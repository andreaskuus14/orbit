import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecision, ideaGoal, ideasPrompt, learn, mergeIdeas, parseIdeas, pickSources, briefIdea, tasteLine, weight, type Idea, type Source, type Tally } from "../src/lib/dream-ideas-pure.ts";

const now = Date.parse("2026-10-26T03:00:00Z");
const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();
const note = (id: string, kind: string, title: string, d = 1, tags?: string[]) => ({ id, kind, title, content: `${title} details`, created_at: ago(d), tags });

test("pickSources: active goals, recent non-journal notes, kept niches; never journal/LIFE", () => {
  const s = pickSources({
    now,
    goals: [{ id: "g1", title: "ARCH sun study", status: "running", updated_at: ago(1) }, { id: "g2", title: "Old", status: "done", updated_at: ago(0) }, { id: "g3", title: "Draft", status: "draft", updated_at: ago(0) }],
    notes: [note("n1", "idea", "Shorts about light"), note("j1", "journal", "Diary entry"), note("l1", "note", "Private", 1, ["life"]), note("n2", "note", "Too old", 30)],
    niches: [{ id: "k1", title: "Plant shop", product: "pots", status: "kept" }, { id: "k2", title: "Nope", product: "x", status: "new" }],
  });
  assert.deepEqual(s.map((x) => x.text.split(/[:( ]/)[0]), ["ARCH", "Shorts", "Plant"]);
  assert.deepEqual(s.map((x) => x.ref), ["S1", "S2", "S3"]);
  assert.ok(!JSON.stringify(s).includes("Diary") && !JSON.stringify(s).includes("Private"));
  assert.deepEqual(pickSources({ now, goals: [], notes: [note("n1", "idea", "Alone")], niches: [] }), [], "one source has nothing to combine");
});

const src: Source[] = [{ ref: "S1", kind: "goal", text: "ARCH sun study" }, { ref: "S2", kind: "note", text: "Shorts" }, { ref: "S3", kind: "niche", text: "Plant shop" }];
let n = 0;
const mk = () => `i${++n}`;

test("parseIdeas: keeps valid combinations of 2+ real sources, drops the rest, best-liked category first", () => {
  const text = `Sure! ${JSON.stringify({ ideas: [
    { title: "How light moves through a house", why: "Sun study as Shorts", step: "Film one window for a day", category: "content", from: ["S1", "S2"] },
    { title: "Single source", why: "", step: "x step", category: "content", from: ["S1", "S1"] },
    { title: "Made-up ref", why: "", step: "x step", category: "game", from: ["S1", "S9"] },
    { title: "Bad category", why: "", step: "x step", category: "crypto", from: ["S1", "S2"] },
    { title: "Visit https://x.y", why: "", step: "x step", category: "tool", from: ["S1", "S2"] },
    { title: "Sunlit plant shelf kit", why: "Shop + study", step: "Sketch one shelf", category: "business", from: ["S1", "S3"] },
  ] })}`;
  const t: Tally = { business: { keep: 3, discard: 0 } };
  const out = parseIdeas(text, src, t, "2026-10-26", mk);
  assert.deepEqual(out.map((i) => i.title), ["Sunlit plant shelf kit", "How light moves through a house"]);
  assert.equal(out[1].status, "new");
  assert.deepEqual(parseIdeas("not json", src, {}, "d", mk), []);
  assert.deepEqual(parseIdeas('{"ideas":"x"}', src, {}, "d", mk), []);
});

test("learning: Laplace keep rate per category, taste line only with signal, changed minds count", () => {
  assert.equal(weight({}, "game"), 0.5);
  let t: Tally = learn(learn({}, "game", "keep"), "game", "keep");
  t = learn(learn(t, "business", "discard"), "business", "discard");
  assert.equal(weight(t, "game"), 0.75);
  assert.equal(tasteLine(t), "He usually keeps game ideas. He usually discards business ideas; avoid them unless unusually strong.");
  assert.equal(tasteLine(learn({}, "game", "keep")), "");
  assert.ok(ideasPrompt(src, t).includes("TASTE") && ideasPrompt(src, {}).indexOf("TASTE") === -1);

  const idea: Idea = { id: "a", day: "d", title: "T", why: "", step: "s", category: "game", from: ["S1", "S2"], status: "new" };
  const u = { ideas: [idea], tally: {} as Tally };
  assert.equal((applyDecision(u, "a", "keep") as Idea).status, "kept");
  assert.deepEqual(u.tally.game, { keep: 1, discard: 0 });
  applyDecision(u, "a", "goal"); // already counted as a keep
  assert.deepEqual(u.tally.game, { keep: 1, discard: 0 });
  assert.equal(applyDecision(u, "a", "discard"), "Already a goal");
  assert.equal(applyDecision(u, "zz", "keep"), "That idea is gone");
  const v = { ideas: [{ ...idea, status: "kept" as const }], tally: {} as Tally };
  applyDecision(v, "a", "discard");
  assert.deepEqual(v.tally.game, { keep: 0, discard: 1 });
});

test("list, brief line and goal draft", () => {
  const a: Idea = { id: "a", day: "2026-10-26", title: "Light Shorts", why: "w", step: "s", category: "content", from: [], status: "new" };
  const list = mergeIdeas([{ ...a, id: "old", day: "2026-10-25" }], [a, { ...a, id: "b" }]);
  assert.deepEqual(list.map((i) => i.id), ["a", "b", "old"]);
  assert.deepEqual(briefIdea(list, "2026-10-26"), { id: "a", title: "Light Shorts", more: 1 });
  assert.equal(briefIdea(list, "2026-10-27"), null);
  assert.equal(mergeIdeas(Array.from({ length: 50 }, (_, i) => ({ ...a, id: `x${i}` })), []).length, 40);
  assert.deepEqual(ideaGoal(a), { title: "Light Shorts", why: "w First step: s", agents: ["atlas"] });
});
