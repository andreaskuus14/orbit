import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanTagList, counts, dayLabel, isoOrNull, linkPair, newestFirst, normMap, normMemory, normStar, parseAsk, shownTags, tagsFromText, titleFrom, topTopics, UNDO_MS, withoutPending } from "../src/lib/memory-planet-pure.ts";
import { searchStars, starProjects, subgraph, connections } from "../src/lib/memory-world-pure.ts";

const ID = "00000000-0000-4000-8000-000000000001", ID2 = "00000000-0000-4000-8000-000000000002";

test("normStar: every field can be missing or the wrong type (#719, NULL inside tags[])", () => {
  assert.equal(normStar(null), null);
  assert.equal(normStar({ title: "no id" }), null);
  const s = normStar({ id: ID, title: null, kind: null, tags: ["a", null, 3, " a ", "", "b"], created_at: "nope", x: NaN, y: "1", z: Infinity })!;
  assert.deepEqual(s, { id: ID, title: "Untitled", kind: "note", tags: ["a", "b"], folder: null, created_at: null, source: null, x: 0, y: 0, z: 0 });
  assert.deepEqual(normStar({ id: ID, tags: null })!.tags, []);
  assert.deepEqual(normStar({ id: ID })!.tags, []);
});

test("journal stars and rows never carry their title, text or tags", () => {
  const s = normStar({ id: ID, kind: "journal", title: "secret title", tags: ["mood:sad"], folder: "x" })!;
  assert.equal(s.title, "Journal entry"); assert.deepEqual(s.tags, []); assert.equal(s.folder, null);
  const m = normMemory({ id: ID, kind: "journal", title: "secret", content: "secret text", tags: ["mood"], url: "https://x", created_at: "2026-11-20T10:00:00Z" })!;
  assert.equal(m.title, "Journal entry · 2026-11-20"); assert.equal(m.content, ""); assert.deepEqual(m.tags, []); assert.equal(m.url, null); assert.equal(m.locked, true);
  const sealed = normMemory({ id: ID, kind: "note", locked: true, title: "Journal entry · 2026-11-20", content: "x" })!; // redacted by the API (redactJournalRow)
  assert.equal(sealed.content, ""); assert.deepEqual(shownTags({ tags: ["a"], kind: "journal" }), []);
});

test("normMap drops links and edges that point at missing stars, keeps the rest", () => {
  const d = normMap({ items: [{ id: "a" }, { nope: 1 }, { id: "b" }], links: [{ from: "a", to: "b" }, { from: "a", to: "zz" }, null], edges: [[0, 1, 0.9], [0, 5, 0.9], [0, 1, NaN], "x"], total: 3 });
  assert.equal(d.items.length, 2); assert.deepEqual(d.links, [{ from: "a", to: "b" }]); assert.deepEqual(d.edges, [[0, 1, 0.9]]);
  assert.deepEqual(normMap(undefined).items, []);
});

test("the map helpers survive normalised rows", () => {
  const items = [normStar({ id: "a", title: "Pet shop", tags: ["scope:pet sim"] })!, normStar({ id: "b", tags: [null] })!];
  assert.deepEqual(searchStars(items, "pet"), [0]); assert.deepEqual(starProjects(items), ["pet sim"]);
  assert.equal(subgraph(items, [[0, 1, 0.8]], "pet sim").items.length, 1); assert.deepEqual(connections(9, items, []), []);
});

test("parseAsk: remember … saves (EN and ET), anything else searches", () => {
  assert.deepEqual(parseAsk("remember that I prefer short answers"), { kind: "remember", content: "I prefer short answers" });
  assert.deepEqual(parseAsk("Remember: the shop opens on Fridays"), { kind: "remember", content: "The shop opens on Fridays" });
  assert.deepEqual(parseAsk("Pea meeles, et eelistan lühikesi vastuseid"), { kind: "remember", content: "Eelistan lühikesi vastuseid" });
  assert.deepEqual(parseAsk("jäta meelde trenn kell 6"), { kind: "remember", content: "Trenn kell 6" });
  assert.deepEqual(parseAsk("what do you remember about my pet simulator?"), { kind: "search", q: "what do you remember about my pet simulator?" });
  assert.deepEqual(parseAsk("remember"), { kind: "search", q: "remember" });
  assert.deepEqual(parseAsk("save money tips"), { kind: "search", q: "save money tips" });
  assert.equal(parseAsk("   "), null);
  assert.equal((parseAsk("x".repeat(900)) as { q: string }).q.length, 500);
});

