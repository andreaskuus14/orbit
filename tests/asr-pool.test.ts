import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { NoWorkerError, createAsrLanes, createPool } from "../src/lib/asr-pool.ts";

const FAKE = path.join(import.meta.dirname, "fixtures", "asr-fake-worker.mjs");
const audio = (n = 16) => new Float32Array(n);

test("pool answers in FIFO order on one worker and keeps outputs as-is", async () => {
  const pool = createPool(FAKE, 1);
  const order: number[] = [];
  const runs = [30, 0, 0].map((ms, i) => pool.run({ model: "m", audio: audio(i + 1), options: { ms } }, 5000).then((r) => { order.push(i); return r; }));
  const out = await Promise.all(runs);
  assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(out[1], { text: "m:2", chunks: [{ text: " hi", timestamp: [0, 0.5] }] });
  pool.close();
});

test("two workers run two requests at once", async () => {
  const pool = createPool(FAKE, 2);
  const t = Date.now();
  await Promise.all([pool.run({ model: "m", audio: audio(), options: { ms: 300 } }, 5000), pool.run({ model: "m", audio: audio(), options: { ms: 300 } }, 5000)]);
  assert.ok(Date.now() - t < 550, "ran in parallel");
  pool.close();
});

test("crash rejects only the running request; a new worker serves the queue", async () => {
  const pool = createPool(FAKE, 1);
  const a = pool.run({ model: "m", audio: audio(), options: { crash: true } }, 5000);
  const b = pool.run({ model: "m", audio: audio(3) }, 5000);
  await assert.rejects(a, /exited \(code 3\)/);
  assert.equal((await b as { text: string }).text, "m:3");
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

test("missing worker script: falls back to in-process once", async () => {
  const calls: string[] = [];
  const errs: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errs.push(a); };
  try {
    const lanes = createAsrLanes(path.join(import.meta.dirname, "fixtures", "nope.mjs"), { voice: 1, clip: 1 }, async (model) => {
      calls.push(model);
      return async (a) => ({ text: `local:${a.length}` });
    });
    const asr = await lanes.pipeline("clip", "base", {}, "/cache");
    assert.deepEqual(await asr(audio(4)), { text: "local:4" });
    assert.deepEqual(await asr(audio(2)), { text: "local:2" });
    assert.deepEqual(calls, ["base"]);
    assert.equal(errs.length, 1);
    await assert.rejects(lanes.pools.clip.run({}, 10), NoWorkerError);
  } finally { console.error = orig; }
});

test("model that won't load in the worker: lane switches to in-process once, request retried there", async () => {
  const calls: string[] = [];
  const errs: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errs.push(a); };
  try {
    const lanes = createAsrLanes(FAKE, { voice: 1, clip: 1 }, async (model) => { calls.push(model); return async (a) => ({ text: `local:${a.length}` }); });
    const asr = await lanes.pipeline("clip", "broken", {}, "/cache");
    assert.deepEqual(await asr(audio(4)), { text: "local:4" });
    assert.equal(lanes.pools.clip.dead, true);
    assert.equal(lanes.pools.voice.dead, false);
    assert.deepEqual(calls, ["broken"]);
    assert.equal(errs.length, 1);
    // model download failure surfaces as a plain error and keeps the worker lane
    await assert.rejects(lanes.pipeline("voice", "offline", {}, "/cache"), /download/);
    assert.equal(lanes.pools.voice.dead, false);
    // per-audio errors still surface without switching lanes
    const voice = await lanes.pipeline("voice", "small.en", {}, "/cache");
    await assert.rejects(voice(audio(), { fail: true }), /alignment/);
    assert.equal(lanes.pools.voice.dead, false);
    lanes.close();
  } finally { console.error = orig; }
});
