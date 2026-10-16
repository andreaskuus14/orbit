import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, embedUrl, isVideoId, length, parseWatchChoice, parseWatchCommand, parseWatchControl, pickLatest, planWatch, watchReply } from "../src/lib/watch-pure.ts";
import { parseNavCommand } from "../src/lib/nav-pure.ts";

test("watch commands", () => {
  const yes: [string, string, boolean?][] = [
    ["open Jynxzi's latest videos", "Jynxzi"],
    ["Show me Jynxzi's newest video.", "Jynxzi"],
    ["show me jynxzi's newest videos", "jynxzi"],
    ["play MrBeast's latest video", "MrBeast"],
    ["Hey Orbit, play Kai Cenat’s newest video please", "Kai Cenat"],
    ["what did Jynxzi upload", "Jynxzi"],
    ["What has xQc uploaded recently?", "xQc"],
    ["show me the latest videos from Jynxzi", "Jynxzi"],
    ["find videos by @jynxzi", "jynxzi"],
    ["show me the newest Jynxzi video", "Jynxzi"],
    ["show me the latest from Jynxzi", "Jynxzi"],
    ["play jynxzi newest video", "jynxzi"],
    ["show me Jynxzi's latest shorts", "Jynxzi", true],
  ];
  for (const [t, creator, shorts = false] of yes) assert.deepEqual(parseWatchCommand(t), { creator, shorts }, t);
  for (const t of ["what's the latest news", "show me my videos", "open my latest videos", "how do I upload a video", "show me videos", "what did you upload",
    "show me funny cat videos", "who is Jynxzi", "play some music", "show me the latest news from Germany", "open the clip factory", "show my stats",
    "what's Jynxzi's newest video about", "show me Jynxzi", "tell me about Jynxzi's latest videos"])
    assert.equal(parseWatchCommand(t), null, t);
});

test("choices", () => {
  assert.equal(parseWatchChoice("open the first", 3), 0);
  assert.equal(parseWatchChoice("number two", 3), 1);
  assert.equal(parseWatchChoice("the second one", 3), 1);
  assert.equal(parseWatchChoice("Number 3.", 3), 2);
  assert.equal(parseWatchChoice("play the last one", 3), 2);
  assert.equal(parseWatchChoice("yes", 3), 0);
  assert.equal(parseWatchChoice("Yeah, please", 3), 0);
  assert.equal(parseWatchChoice("no", 3), "cancel");
  assert.equal(parseWatchChoice("cancel", 3), "cancel");
  assert.equal(parseWatchChoice("number 3", 2), null); // out of range
  assert.equal(parseWatchChoice("yes", 3, false), null); // while playing, "yes"/"no" mean nothing
  assert.equal(parseWatchChoice("no", 3, false), null);
  assert.equal(parseWatchChoice("open the second one", 3, false), 1);
  for (const t of ["what's the weather", "the first time I saw it", "two plus two", "open the news"]) assert.equal(parseWatchChoice(t, 3), null, t);
});

test("controls", () => {
  assert.equal(parseWatchControl("pause"), "pause");
  assert.equal(parseWatchControl("Pause the video."), "pause");
  assert.equal(parseWatchControl("play"), "play");
  assert.equal(parseWatchControl("resume"), "play");
  assert.equal(parseWatchControl("next video"), "next");
  assert.equal(parseWatchControl("close video"), "close");
  assert.equal(parseWatchControl("full screen"), "fullscreen");
  assert.equal(parseWatchControl("go fullscreen"), "fullscreen");
  assert.equal(parseWatchControl("exit full screen"), "exitFullscreen");
  assert.equal(parseWatchControl("pause my tasks"), null);
  assert.equal(parseWatchControl("play some music"), null);
});

test("ids, embed URL, quota plan", () => {
  assert.ok(isVideoId("dQw4w9WgXcQ"));
  for (const bad of ["dQw4w9WgXc", "dQw4w9WgXcQQ", "dQw4w9WgX/Q", "<script>xx", 42]) assert.ok(!isVideoId(bad));
  assert.equal(embedUrl("dQw4w9WgXcQ", "http://localhost:3000"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&enablejsapi=1&origin=http%3A%2F%2Flocalhost%3A3000");
  assert.equal(embedUrl("../evil?x=1", "x"), "");
  assert.equal(planWatch(false, 100), 3);
  assert.equal(planWatch(true, 100), 2);
  assert.equal(planWatch(true, 2), 2);
  assert.equal(typeof planWatch(false, 2), "string");
});

test("pickLatest: newest long-form first, Shorts only when asked", () => {
  const it = (id: string, at: string, dur: string, extra = {}) => ({ id, snippet: { title: id, publishedAt: at, ...extra }, contentDetails: { duration: dur }, statistics: { viewCount: "10" } });
  const items = [it("aaaaaaaaaaa", "2026-10-01T00:00:00Z", "PT20M"), it("bbbbbbbbbbb", "2026-10-05T00:00:00Z", "PT45S"), it("ccccccccccc", "2026-10-04T00:00:00Z", "PT1H"),
    it("ddddddddddd", "2026-10-03T00:00:00Z", "PT10M"), it("eeeeeeeeeee", "2026-10-02T00:00:00Z", "PT9M"), it("fffffffffff", "2026-10-06T00:00:00Z", "PT0S", { liveBroadcastContent: "upcoming" }),
    { id: "bad", snippet: {} }];
  assert.deepEqual(pickLatest(items, false).map((v) => v.id), ["ccccccccccc", "ddddddddddd", "eeeeeeeeeee"]);
  assert.deepEqual(pickLatest(items, true).map((v) => v.id), ["bbbbbbbbbbb"]);
  assert.equal(pickLatest(items, false)[0].durationSec, 3600);
});

test("reply and formatting", () => {
  const v = (title: string) => ({ id: "x", title, publishedAt: "", views: 0, durationSec: 0, thumb: "" });
  assert.equal(watchReply("Jynxzi", [v("A"), v("B"), v("C")]), "Found 3 new Jynxzi videos: 1. A, 2. B, 3. C. Which one should I open?");
  assert.equal(watchReply("Jynxzi", [v("A")]), "Found 1 new Jynxzi video: 1. A. Should I open it?");
  assert.match(watchReply("Jynxzi", []), /couldn't find/);
  assert.equal(length(3723), "1:02:03");
  assert.equal(length(65), "1:05");
  assert.equal(ago("2026-10-13T00:00:00Z", Date.parse("2026-10-16T00:00:00Z")), "3 days ago");
});

test("theater navigation", () => {
  for (const t of ["go to the theater", "open the cinema", "take me to the theater"]) assert.deepEqual(parseNavCommand(t), { panel: "theater" }, t);
});
