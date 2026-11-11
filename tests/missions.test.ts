import { test } from "node:test";
import assert from "node:assert/strict";
import { acted, canDo, missionLabel, stepVerified, classifyFailure, collectReceipts, deriveStatus, explain, missionBlocked, newDoc, nextAction, onFailure, validateMission, MAX_RETRIES } from "../src/lib/missions-pure.ts";

const chain = (status: "running" | "done" | "failed" | "waiting" | "cancelled", steps: string[]) =>
  ({ status, steps: steps.map((s, index) => ({ index, agent: "atlas", request: "r", taskId: `t${index}`, status: s as "queued" })) });

test("classifyFailure: the five classes", () => {
  assert.equal(classifyFailure("Interrupted (ORBIT restarted)"), "temporary");
  assert.equal(classifyFailure("429 rate limit"), "temporary");
  assert.equal(classifyFailure("403 Forbidden"), "permission");
  assert.equal(classifyFailure("The owner rejected the action"), "permission");
  assert.equal(classifyFailure("request must be 1-2000 characters"), "invalid");
  assert.equal(classifyFailure("YOUTUBE_API_KEY not configured"), "unavailable");
  assert.equal(classifyFailure("could not parse the reply"), "faulty");
  assert.equal(classifyFailure(null), "faulty");
});

test("onFailure: retries only temporary, bounded; owner-fixable classes wait for input", () => {
  assert.equal(onFailure({ index: 0, error: "timeout" }, {}).do, "retry");
  const spent = onFailure({ index: 0, error: "timeout" }, { 0: MAX_RETRIES });
  assert.ok(spent.do === "stop" && spent.status === "failed" && /after 2 retries/.test(spent.why));
  const perm = onFailure({ index: 1, error: "403" }, {});
  assert.ok(perm.do === "stop" && perm.status === "waiting-input" && perm.cls === "permission");
  const faulty = onFailure({ index: 1, error: "bad output" }, {});
  assert.ok(faulty.do === "stop" && faulty.status === "failed");
  // an approved action already ran: never blind-retry, even a temporary failure
  const a = onFailure({ index: 0, error: "Interrupted (ORBIT restarted)" }, {}, true);
  assert.ok(a.do === "stop" && a.status === "waiting-input");
  assert.equal(acted([{ status: "approved" }]), true);
  assert.equal(acted([{ status: "pending" }]), false);
});

test("deriveStatus: chain progress + owner choices", () => {
  assert.equal(deriveStatus({ status: "queued" }, chain("running", ["queued", "queued"])), "queued");
  assert.equal(deriveStatus({ status: "queued" }, chain("running", ["running", "queued"])), "running");
  assert.equal(deriveStatus({ status: "running" }, chain("waiting", ["done", "awaiting_approval"])), "waiting-approval");
  assert.equal(deriveStatus({ status: "paused" }, chain("running", ["done", "queued"])), "paused");
  assert.equal(deriveStatus({ status: "paused" }, chain("done", ["done", "done"])), "completed");
  assert.equal(deriveStatus({ status: "running" }, chain("failed", ["done", "failed"])), "failed");
  assert.equal(deriveStatus({ status: "waiting-input" }, chain("failed", ["done", "failed"])), "waiting-input");
  assert.equal(deriveStatus({ status: "cancelled" }, chain("running", ["queued"])), "cancelled");
  assert.equal(deriveStatus({ status: "running" }, null), "failed");
});

test("canDo + explain + nextAction", () => {
  assert.ok(canDo("pause", "running") && !canDo("pause", "completed") && canDo("resume", "paused") && !canDo("resume", "running"));
  assert.ok(canDo("retry", "failed") && canDo("retry", "waiting-input") && !canDo("retry", "running") && !canDo("cancel", "cancelled"));
  assert.match(explain("paused", "running"), /Resumed/);
  assert.match(explain("failed", "running"), /Retrying/);
  assert.match(explain("running", "cancelled"), /receipts are kept/);
  assert.match(nextAction("waiting-approval", chain("waiting", ["done", "awaiting_approval"])), /step 2/);
  assert.match(nextAction("waiting-input", null, "Step 1 hit missing permission"), /Retry/);
});

test("collectReceipts: only verified things, deduped, partial results kept", () => {
  const steps = [
    { index: 0, taskId: "t0", status: "done", pending: [{ status: "approved", tool: "save_memory", evidence: [{ kind: "memory", id: "m1" }] }, { status: "rejected", tool: "x", evidence: [{ kind: "file", id: "f9" }] }] },
    { index: 1, taskId: "t1", status: "failed", pending: [{ status: "approved", tool: "create_task", evidence: [{ kind: "task", id: "k2" }, { kind: "bogus", id: "z" }] }] },
    { index: 2, taskId: null, status: "queued" },
  ];
  const r = collectReceipts(steps, [], "2026-10-26T00:00:00Z");
  assert.deepEqual(r.map((x) => `${x.kind}:${x.ref}`), ["memory:m1", "task:k2"]); // a step task finishing is not evidence
  assert.equal(collectReceipts(steps, r, "x").length, 0);
});

