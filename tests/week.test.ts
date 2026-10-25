import { test } from "node:test";
import assert from "node:assert/strict";
import { citeTarget, citeWeek, knownCites, midnight, weekAnswer, weekFacts, weekIntent, weekToolText, weekWindow, type WeekIn } from "../src/lib/week-pure.ts";
import type { LedgerEvent } from "../src/lib/ledger-pure.ts";

// Friday 23 Oct 2026, 15:00 Tallinn (EEST, UTC+3). The week is Mon 19 – Sun 25 Oct.
const NOW = Date.parse("2026-10-23T12:00:00Z");
const ev = (id: string, at: string, type: string, planet: string, data: object) => ({ id, at, type, planet, data }) as LedgerEvent;
const G1 = "11111111-1111-4111-8111-111111111111", G2 = "22222222-2222-4222-8222-222222222222", MEM = "33333333-3333-4333-8333-333333333333";

export const SAMPLE: WeekIn = {
  now: NOW, shortsTarget: 7,
  events: [
    ev("1", "2026-10-19T06:00:00Z", "morning.done", "core", { source: "goals", key: "goal:x" }),
    ev("2", "2026-10-20T06:00:00Z", "morning.done", "core", { source: "work", key: "t:y" }),
    ev("3", "2026-10-22T06:00:00Z", "morning.click", "core", { source: "news", key: "n:z" }),
    ev("4", "2026-10-21T18:00:00Z", "focus.session", "life", { minutes: 50 }),
    ev("5", "2026-10-21T19:00:00Z", "journal.saved", "life", { memoryId: "secret-journal-id" }),
    ev("6", "2026-10-22T19:00:00Z", "journal.saved", "life", { memoryId: "secret-journal-id-2" }),
    ev("7", "2026-10-21T10:00:00Z", "goal.step", "agents", { goalId: G1, step: "s1", status: "done" }),
    ev("8", "2026-10-22T10:00:00Z", "goal.step", "agents", { goalId: G1, step: "s2", status: "started" }),
    ev("9", "2026-10-22T12:00:00Z", "clip.outcome48h", "studio", { clipId: "job1/c1", views: 12400, likes: 300 }),
    ev("10", "2026-10-12T06:00:00Z", "morning.done", "core", { source: "goals", key: "old" }), // last week: outside
  ],
  goals: [
    { id: G1, title: "Reach 1000 subscribers", status: "running", deadline: "2026-10-31", updatedAt: "2026-10-22T10:00:00Z",
      steps: [{ id: "s1", what: "Find 3 hook formats", status: "done" }, { id: "s2", what: "Post 5 hook tests", status: "running" }, { id: "s3", what: "Review results", status: "pending" }] },
    { id: G2, title: "Portfolio draft for architecture school", status: "waiting", deadline: "2026-10-21", updatedAt: "2026-10-18T10:00:00Z", steps: [{ id: "a", what: "Collect sketches", status: "done" }, { id: "b", what: "Layout", status: "pending" }] },
    { id: "g3", title: "Ship pet sim update", status: "done", updatedAt: "2026-10-20T10:00:00Z", steps: [] },
    { id: "g4", title: "Old overdue goal", status: "approved", deadline: "2026-10-01", updatedAt: "2026-10-01T10:00:00Z", steps: [] },
  ],
  tasks: [
    { id: "t1", title: "Research Shorts hooks", status: "done", created_at: "2026-10-20T08:00:00Z", finished_at: "2026-10-20T09:00:00Z" },
    { id: "t2", title: "Draft outreach email", status: "awaiting_approval", created_at: "2026-10-19T08:00:00Z" },
    { id: "t3", title: "Last month's task", status: "done", created_at: "2026-09-01T08:00:00Z", finished_at: "2026-09-01T09:00:00Z" },
  ],
  clips: [
    { job: "job1", id: "c1", title: "Streamer rage quits", status: "approved", publish: { status: "done", at: "2026-10-20T10:00:00Z" }, approvedAt: "2026-10-19T10:00:00Z" },
    { job: "job1", id: "c2", title: "Clutch 1v4", status: "approved", publish: { status: "scheduled", at: "2026-10-22T10:00:00Z", scheduledFor: "2026-10-24T14:00:00Z" } },
  ],
  memories: [{ id: MEM, title: "Hook idea: start mid-sentence", created_at: "2026-10-21T10:00:00Z" }],
  habits: [{ name: "Read 20 min", streak: 4 }, { name: "Gym", streak: 1 }],
};

test("week window: Tallinn Monday start, DST-aware midnights", () => {
  const w = weekWindow(NOW);
  assert.deepEqual([w.from, w.to, w.days], ["2026-10-19", "2026-10-25", 5]);
  assert.equal(new Date(w.start).toISOString(), "2026-10-18T21:00:00.000Z"); // EEST
  assert.equal(new Date(w.end).toISOString(), "2026-10-25T22:00:00.000Z"); // clocks went back on 25 Oct: EET
  assert.equal(new Date(midnight("2026-01-05")).toISOString(), "2026-01-04T22:00:00.000Z");
  assert.equal(weekWindow(NOW, 1).from, "2026-10-12");
  // Sunday 23:30 local still belongs to that week; Monday 00:30 local starts the next
  assert.equal(weekWindow(Date.parse("2026-10-25T21:30:00Z")).from, "2026-10-19");
  assert.equal(weekWindow(Date.parse("2026-10-25T22:30:00Z")).from, "2026-10-26");
});

