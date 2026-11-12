import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// STUDIO plans on the plan-jobs runner (real plan-jobs.ts, stop-all.ts, autonomy.ts, job-log leases); only the STUDIO step bodies are faked.
const root = path.join(import.meta.dirname, "..");
const old = { id: "plan-old1", goal: "5 shorts", createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z", status: "running", current: 2, jobId: "j1",
  steps: [{ type: "clip", args: { source: "a.mp4", count: 5 }, status: "done" }, { type: "wait", args: {}, status: "done" }, { type: "pick_best", args: { n: 2 }, status: "pending" },
    { type: "approve", args: {}, status: "pending" }, { type: "schedule", args: {}, status: "pending" }] };

async function scenario(body: string, autonomy?: object) {
  const data = await mkdtemp(path.join(tmpdir(), "orbit-splan-")), studio = path.join(data, "studio");
  await mkdir(studio, { recursive: true });
  await writeFile(path.join(studio, "plans.json"), JSON.stringify({ v: 1, plans: [old] })); // the old plans.ts format
  if (autonomy) await writeFile(path.join(data, "autonomy.json"), JSON.stringify(autonomy));
  const code = `const L = (m) => import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib")).href)} + "/" + m);
const pj = await L("plan-jobs.ts"), stop = await L("stop-all.ts"), fs = await import("node:fs");
const ran = []; const fake = async (_id, p, s) => { ran.push(s.type); return s.type + " ok"; };
const out = {};
${body}
console.log(JSON.stringify(out)); process.exit(0);`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ORBIT_DATA_DIR: data, ORBIT_STUDIO_DIR: studio }, timeout: 80_000 });
  return JSON.parse(stdout.trim().split("\n").pop()!);
}

test("old plans.json loads into plan-jobs; the plan runs through the runner and pauses for the schedule OK", { timeout: 90_000 }, async () => {
  const got = await scenario(`const p = await pj.currentStudioPlan();
out.loaded = { id: p.id, current: p.current, jobId: p.jobId };
out.migrated = fs.existsSync(process.env.ORBIT_STUDIO_DIR + "/plans.json.migrated") && !fs.existsSync(process.env.ORBIT_STUDIO_DIR + "/plans.json");
await pj.resumeStudioPlans(fake);
const q = await pj.currentStudioPlan();
out.ran = ran; out.status = q.status; out.current = q.current; out.notes = q.steps.map((s) => s.note ?? null);
out.badOk = await pj.studioPlanAction(q.id, "confirm", 1);
out.cancel = await pj.studioPlanAction(q.id, "cancel", 0); out.after = (await pj.currentStudioPlan()).status;
out.visibleToJobsUi = (await pj.listPlanJobs()).length;`);
  assert.deepEqual(got.loaded, { id: "plan-old1", current: 2, jobId: "j1" });
  assert.equal(got.migrated, true);
  assert.deepEqual(got.ran, ["pick_best", "approve"]);
  assert.equal(got.status, "waiting");
  assert.equal(got.current, 4);
  assert.deepEqual(got.notes.slice(2, 4), ["pick_best ok", "approve ok"]);
  assert.match(got.badOk, /doesn't need an OK/);
  assert.equal(got.cancel, "");
  assert.equal(got.after, "cancelled");
  assert.equal(got.visibleToJobsUi, 0);
});

test("Stop-all halts a STUDIO plan between steps; Resume continues it", { timeout: 90_000 }, async () => {
  const got = await scenario(`await stop.setStopAll(true);
await pj.resumeStudioPlans(fake); await pj.tickStudioPlans(fake);
out.during = { ran: [...ran], current: (await pj.currentStudioPlan()).current };
await stop.setStopAll(false);
await pj.tickStudioPlans(fake);
out.after = { ran, status: (await pj.currentStudioPlan()).status };`);
  assert.deepEqual(got.during, { ran: [], current: 2 });
  assert.deepEqual(got.after, { ran: ["pick_best", "approve"], status: "waiting" });
});

test("Autonomy: Studio prepare Off (or Ask) stops background resume; his own open of CORE still drives it", { timeout: 90_000 }, async () => {
  for (const level of ["off", "ask"]) {
    const got = await scenario(`await pj.tickStudioPlans(fake);
out.tick = [...ran];
await pj.resumeStudioPlans(fake);
out.owner = ran;`, { levels: { "studio-prepare": level } });
    assert.deepEqual(got.tick, [], level);
    assert.deepEqual(got.owner, ["pick_best", "approve"], level);
  }
});
