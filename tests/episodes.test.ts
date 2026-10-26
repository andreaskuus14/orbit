import { test } from "node:test";
import assert from "node:assert/strict";
import { briefEcho, buildEpisodes, episodeMemory, episodeView, episodesBlock, feelingsIn, keyTag, placeInTime, type EpisodeIn } from "../src/lib/episodes-pure.ts";
import type { LedgerEvent } from "../src/lib/ledger-pure.ts";

const ev = (id: string, at: string, type: LedgerEvent["type"], data: object) => ({ id, at, type, planet: "studio", data }) as LedgerEvent;
const base = (): EpisodeIn => ({ memories: [], events: [], proposals: [], clipDecisions: [], goals: [], clipTitles: {}, prospects: {} });
const NOW = Date.parse("2026-10-26T09:00:00Z");

test("a Short far above his usual is a win with its title; usual ones are not episodes", () => {
  const x = base();
  x.clipTitles = { "j1/egg": "Egg hatch 100x" };
  x.events = [
    ev("1", "2026-10-01T10:00:00Z", "clip.outcome48h", { clipId: "j0/a", views: 900, likes: 40 }),
    ev("2", "2026-10-03T10:00:00Z", "clip.outcome48h", { clipId: "j0/b", views: 1100, likes: 50 }),
    ev("3", "2026-10-12T10:00:00Z", "clip.outcome48h", { clipId: "j1/egg", views: 41200, likes: 3100 }),
  ];
  const eps = buildEpisodes(x);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, "win");
  assert.equal(eps[0].key, "short:j1/egg");
  assert.match(eps[0].what, /The Short “Egg hatch 100x” took off: 41,200 views and 3,100 likes in 48 h \(about 41× his usual\)/);
  assert.deepEqual(eps[0].links, ["clip:j1/egg"]);
});

test("calls keep the summary, an outcome and the feelings he stated; journal memories never become episodes", () => {
  const x = base();
  x.memories = [
    { id: "m1", kind: "conversation", source: "core-summary", title: "Call with ORBIT", tags: ["call", "c1"], created_at: "2026-10-20T19:00:00Z",
      content: "Andreas talked about the pet sim update. He said he felt stressed about the Friday deadline. He decided to cut the trading feature." },
    { id: "m2", kind: "journal", source: "evening", title: "Today", tags: ["call"], created_at: "2026-10-20T21:00:00Z", content: "I felt sad today." },
    { id: "m3", kind: "conversation", source: "core-summary", title: "Chat", tags: ["chat", "x"], created_at: "2026-10-20T21:00:00Z", content: "Chat about tea." },
  ];
  const eps = buildEpisodes(x);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, "call");
  assert.deepEqual(eps[0].feelings, ["He said he felt stressed about the Friday deadline."]);
  assert.equal(eps[0].outcome, "He decided to cut the trading feature.");
  assert.ok(!JSON.stringify(eps).includes("sad today"));
});