test("week facts: planned vs done, slipped, late, streaks, wins, with citations", () => {
  const wk = weekFacts(SAMPLE), t = (k: string) => wk.facts.filter((f) => f.kind === k).map((f) => `${f.text}${f.cite ? ` <${f.cite}>` : ""}`);
  assert.deepEqual(t("win").sort(), [`Finished goal “Ship pet sim update” <goal:g3>`, `Short “Streamer rage quits” got 12,400 views in 48 h <clip:job1/c1>`]);
  assert.ok(t("done").includes(`Goal “Reach 1000 subscribers”: 1 step done (Find 3 hook formats) <goal:${G1}>`));
  assert.ok(t("done").includes("Agent task done: “Research Shorts hooks” <task:t1>"));
  assert.ok(t("done").includes(`"Do this first" done on 2 of 5 days <event:morning.done~2>`));
  assert.ok(t("done").includes("2 evening captures written"));
  assert.ok(t("done").includes(`Memory saved: “Hook idea: start mid-sentence” <memory:${MEM}>`));
  assert.ok(!t("done").some((s) => s.includes("Last month")));
  const slipped = t("slipped");
  assert.ok(slipped.includes(`Goal “Portfolio draft for architecture school” missed its deadline Wed 21 Oct (1 of 2 steps done) <goal:${G2}>`));
  assert.ok(slipped.includes(`Goal “Reach 1000 subscribers”: 1 step started but not finished (Post 5 hook tests) <goal:${G1}>`));
  assert.ok(slipped.includes("Agent task started but not finished: “Draft outreach email” (waiting for your approval) <task:t2>"));
  assert.ok(slipped.includes(`"Do this first" not done on 2 days`)); // Wed, Thu; Fri (today) isn't over
  assert.ok(slipped.includes("Shorts: 2 of 7 (weekly target) published or scheduled: behind pace (5 by today)"));
  assert.deepEqual(t("late").sort(), ["Agent task waiting for your approval since Mon 19 Oct: “Draft outreach email” <task:t2>", "Goal “Old overdue goal” missed its deadline Thu 1 Oct <goal:g4>"]);
  assert.deepEqual(t("streak"), ["Habit streak: Read 20 min, 4 days"]);
  assert.ok(t("planned").includes(`Goal “Reach 1000 subscribers” is due Sat 31 Oct (1 of 3 steps done) <goal:${G1}>`) === false); // due next week, not this
  assert.ok(t("planned").includes("Goals due this week: 1, finished 0"));
  // privacy: journal memory ids never become facts or citations
  assert.ok(!JSON.stringify(wk).includes("secret-journal"));
});

test("last week: everything due then is slipped, target missed", () => {
  const wk = weekFacts({ ...SAMPLE, now: Date.parse("2026-10-28T12:00:00Z"), weeksAgo: 1 });
  assert.equal(wk.from, "2026-10-19");
  assert.ok(wk.facts.some((f) => f.kind === "slipped" && f.text.endsWith("target missed by 5")));
});

test("intents: the common questions answer locally; everything else goes to CORE", () => {
  for (const [q, want] of [["what slipped this week?", "slipped"], ["What slipped?", "slipped"], ["what did I get done?", "done"], ["What did I get done this week", "done"],
    ["what's late?", "late"], ["anything overdue?", "late"], ["how's my week going?", "overview"], ["How did my week go?", "overview"],
    ["what did I finish last week?", "done"]] as const) assert.equal(weekIntent(q)?.intent, want, q);
  assert.equal(weekIntent("what did I finish last week?")?.weeksAgo, 1);
  for (const q of ["what did I miss in the news this week?", "hello", "late night ideas for a video", "what slipped in the stock market this week", "why am I always late to things I care about and how do I fix it this week"])
    assert.equal(weekIntent(q), null, q);
});

test("answers cite sources; citations number after memory cites and open the source", () => {
  const wk = weekFacts(SAMPLE);
  const a = weekAnswer(wk, "slipped");
  assert.match(a, /^This week \(Mon 19 Oct – Sun 25 Oct\), what slipped:/);
  assert.match(a, /\[w:goal:22222222-/);
  assert.match(weekAnswer(wk, "late"), /Old overdue goal/);
  assert.match(weekAnswer(wk, "done"), /Finished goal “Ship pet sim update” \[w:goal:g3\]/);
  assert.match(weekAnswer(wk, "overview"), /Biggest wins:/);
  assert.match(weekAnswer({ ...wk, facts: [] }, "slipped"), /^Nothing slipped so far this week/);

  const known = knownCites([weekToolText(wk)]);
  const r = citeWeek(`Portfolio slipped [w:goal:${G2}], again [w:goal:${G2}]. Made up [w:task:nope]. Memo [w:memory:${MEM}] [m:${MEM}]`, known, [MEM]);
  assert.equal(r.text, `Portfolio slipped [2], again [2]. Made up . Memo [1] [m:${MEM}]`);
  assert.deepEqual(r.cites.map((c) => [c.id, c.kind]), [[`goal:${G2}`, "week:goal"]]);
  assert.match(r.cites[0].title, /^Goal “Portfolio draft/);

  assert.deepEqual(citeTarget({ id: `goal:${G2}`, kind: "week:goal" }), { goal: G2 });
  assert.deepEqual(citeTarget({ id: "task:t1", kind: "week:task" }), { task: "t1" });
  assert.deepEqual(citeTarget({ id: "clip:job1/c1", kind: "week:clip" }), { nav: { panel: "studio", view: "clips" } });
  assert.deepEqual(citeTarget({ id: "event:morning.done~2", kind: "week:event" }), { nav: { panel: null, morning: true } });
  assert.equal(citeTarget({ id: MEM, kind: "memory" }), null);
});
