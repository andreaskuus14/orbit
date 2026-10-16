import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, embedUrl, isVideoId, length, mergeByDate, pruneCache, parseWatchChoice, parseWatchCommand, parseWatchControl, pickLatest, pickVideos, planTopic, planWatch, safeThumb, topicQuery, unitCost, watchReply } from "../src/lib/watch-pure.ts";
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
    ["what did @Jynxzi post today", "Jynxzi"],
    ["show me the latest videos from Jynxzi", "Jynxzi"],
    ["find videos by @jynxzi", "jynxzi"],
    ["show me the newest Jynxzi video", "Jynxzi"],
    ["show me the latest from Jynxzi", "Jynxzi"],
    ["play jynxzi newest video", "jynxzi"],
    ["show me Jynxzi's latest shorts", "Jynxzi", true],
  ];
  for (const [t, creator, shorts = false] of yes) assert.deepEqual(parseWatchCommand(t), { creator, shorts }, t);
  for (const t of ["what's the latest news", "show me my videos", "open my latest videos", "how do I upload a video", "show me videos", "what did you upload",
    "who is Jynxzi", "play some music", "show me the latest news from Germany", "open the clip factory", "show my stats",
    "what's Jynxzi's newest video about", "show me Jynxzi", "tell me about Jynxzi's latest videos", "show me videos from last week", "show me the latest videos by category", "show me the latest news videos", "what did Trump post today", "what has everybody posted", "show me videos from 2024", "show me the latest videos from this year", "find videos by date"])
    assert.equal(parseWatchCommand(t), null, t);
});

test("topic commands", () => {
  const yes: [string, string, boolean?][] = [
    ["show me cs2 videos", "cs2"],
    ["Show me videos about Minecraft.", "Minecraft"],
    ["show me some Fortnite videos", "Fortnite"],
    ["show me funny cat videos", "funny cat"],
    ["find videos on rocket league", "rocket league"],
    ["show me the latest videos about GTA", "GTA"],
  ];
  for (const [t, topic, shorts = false] of yes)
    assert.deepEqual(parseWatchCommand(t), { creator: topic, shorts, topic: true }, t);
  assert.deepEqual(parseWatchCommand("show me Jynxzi's latest videos"), { creator: "Jynxzi", shorts: false }); // still a creator
  assert.deepEqual(parseWatchCommand("play the newest valorant shorts"), { creator: "valorant", shorts: true }); // creator lookup → server falls back to a topic
  for (const t of ["show me my videos", "show me some videos", "show me youtube videos", "show me news videos", "show me videos about", "show me Jynxzi's videos about cars", "show me gaming videos"])
    assert.ok(!parseWatchCommand(t)?.topic, t);
});

test("topic query, units, thumbnails", () => {
  assert.equal(topicQuery("cs2"), "Counter-Strike 2");
  assert.equal(topicQuery(" CS2 "), "Counter-Strike 2");
  assert.equal(topicQuery("fn"), "Fortnite");
  assert.equal(topicQuery("mc"), "Minecraft");
  assert.equal(topicQuery("val"), "Valorant");
  assert.equal(topicQuery("r6"), "Rainbow Six Siege");
  assert.equal(topicQuery("gta"), "GTA");
  assert.equal(topicQuery("rocket   league"), "rocket league");
  for (const bad of ["", "   ", "x".repeat(61), 5, null, "a\u0007b"]) assert.equal(topicQuery(bad), null, String(bad));
  assert.equal(unitCost("search"), 100);
  assert.equal(unitCost("videos"), 1);
  assert.equal(planTopic(5000), 101);
  assert.equal(typeof planTopic(100), "string");
  assert.equal(safeThumb("https://i.ytimg.com/vi/x/mqdefault.jpg"), "https://i.ytimg.com/vi/x/mqdefault.jpg");
  for (const bad of ["http://i.ytimg.com/x", "https://evil.com/i.ytimg.com/", "https://i.ytimg.com.evil.com/x", "javascript:alert(1)", 3]) assert.equal(safeThumb(bad), "", String(bad));
});

