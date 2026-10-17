import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { NoWorkerError, asrWorkers, createAsrLanes, createPool, type AsrPhase } from "../src/lib/asr-pool.ts";

const FAKE = path.join(import.meta.dirname, "fixtures", "asr-fake-worker.mjs");
const audio = (n = 16) => new Float32Array(n);

test("pool answers in FIFO order on one worker and keeps outputs as-is", async () => {
  const pool = createPool(FAKE, 1);
  const order: number[] = [];
  const runs = [30, 0, 0].map((ms, i) => pool.run({ model: "m", audio: audio(i + 1), options: { ms } }, 5000).then((r) => { order.push(i); return r; }));
  const out = await Promise.all(runs);
  assert.deepEqual(order, [0, 1, 2]); // and no "overlap" error: one request at a time per child
  const { pid: _, ...rest } = out[1] as { pid: number };
  assert.deepEqual(rest, { text: "m:2", chunks: [{ text: " hi", timestamp: [0, 0.5] }] });
  pool.close();
});

test("two workers run two requests at once", async () => {
  const pool = createPool(FAKE, 2);
  await Promise.all([pool.run({ model: "m", audio: audio() }, 5000), pool.run({ model: "m", audio: audio() }, 5000)]); // warm: both children started
  const t = Date.now();
  await Promise.all([pool.run({ model: "m", audio: audio(), options: { ms: 300 } }, 5000), pool.run({ model: "m", audio: audio(), options: { ms: 300 } }, 5000)]);
  assert.ok(Date.now() - t < 550, "ran in parallel");
  pool.close();
});

test("crash kills only the child: rejects the running request, a new child serves the queue", async () => {
  const pool = createPool(FAKE, 1);
  const first = await pool.run({ model: "m", audio: audio() }, 5000) as { pid: number };
  assert.notEqual(first.pid, process.pid, "runs in its own process");
  const a = pool.run({ model: "m", audio: audio(), options: { crash: true } }, 5000);
  const b = pool.run({ model: "m", audio: audio(3) }, 5000);
  await assert.rejects(a, /exited \(code 3\)/);
  const next = await b as { text: string; pid: number };
  assert.equal(next.text, "m:3");
  assert.notEqual(next.pid, first.pid);
  assert.equal(pool.dead, false);
  pool.close();
});

test("timeout rejects and restarts the worker; worker errors keep their message", async () => {
  const pool = createPool(FAKE, 1);
  await assert.rejects(pool.run({ model: "m", audio: audio(), options: { hang: true } }, 100), /timed out/);
  await assert.rejects(pool.run({ model: "m", audio: audio(), options: { fail: true } }, 5000), /alignment/);
  assert.equal((await pool.run({ model: "m", audio: audio(5) }, 5000) as { text: string }).text, "m:5");
  pool.close();
});

test("voice lane isn't stuck behind a busy clip lane", async () => {
  const lanes = createAsrLanes(FAKE, { voice: 1, clip: 1 });
  const clip = await lanes.pipeline("clip", "base", {}, "/cache");
  const voice = await lanes.pipeline("voice", "small.en", {}, "/cache");
  let clipDone = false;
  const c = clip(audio(), { ms: 500 }).then(() => { clipDone = true; });
  assert.equal((await voice(audio(7)) as { text: string }).text, "small.en:7");
  assert.equal(clipDone, false);
  await c;
  lanes.close();
});

test("missing worker script: voice falls back to in-process once, clip throws", async () => {
  const calls: string[] = [];
  const errs: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errs.push(a); };
  try {
    const lanes = createAsrLanes(path.join(import.meta.dirname, "fixtures", "nope.mjs"), { voice: 1, clip: 1 }, async (model) => {
      calls.push(model);
      return async (a) => ({ text: `local:${a.length}` });
    });
    const asr = await lanes.pipeline("voice", "base", {}, "/cache");
    assert.deepEqual(await asr(audio(4)), { text: "local:4" });
    assert.deepEqual(await asr(audio(2)), { text: "local:2" });
    assert.deepEqual(calls, ["base"]);
    assert.equal(errs.length, 2); // "script not found" + "worker unusable"
    await assert.rejects(lanes.pools.voice.run({}, 10), NoWorkerError);
    await assert.rejects(lanes.pipeline("clip", "base", {}, "/cache"), /own process/);
    assert.deepEqual(calls, ["base"]);
  } finally { console.error = orig; }
});

