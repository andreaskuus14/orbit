import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalItems, buildPlan, dragOrder, acceptPlan, markDone, eveningReport, inferCommitments, decideCommitment, commitmentItems, dueFrom, type PlanItem } from "../src/lib/dayplan-pure.ts";

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

// ── Capacity (roadmap 42) ──
import { capacity, carryForward, dayStat, planText, type Block, type DayPlan } from "../src/lib/dayplan-pure.ts";

test("capacity: never fills every free hour; the cap holds back the rest and flags overload", () => {
  const items = Array.from({ length: 6 }, (_, i) => task(`t${i}`, 120));
  const p = buildPlan(items, { day: "2026-10-28", now: 8 * 60, personal: null, maxPlanned: 6 * 60 });
  assert.equal(p.load!.plannedMin, 360);
  assert.equal(p.unplaced.filter((u) => u.why === "cap").length, 3);
  assert.equal(p.load!.overload, true);
  const light = buildPlan([task("a", 60)], { day: "2026-10-28", now: 8 * 60 });
  assert.equal(light.load!.overload, false); assert.equal(light.load!.capMin, 360); // default 6 h
});

test("capacity: overload when fixed commitments leave less free time than the tasks need", () => {
  const meeting: PlanItem = { id: "m", title: "School", min: 0, flexible: false, fixed: { start: 8 * 60, end: 21 * 60 }, source: { kind: "calendar", label: "cal" } };
  const p = buildPlan([meeting, task("a", 90)], { day: "2026-10-28", now: 8 * 60, personal: null });
  assert.equal(p.load!.freeMin, 60); assert.equal(p.load!.overload, true);
  assert.equal(p.unplaced[0].why, "time");
  assert.match(planText(p), /Overloaded: 90 min of tasks/);
});

test("capacity: completion history lowers the cap to what he really finishes (needs 3 days)", () => {
  const h = (d: string, planned: number, done: number) => ({ day: d, plannedMin: planned, doneMin: done });
  assert.equal(capacity(360, [h("a", 300, 100), h("b", 300, 100)]), 360);
  assert.equal(capacity(360, [h("a", 300, 120), h("b", 300, 120), h("c", 300, 120)]), 150);
  assert.equal(capacity(360, [h("a", 300, 0), h("b", 300, 0), h("c", 300, 0)]), 60); // floor
  assert.equal(capacity(360, [h("a", 400, 400), h("b", 400, 400), h("c", 400, 400)]), 360); // never above his limit
});

test("carry forward: unfinished accepted work comes back explicitly, first, and isn't planned twice", () => {
  const blk = (id: string, done: boolean, kind: "goal" | "approval" = "goal"): Block => ({ id, title: id, start: 600, end: 660, flexible: true, done, source: { kind, label: "x" } });
  const prev: DayPlan = { day: "2026-10-27", accepted: "2026-10-27T07:00:00Z", unplaced: [], blocks: [blk("done", true), blk("left", false), blk("goal:1", false), blk("ap:1", false, "approval")] };
  assert.deepEqual(dayStat(prev), { day: "2026-10-27", plannedMin: 240, doneMin: 60 });
  const items = carryForward([task("goal:1", 45), task("new", 30)], prev, "2026-10-28");
  assert.deepEqual(items.map((i) => [i.id, i.carried ?? null]), [["goal:1", "2026-10-27"], ["new", null], ["left", "2026-10-27"]]);
  const p = buildPlan(items, { day: "2026-10-28", now: 8 * 60 });
  assert.deepEqual(p.carried, ["goal:1", "left"]);
  assert.deepEqual(p.blocks.filter((b) => b.flexible).slice(0, 2).map((b) => b.id).sort(), ["goal:1", "left"]); // overdue → first
  assert.match(planText(p), /Carried from earlier: goal:1, left/);
  assert.equal(carryForward(items, { ...prev, accepted: undefined }, "2026-10-28"), items); // not accepted → nothing promised
});

test("clip approvals batch into one capped STUDIO review block that never crowds out his own work", () => {
  const ap = approvalItems([1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, title: `Clip ${n}`, kind: "clip" })).concat({ id: "s1", title: "Mail", kind: "send" }));
  assert.equal(ap.length, 2);
  assert.deepEqual([ap[0].title, ap[0].min, ap[0].source.open], ["Review 5 clips in STUDIO", 30, { panel: "studio", view: "review" }]);
  assert.deepEqual([ap[1].title, ap[1].min], ["Review: Mail", 10]);
  const p = buildPlan([cal("busy", 600, 1440), task("essay", 30, { due: day }), ...ap], { day, now: 480 }); // 2 h free before 10:00
  const flex = p.blocks.filter((b) => b.flexible).map((b) => b.id);
  assert.equal(flex[0], "essay"); // his deadline first; the next action is never a single clip
  assert.ok(flex.includes("ap:clip"));
  assert.ok(p.unplaced.some((u) => u.id === "ap:s1" && u.why === "cap")); // chores capped at a quarter of free time
});