test("pickVideos (topics) and mergeByDate (All)", () => {
  const it = (id: string, dur: string, live = "none", views = "1") => ({ id, snippet: { title: id, channelTitle: "Ch", publishedAt: "2026-10-10T00:00:00Z", liveBroadcastContent: live,
    thumbnails: { medium: { url: "https://evil.com/x.jpg" } } }, contentDetails: { duration: dur }, statistics: { viewCount: views } });
  const items = [it("aaaaaaaaaaa", "PT20M"), it("bbbbbbbbbbb", "PT30S"), it("ccccccccccc", "PT0S", "live"), it("ddddddddddd", "PT0S", "upcoming")];
  const long = pickVideos(items, false, false);
  assert.deepEqual(long.map((v) => v.id), ["aaaaaaaaaaa"]);
  assert.equal(long[0].channel, "Ch");
  assert.equal(long[0].thumb, ""); // not YouTube's image host
  assert.deepEqual(pickVideos(items, true, false).map((v) => v.id), ["bbbbbbbbbbb"]);
  assert.deepEqual(pickVideos(items, false).map((v) => v.id), ["aaaaaaaaaaa", "ccccccccccc"]); // creator lookups keep live streams as before
  const v = (id: string, at: string) => ({ id, title: id, publishedAt: at, views: 0, durationSec: 60, thumb: "" });
  assert.deepEqual(mergeByDate([[v("a", "2026-10-01"), v("b", "2026-10-03")], [v("c", "2026-10-02"), v("a", "2026-10-01")]]).map((x) => x.id), ["b", "c", "a"]);
  assert.match(watchReply("Counter-Strike 2", [v("a", "")], false, true), /^Here is a popular video about Counter-Strike 2/);
  assert.match(watchReply("Counter-Strike 2", [], false, true), /couldn't find any recent videos about/);
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

test("ORBIT places are not YouTube topics", async () => {
  const { parseWatchCommand } = await import("../src/lib/watch-pure.ts");
  assert.equal(parseWatchCommand("show me the studio videos"), null);
  assert.equal(parseWatchCommand("show me cs2 videos")?.topic, true);
});

test("in-theater phrases never become topic searches", () => {
  const ts = ["play the next video", "show me the second video", "show me the 2nd video", "play the tenth video",
    ...["previous", "same", "another", "full", "random"].map((w) => `play the ${w} video`),
    ...["saved", "watched", "liked", "favorite", "favourite", "older", "long", "short", "newer", "other", "more"].map((w) => `show me ${w} videos`),
    "show me those videos", "show me that video", "play this video"];
  for (const t of ts) assert.equal(parseWatchCommand(t), null, t);
  assert.equal(parseWatchChoice("show me the second video", 3), 1); // answered as a choice instead
  assert.deepEqual(parseWatchCommand("show me rocket league videos"), { creator: "rocket league", shorts: false, topic: true }); // real topics still pass
  assert.deepEqual(parseWatchCommand("show me Rainbow Six videos"), { creator: "Rainbow Six", shorts: false, topic: true });
});

test("pruneCache: expired dropped, size capped (oldest first)", () => {
  const m = new Map<string, { at: number }>([["old", { at: 0 }], ["a", { at: 900 }], ["b", { at: 950 }], ["c", { at: 990 }]]);
  pruneCache(m, 1000, 500, 3);
  assert.deepEqual([...m.keys()], ["b", "c"]); // "old" expired; "a" dropped to leave room for the new entry
  const big = new Map(Array.from({ length: 250 }, (_, i) => [`k${i}`, { at: 1000 }] as [string, { at: number }]));
  pruneCache(big, 1000, 500);
  assert.equal(big.size, 199);
  assert.ok(big.has("k249") && !big.has("k0"));
});
