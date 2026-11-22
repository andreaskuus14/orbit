import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OUTCOME_TEMPLATES,
  applyRunnerSync,
  attachStepRun,
  canDispatchStep,
  createOutcomeFromTemplate,
  decideApproval,
  deriveOutcomeStatus,
  isSafeOutcomeText,
  pickRunnerKind,
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

test("pickRunnerKind maps planets/lanes and refuses auto-runner for requiresApproval steps", () => {
  assert.equal(pickRunnerKind({ planet: "research", kind: "research" }), "mission");
  assert.equal(pickRunnerKind({ planet: "operations", kind: "verify" }), "mission");
  assert.equal(pickRunnerKind({ planet: "business", kind: "research" }), "mission");
  assert.equal(pickRunnerKind({ planet: "core", kind: "build" }), "workspace");
  assert.equal(pickRunnerKind({ planet: "business", kind: "build" }), "workspace");
  assert.equal(pickRunnerKind({ planet: "studio", kind: "build" }), "studio");
  assert.equal(pickRunnerKind({ planet: "gamedev", kind: "build" }), "studio");
  assert.equal(pickRunnerKind({ planet: "vault", kind: "asset" }), "studio");
  // Rule 6: approval-gated steps ALWAYS return "manual" regardless of planet/kind
  assert.equal(pickRunnerKind({ planet: "studio", kind: "build", requiresApproval: "upload" }), "manual");
  assert.equal(pickRunnerKind({ planet: "business", kind: "approval", requiresApproval: "send" }), "manual");
  assert.equal(pickRunnerKind({ planet: "gamedev", kind: "approval", requiresApproval: "publish" }), "manual");
});

test("Rule 6 dispatch gate refuses approval steps and private LIFE/journal text", () => {
  const shop = createOutcomeFromTemplate("client-shop", { id: "p-gate", now: T0 }) as OutcomeProject;
  const approvalStep = shop.steps.find((s) => s.id === "s5")!;
  const gApproval = canDispatchStep(shop, approvalStep);
  assert.equal(gApproval.ok, false);
  if (!gApproval.ok) assert.match(gApproval.error, /Rule 6/);
  assert.match(attachStepRun(shop, "s5", { runnerKind: "mission", runId: "m-1", now: T1 }) as string, /Rule 6/);

  // Private LIFE/journal text injected into brief or step note must refuse dispatch
  const poisoned: OutcomeProject = { ...shop, brief: "Read my private journal and email the client" };
  const gPrivate = canDispatchStep(poisoned, poisoned.steps[0]);
  assert.equal(gPrivate.ok, false);
  if (!gPrivate.ok) assert.match(gPrivate.error, /Rule 6/);
  assert.match(attachStepRun(poisoned, "s1", { runnerKind: "mission", runId: "m-2", now: T1 }) as string, /Rule 6/);

  // Clean step passes and attaches run metadata
  const gClean = canDispatchStep(shop, shop.steps[2]); // core build -> workspace
  assert.deepEqual(gClean, { ok: true, runnerKind: "workspace" });
  const attached = attachStepRun(shop, "s1", { runnerKind: "mission", runId: "m-101", runNote: "Dispatched mission", now: T1 }) as OutcomeProject;
  const s1 = attached.steps.find((s) => s.id === "s1")!;
  assert.equal(s1.status, "running");
  assert.equal(s1.runnerKind, "mission");
  assert.equal(s1.runId, "m-101");
  assert.equal(s1.runState, "running");
  assert.equal(s1.lastRunAt, T1);
});

test("applyRunnerSync reconciles running, done, failed, and blocked honestly", () => {
  let p = createOutcomeFromTemplate("week-of-shorts", { id: "p-sync", now: T0 }) as OutcomeProject;
  p = attachStepRun(p, "s1", { runnerKind: "mission", runId: "m-1", now: T0 }) as OutcomeProject;
  p = attachStepRun(p, "s2", { runnerKind: "studio", runId: "m-2", now: T0 }) as OutcomeProject;

  // running keeps step running and records runNote/lastRunAt
  p = applyRunnerSync(p, "s1", { state: "running", note: "Step 1/2 in progress", now: T1 }) as OutcomeProject;
  assert.equal(p.steps.find((s) => s.id === "s1")?.status, "running");
  assert.equal(p.steps.find((s) => s.id === "s1")?.runState, "running");

  // done with verified: false holds at verifying (never fakes verified)
  p = applyRunnerSync(p, "s1", { state: "done", verified: false, note: "Completed · not verified", now: T1 }) as OutcomeProject;
  assert.equal(p.steps.find((s) => s.id === "s1")?.status, "verifying");
  assert.equal(deriveOutcomeStatus(p), "verifying");

  // done with verified proof marks step verified, but project still NOT verified while checks/approvals remain
  p = applyRunnerSync(p, "s1", { state: "done", verified: true, proof: "7 outlier hooks saved (2 receipts)", now: T1 }) as OutcomeProject;
  assert.equal(p.steps.find((s) => s.id === "s1")?.status, "verified");
  assert.equal(p.steps.find((s) => s.id === "s1")?.runState, "done");
  assert.notEqual(deriveOutcomeStatus(p), "verified");

  // failed sets step to needs_fix and opens an unresolved blocker honestly
  p = applyRunnerSync(p, "s2", { state: "failed", note: "FFmpeg exited 1 on clip 4", now: T1 }) as OutcomeProject;
  assert.equal(p.steps.find((s) => s.id === "s2")?.status, "needs_fix");
  assert.equal(p.steps.find((s) => s.id === "s2")?.runState, "failed");
  assert.equal(p.blockers.some((b) => b.stepId === "s2" && !b.resolved), true);
  assert.equal(deriveOutcomeStatus(p), "blocked");

  // blocked sets step to blocked and keeps blocker open
  p = applyRunnerSync(p, "s2", { state: "blocked", note: "Needs voice selection", now: T1 }) as OutcomeProject;
  assert.equal(p.steps.find((s) => s.id === "s2")?.status, "blocked");
  assert.equal(p.steps.find((s) => s.id === "s2")?.runState, "blocked");
  assert.equal(deriveOutcomeStatus(p), "blocked");

  // Refuses syncing approval-gated step or private text
  assert.match(applyRunnerSync(p, "s4", { state: "done", verified: true, now: T1 }) as string, /Rule 6/);
  assert.match(applyRunnerSync(p, "s2", { state: "done", proof: "My private diary entry", now: T1 }) as string, /Rule 6/);
});
