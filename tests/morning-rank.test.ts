import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_KINDS, MAX_CARDS, QUIET_WEIGHT, SOURCES, cardKey, devBacklog, dropDone, goalDeadlines, kindWeights, morningCandidates, pickHero, rankCards, type Candidate, type Thumb } from "../src/lib/morning-rank-pure.ts";

const NOW = Date.parse("2026-10-23T07:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const c = (kind: Candidate["kind"], key: string, base: number): Candidate => ({ kind, key, title: key, base, open: { panel: "agents" } });
const ALL = [c("task", "t1", 0.9), c("task", "t2", 0.85), c("task", "t3", 0.8), c("goal", "g1", 0.4), c("news", "n1", 0.5), c("business", "b1", 0.3), c("idea", "i1", 0.2)];

test("no thumbs: one card per kind, top task first, exactly 5", () => {
  const r = rankCards(ALL, [], NOW);
  assert.equal(r.length, MAX_CARDS);
  assert.deepEqual(r.map((x) => x.key), ["t1", "n1", "g1", "b1", "i1"]);
});

test("missing kinds are filled with the next best items", () => {
  const r = rankCards(ALL.filter((x) => x.kind === "task" || x.kind === "news"), [], NOW);
  assert.deepEqual(r.map((x) => x.key), ["t1", "t2", "t3", "n1"]);
});

test("👎 on an exact item hides it for a week, then it can return", () => {
  const down: Thumb = { kind: "task", key: "t1", up: false, at: ago(1) };
  assert.equal(rankCards(ALL, [down], NOW).some((x) => x.key === "t1"), false);
  assert.equal(rankCards(ALL, [{ ...down, at: ago(8) }], NOW).some((x) => x.key === "t1"), true);
  // a newer 👍 on the same key wins over the older 👎
  assert.equal(rankCards(ALL, [down, { ...down, up: true, at: ago(0.5) }], NOW)[0].key, "t1");
});

test("kind weights learn from thumbs, decay with age and stay in (0.5, 1.5)", () => {
  const ups = Array.from({ length: 4 }, (_, i): Thumb => ({ kind: "idea", key: `x${i}`, up: true, at: ago(1) }));
  const w = kindWeights(ups, NOW);
  assert.ok(w.idea > 1.4 && w.idea < 1.5);
  assert.equal(w.task, 1);
  assert.ok(kindWeights(ups.map((t) => ({ ...t, at: ago(60) })), NOW).idea < w.idea);
  const many = Array.from({ length: 100 }, (_, i): Thumb => ({ kind: "news", key: `y${i}`, up: false, at: ago(0) }));
  assert.ok(kindWeights(many, NOW).news >= 0.5);
  // future-dated and unknown kinds are ignored
  assert.deepEqual(kindWeights([{ kind: "life", key: "k", up: true, at: ago(1) }, { kind: "idea", key: "k", up: true, at: ago(-1) }], NOW), Object.fromEntries(CARD_KINDS.map((k) => [k, 1])));
});

test("liked kinds rise; a disliked kind loses its reserved slot", () => {
  const likeGoals = Array.from({ length: 6 }, (_, i): Thumb => ({ kind: "goal", key: `old${i}`, up: true, at: ago(1) }));
  const r = rankCards(ALL, likeGoals, NOW), base = rankCards(ALL, [], NOW), at = (xs: { key: string }[], k: string) => xs.findIndex((x) => x.key === k);
  assert.ok(at(base, "g1") > at(base, "n1") && at(r, "g1") < at(r, "n1"));
  const hateBiz = Array.from({ length: 4 }, (_, i): Thumb => ({ kind: "business", key: `old${i}`, up: false, at: ago(1) }));
  const r2 = rankCards(ALL, hateBiz, NOW);
  assert.equal(r2.some((x) => x.key === "b1"), false);
  assert.equal(r2.length, MAX_CARDS);
});

test("duplicate keys collapse and order is deterministic", () => {
  const r = rankCards([c("news", "n1", 0.5), c("news", "n1", 0.9), c("goal", "g", 0.5)], [], NOW);
  assert.deepEqual(r.map((x) => [x.key, x.score]), [["g", 0.5], ["n1", 0.5]]); // first copy kept; ties go by kind order
});

test("morningCandidates maps every source to a kind with ledger-safe keys", () => {
  const item = { kind: "task" as const, id: "a1", title: "Ship it", status: "awaiting_approval", detail: "d", action: "Approve" };
  const cs = morningCandidates({
    work: { items: [item, { ...item, kind: "goal", id: "g1", status: "running" }] }, studioReady: 2, proposals: ["p"],
    headlines: ["H".repeat(300)], alerts: ["AAPL above 200"], followups: [{ id: "p1", name: "Cafe" }],
    recall: [{ id: "m1", title: "Old note", label: "a year ago" }], ideas: [{ id: "i1", title: "Idea", next: "Try it", score: 80 }],
  });
  assert.deepEqual([...new Set(cs.map((x) => x.kind))].sort(), [...CARD_KINDS].sort());
  assert.ok(cs.every((x) => x.key.length <= 128 && x.base >= 0 && x.base <= 1));
  assert.equal(cs.find((x) => x.kind === "task")!.base, 0.9);
  assert.deepEqual(cs.find((x) => x.kind === "goal")!.open, { work: { ...item, kind: "goal", id: "g1", status: "running" } });
  assert.equal(cardKey("news", "  a   b "), "news:a b");
});

test("pickHero: the best card, unless done; quiet sources sink once anything was clicked", () => {
  const s = (src: Candidate["source"], key: string, base: number): Candidate => ({ ...c("task", key, base), source: src });
  const cands = [s("news", "n", 0.9), s("studio", "st", 0.8)];
  assert.equal(pickHero([], [], [], NOW), null);
  assert.equal(pickHero(cands, [], [], NOW)!.key, "n"); // no clicks at all: every source equally quiet
  const clicked = [{ source: "studio", key: "st", at: ago(3), done: false }];
  const h = pickHero(cands, [], clicked, NOW)!;
  assert.equal(h.key, "st"); // news not clicked in 14 days: 0.9 × 0.6 < 0.8
  assert.ok(0.9 * QUIET_WEIGHT < 0.8 && h.why.length > 0);
  assert.equal(pickHero(cands, [], [{ ...clicked[0], at: ago(15) }], NOW)!.key, "n"); // clicks older than 14 days don't count
  // done today hides that exact item; yesterday's done and plain clicks don't
  assert.deepEqual(dropDone(cands, [{ source: "news", key: "n", at: ago(0.2), done: true }], NOW).map((x) => x.key), ["st"]);
  assert.equal(dropDone(cands, [{ source: "news", key: "n", at: ago(1), done: true }], NOW).length, 2);
  assert.equal(dropDone(cands, [{ source: "news", key: "n", at: ago(0.2), done: false }], NOW).length, 2);
  // thumbs still count: a 👎 on the top item hides it; a liked kind says so in the why line
  assert.equal(pickHero(cands, [{ kind: "task", key: "n", up: false, at: ago(1) }], [], NOW)!.key, "st");
  const ups = Array.from({ length: 4 }, (_, i): Thumb => ({ kind: "task", key: `u${i}`, up: true, at: ago(1) }));
  assert.match(pickHero(cands, ups, [], NOW)!.why, /rate these highly/);
});

test("goalDeadlines: open goals due within a week, soonest first, ARCH tagged", () => {
  const g = (id: string, doc: Record<string, unknown>) => ({ id, doc: { title: id, status: "running", steps: [], ...doc } });
  const r = goalDeadlines([
    g("later", { deadline: "2026-11-30" }), g("none", {}), g("done", { deadline: "2026-10-24", status: "done" }), g("bad", { deadline: "soon" }),
    g("arch", { title: "Crit model", why: "First architecture crit", deadline: "2026-10-25", steps: [{ status: "done", what: "Sketch" }, { status: "pending", what: "Build the model" }] }),
    g("late", { deadline: "2026-10-20" }),
  ], "2026-10-23");
  assert.deepEqual(r.map((d) => [d.id, d.days, d.arch]), [["late", -3, false], ["arch", 2, true]]);
  assert.equal(r[1].next, "Build the model");
  assert.equal(r[0].next, undefined);
});

test("devBacklog and the new sources become candidates with a source and a why line", () => {
  const bug = (id: string, severity: string, status = "open", created = "2026-10-01") => ({ id, game: "pet", title: id, detail: "", severity, status, created });
  const world = { v: 1, games: [{ id: "pet", name: "Pet Sim", platform: "roblox", stage: "alpha", pitch: "", notes: "" }],
    bugs: [bug("polish", "polish"), bug("fixed", "crash", "fixed"), bug("major", "major"), bug("crash-new", "crash", "open", "2026-10-20"), bug("crash-old", "crash", "fixing", "2026-10-02")] };
  const b = devBacklog(world as Parameters<typeof devBacklog>[0]);
  assert.deepEqual(b.map((x) => x.id), ["crash-old", "crash-new"]);
  assert.equal(b[0].game, "Pet Sim");
  const cs = morningCandidates({ dev: { bugs: b, recent: true }, deadlines: [{ id: "g1", title: "Crit", next: "Build", days: 0, arch: true }],
    archLesson: { id: "m9", title: "Villa Savoye" }, work: { items: [{ kind: "goal", id: "g1", title: "Crit", status: "running", detail: "", action: "Open" }] } });
  assert.ok(cs.every((x) => x.source && (SOURCES as readonly string[]).includes(x.source) && x.why));
  assert.equal(cs[0].key, "goal:g1"); // the deadline copy comes first, so it wins over the plain work item
  assert.equal(cs[0].source, "arch");
  assert.match(cs.find((x) => x.source === "devworld")!.why!, /Crash bug in Pet Sim, where your last dev session/);
  assert.equal(rankCards(cs, [], NOW).filter((x) => x.key === "goal:g1").length, 1);
});
