import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, dragOrder, acceptPlan, markDone, eveningReport, inferCommitments, decideCommitment, commitmentItems, dueFrom, type PlanItem } from "../src/lib/dayplan-pure.ts";

const day = "2026-10-26";
const cal = (id: string, s: number, e: number): PlanItem => ({ id, title: id, min: e - s, flexible: false, fixed: { start: s, end: e }, source: { kind: "calendar", label: "Calendar" } });
const task = (id: string, min: number, extra: Partial<PlanItem> = {}): PlanItem => ({ id, title: id, min, flexible: true, source: { kind: "goal", label: "Goal" }, ...extra });

test("fixed events stay put, tasks fill gaps around them and personal time", () => {
  const p = buildPlan([cal("class", 9 * 60, 11 * 60), task("a", 90), task("b", 30)], { day, now: 8 * 60 });
  const at = (id: string) => p.blocks.find((b) => b.id === id)!;
  assert.deepEqual([at("class").start, at("class").end], [540, 660]);
  assert.equal(at("a").start, 660); // 8:00-9:00 is too short for 90
  assert.ok(at("b").start >= 480 && at("b").end <= 540); // b fits before class
  assert.ok(p.blocks.some((b) => b.id === "personal" && !b.flexible));
  for (const b of p.blocks.filter((x) => x.flexible)) assert.ok(b.end <= 19 * 60 || b.start >= 21 * 60);
});

test("urgent and approvals go first; non-flexible untimed items aren't moved in", () => {
  const p = buildPlan([task("later", 30, { rank: 1 }), task("due", 30, { due: day }), task("ok", 15, { source: { kind: "approval", label: "Approvals" } }), { ...task("pinned", 30), flexible: false }], { day, now: 600 });
  assert.deepEqual(p.blocks.filter((b) => b.flexible).map((b) => b.id), ["due", "ok", "later"]);
  assert.deepEqual(p.unplaced.map((u) => u.id), ["pinned"]);
});

test("a break after long work, overflow is unplaced, starts after now", () => {
  const p = buildPlan([task("x", 60), task("y", 60), task("z", 240)], { day, now: 17 * 60 + 2, personal: null, dayEnd: 20 * 60 });
  assert.equal(p.blocks[0].start, 17 * 60 + 5);
  assert.ok(p.blocks.some((b) => b.source.kind === "break"));
  assert.deepEqual(p.unplaced.map((u) => u.id), ["z"]);
});

test("drag reorders flexible only; accept, done and evening report", () => {
  const items = [cal("meet", 600, 660), task("a", 30), task("b", 30)];
  const p = buildPlan(items, { day, now: 480 });
  assert.equal(dragOrder(p, "meet", null), "Only flexible tasks can move");
  const order = dragOrder(p, "b", "a") as string[];
  assert.deepEqual(order, ["b", "a"]);
  const q = buildPlan(items, { day, now: 480 }, order);
  assert.equal(q.blocks.find((b) => b.flexible)!.id, "b");
  assert.equal(markDone(q, "b", true), "Accept the plan first");
  const done = markDone(acceptPlan(q, "t"), "b", true);
  assert.equal(typeof done, "object");
  const r = eveningReport(done as never, 23 * 60)!;
  assert.deepEqual([r.done.length, r.missed.map((b) => b.id).sort()], [1, ["a", "meet"]]);
  assert.match(r.text, /^Done 1\/3: b\. Missed:/);
  assert.equal(eveningReport(q, 1000), null);
});

test("commitments are inferred as awaiting and need his confirm before planning", () => {
  const now = new Date(2026, 9, 26, 9); // Monday
  const cs = inferCommitments("Sure, I'll send the drawings by Friday. You will bring the model tomorrow. Nice weather.", { kind: "note" }, now);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.status === "awaiting"));
  assert.equal(cs[0].owner, "me"); assert.equal(cs[0].due, "2026-10-30");
  assert.equal(cs[1].owner, "them"); assert.equal(cs[1].due, "2026-10-27");
  assert.deepEqual(commitmentItems(cs), []);
  const ok = decideCommitment(cs, cs[0].id, true) as typeof cs;
  assert.equal(commitmentItems(ok).length, 1);
  assert.equal(decideCommitment(ok, cs[0].id, false), "Already decided");
  assert.deepEqual(inferCommitments("I need to call the bank", { kind: "note" }, now)[0].missing, ["deadline"]);
  assert.equal(dueFrom("on 2026-11-03", now), "2026-11-03");
});
