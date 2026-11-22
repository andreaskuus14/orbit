import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OUTCOME_TEMPLATES,
  createOutcomeFromTemplate,
  decideApproval,
  deriveOutcomeStatus,
  isSafeOutcomeText,
  readySteps,
  recordCheckResult,
  retryFixStep,
  reviewDeskSummary,
  startReadySteps,
  updateStepStatus,
  type OutcomeProject,
} from "../src/lib/outcome-cockpit-pure.ts";

const T0 = "2026-11-22T10:00:00.000Z";
const T1 = "2026-11-22T10:05:00.000Z";

test("starter templates create parallel cross-planet plans with Rule 6 approvals", () => {
  assert.equal(OUTCOME_TEMPLATES.length, 3);
  const roblox = createOutcomeFromTemplate("roblox-update", { id: "p1", now: T0 }) as OutcomeProject;
  assert.equal(roblox.template, "roblox-update");
  assert.deepEqual(readySteps(roblox).map((s) => s.id), ["s1", "s2"]); // independent lanes run in parallel
  assert.equal(deriveOutcomeStatus(roblox), "active");
  assert.equal(roblox.approvals[0].kind, "publish");
  assert.equal(roblox.approvals[0].status, "waiting");

  const started = startReadySteps(roblox, T1);
  assert.deepEqual(started.steps.filter((s) => s.status === "running").map((s) => s.id), ["s1", "s2"]);
  assert.equal(started.steps.find((s) => s.id === "s3")?.status, "queued"); // waits for s1 + s2
});

test("honest verification gate: failed check triggers needs_fix + blocker, retry reuses verified work, never fakes done", () => {
  let p = createOutcomeFromTemplate("client-shop", { id: "p2", now: T0 }) as OutcomeProject;
  // Verify parallel lanes s1 and s2
  p = updateStepStatus(p, "s1", "verified", { now: T1 }) as OutcomeProject;
  p = updateStepStatus(p, "s2", "verified", { now: T1 }) as OutcomeProject;
  assert.deepEqual(readySteps(p).map((s) => s.id), ["s3"]); // s3 now unblocked
  p = updateStepStatus(p, "s3", "verified", { now: T1 }) as OutcomeProject;
  p = updateStepStatus(p, "s4", "verified", { now: T1 }) as OutcomeProject;
  // Still NOT verified done because checks are pending
  assert.equal(deriveOutcomeStatus(p), "verifying");
  // Cannot approve release before all checks pass
  assert.match(decideApproval(p, "a1", "approved", T1) as string, /All agreed checks must pass/);

  // Fail a check → surfaces blocker & flags build step needs_fix
  p = recordCheckResult(p, "c2", false, "Mobile hero overflows 390px viewport", T1) as OutcomeProject;
  assert.equal(deriveOutcomeStatus(p), "blocked");
  assert.equal(p.steps.find((s) => s.id === "s3")?.status, "needs_fix");
  assert.equal(p.blockers.filter((b) => !b.resolved).length, 1);

  // Retry fix → restarts ONLY s3, marks already-verified sibling steps as reused
  p = retryFixStep(p, "s3", T1) as OutcomeProject;
  assert.equal(p.steps.find((s) => s.id === "s3")?.status, "running");
  assert.equal(p.steps.find((s) => s.id === "s1")?.reused, true);
  assert.equal(p.blockers.filter((b) => !b.resolved).length, 0);

  // Finish fix + pass all checks → waits for owner click approval (Rule 6)
  p = updateStepStatus(p, "s3", "verified", { now: T1 }) as OutcomeProject;
  for (const c of p.checks) p = recordCheckResult(p, c.id, true, "Passed", T1) as OutcomeProject;
  assert.equal(deriveOutcomeStatus(p), "waiting_approval");
  assert.equal(reviewDeskSummary(p).canApprove, true);
  // Cannot bypass approval via step status mutation
  assert.match(updateStepStatus(p, "s5", "verified", { now: T1 }) as string, /Rule 6/);

  // Owner clicks Approve → project is genuinely verified
  p = decideApproval(p, "a1", "approved", T1) as OutcomeProject;
  assert.equal(deriveOutcomeStatus(p), "verified");
  assert.equal(reviewDeskSummary(p).pct, 100);
});

test("Rule 6 privacy wall rejects journal/LIFE text and credentials", () => {
  assert.equal(isSafeOutcomeText("Launch Roblox tycoon v2"), true);
  assert.equal(isSafeOutcomeText("Summarize my private journal"), false);
  assert.equal(isSafeOutcomeText("Use sk-1234567890abcdef1234"), false);
  assert.match(createOutcomeFromTemplate("custom", { id: "x", title: "My diary plan", now: T0 }) as string, /Rule 6/);
});

test("disk store round-trip persists and updates outcomes cleanly", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-outcomes-"));
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--import",
      "./tests/fixtures/ts-resolve.mjs",
      "-e",
      `import { createOutcome, listOutcomes, runParallelOutcomeSteps, deleteOutcome } from "./src/lib/outcome-cockpit.ts";
       const c = await createOutcome("u1", { template: "week-of-shorts" });
       if (!c.project) throw new Error(c.error);
       const r = await runParallelOutcomeSteps("u1", c.project.id);
       const list = await listOutcomes("u1");
       const del = await deleteOutcome("u1", c.project.id);
       console.log(JSON.stringify({ running: r.project.steps.filter(s => s.status === "running").length, count: list.length, del }));`,
    ],
    { env: { ...process.env, ORBIT_DATA_DIR: dir }, encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(out.trim()), { running: 2, count: 1, del: true });
});