test("runtime that won't load in the child: voice switches to in-process once, clip throws", async () => {
  const calls: string[] = [];
  const errs: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errs.push(a); };
  try {
    const lanes = createAsrLanes(FAKE, { voice: 1, clip: 1 }, async (model) => { calls.push(model); return async (a) => ({ text: `local:${a.length}` }); });
    // model download failure surfaces as a plain error and keeps the child lane
    await assert.rejects(lanes.pipeline("clip", "offline", {}, "/cache"), /download/);
    assert.equal(lanes.pools.clip.dead, false);
    // per-audio errors still surface without switching lanes
    const clip = await lanes.pipeline("clip", "base", {}, "/cache");
    await assert.rejects(clip(audio(), { fail: true }), /alignment/);
    assert.equal(lanes.pools.clip.dead, false);
    const asr = await lanes.pipeline("voice", "broken", {}, "/cache");
    assert.deepEqual(await asr(audio(4)), { text: "local:4" });
    assert.equal(lanes.pools.voice.dead, true);
    assert.equal(lanes.pools.clip.dead, false);
    assert.deepEqual(calls, ["broken"]);
    assert.equal(errs.length, 1);
    await assert.rejects(lanes.pipeline("clip", "broken", {}, "/cache"), /own process/);
    assert.deepEqual(calls, ["broken"]);
    lanes.close();
  } finally { console.error = orig; }
});

test("clip lane defaults to one child", () => {
  const old = process.env.ORBIT_ASR_WORKERS;
  delete process.env.ORBIT_ASR_WORKERS;
  try { assert.equal(asrWorkers(), 1); process.env.ORBIT_ASR_WORKERS = "3"; assert.equal(asrWorkers(), 3); }
  finally { if (old === undefined) delete process.env.ORBIT_ASR_WORKERS; else process.env.ORBIT_ASR_WORKERS = old; }
});

test("load reports downloading → loading to the caller", async () => {
  const lanes = createAsrLanes(FAKE, { voice: 1, clip: 1 });
  const seen: AsrPhase[] = [];
  await lanes.pipeline("clip", "fresh", {}, "/cache", (p) => seen.push(p));
  assert.deepEqual(seen, [{ phase: "downloading" }, { phase: "downloading", f: 0.5 }, { phase: "loading" }]);
  lanes.close();
});

test("in-process fallback runs one onnxruntime call at a time, across models", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    let active = 0, peak = 0;
    const lanes = createAsrLanes(path.join(import.meta.dirname, "fixtures", "nope.mjs"), { voice: 1, clip: 1 }, async () => async (a) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return { text: `local:${a.length}` };
    });
    const [en, multi] = await Promise.all([lanes.pipeline("voice", "small.en", {}, "/c"), lanes.pipeline("voice", "small", {}, "/c")]);
    await Promise.all([en(audio()), multi(audio()), en(audio()), multi(audio())]);
    assert.equal(peak, 1);
  } finally { console.error = orig; }
});

const quiet = async (fn: () => Promise<void>) => { const orig = console.error; console.error = () => {}; try { await fn(); } finally { console.error = orig; } };

test("child that never says ready: start timeout, 3 tries with backoff, then gives up", async () => quiet(async () => {
  const pool = createPool(path.join(import.meta.dirname, "fixtures", "asr-silent-worker.mjs"), 1, 100);
  const t = Date.now();
  await assert.rejects(pool.run({ model: "m", audio: audio() }, 5000), (e: Error) => e instanceof NoWorkerError && /start in time/.test(e.message));
  assert.ok(Date.now() - t >= 3000, "backed off 1 s + 2 s between tries");
  assert.equal(pool.dead, true);
}));

test("3 crashes in a row: new requests fail fast for a while", async () => quiet(async () => {
  const pool = createPool(FAKE, 1);
  for (let i = 0; i < 3; i++) await assert.rejects(pool.run({ model: "m", audio: audio(), options: { crash: true } }, 5000), /exited/);
  const t = Date.now();
  await assert.rejects(pool.run({ model: "m", audio: audio() }, 5000), /paused/);
  assert.ok(Date.now() - t < 100);
  assert.equal(pool.dead, false);
  pool.close();
}));

test("a request that can't be sent fails alone; the child keeps serving", async () => {
  const pool = createPool(FAKE, 1);
  await assert.rejects(pool.run({ model: "m", audio: audio(), options: { f: () => 1 } }, 5000));
  assert.equal((await pool.run({ model: "m", audio: audio(6) }, 5000) as { text: string }).text, "m:6");
  pool.close();
});