test("titleFrom, tagsFromText, cleanTagList", () => {
  assert.equal(titleFrom("Short line\nmore"), "Short line");
  const long = titleFrom("word ".repeat(40)); assert.ok(long.length <= 81 && long.endsWith("…"));
  assert.deepEqual(tagsFromText(" a, b ,, a ,c"), ["a", "b", "c"]); assert.equal(tagsFromText(Array.from({ length: 30 }, (_, i) => `t${i}`).join(",")).length, 20);
  assert.deepEqual(cleanTagList("nope"), []);
});

test("dates: undated rows go last, Invalid Date never reaches the screen", () => {
  const now = Date.parse("2026-11-23T12:00:00");
  assert.equal(isoOrNull("garbage"), null); assert.equal(dayLabel(null, "en", now), ""); assert.equal(dayLabel("garbage", "en", now), "");
  assert.equal(dayLabel("2026-11-23T08:00:00", "en", now), "Today"); assert.equal(dayLabel("2026-11-22T08:00:00", "et", now), "Eile");
  assert.equal(dayLabel("2026-11-14T08:00:00", "en", now), "14 Nov"); assert.match(dayLabel("2025-01-02T08:00:00", "en", now), /2025/);
  assert.deepEqual(newestFirst([{ id: 1, created_at: null }, { id: 2, created_at: "2026-01-01T00:00:00Z" }, { id: 3, created_at: "2026-02-01T00:00:00Z" }]).map((x) => x.id), [3, 2, 1]);
  assert.deepEqual(counts([{ created_at: "2026-11-23T09:00:00" }, { created_at: "2026-11-20T09:00:00" }, { created_at: null }], now), { n: 3, today: 1 });
});

test("topTopics: most used tags and projects, never journal or provenance tags", () => {
  const rows = [{ kind: "note", tags: ["pet", "fp:abc"] }, { kind: "idea", tags: ["pet", "scope:orbit"] }, { kind: "note", tags: ["scope:orbit"] }, { kind: "journal", tags: ["mood", "mood"] }, { kind: "journal", tags: ["mood"] }];
  assert.deepEqual(topTopics(rows), ["orbit", "pet"]);
});

test("delete waits for Undo and hides the row meanwhile; link body takes two different uuids only", () => {
  assert.ok(UNDO_MS >= 6000);
  assert.deepEqual(withoutPending([{ id: "a" }, { id: "b" }], new Set(["a"])), [{ id: "b" }]);
  assert.deepEqual(linkPair({ from: ID, to: ID2 }), { from: ID, to: ID2 });
  assert.equal(linkPair({ from: ID, to: ID }), null); assert.equal(linkPair({ from: ID, to: "x),or(id.neq.0" }), null); assert.equal(linkPair(null), null);
});

test("the map route sends no journal title or tags and cleans every field; PATCH answers redacted and drops the map cache", () => {
  const map = readFileSync(new URL("../src/app/api/memories/map/route.ts", import.meta.url), "utf8");
  assert.match(map, /j \? "Journal entry"/); assert.match(map, /tags: j \? \[\] : cleanTagList\(r\.tags\)/); assert.match(map, /isoOrNull\(r\.created_at\)/);
  const one = readFileSync(new URL("../src/app/api/memories/[id]/route.ts", import.meta.url), "utf8");
  assert.match(one, /memory: redactJournalRow\(data/); assert.match(one, /bustMapCache\(user\.id\)/);
});

test("MEMORY UI: no hard-coded English in the new surface, EN and ET keys in step", async () => {
  const { EN, ET } = await import("../src/lib/i18n-pure.ts");
  const mp = Object.keys(EN).filter((k) => k.startsWith("mp."));
  assert.ok(mp.length > 100);
  for (const k of mp) assert.ok((ET as Record<string, string>)[k], `ET missing ${k}`);
  const shell = readFileSync(new URL("../src/components/MemoryShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /confirm\("(?!.*t\()/); // the only confirm() text is translated
  assert.doesNotMatch(shell, /alert\(/);
});
