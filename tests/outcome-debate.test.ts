import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOutcomeFromTemplate,
  deriveOutcomeStatus,
  pickBackgroundActions,
  readySteps,
  type OutcomeProject,
} from "../src/lib/outcome-cockpit-pure.ts";
import {
  MAX_ADDED_CHECKS,
  MAX_OBJECTIONS,
  applyDebate,
  buildCritiquePrompt,
  buildDefensePrompt,
  endDebate,
  judgeDebate,
  newPlanDebate,
  parseObjections,
  parseReplies,
  planReviewPending,
} from "../src/lib/outcome-debate-pure.ts";

const T0 = "2026-11-22T10:00:00.000Z";
const T1 = "2026-11-22T10:02:00.000Z";

const shop = (debate = true): OutcomeProject => {
  const p = createOutcomeFromTemplate("client-shop", { id: "shop", now: T0 }) as OutcomeProject;
  return debate ? { ...p, debate: newPlanDebate() } : p;
};

const critic = (items: unknown[]) => JSON.stringify({ objections: items });

test("nothing runs while the plan review is pending; older projects without a debate are unaffected", () => {
  const pending = shop();
  assert.equal(planReviewPending(pending), true);
  assert.deepEqual(readySteps(pending), []);
  const old = shop(false);
  assert.equal(planReviewPending(old), false);
  assert.deepEqual(readySteps(old).map((s) => s.id), ["s1", "s2"]);
  const done = applyDebate(pending, [], T1);
  assert.deepEqual(readySteps(done).map((s) => s.id), ["s1", "s2"]);
});

test("background picks the plan review before anything else for that project", () => {
  const actions = pickBackgroundActions([shop(), shop(false)].map((p, i) => ({ ...p, id: `p${i}` })));
  assert.deepEqual(actions.map((a) => [a.projectId, a.action]), [["p0", "plan_review"], ["p1", "run_ready"]]);
});

test("the critic prompt carries the whole plan, including the owner approvals", () => {
  const prompt = buildCritiquePrompt(shop());
  for (const needle of ["s1", "s5", "c3", "waits for owner send click", "send: Send demo shop link to client"]) assert.ok(prompt.includes(needle), needle);
});

test("parseObjections validates targets, severities, length and caps the count", () => {
  const p = shop();
  const raw = "Here you go:\n```json\n" + critic([
    { target: "c2", severity: "blocker", claim: "A preview can render while the cart is broken", fix: "Add-to-cart and checkout complete on mobile" },
    { target: "s99", severity: "weird", claim: "Unknown target should fall back to plan", fix: "Measure something real here" },
    { target: "s1", severity: "minor", claim: "short", fix: "x" },
    ...Array.from({ length: 10 }, (_, i) => ({ target: "plan", severity: "minor", claim: `Extra objection number ${i}`, fix: `Extra check number ${i}` })),
  ]) + "\n```";
  const out = parseObjections(raw, p)!;
  assert.equal(out.length, MAX_OBJECTIONS);
  assert.deepEqual(out[0], { id: "o1", target: "c2", severity: "blocker", claim: "A preview can render while the cart is broken", fix: "Add-to-cart and checkout complete on mobile", verdict: "survived" });
  assert.equal(out[1].target, "plan");
  assert.equal(out[1].severity, "major");
  assert.equal(parseObjections("I think the plan is fine.", p), null);
  assert.deepEqual(parseObjections(critic([]), p), []);
});

test("objections that would weaken an approval or add an outward action are refused", () => {
  const out = parseObjections(critic([
    { target: "s5", severity: "major", claim: "Waiting for the owner slows the launch down", fix: "Skip the owner approval for the email" },
    { target: "s5", severity: "major", claim: "The client may lose interest while it waits", fix: "Send the preview email automatically" },
    { target: "c1", severity: "major", claim: "Registry facts may be stale by send time", fix: "Re-check registry facts within 24 h of the draft" },
  ]), shop())!;
  assert.deepEqual(out.map((o) => o.verdict), ["refused", "refused", "survived"]);
  const judged = judgeDebate(out, [{ id: "o1", verdict: "accept", reason: "Fine" }, { id: "o2", verdict: "accept", reason: "Fine" }]);
  assert.deepEqual(judged.map((o) => o.verdict), ["refused", "refused", "survived"]);
});

test("private journal text never enters the debate", () => {
  const out = parseObjections(critic([{ target: "plan", severity: "major", claim: "Use the owner's journal entries for tone", fix: "Quote the diary in the email" }]), shop())!;
  assert.deepEqual(out, []);
});

