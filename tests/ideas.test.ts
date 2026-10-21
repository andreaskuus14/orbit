import { test } from "node:test";
import assert from "node:assert/strict";
import { board, parseIdeas, videoIdFrom, vttText } from "../src/lib/ideas-pure.ts";

test("videoIdFrom accepts YouTube links only", () => {
  for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1", "https://youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://youtube.com/live/dQw4w9WgXcQ?si=x"])
    assert.equal(videoIdFrom(u), "dQw4w9WgXcQ", u);
  for (const u of ["https://evil.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://youtube.com/watch?v=short", "not a url", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ"])
    assert.equal(videoIdFrom(u), null, u);
});

test("vttText strips timings, tags and YouTube's rolling repeats", () => {
  const vtt = "WEBVTT\nKind: captions\nLanguage: en\n\n00:00:01.000 --> 00:00:03.000\nidea <c>one</c> is clipping\n\n00:00:03.000 --> 00:00:05.000\nidea one is clipping\n\n00:00:05.000 --> 00:00:07.000\nidea two &amp; more\n";
  assert.equal(vttText(vtt), "idea one is clipping idea two & more");
});

test("parseIdeas cleans, clamps and caps; board shows 60+ and not dismissed", () => {
  let n = 0;
  const ans = 'Sure [note]:\n[{"title":"Clip service","summary":"Sell clipping","area":"studio","score":88,"next":"Offer 1 creator a free week"},{"title":"x","area":"moon","score":"999"},{"area":"studio"},{"title":"Low","score":20}]';
  const ideas = parseIdeas(ans, "vid", "10 side hustles", "2026-10-20T00:00:00Z", () => `i${++n}`);
  assert.equal(ideas.length, 3);
  assert.equal(ideas[1].area, "other");
  assert.equal(ideas[1].score, 100);
  assert.deepEqual(parseIdeas("no json", "v", "t", "now", () => "x"), []);
  const b = board([...ideas, { ...ideas[0], id: "d", dismissed: true }], Date.parse("2026-10-21T00:00:00Z"));
  assert.deepEqual(b.shown.map((i) => i.title), ["x", "Clip service"]);
  assert.equal(b.hidden, 2);
});

import { filterFresh, freshnessLabel, isStale, sourceDate, type Idea } from "../src/lib/ideas-pure.ts";
const DAY = 86_400_000, NOW = Date.parse("2026-10-21T12:00:00Z");
const dated = (id: string, age: number, extra: Partial<Idea> = {}): Idea => ({ id, video: "abcdefghijk", videoTitle: "Source", title: id, summary: "", area: "core", score: 80, next: "",
  at: new Date(NOW - 2 * DAY).toISOString(), sourceAt: new Date(NOW - age * DAY).toISOString(), ...extra });

test("freshness: source age controls staleness, exact 14d boundary stays fresh, legacy and invalid dates are stale", () => {
  assert.equal(isStale(dated("fresh", 14), NOW), false);
  assert.equal(isStale(dated("old", 14, { sourceAt: new Date(NOW - 14 * DAY - 1).toISOString() }), NOW), true);
  assert.equal(isStale(dated("recent source", 1, { at: new Date(NOW - 100 * DAY).toISOString() }), NOW), false);
  for (const changes of [{ at: undefined }, { sourceAt: undefined }, { at: "" }, { sourceAt: "bad date" }, { sourceAt: new Date(NOW + DAY).toISOString() }, { at: new Date(NOW + DAY).toISOString() }]) {
    assert.equal(isStale(dated("legacy", 1, changes), NOW), true, JSON.stringify(changes));
  }
  assert.equal(isStale({}, NOW), true);
  assert.equal(freshnessLabel(dated("label", 5), NOW), "found 2d ago · source 5d old");
  assert.equal(freshnessLabel(dated("today", 0, { at: new Date(NOW).toISOString() }), NOW), "found 0d ago · source 0d old");
  assert.equal(freshnessLabel({}, NOW), "found unknown · source unknown");
  assert.equal(freshnessLabel(dated("mixed", 5, { at: undefined }), NOW), "found unknown · source 5d old");
});

test("filterFresh drops sources over 30d and undated candidates before CORE; no input mutation", () => {
  const candidates = [dated("30d", 30), dated("recent", 1), dated("too old", 30, { sourceAt: new Date(NOW - 30 * DAY - 1).toISOString() }),
    dated("unknown", 0, { sourceAt: undefined }), dated("invalid", 0, { sourceAt: "invalid" }), dated("future", -1)];
  const before = structuredClone(candidates);
  assert.deepEqual(filterFresh(candidates, NOW).map((i) => i.id), ["30d", "recent"]);
  assert.deepEqual(candidates, before);
  assert.deepEqual(filterFresh([], NOW), []);
});

test("board sorts stale last before score and found date, preserving hidden and legacy records", () => {
  const rows = [dated("stale high", 20, { score: 100 }), dated("fresh low", 5, { score: 60 }), dated("fresh high", 5, { score: 90 }),
    dated("legacy", 0, { at: undefined, sourceAt: undefined, score: 99 }), dated("dismissed", 0, { dismissed: true }), dated("weak", 0, { score: 59 })];
  const before = structuredClone(rows), result = board(rows, NOW);
  assert.deepEqual(result.shown.map((i) => i.id), ["fresh high", "fresh low", "stale high", "legacy"]);
  assert.equal(result.hidden, 2); assert.deepEqual(rows, before);
  const tied = [dated("old found", 1), dated("new found", 1, { at: new Date(NOW - DAY).toISOString() })];
  assert.deepEqual(board(tied, NOW).shown.map((i) => i.id), ["new found", "old found"]);
});

test("sourceDate accepts real UTC upload dates and rejects missing, malformed or impossible dates", () => {
  assert.equal(sourceDate("20261016"), "2026-10-16T00:00:00.000Z");
  assert.equal(sourceDate("20240229"), "2024-02-29T00:00:00.000Z");
  for (const raw of ["NA", "", "20260229", "20260230", "20261301", "20261000", "not a date", "2026-10-16"]) assert.equal(sourceDate(raw), undefined, raw);
});

test("new ideas persist both real dates and ignore dates hallucinated by CORE", () => {
  const found = new Date(NOW).toISOString(), sourceAt = "2026-10-16T00:00:00.000Z";
  const ideas = parseIdeas('[{"title":"Fresh idea","score":90,"at":"fake","sourceAt":"fake"}]', "abcdefghijk", "Source", found, () => "id", sourceAt);
  assert.equal(ideas[0].at, found); assert.equal(ideas[0].sourceAt, sourceAt);
  assert.equal(freshnessLabel(ideas[0], NOW), "found 0d ago · source 5d old");
});
