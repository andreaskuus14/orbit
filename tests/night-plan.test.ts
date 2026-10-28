import { test } from "node:test";
import assert from "node:assert/strict";
import { diffText, nightDiff, nightDiffLine, planTonight, snapDiff, whyText, type Signals, type Snap } from "../src/lib/night-plan-pure.ts";
import { NIGHT_DEFAULTS as S, type PlanInput } from "../src/lib/night-pure.ts";
import type { Goal, Step } from "../src/lib/goals-pure.ts";
import type { Rule } from "../src/lib/rules-pure.ts";

const DAY = 86_400_000, now = Date.parse("2026-07-02T22:30:00Z"), iso = (d: number) => new Date(now - d * DAY).toISOString();
const step = (): Step => ({ id: Math.random().toString(36).slice(2), what: "Do", agent: "atlas", expected: "", needsApproval: false, status: "pending" });
const goal = (o: Partial<Goal> = {}): Goal => ({
  v: 1, title: "G", why: "", status: "approved", metric: { kind: "none", how: "", samples: [] }, agents: ["atlas"],
  budget: { runsPerDay: 4, callsPerStep: 8 }, usage: { day: "2026-07-03", runs: 0 }, steps: [step(), step()], learned: [], log: [], ...o,
});
const input = (o: Partial<PlanInput> = {}): PlanInput => ({ tonight: [], goals: [], followups: [], drafted: {}, nicheDue: false, handled: [], now, today: "2026-07-03", ...o });
const none: Signals = { loops: [], rules: [] };
const ids = (q: { kind: string; ref: string }[]) => q.map((t) => `${t.kind}:${t.ref}`);

test("planTonight: upkeep, then his asks, then signals beat the default order; one reason each", () => {
  const goals = [{ id: "g1", doc: goal() }, { id: "g2", doc: goal() }];
  const tonight = [{ id: "t1", text: "Hooks", agent: "atlas", by: "owner" as const, at: iso(3) }];
  const sig: Signals = { loops: [{ key: "goal:g2:2026-06-20", kind: "goal", since: iso(12) }, { key: "prospect:p1:2026-06-25", kind: "prospect", since: iso(8) }], rules: [] };
  const { queue, deferred } = planTonight(input({ goals, tonight, followups: [{ id: "p1", name: "Cafe" }] }), S, { calls: 0, ms: 0 }, sig);
  assert.deepEqual(ids(queue), ["hygiene:hygiene", "research:t1", "goal:g2", "business:p1", "clips:clips", "goal:g1"]); // equal reasons: the cheaper one first
  assert.equal(deferred, 0);
  const why = Object.fromEntries(queue.map((t) => [t.ref, whyText(t.why)]));
  assert.deepEqual(why, { hygiene: "Nightly upkeep", t1: "You asked 3 days ago", g2: "Stalled for 12 days", p1: "No reply for 8 days", g1: "Due on its own schedule", clips: "Due on its own schedule" });
  assert.equal(whyText(queue[2].why, "et"), "Seisnud 12 päeva");
  // deterministic: same input, same plan
  assert.deepEqual(planTonight(input({ goals, tonight, followups: [{ id: "p1", name: "Cafe" }] }), S, { calls: 0, ms: 0 }, sig), { queue, deferred });
});

test("planTonight: budget left decides what fits, highest score first; deferred counted", () => {
  const goals = [{ id: "g1", doc: goal() }, { id: "g2", doc: goal({ deadline: "2026-07-05" }) }];
  const { queue, deferred } = planTonight(input({ goals }), { ...S, maxCalls: 12 }, { calls: 3, ms: 0 }, none);
  assert.deepEqual(ids(queue), ["hygiene:hygiene", "goal:g2"]); // 3 used + 8; g1 (8) and clips (6) don't fit
  assert.equal(deferred, 2);
  assert.equal(whyText(queue[1].why), "Deadline in 2 days");
});

test("planTonight: pins, learned fades, Autonomy off and due deal rules", () => {
  const goals = [{ id: "g1", doc: goal() }];
  const base = input({ goals, deals: 1, boost: { clips: Infinity, goal: 0.2 } });
  const q = planTonight(base, S, { calls: 0, ms: 0 }, none).queue;
  assert.deepEqual(ids(q), ["hygiene:hygiene", "clips:clips", "deals:deals", "goal:g1"]);
  assert.equal(whyText(q[1].why), "You set this to Always");
  const rule = { name: "Deals at 7:30", status: "active", action: { kind: "orbit", id: "deals" }, trigger: { type: "schedule", schedule: { days: [0, 1, 2, 3, 4, 5, 6], hour: 7, minute: 30 } } } as Rule;
  const r = planTonight(input({ goals, deals: 1 }), S, { calls: 0, ms: 0 }, { loops: [], rules: [rule] }).queue;
  assert.equal(r[1].kind, "deals");
  assert.equal(whyText(r[1].why), "Your rule “Deals at 7:30” runs soon");
  assert.ok(!planTonight({ ...base, off: ["clips"] }, S, { calls: 0, ms: 0 }, none).queue.some((t) => t.kind === "clips")); // only kinds the night may run
});

const snap = (o: Partial<Snap> = {}): Snap => ({ drafts: 1, tasks: 10, steps: 4, memories: 50, loops: 5, ...o });

test("morning diff: per item before → after, a report-only draft counts, unreadable counts never show", () => {
  assert.equal(snapDiff(snap(), snap()), undefined);
  assert.deepEqual(snapDiff(snap(), snap({ steps: 5, loops: 3 })), { steps: [4, 5], loops: [5, 3] });
  assert.deepEqual(snapDiff(snap(), snap(), { draft: "Hi again" }), { drafts: [1, 2] });
  assert.equal(snapDiff(snap({ memories: NaN }), snap({ memories: 51 })), undefined);
  assert.equal(diffText({ drafts: [1, 2], loops: [5, 3] }), "drafts waiting 1 → 2 · open loops 5 → 3");
  assert.equal(diffText({ loops: [5, 3] }, "et"), "lahtised otsad 5 → 3");
});

test("morning diff: the whole night from first before to last after, in run order; one line", () => {
  const items = [
    { at: "2026-07-03T01:20:00Z", diff: { steps: [5, 6] as [number, number], drafts: [2, 1] as [number, number] } },
    { at: "2026-07-03T01:00:00Z", diff: { steps: [4, 5] as [number, number], drafts: [1, 2] as [number, number] } },
    { at: "2026-07-03T01:30:00Z" },
  ];
  assert.deepEqual(nightDiff(items), { steps: [4, 6] }); // drafts went 1 → 2 → 1: no net change
  assert.equal(nightDiffLine(items), "Overnight: goal steps 4 → 6");
  assert.equal(nightDiffLine(items, "et"), "Öösel: eesmärkide sammud 4 → 6");
  assert.equal(nightDiffLine([{ at: "x" }]), "");
});
