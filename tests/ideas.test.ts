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
  const b = board([...ideas, { ...ideas[0], id: "d", dismissed: true }]);
  assert.deepEqual(b.shown.map((i) => i.title), ["x", "Clip service"]);
  assert.equal(b.hidden, 2);
});
