import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TOPICS, addCreator, addTopic, addWatched, parseCreators, parseHistory, parseTopics, removeCreator, removeTopic, togglePin, type SavedCreator } from "../src/lib/theater-history-pure.ts";

const names = (l: SavedCreator[]) => l.map((c) => (c.pinned ? `*${c.name}` : c.name));

test("creators: most recent first, case-insensitive dedupe, cap 8", () => {
  let l: SavedCreator[] = [];
  for (const n of ["a", "b", "c"]) l = addCreator(l, n);
  assert.deepEqual(names(l), ["c", "b", "a"]);
  assert.deepEqual(names(addCreator(l, " A ")), ["A", "c", "b"]);
  for (let i = 0; i < 10; i++) l = addCreator(l, `x${i}`);
  assert.equal(l.length, 8);
  assert.equal(l[0].name, "x9");
  assert.equal(addCreator(l, "").length, 8); // invalid name: unchanged
  assert.equal(addCreator(l, "a".repeat(41)), l);
});

test("creators: pins first, kept on re-search, max 8, remove", () => {
  let l = ["a", "b", "c"].reduce<SavedCreator[]>((acc, n) => addCreator(acc, n), []);
  l = togglePin(l, "A");
  assert.deepEqual(names(l), ["*a", "c", "b"]);
  l = addCreator(l, "b");
  assert.deepEqual(names(l), ["*a", "b", "c"]);
  l = addCreator(l, "A");
  assert.deepEqual(names(l), ["*A", "b", "c"]); // still pinned
  assert.deepEqual(names(togglePin(l, "a")), ["A", "b", "c"]); // unpinned: stays put among recents
  for (let i = 0; i < 7; i++) l = togglePin(addCreator(l, `p${i}`), `p${i}`);
  assert.equal(l.filter((c) => c.pinned).length, 8);
  assert.equal(togglePin(l, "b"), l); // 9th pin refused
  for (let i = 0; i < 9; i++) l = addCreator(l, `r${i}`);
  assert.equal(l.length, 16);
  assert.ok(l.slice(0, 8).every((c) => c.pinned));
  assert.ok(!removeCreator(l, "P3").some((c) => c.name === "p3"));
});

test("creators: stored JSON is validated", () => {
  for (const bad of [null, "x", 42, {}, undefined]) assert.deepEqual(parseCreators(bad), []);
  assert.deepEqual(parseCreators([{ name: "Jynxzi", pinned: true }, { name: "jynxzi" }, { name: 5 }, null, { name: "a\u0000b" }, { name: "MrBeast", pinned: "yes" }]),
    [{ name: "Jynxzi", pinned: true }, { name: "MrBeast", pinned: false }]);
});

const vid = (id: string) => ({ id, title: `T ${id}`, publishedAt: "2026-10-01T00:00:00Z", views: 5, durationSec: 60, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` });

test("history: newest first, dedupe by id, cap 20, bad ids refused", () => {
  let h = addWatched([], vid("aaaaaaaaaaa"), "Jynxzi", 1);
  h = addWatched(h, vid("bbbbbbbbbbb"), "Jynxzi", 2);
  h = addWatched(h, vid("aaaaaaaaaaa"), "Jynxzi", 3);
  assert.deepEqual(h.map((v) => v.id), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  assert.equal(addWatched(h, vid("../evil"), "x", 4), h);
  for (let i = 0; i < 25; i++) h = addWatched(h, vid(`v${String(i).padStart(10, "0")}`), "x", 10 + i);
  assert.equal(h.length, 20);
});

test("history: stored JSON is validated", () => {
  assert.deepEqual(parseHistory("nope"), []);
  const out = parseHistory([
    { ...vid("aaaaaaaaaaa"), channel: "J", at: 1 },
    { ...vid("ccccccccccc"), channel: "J", at: 5, thumb: "javascript:alert(1)", views: "lots" },
    { id: "<script>xx", title: "x", at: 9 },
    { ...vid("aaaaaaaaaaa"), at: 7 },
  ]);
  assert.deepEqual(out.map((v) => v.id), ["ccccccccccc", "aaaaaaaaaaa"]);
  assert.equal(out[0].thumb, "");
  assert.equal(out[0].views, 0);
  assert.equal(out[1].thumb, "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg");
});

test("topics: defaults, dedupe, cap 12, validation", () => {
  assert.deepEqual(parseTopics(null), DEFAULT_TOPICS); // never saved
  assert.deepEqual(parseTopics([]), []); // all removed stays removed
  assert.deepEqual(parseTopics(["CS2", "cs2", 4, "", "All", " Rocket  League "]), ["CS2", "Rocket League"]);
  let l = addTopic(DEFAULT_TOPICS, "Apex");
  assert.equal(l.at(-1), "Apex");
  assert.equal(addTopic(l, "apex"), l);
  for (let i = 0; i < 10; i++) l = addTopic(l, `t${i}`);
  assert.equal(l.length, 12);
  assert.deepEqual(removeTopic(l, "CS2").includes("CS2"), false);
  assert.equal(addTopic([], "x".repeat(61)).length, 0);
});
