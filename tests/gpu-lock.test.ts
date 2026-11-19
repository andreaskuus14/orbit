import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beat, drop, emptyGpu, enqueue, gpuSlots, gpuStatus, holds, tick, waitText, type GpuKind, type GpuState } from "../src/lib/gpu-lock-pure.ts";

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-gpu-"));
const { acquireGpu, gpuNow, withGpu } = await import("../src/lib/gpu-lock.ts");

const w = (id: string, kind: GpuKind, now: number, wait = 60_000, ttl = 10_000) => ({ id, kind, since: now, deadline: now + wait, ttl });

test("gpuSlots: default 1, clamped 1-4", () => {
  assert.equal(gpuSlots(undefined), 1);
  assert.equal(gpuSlots("0"), 1);
  assert.equal(gpuSlots("x"), 1);
  assert.equal(gpuSlots("2"), 2);
  assert.equal(gpuSlots("9"), 4);
});

test("tick: one at a time, strict FIFO, release hands on to the next", () => {
  let s: GpuState = emptyGpu(1);
  for (const id of ["a", "b", "c"]) s = enqueue(s, w(id, id === "a" ? "3d" : "image", 0));
  let t = tick(s, 0);
  assert.deepEqual(t.granted, ["a"]);
  s = t.state;
  assert.deepEqual(tick(s, 1).granted, []);
  assert.equal(waitText(s, "b"), "Waiting for the GPU (3D model running)");
  assert.equal(waitText(s, "c"), "Waiting for the GPU (3D model running; 1 ahead in line)");
  assert.equal(waitText(s, "a"), "");
  t = tick(drop(s, "a"), 2);
  assert.deepEqual(t.granted, ["b"]);
  t = tick(drop(t.state, "b"), 3);
  assert.deepEqual(t.granted, ["c"]);
});

test("tick: a lone job is granted at once (no change when only one job runs)", () => {
  const t = tick(enqueue(emptyGpu(), w("x", "render", 5)), 5);
  assert.deepEqual(t.granted, ["x"]);
  assert.ok(holds(t.state, "x"));
});

test("tick: two slots run two jobs", () => {
  let s = emptyGpu(2);
  for (const id of ["a", "b", "c"]) s = enqueue(s, w(id, "image", 0));
  assert.deepEqual(tick(s, 0).granted, ["a", "b"]);
});

test("expiry: a lease without heartbeat expires and the next waiter gets the GPU; a heartbeat keeps it", () => {
  let s = tick(enqueue(emptyGpu(), w("a", "3d", 0, 60_000, 10_000)), 0).state;
  s = enqueue(s, w("b", "image", 0));
  s = beat(s, "a", 8_000); // until 18 s
  let t = tick(s, 15_000);
  assert.deepEqual(t.granted, []);
  t = tick(t.state, 18_000);
  assert.deepEqual(t.expired.map((h) => h.id), ["a"]);
  assert.deepEqual(t.granted, ["b"]);
  assert.ok(!holds(t.state, "a"));
  // the expired holder releasing late is a no-op and doesn't free b's lease
  assert.ok(holds(drop(t.state, "a"), "b"));
});

test("wait timeout: a waiter past its deadline is dropped, the rest keep their place", () => {
  let s = tick(enqueue(emptyGpu(), w("a", "3d", 0, 60_000, 999_999)), 0).state;
  s = enqueue(enqueue(s, w("b", "image", 0, 1_000)), w("c", "image", 0, 60_000));
  const t = tick(s, 1_000);
  assert.deepEqual(t.timedOut, ["b"]);
  assert.deepEqual(t.state.queue.map((q) => q.id), ["c"]);
  assert.equal(waitText(t.state, "c"), "Waiting for the GPU (3D model running)");
});

test("gpuStatus: free, busy with minutes and waiting count", () => {
  assert.equal(gpuStatus(emptyGpu(), 0).text, "GPU free");
  let s = tick(enqueue(emptyGpu(), w("a", "3d", 0)), 0).state;
  s = enqueue(s, w("b", "render", 0));
  const st = gpuStatus(s, 4 * 60_000);
  assert.equal(st.text, "GPU busy: 3D model, 4 min (1 waiting)");
  assert.equal(st.busy, true);
});

test("acquireGpu: second waits until the first releases, with a wait message; abort leaves the queue", async () => {
  const a = await acquireGpu("3d");
  const waits: string[] = [];
  let bGot = false;
  const b = acquireGpu("image", { onWait: (t) => waits.push(t) }).then((l) => { bGot = true; return l; });
  const ctrl = new AbortController();
  const c = acquireGpu("render", { signal: ctrl.signal });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bGot, false);
  assert.deepEqual(waits, ["Waiting for the GPU (3D model running)"]);
  assert.match(gpuNow().text, /^GPU busy: 3D model, 0 min \(2 waiting\)$/);
  ctrl.abort();
  await assert.rejects(c);
  a.release();
  a.release(); // twice is harmless
  const lb = await b;
  assert.equal(gpuNow().waiting, 0);
  lb.release();
  assert.equal(gpuNow().text, "GPU free");
});

test("acquireGpu: maxWaitMs rejects with a timeout reason; withGpu releases on throw", async () => {
  const a = await acquireGpu("3d");
  await assert.rejects(acquireGpu("image", { maxWaitMs: 50 }), (e: Error & { reason?: string }) => e.reason === "timeout");
  a.release();
  await assert.rejects(withGpu("image", {}, async () => { throw new Error("boom"); }), /boom/);
  assert.equal(gpuNow().text, "GPU free");
});
