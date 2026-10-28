import { test } from "node:test";
import assert from "node:assert/strict";
import { EXACT_BOOST, RECENCY_MAX, groupHits, journalHits, likePattern, rankHits, recency, snip, titleBoost, vaultSource, type SearchHit } from "../src/lib/search-pure.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const hit = (source: SearchHit["source"], id: string, title = id, at?: string): SearchHit => ({ source, id, title, snippet: "", at, open: { memory: id } });

test("rankHits fuses per-source lists by rank (RRF)", () => {
  const r = rankHits([[hit("memory", "m1"), hit("memory", "m2")], [hit("chat", "c1")]], "zzz", NOW);
  assert.deepEqual(r.map((h) => h.id).slice(2), ["m2"]); // both #1s ahead of a #2
  assert.ok(r[0].score > r[2].score);
});

test("rankHits: same source+id counts once; same id in two sources stays two hits", () => {
  const r = rankHits([[hit("memory", "x"), hit("memory", "x")], [hit("task", "x")]], "q", NOW);
  assert.equal(r.length, 2);
});

test("an exact title beats a better rank; recency breaks ties between sources", () => {
  const r = rankHits([[hit("memory", "a", "other"), hit("memory", "b", "Pet Sim")]], "pet  sim", NOW);
  assert.equal(r[0].id, "b");
  const t = rankHits([[hit("memory", "old", "x", "2025-01-01")], [hit("chat", "new", "y", "2026-10-27")]], "q", NOW);
  assert.equal(t[0].id, "new");
});

test("recency and titleBoost bounds", () => {
  assert.equal(recency(undefined, NOW), 0);
  assert.equal(recency("not a date", NOW), 0);
  assert.equal(recency(new Date(NOW).toISOString(), NOW), RECENCY_MAX);
  assert.ok(Math.abs(recency(new Date(NOW - 30 * 86_400_000).toISOString(), NOW) - RECENCY_MAX / 2) < 1e-12);
  assert.ok(RECENCY_MAX < EXACT_BOOST);
  assert.equal(titleBoost("Pet sim", "PET SIM"), EXACT_BOOST);
  assert.ok(titleBoost("My pet sim notes", "pet sim") > 0 && titleBoost("My pet sim notes", "pet sim") < EXACT_BOOST);
  assert.equal(titleBoost("abc", "  "), 0);
});

test("groupHits keeps best-first group order and caps each group", () => {
  const ranked = rankHits([[hit("chat", "c1"), hit("chat", "c2"), hit("chat", "c3")], [hit("goal", "g1")]], "q", NOW);
  const g = groupHits(ranked, 2);
  assert.deepEqual(g.map((x) => x.source).sort(), ["chat", "goal"]);
  assert.equal(g.find((x) => x.source === "chat")!.hits.length, 2);
});

test("snip centres on the hit, falls back to a query word, then to the start", () => {
  const text = `${"a ".repeat(100)}the ORBIT launch plan ${"b ".repeat(100)}`;
  assert.match(snip(text, "launch plan"), /^….*launch plan.*…$/);
  assert.match(snip(text, "missing launch"), /launch/);
  assert.equal(snip("short text", "nope"), "short text");
  assert.equal(snip("", "x"), "");
});

test("likePattern escapes wildcards and refuses tiny queries", () => {
  assert.equal(likePattern("a"), null);
  assert.equal(likePattern(" 50%_off\\ "), "%50\\%\\_off\\\\%");
});

test("journalHits: every word must match, newest first, opens LIFE journal", () => {
  const j = { "2026-10-01": "Long walk with Marko", "2026-10-20": "Marko called about the walk", "2026-10-21": "nothing" };
  const r = journalHits(j, "marko walk");
  assert.deepEqual(r.map((h) => h.id), ["2026-10-20", "2026-10-01"]);
  assert.deepEqual(r[0].open, { nav: { panel: "life", life: "journal" } });
  assert.deepEqual(journalHits(j, "   "), []);
});

test("vaultSource tells notes from files", () => {
  assert.equal(vaultSource("plan.MD"), "note");
  assert.equal(vaultSource("photo.png"), "file");
});
