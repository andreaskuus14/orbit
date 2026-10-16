import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDescription, engageDue, engageProblem, latestPublished, parseDrafts, unanswered, REPLY_MAX } from "../src/lib/clips/engage-pure.ts";
import type { ClipJob } from "../src/lib/clips/types.ts";

const VID = "abcdefghijk", VID2 = "bcdefghijkl";

test("parseDrafts keeps valid replies for known comments only, strips <>, drops links/too long/dupes", () => {
  const d = parseDrafts(`sure! {"replies":[
    {"commentId":"c1","text":"Haha <b>right</b>?"},
    {"commentId":"c1","text":"dupe"},
    {"commentId":"c2","text":"check www.spam.com"},
    {"commentId":"c3","text":"${"x".repeat(REPLY_MAX + 1)}"},
    {"commentId":"zz","text":"unknown comment"},
    {"commentId":"c4","text":"https://x.io lol"},
    null, 5
  ],"pinned":"Would you have <stayed>?"}`, ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(d, { replies: [{ commentId: "c1", text: "Haha bright/b?" }], pinned: "Would you have stayed?" });
  assert.equal(parseDrafts("no json", ["c1"]), null);
  assert.equal(parseDrafts(`{"replies":"nope","pinned":"x"}`, ["c1"]), null);
  assert.equal(parseDrafts(`{"replies":[]}`, ["c1"]), null); // pinned missing
  assert.equal(parseDrafts(`{"replies":[],"pinned":"see youtube.com"}`, ["c1"]), null); // nothing usable left
});

test("buildDescription: ≤2 lines, credit line when creator known, 3-5 hashtags incl. #shorts", () => {
  const t = buildDescription(`{"description":"He did <not> see that coming\\nWatch till the end\\nthird line","hashtags":["gaming","#Shorts","#fail moments","#bad-tag","clutch","#gg","#extra"]}`, "Kai Cenat");
  assert.equal(t, "He did not see that coming\nWatch till the end\n\n🎥 Kai Cenat (source)\n\n#shorts #gaming #failmoments #clutch #gg");
  assert.equal(buildDescription(`{"description":"Nice","hashtags":["a","b"]}`, ""), "Nice\n\n#shorts #a #b");
  assert.equal(buildDescription(`{"description":"Nice","hashtags":["a"]}`, ""), null); // < 3 tags
  assert.equal(buildDescription(`{"description":"go to bit.ly/x","hashtags":["a","b"]}`, ""), null); // link-only description
  assert.equal(buildDescription("nope", "x"), null);
});

test("unanswered drops replied, owner's own and empty comments, strips <>", () => {
  const th = (id: string, text: string, replies = 0, author = "UCfan") => ({ id, snippet: { channelId: "UCme", totalReplyCount: replies,
    topLevelComment: { snippet: { authorDisplayName: "Fan <1>", authorChannelId: { value: author }, textOriginal: text, likeCount: 3, publishedAt: "2026-10-01T00:00:00Z" } } } });
  const out = unanswered({ items: [th("a", "W <clip>"), th("b", "answered", 2), th("c", "mine", 0, "UCme"), th("d", "  ")] });
  assert.deepEqual(out, [{ id: "a", author: "Fan 1", text: "W clip", likes: 3, publishedAt: "2026-10-01T00:00:00Z" }]);
  assert.deepEqual(unanswered(null), []);
});

test("latestPublished: live clips only, newest first, deduped, max n", () => {
  const clip = (id: string, publish: object) => ({ id, start: 0, end: 10, title: `T ${id}`, hook: "h", reason: "r", score: 1, status: "approved", publish });
  const jobs = [{ id: "j1", clips: [
    clip("clip-1", { status: "done", videoId: VID, at: "2026-10-01T00:00:00Z" }),
    clip("clip-2", { status: "done", videoId: VID2, at: "2026-10-05T00:00:00Z", title: "Sent <title>" }),
    clip("clip-3", { status: "scheduled", videoId: "cdefghijklm", at: "2026-10-01T00:00:00Z", scheduledFor: "2099-01-01T00:00:00Z" }), // not live yet
    clip("clip-4", { status: "failed", at: "2026-10-01T00:00:00Z" }),
    clip("clip-5", { status: "done", videoId: VID, at: "2026-09-01T00:00:00Z" }), // duplicate video
  ] }] as unknown as ClipJob[];
  const out = latestPublished(jobs, Date.parse("2026-10-16T00:00:00Z"));
  assert.deepEqual(out.map((s) => [s.videoId, s.clipId, s.title]), [[VID2, "clip-2", "Sent title"], [VID, "clip-1", "T clip-1"]]);
  assert.equal(latestPublished(jobs, Date.now(), 1).length, 1);
});

test("engageProblem validates the cache; engageDue is 30 min", () => {
  const ok = { v: 1, fetchedAt: "2026-10-16T00:00:00Z", shorts: [{ videoId: VID, jobId: "j", clipId: "c", title: "t", hook: "h", reason: "r",
    comments: [{ id: "x", author: "a", text: "t", likes: 0, publishedAt: "" }] }] };
  assert.equal(engageProblem(ok), "");
  assert.notEqual(engageProblem({ ...ok, v: 2 }), "");
  assert.notEqual(engageProblem({ ...ok, shorts: [{ ...ok.shorts[0], videoId: "bad" }] }), "");
  assert.notEqual(engageProblem({ ...ok, shorts: [{ ...ok.shorts[0], comments: [{ id: "x" }] }] }), "");
  const t = Date.parse(ok.fetchedAt);
  assert.equal(engageDue(ok as never, t + 29 * 60_000), false);
  assert.equal(engageDue(ok as never, t + 31 * 60_000), true);
  assert.equal(engageDue(null, t), true);
});