test("validateMission: objective, constraints carried into every step", () => {
  assert.equal(typeof validateMission({}), "string");
  assert.equal(typeof validateMission({ objective: "x" }), "string");
  const m = validateMission({ objective: "Ship it", acceptance: "it is live", constraints: ["no spending"], steps: [{ agent: "Atlas", request: "research" }, { agent: "nova", request: "" }] });
  assert.ok(typeof m !== "string");
  assert.equal(m.steps[0].agent, "atlas");
  assert.match(m.steps[0].request, /constraints \(must hold\): no spending/);
  assert.match(m.steps[0].request, /done when: it is live/);
  assert.match(String(validateMission({ objective: "Ship it", steps: [] })), /acceptance is required/); // vague: ask
  const r = validateMission({ objective: "Research EV prices", assumptions: ["prices fell"], steps: [] });
  assert.ok(typeof r !== "string" && /cite sources/.test(r.acceptance));
  const a = validateMission({ objective: "Research EV prices", assumptions: ["prices fell"], steps: [{ agent: "atlas", request: "go" }] });
  assert.ok(typeof a !== "string" && /DISPROVED/.test(a.steps[0].request));
  assert.equal(m.steps[1].request, ""); // empty stays empty so validateChain still refuses it
  assert.equal(newDoc("o", [], "t").status, "queued");
});

test("work brief travels with mission steps and remains available alongside receipts", () => {
  const objective = "Research shipping costs";
  const constraints = ["Use public sources"];
  const acceptance = "Two dated estimates";
  const brief = { output: "Comparison table", evidence: "Link and date for each estimate", approvalPoints: "Review the draft before sharing" };
  const m = validateMission({ objective, constraints, acceptance, brief, steps: [{ agent: "atlas", request: "Find rates" }, { agent: "nova", request: "Compare them" }] });
  assert.ok(typeof m !== "string");
  assert.deepEqual(m.brief, brief);
  for (const step of m.steps) {
    assert.match(step.request, /Expected mission output: Comparison table/);
    assert.match(step.request, /Evidence to provide: Link and date for each estimate/);
    assert.doesNotMatch(step.request, /Review the draft before sharing/);
  }
  const doc = newDoc(m.objective, m.constraints, "t", { acceptance: m.acceptance, brief: m.brief });
  const completed = JSON.parse(JSON.stringify({ ...doc, status: "completed", receipts: [{ kind: "task", ref: "t1" }] }));
  assert.deepEqual(completed.brief, brief);
  assert.equal(completed.receipts[0].ref, "t1");
  assert.equal(newDoc(objective, constraints, "t").brief, undefined);
});

test("a long work brief does not silently truncate step instructions", () => {
  const body = { objective: "Research shipping costs", brief: { evidence: "Include dated source links" }, steps: [{ agent: "atlas", request: "x".repeat(2000) }] };
  assert.match(String(validateMission(body)), /shorten a step or the brief/i);
  const blank = validateMission({ ...body, brief: { output: " ", evidence: 2, approvalPoints: null } });
  assert.ok(typeof blank !== "string");
  assert.equal(blank.brief, undefined);
});

test("missionBlocked: owner's own instruction only", () => {
  assert.ok(missionBlocked("research X then write Y", true));
  assert.ok(missionBlocked("what is a mission?", false));
  assert.equal(missionBlocked("Research the market, then draft a plan", false), "");
});

test("executed vs verified: a completed mission is verified only when every step has a read-back receipt", () => {
  const at = "2026-10-28T00:00:00Z";
  const old = { kind: "task" as const, ref: "t0", step: 0, check: "step task finished (status done in ORBIT's tasks table)", at };
  const rb = (step: number) => ({ kind: "memory" as const, ref: `m${step}`, step, check: "save_memory read back after your approval", at });
  assert.equal(missionLabel("completed", [], 2), "Completed · not verified");
  assert.equal(missionLabel("completed", [old], 1), "Completed · not verified"); // pre-split "done" receipts don't count
  assert.equal(missionLabel("completed", [rb(0)], 2), "Completed · not verified");
  assert.equal(missionLabel("completed", [rb(0), rb(1)], 2), "Completed · verified");
  assert.equal(missionLabel("running", [rb(0)], 2), "Running");
  assert.equal(stepVerified([old], 0), false);
  assert.equal(stepVerified([rb(1)], 1), true);
});