test("judge: accept survives, specific rebuttal drops, blockers can't be argued away, silence stands", () => {
  const p = shop();
  const objections = parseObjections(critic([
    { target: "c2", severity: "blocker", claim: "A preview can render while the cart is broken", fix: "Add-to-cart and checkout complete on mobile" },
    { target: "s3", severity: "major", claim: "No admin login protection is checked", fix: "Admin route returns 401 without a session" },
    { target: "s2", severity: "minor", claim: "Product shots might be off-brand", fix: "Shots use the client's palette" },
    { target: "s1", severity: "major", claim: "Company could be in liquidation", fix: "Registry status is active" },
    { target: "c3", severity: "major", claim: "Orders could duplicate on retry", fix: "Same order POSTed twice is stored once" },
  ]), p)!;
  const replies = parseReplies(JSON.stringify({ replies: [
    { id: "o1", verdict: "reject", reason: "c2 already covers rendering in headless mode" },
    { id: "o2", verdict: "accept", reason: "Right, admin is unprotected" },
    { id: "o3", verdict: "reject", reason: "s2 already reads the client's brand colours from VAULT before generating" },
    { id: "o4", verdict: "reject", reason: "no" },
    { id: "bogus", verdict: "reject", reason: "ignored" },
  ] }));
  assert.equal(replies.length, 4);
  const judged = judgeDebate(objections, replies);
  assert.deepEqual(judged.map((o) => [o.id, o.verdict]), [["o1", "survived"], ["o2", "survived"], ["o3", "dropped"], ["o4", "survived"], ["o5", "survived"]]);
  assert.match(judged[0].reply!, /blockers are checked/);
  assert.match(judged[4].reply!, /No answer/);
  assert.equal(judged[2].reply, "s2 already reads the client's brand colours from VAULT before generating");
});

test("applyDebate only adds checks (capped), keeps every approval, and the outcome can't be verified until they pass", () => {
  const p = shop();
  const objections = parseObjections(critic([
    { target: "c2", severity: "blocker", claim: "A preview can render while the cart is broken", fix: "Add-to-cart and checkout complete on mobile" },
    { target: "s3", severity: "major", claim: "No admin login protection is checked", fix: "Admin route returns 401 without a session" },
    { target: "s2", severity: "minor", claim: "Product shots might be off-brand", fix: "Shots use the client's palette" },
    { target: "plan", severity: "major", claim: "Nothing checks the email links", fix: "Every link in the draft resolves (200)" },
    { target: "s1", severity: "major", claim: "Company could be in liquidation", fix: "Registry status is active" },
  ]), p)!;
  const next = applyDebate(p, judgeDebate(objections, []), T1);
  assert.equal(next.checks.length, p.checks.length + MAX_ADDED_CHECKS);
  const added = next.checks.slice(p.checks.length);
  assert.deepEqual(added.map((c) => [c.id, c.label, c.fixesStepId, c.status]), [
    ["pr1", "Add-to-cart and checkout complete on mobile", "s3", "pending"],
    ["pr2", "Admin route returns 401 without a session", "s3", "pending"],
    ["pr3", "Every link in the draft resolves (200)", "s3", "pending"],
  ]);
  assert.deepEqual(next.approvals, p.approvals);
  assert.deepEqual(next.steps, p.steps);
  assert.equal(next.debate?.status, "done");
  assert.equal(next.debate?.objections.find((o) => o.id === "o3")?.checkId, undefined); // minor: desk only
  assert.equal(next.debate?.note, "5 of 5 objections survived; 3 checks added.");

  // every original check passing is no longer enough
  let q = next;
  for (const c of p.checks) q = { ...q, checks: q.checks.map((x) => (x.id === c.id ? { ...x, status: "pass" as const } : x)) };
  q = { ...q, steps: q.steps.map((s) => (s.requiresApproval ? s : { ...s, status: "verified" as const })) };
  assert.equal(deriveOutcomeStatus(q), "verifying");
});

test("a failed or skipped review lets the plan run unchanged and says so", () => {
  const p = shop();
  const failed = endDebate(p, "failed", "The critic's reply was unreadable; the plan runs as written.", T1);
  assert.equal(failed.debate?.status, "failed");
  assert.deepEqual(failed.checks, p.checks);
  assert.deepEqual(readySteps(failed).map((s) => s.id), ["s1", "s2"]);
  const nothing = applyDebate(p, [], T1);
  assert.equal(nothing.debate?.note, "The critic found nothing to change.");
});

test("the planner sees every open objection", () => {
  const p = shop();
  const objections = parseObjections(critic([{ target: "s3", severity: "major", claim: "No admin login protection is checked", fix: "Admin route returns 401 without a session" }]), p)!;
  const prompt = buildDefensePrompt(p, objections);
  assert.ok(prompt.includes("o1 [major] on s3: No admin login protection is checked"));
});
