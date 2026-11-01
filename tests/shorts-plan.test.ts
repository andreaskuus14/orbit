import { test } from "node:test";
import assert from "node:assert/strict";
import { PER_SOURCE, batchProblem, emptyPlan, ideaCands, inFlight, morningBatch, nightTodo, pickIdeas, rollWeek, trendCands, weekNeed,
  type Cand, type ShortsPlan, type StoryState } from "../src/lib/clips/shorts-plan-pure.ts";
import { ideaSeed } from "../src/lib/clips/pipeline-pure.ts";

const cand = (key: string, source: Cand["source"], score: number): Cand => ({ key, source, title: key, idea: `idea ${key}`, score });
const st = (id: string, x: Partial<StoryState> = {}): StoryState => ({ id, status: "quoted", quoted: true, credits: 70, ok: true, madeAny: false, ...x });
const plan = (picks: ShortsPlan["picks"]): ShortsPlan => ({ ...emptyPlan(1), picks });
const pk = (key: string, story?: string) => ({ ...cand(key, "radar", 0.8), at: "", ...(story ? { story } : {}) });

test("idea sources: radar, comment ideas and Day-N sessions keep the board's seed; other areas and dismissed are skipped", () => {
  const c = ideaCands([
    { id: "a", title: "T", summary: "S", area: "studio", score: 80 },
    { id: "b", title: "Viewers ask", summary: "x", area: "studio", score: 70, origin: "comments" },
    { id: "c", title: "Day 4", summary: "y", area: "studio", score: 65, origin: "devsession" },
    { id: "d", title: "Biz", summary: "z", area: "business", score: 99 },
    { id: "e", title: "Gone", summary: "z", area: "studio", score: 99, dismissed: true },
    { id: "research", title: "Undated research", summary: "z", area: "studio", score: 100, origin: "transcript" },
  ]);
  assert.deepEqual(c.map((x) => x.source), ["radar", "comments", "roblox"]);
  assert.equal(c[0].idea, ideaSeed({ title: "T", summary: "S" }));
  assert.equal(c[0].score, 0.8);
  const t = trendCands({ risers: [{ name: "Grow a Garden", strong: true }], topics: [{ term: "minecraft", count: 4 }] });
  assert.deepEqual(t.map((x) => x.key), ["trend:roblox:grow a garden", "trend:yt:minecraft"]);
  assert.ok(t.every((x) => x.source === "trend" && x.score < 0.75));
});

test("weekNeed: target minus booked, in review and in flight; never negative", () => {
  assert.equal(weekNeed({ target: 7, booked: 2, ready: 1, inFlight: 1 }), 3);
  assert.equal(weekNeed({ target: 7, booked: 6, ready: 3, inFlight: 0 }), 0);
});

test("pickIdeas: best first, skips used keys and written seeds, caps each source", () => {
  const cands = [cand("r1", "radar", 0.9), cand("r2", "radar", 0.85), cand("r3", "radar", 0.84), cand("r4", "radar", 0.83), cand("c1", "comments", 0.7),
    cand("t1", "trend", 0.6), cand("used", "radar", 0.99), cand("written", "comments", 0.95)];
  const got = pickIdeas(cands, 10, ["used"], ["idea written"]).map((c) => c.key);
  assert.deepEqual(got, ["r1", "r2", "r3", "c1", "t1"]); // r4 over the per-source cap
  assert.equal(PER_SOURCE, 3);
  assert.deepEqual(pickIdeas(cands, 2, [], []).map((c) => c.key), ["used", "written"]);
  assert.deepEqual(pickIdeas(cands, 5, ["used", "written"], [], [pk("x1"), pk("x2"), pk("x3")]).map((c) => c.key), ["c1", "t1"]); // radar full this week
});

test("nightTodo: scripts picks without a story (3 a night), re-quotes drafts and stale quotes only", () => {
  const p = plan([pk("a"), pk("b"), pk("c"), pk("d"), pk("e", "s1"), pk("f", "s2"), pk("g", "s3"), pk("h", "s4")]);
  const t = nightTodo(p, [st("s1", { status: "draft", quoted: false }), st("s2"), st("s3", { status: "generating", quoted: false }), st("s4", { status: "quoted", quoted: false })]);
  assert.deepEqual(t.write.map((x) => x.key), ["a", "b", "c"]);
  assert.deepEqual(t.quote, ["s1", "s4"]);
});

test("inFlight counts unscripted picks and unfinished stories, not done or failed ones", () => {
  const p = plan([pk("a"), pk("b", "s1"), pk("c", "s2"), pk("d", "s3")]);
  assert.equal(inFlight(p, [st("s1"), st("s2", { status: "done" }), st("s3", { status: "failed" })]), 2);
});

test("rollWeek: a new week keeps only picks still in flight, and every used key", () => {
  const p = { ...plan([pk("a", "s1"), pk("b", "s2"), pk("c")]), used: ["a", "b", "c"], target: 5 };
  assert.equal(rollWeek(p, 1), p);
  const n = rollWeek(p, 2, ["s2"]);
  assert.deepEqual(n.picks.map((x) => x.key), ["b"]);
  assert.deepEqual(n.used, ["a", "b", "c"]);
  assert.equal(n.target, 5);
});

test("morningBatch: one click for every valid quote in plan order that fits the weekly cap", () => {
  const p = plan([pk("a", "s1"), pk("b", "s2"), pk("c", "s3"), pk("d", "s4"), pk("e", "s5")]);
  const stories = [st("s1"), st("s2", { madeAny: true, credits: 90 }), st("s3", { credits: 200 }), st("s4", { ok: false }), st("s5", { credits: 50 })];
  const b = morningBatch(p, stories, { s1: "Banana betrayal" }, 10, 230);
  assert.deepEqual(b.items.map((i) => i.id), ["s1", "s2", "s5"]); // s3 doesn't fit (cheaper s5 still does), s4's quote is invalid
  assert.equal(b.credits, 210);
  assert.equal(b.label, "Approve 3 Shorts for 210 credits");
  assert.deepEqual(b.items.map((i) => i.part), ["characters", "shots", "characters"]);
  assert.equal(b.items[0].title, "Banana betrayal");
  assert.equal(b.held, 1);
  assert.match(b.why!, /weekly cap/);
  const none = morningBatch(p, stories, {}, 230, 230);
  assert.equal(none.items.length, 0);
  assert.equal(none.label, "");
});

test("batchProblem: the click must match the server's batch exactly", () => {
  const b = morningBatch(plan([pk("a", "s1"), pk("b", "s2")]), [st("s1"), st("s2")], {}, 0, 1000);
  assert.equal(batchProblem(b, ["s2", "s1"], 140), "");
  assert.match(batchProblem(b, ["s1"], 70), /changed/);
  assert.match(batchProblem(b, ["s1", "s2"], 100), /140/);
  assert.match(batchProblem(b, "s1", 140), /changed/);
  assert.match(batchProblem(morningBatch(plan([]), [], {}, 0, 10), [], 0), /Nothing/);
});
