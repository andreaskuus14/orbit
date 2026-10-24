import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterComments, commentTokens, commentUrl, dedupeComments, isAsk, mergeCommentIdeas, normalizeComment, parseThreads, type RawComment } from "../src/lib/comment-ideas-pure.ts";
import type { Idea } from "../src/lib/ideas-pure.ts";

let n = 0;
const c = (author: string, text: string, videoId = "vidAAAAAAAA"): RawComment => ({ id: `c${++n}`, videoId, author, text, publishedAt: `2026-10-2${n % 10}T00:00:00Z` });

test("normalize, tokens and ask detection", () => {
  assert.equal(normalizeComment("What SOFTWARE do u use?? 🔥 https://x.y @bob"), "what software do u use??");
  assert.deepEqual(commentTokens("What software do you use to edit your videos?"), ["software", "edit"]);
  assert.ok(isAsk("part 2 pls")); assert.ok(isAsk("How did you do that")); assert.ok(isAsk("Can you make one about Roblox"));
  assert.ok(!isAsk("first")); assert.ok(!isAsk("this is so funny lol"));
});

test("dedupe: same author + same text once, non-asks and empty-token comments dropped", () => {
  const list = [c("a", "How do you edit?"), c("a", "how do you EDIT"), c("b", "How do you edit?"), c("d", "nice"), c("e", "why??")];
  assert.deepEqual(dedupeComments(list).map((x) => x.author), ["a", "b"]);
});

test("clusters need 3 distinct askers; similar wording groups, unrelated stays apart", () => {
  const list = [c("a", "What software do you use to edit?"), c("b", "how do you edit your videos"), c("b", "what editing software is that?"),
    c("c", "Which software do you edit with"), c("d", "part 2 please!"), c("e", "make a part 2"), c("f", "Can you play Roblox next?")];
  const cl = clusterComments(list);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].askers, 3);
  assert.ok(cl[0].terms.includes("edit"));
  assert.equal(cl[0].comments.length, 4);
  assert.deepEqual(clusterComments([c("x", "part 2?"), c("y", "part 2 pls"), c("z", "PART 2!!!?"), c("w", "need part 2")]).map((x) => [x.key, x.askers]), [["2+part", 4]]);
});

test("parseThreads skips the channel's own comments and malformed items", () => {
  const r = { items: [
    { id: "t1", snippet: { channelId: "UC1", topLevelComment: { snippet: { authorChannelId: { value: "UC2" }, authorDisplayName: "Vi", textOriginal: "how?", publishedAt: "2026-10-20T00:00:00Z" } } } },
    { id: "t2", snippet: { channelId: "UC1", topLevelComment: { snippet: { authorChannelId: { value: "UC1" }, textOriginal: "thanks all" } } } },
    { snippet: {} }] };
  assert.deepEqual(parseThreads(r, "vidAAAAAAAA"), [{ id: "t1", videoId: "vidAAAAAAAA", author: "UC2", text: "how?", publishedAt: "2026-10-20T00:00:00Z" }]);
  assert.deepEqual(parseThreads(null, "v"), []);
  assert.equal(commentUrl({ id: "Ug x", videoId: "vidAAAAAAAA" }), "https://www.youtube.com/watch?v=vidAAAAAAAA&lc=Ug%20x");
});

test("merge: new cluster adds an idea linked to its comments; rerun updates it in place and keeps dismissal", () => {
  const cl = clusterComments([c("a", "part 2?"), c("b", "part 2 pls"), c("c", "PART 2!!!?")]);
  let id = 0;
  const first = mergeCommentIdeas([], cl, { vidAAAAAAAA: "My Short" }, "2026-10-24T00:00:00Z", () => `i${++id}`);
  assert.equal(first.added, 1);
  const idea = first.ideas[0];
  assert.equal(idea.origin, "comments"); assert.equal(idea.videoTitle, "Comments on My Short"); assert.equal(idea.comments?.length, 3); assert.equal(idea.score, 60);
  const dismissed: Idea[] = [{ ...idea, dismissed: true }];
  const more = clusterComments([...cl[0].comments, c("d", "part 2 when")]);
  const again = mergeCommentIdeas(dismissed, more, {}, "2026-10-25T00:00:00Z", () => `i${++id}`);
  assert.equal(again.added, 0); assert.equal(again.ideas.length, 1);
  assert.equal(again.ideas[0].id, "i1"); assert.equal(again.ideas[0].dismissed, true); assert.equal(again.ideas[0].askers, 4); assert.equal(again.ideas[0].at, "2026-10-24T00:00:00Z");
});
