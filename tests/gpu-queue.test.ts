import test from "node:test";
import assert from "node:assert/strict";
import { afterFailure, backoffMs, canCancel, claimNext, jobProgress, kindOfTool, queueOn, retryable, runnerError, validatePayload, workerOn, type GpuJob } from "../src/lib/gpu-queue-pure.ts";

const T0 = Date.parse("2026-11-24T10:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const job = (o: Partial<GpuJob> = {}): GpuJob => ({
  id: "a", user_id: "u", kind: "image", payload: { tool: "local_image", input: { prompt: "a cat" } }, status: "queued", worker: null,
  progress: 0, progress_text: null, result: null, error: null, attempts: 0, max_attempts: 3, run_after: iso(T0 - 1000), lease_until: null,
  created_at: iso(T0 - 5000), claimed_at: null, started_at: null, finished_at: null, updated_at: iso(T0 - 5000), ...o,
});

test("flag: off by default, worker follows the flag unless ORBIT_GPU_WORKER=0", () => {
  assert.equal(queueOn({}), false); assert.equal(queueOn({ ORBIT_GPU_QUEUE: "1" }), true); assert.equal(queueOn({ ORBIT_GPU_QUEUE: "true" }), false);
  assert.equal(workerOn({ ORBIT_GPU_QUEUE: "1" }), true); assert.equal(workerOn({ ORBIT_GPU_QUEUE: "1", ORBIT_GPU_WORKER: "0" }), false); assert.equal(workerOn({}), false);
  assert.equal(kindOfTool("local_3d"), "3d"); assert.equal(kindOfTool("local_transcribe"), null);
});

test("payload validation refuses journal / LIFE data in every shape", () => {
  assert.equal(validatePayload("image", { tool: "local_image", input: { prompt: "a red car" } }).ok, true);
  assert.equal(validatePayload("nope", {}).ok, false);
  assert.equal(validatePayload("image", []).ok, false);
  for (const p of [
    { journal: "today I…" }, { input: { life: {} } }, { input: { kind: "journal", text: "x" } }, { input: { tags: ["life:mood"] } },
    { input: { prompt: "my journal entry from Monday" } }, { input: { prompt: "x".repeat(5000) } }, { a: { b: { c: { d: { e: { f: 1 } } } } } },
    { n: Number.NaN },
  ]) assert.equal(validatePayload("image", p).ok, false, JSON.stringify(p).slice(0, 60));
});

test("claim: oldest due job of a known kind, lease set, attempts counted; two claims never get the same job", () => {
  const jobs = [job({ id: "late", run_after: iso(T0 + 60_000) }), job({ id: "b", created_at: iso(T0 - 2000) }), job({ id: "a" }), job({ id: "v", kind: "video" })];
  const one = claimNext(jobs, "w1", ["image"], 60_000, T0);
  assert.equal(one.job?.id, "a"); assert.equal(one.job?.status, "claimed"); assert.equal(one.job?.attempts, 1); assert.equal(one.job?.lease_until, iso(T0 + 60_000));
  const two = claimNext(one.jobs, "w2", ["image"], 60_000, T0);
  assert.equal(two.job?.id, "b");
  assert.equal(claimNext(two.jobs, "w3", ["image"], 60_000, T0).job, null); // "late" not due yet
});

test("lease expiry: a lost job is taken over; out of attempts it fails", () => {
  const lost = job({ status: "running", worker: "w1", attempts: 1, lease_until: iso(T0 - 1) });
  const r = claimNext([lost], "w2", ["image"], 60_000, T0);
  assert.equal(r.job?.worker, "w2"); assert.equal(r.job?.attempts, 2);
  assert.equal(claimNext([{ ...lost, lease_until: iso(T0 + 1000) }], "w2", ["image"], 60_000, T0).job, null); // still leased
  const dead = claimNext([{ ...lost, attempts: 3 }], "w2", ["image"], 60_000, T0);
  assert.equal(dead.job, null); assert.equal(dead.jobs[0].status, "failed");
});

test("retry with backoff; permanent errors fail at once", () => {
  assert.deepEqual([1, 2, 3].map(backoffMs), [30_000, 120_000, 480_000]); assert.equal(backoffMs(9), 30 * 60_000);
  const r = afterFailure({ attempts: 1, max_attempts: 3 }, "ComfyUI timed out", T0);
  assert.equal(r.status, "queued"); assert.equal(r.status === "queued" && r.run_after, iso(T0 + 30_000));
  assert.equal(afterFailure({ attempts: 3, max_attempts: 3 }, "timed out", T0).status, "failed");
  assert.equal(afterFailure({ attempts: 1, max_attempts: 3 }, "ComfyUI isn't installed", T0).status, "failed");
  assert.equal(retryable("fetch failed ECONNREFUSED"), true);
  assert.equal(runnerError("Error: boom"), "boom"); assert.equal(runnerError("Saved the picture"), null);
});

test("cancel only unfinished jobs; cards show waiting / working / done / cancelled", () => {
  assert.equal(canCancel("queued"), true); assert.equal(canCancel("running"), true); assert.equal(canCancel("done"), false); assert.equal(canCancel("cancelled"), false);
  assert.equal(jobProgress(job(), "en", T0).phase, "waiting");
  const run = jobProgress(job({ status: "running", progress: 0.5, progress_text: "Making it", started_at: iso(T0) }), "en", T0);
  assert.equal(run.phase, "working"); assert.equal(run.now, "Making it");
  const done = jobProgress(job({ status: "done", result: { text: "Saved x.png" } }), "et", T0);
  assert.equal(done.phase, "done"); assert.equal(done.result?.text, "Saved x.png");
  const c = jobProgress(job({ status: "cancelled" }), "en", T0);
  assert.equal(c.phase, "failed"); assert.equal(c.result?.text, "Cancelled"); assert.equal(c.action, null);
  assert.match(jobProgress(job({ attempts: 1 }), "en", T0).now ?? "", /Trying again \(2\/3\)/);
});
