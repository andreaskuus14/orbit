import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAIN_MAX_CALLS, COMPANY, ROLES, grade, orgChart, planCompany, resolvedStep, roleOf, stepStatus } from "../src/lib/company-pure.ts";
import { parseMeta, toMeta, validateChain } from "../src/lib/chains-pure.ts";

const plan = (g: string) => { const p = planCompany(g); if (typeof p === "string") throw new Error(p); return p; };

test("planner: roles by keywords in a fixed order, always ends with the writer, valid chain within budget", () => {
  assert.deepEqual(plan("Research Roblox pet sim trends and write a plan").roles, ["ceo", "researcher", "writer"]);
  assert.deepEqual(plan("Analyze my stats and write a weekly report every Monday").roles, ["ceo", "analyst", "writer", "ops"]);
  assert.deepEqual(plan("Draft a cold email").roles, ["ceo", "researcher", "writer"]); // nothing matched: research first, still 2+ steps
  for (const g of ["Draft a cold email", "Analyze my numbers, research competitors, write it up and automate it weekly"]) {
    const p = plan(g);
    assert.equal(typeof validateChain({ goal: p.goal, steps: p.steps }), "object", g);
    assert.ok(p.steps.reduce((n, s) => n + s.calls!, 0) <= CHAIN_MAX_CALLS);
    assert.ok(p.steps.every((s) => /approval/.test(s.request) && /Do not send/.test(s.request)), "every step is told nothing goes out without approval");
    assert.deepEqual(p.steps.map((s) => s.agent), p.roles.slice(1).map((r) => COMPANY[r].agent));
  }
  assert.match(planCompany("") as string, /goal/);
  assert.match(planCompany(42) as string, /goal/);
  assert.match(planCompany("x".repeat(300)) as string, /goal/);
});

test("chain meta keeps per-step calls and the company flag; bad calls rejected; plain chains unchanged", () => {
  const p = plan("Research X and write a post");
  const m = parseMeta(JSON.stringify(toMeta(validateChain({ goal: p.goal, steps: p.steps }) as never, true)))!;
  assert.equal(m.company, 1);
  assert.deepEqual(m.steps.map((s) => s.calls), [COMPANY.researcher.calls, COMPANY.writer.calls]);
  assert.match(validateChain({ goal: "g", steps: [{ agent: "atlas", request: "a", calls: 0 }, { agent: "forge", request: "b" }] }) as string, /step 1: calls/);
  assert.match(validateChain({ goal: "g", steps: [{ agent: "atlas", request: "a", calls: 13 }, { agent: "forge", request: "b" }] }) as string, /calls/);
  assert.deepEqual(toMeta({ goal: "g", steps: [{ agent: "atlas", request: "a" }] }), { chain: 1, goal: "g", steps: [{ agent: "atlas", len: 1 }] });
});

test("grade: unjudged cases never count; letters by mean", () => {
  assert.equal(grade([]), null);
  assert.equal(grade([null, null]), null);
  assert.equal(grade([2, 1.5, null]), "A");
  assert.equal(grade([1]), "C");
  assert.equal(grade([0]), "F");
});

test("org chart: one seat per role, newest task, done count, grade; CEO only counts company chains", () => {
  const rows = [
    { agent: "atlas", title: "Team step 1/2 · atlas: Research", status: "done", result: "Found  three\nthings", created_at: "2026-10-26T10:00:00Z" },
    { agent: "atlas", title: "Older", status: "done", result: null, created_at: "2026-10-25T10:00:00Z" },
    { agent: "nova", title: "Team: Plain team", status: "done", result: null, created_at: "2026-10-26T11:00:00Z" },
    { agent: "nova", title: "Team: Company: Grow the channel", status: "running", result: null, created_at: "2026-10-26T09:00:00Z" },
  ];
  const seats = orgChart(rows, [{ agent: "atlas", score: 2 }, { agent: "atlas", score: null }, { agent: "forge", score: 0.8 }]);
  assert.deepEqual(seats.map((s) => s.role), [...ROLES]);
  const res = seats.find((s) => s.role === "researcher")!;
  assert.deepEqual([res.grade, res.done, res.last?.output, res.last?.title], ["A", 2, "Found three things", "Team step 1/2 · atlas: Research"]);
  const ceo = seats.find((s) => s.role === "ceo")!;
  assert.deepEqual([ceo.last?.title, ceo.done, ceo.calls], ["Grow the channel", 0, 0]);
  assert.equal(seats.find((s) => s.role === "writer")!.grade, "D");
  assert.equal(seats.find((s) => s.role === "ops")!.last, null);
});

test("roles and step status map for the ledger", () => {
  assert.equal(roleOf("forge"), "writer");
  assert.equal(roleOf("echo"), null);
  assert.deepEqual(["done", "awaiting_approval", "failed", "cancelled"].map(stepStatus), ["done", "approval", "failed", "failed"]);
});

test("resolvedStep: the company.step event after an approval, only for company chains and settled steps", () => {
  const p = plan("Research X and write a post");
  const req = JSON.stringify(toMeta({ goal: p.goal, steps: p.steps }, true));
  assert.deepEqual(resolvedStep(req, "forge", "done"), { role: "writer", status: "done" });
  assert.deepEqual(resolvedStep(req, "forge", "failed"), { role: "writer", status: "failed" });
  assert.equal(resolvedStep(req, "forge", "awaiting_approval"), null);
  assert.equal(resolvedStep(JSON.stringify(toMeta({ goal: p.goal, steps: p.steps })), "forge", "done"), null); // plain team chain
  assert.equal(resolvedStep(null, "forge", "done"), null);
});
