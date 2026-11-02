import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_TRIES, idemKey, lastDone, leaseFree, parseJobLog, planStep, recordStep, type JobLog } from "../src/lib/job-log-pure.ts";

process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-joblog-"));
const { jobEffect, jobStep, readJob, releaseLease, takeLease } = await import("../src/lib/job-log.ts");

test("planStep: run, replay a finished step, same idem key on retry, give up after MAX_TRIES", () => {
  const log: JobLog = {}, now = Date.parse("2026-11-02T10:00:00Z");
  const p1 = planStep(log, "j", "a", true);
  assert.equal(p1.do, "run");
  assert.equal(p1.do === "run" && p1.idem, idemKey("j", "a"));
  recordStep(log, "j", "a", { status: "started", tries: 1, idem: idemKey("j", "a") }, now);
  const p2 = planStep(log, "j", "a", true); // crashed mid-call: retried with the key saved before the call
  assert.deepEqual(p2, { do: "run", tries: 2, retry: true, idem: idemKey("j", "a") });
  recordStep(log, "j", "a", { status: "done", tries: 2, result: { id: "t1" } }, now);
  assert.deepEqual(planStep(log, "j", "a", true), { do: "replay", result: { id: "t1" } });
  recordStep(log, "j", "b", { status: "failed", tries: MAX_TRIES, error: "boom" }, now);
  assert.deepEqual(planStep(log, "j", "b", false), { do: "give-up", error: "boom" });
  assert.equal(lastDone(log, "j"), "a");
  assert.notEqual(idemKey("j", "a"), idemKey("j", "b"));
});

test("recordStep drops oversized results; parseJobLog drops bad and old entries", () => {
  const now = Date.now(), log: JobLog = {};
  recordStep(log, "j", "big", { status: "done", tries: 1, result: "x".repeat(10_000) }, now);
  assert.equal("result" in log.j.steps.big, false);
  const parsed = parseJobLog({ j: log.j, "bad id!": log.j, old: { steps: {}, updatedAt: new Date(now - 30 * 86_400_000).toISOString() }, x: { steps: { s: { status: "weird", at: "t" } }, updatedAt: new Date(now).toISOString() } }, now);
  assert.deepEqual(Object.keys(parsed).sort(), ["j", "x"]);
  assert.deepEqual(parsed.x.steps, {});
});

test("leaseFree: missing, expired or own", () => {
  assert.equal(leaseFree(null, "a", 5), true);
  assert.equal(leaseFree({ owner: "b", until: 10 }, "a", 5), false);
  assert.equal(leaseFree({ owner: "b", until: 10 }, "a", 10), true);
  assert.equal(leaseFree({ owner: "a", until: 10 }, "a", 5), true);
});

test("jobStep replays after a restart; jobEffect keeps its idem key across a crash", async () => {
  let runs = 0;
  assert.equal(await jobStep("job-1", "one", async () => { runs++; return 7; }), 7);
  assert.equal(await jobStep("job-1", "one", async () => { runs++; return 8; }), 7); // from the log
  assert.equal(runs, 1);
  const keys: string[] = [];
  await assert.rejects(jobEffect("job-1", "send", async (k) => { keys.push(k); throw new Error("crash"); }));
  assert.equal(await jobEffect("job-1", "send", async (k) => { keys.push(k); return "ok"; }), "ok");
  assert.equal(keys[0], keys[1]);
  assert.equal((await readJob("job-1"))?.steps.send.status, "done");
});

test("takeLease: one owner at a time, expired lease taken over, release only by its owner", async () => {
  const t0 = Date.now();
  assert.equal(await takeLease("night", 60_000, "A", t0), true);
  assert.equal(await takeLease("night", 60_000, "B", t0 + 1000), false);
  assert.equal(await takeLease("night", 60_000, "A", t0 + 1000), true); // renew
  await releaseLease("night", "B"); // not B's: kept
  assert.equal(await takeLease("night", 60_000, "B", t0 + 2000), false);
  assert.equal(await takeLease("night", 60_000, "B", t0 + 120_000), true); // A's expired
  await releaseLease("night", "B");
  assert.equal(await takeLease("night", 1000, "A", t0 + 130_000), true);
});