test("decisions, business, goals; keys already stored are skipped; oldest first", () => {
  const x = base();
  x.proposals = [
    { id: "p1", title: "Research egg trends", why: "Egg Shorts did well", agent: "scout", status: "approved", created_at: "2026-10-02T08:00:00Z", decided_at: "2026-10-02T09:00:00Z", task_id: "t1" },
    { id: "p2", title: "Pending one", why: "", agent: "scout", status: "pending", created_at: "2026-10-02T08:00:00Z", decided_at: null },
  ];
  x.prospects = { "11111111-2222-3333-4444-555555555555": "Cafe Roma" };
  x.events = [
    ev("b1", "2026-10-05T10:00:00Z", "business.stage", { prospect: "11111111-2222-3333-4444-555555555555", to: "replied" }),
    ev("b2", "2026-10-06T10:00:00Z", "business.stage", { prospect: "99999999-2222-3333-4444-555555555555", to: "contacted" }),
    ev("g1", "2026-10-07T10:00:00Z", "goal.step", { goalId: "g1", step: "Draft titles", status: "failed" }),
    ev("g2", "2026-10-08T10:00:00Z", "goal.step", { goalId: "g2", step: "s1", status: "failed" }),
    ev("g3", "2026-10-09T10:00:00Z", "goal.step", { goalId: "g2", step: "s1", status: "done" }),
  ];
  x.goals = [{ id: "g1", title: "100 subs", status: "done", updated_at: "2026-10-10T10:00:00Z" }];
  x.clipDecisions = [{ clipId: "j/c", title: "Boring bit", action: "rejected", reason: "too slow", at: "2026-10-04T10:00:00Z" }, { clipId: "j/d", title: "x", action: "rejected", at: "2026-10-04T10:00:00Z" }];
  const eps = buildEpisodes(x, new Set(["goal:g1:done"]));
  assert.deepEqual(eps.map((e) => `${e.type} ${e.key}`), [
    "decision proposal:p1", "decision cliprej:j/c", "win prospect:11111111-2222-3333-4444-555555555555:replied", "failure goalstep:g1:Draft titles",
  ]);
  assert.match(eps[0].what, /approved the scout agent's proposal “Research egg trends” \(it said: Egg Shorts did well\)/);
  assert.deepEqual(eps[0].links, ["proposal:p1", "task:t1"]);
  assert.equal(eps[2].what, "Cafe Roma replied to his outreach");
  assert.match(eps[3].what, /“100 subs” failed: Draft titles/);
});

test("feelingsIn wants a feeling about him", () => {
  assert.deepEqual(feelingsIn("The render felt slow to the server. I'm so hyped about the egg Short!"), ["I'm so hyped about the egg Short!"]);
  assert.deepEqual(feelingsIn("Nothing emotional here."), []);
});

test("stored memory round-trips into the list view and the CORE block", () => {
  const x = base();
  x.clipTitles = { "j1/egg": "Egg hatch 100x" };
  x.events = [ev("3", "2026-10-12T10:00:00Z", "clip.outcome48h", { clipId: "j1/egg", views: 41200, likes: 3100 })];
  const m = episodeMemory(buildEpisodes(x)[0]);
  assert.ok(m.tags.includes(keyTag("short:j1/egg")) && m.tags.includes("when:2026-10-12") && m.tags.includes("win"));
  const row = { id: "e1", ...m, created_at: "2026-10-27T03:00:00Z" };
  const v = episodeView(row);
  assert.equal(v.when, "2026-10-12");
  assert.equal(v.type, "win");
  assert.equal(v.outcome, "Took off");
  const block = episodesBlock([row], NOW);
  assert.match(block, /PAST EPISODES/);
  assert.match(block, /- 2026-10-12 \(in October\) · win: The Short “Egg hatch 100x” took off/);
  assert.equal(episodesBlock([], NOW), "");
  assert.equal(briefEcho([row], "short", NOW), "like when “Egg hatch 100x” took off in October");
  assert.equal(briefEcho([row], "short", NOW, ["Egg hatch 100x"]), null);
  assert.equal(briefEcho([row], "reply", NOW), null);
});

test("placeInTime", () => {
  assert.equal(placeInTime("2026-10-25", NOW), "yesterday");
  assert.equal(placeInTime("2026-09-02", NOW), "in September");
  assert.equal(placeInTime("2025-12-02", NOW), "in December 2025");
});

test("the morning brief says the echo after a matching result", async () => {
  const { briefItems } = await import("../src/lib/brief-pure.ts");
  const it = briefItems({ day: "2026-10-26", hour: 8, life: false, morning: {}, decisions: [], replies: [{ id: "p1", name: "Kalev Bakery" }], snoozed: [],
    echo: { reply: "like when Cafe Roma replied in October" } }).find((i) => i.id === "reply:p1")!;
  assert.equal(it.say, "Kalev Bakery wrote back, like when Cafe Roma replied in October.");
});
