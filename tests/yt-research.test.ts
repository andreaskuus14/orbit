import { test } from "node:test";
import assert from "node:assert/strict";
import {
  channelBaseline, channelsToRead, clusterTitles, featureLift, fallbackWhy, freshness, hookText, maturity, pacing, parseChannelTab, parseDetail, parseJson3, parseRedditSearch,
  channelsThatFit, onNiche, parseSearch, parseTrendsTimeline, parseVtt, postingTime, rankOutliers, researchInput, scoreVideo, titleFeatures, tokens, trendDirection, validThumb, validWhy, wordsPerMinute,
  MIN_VIEWS, type ChannelTab, type Evidence, type YtVideo,
} from "../src/lib/yt-research-pure.ts";

const NOW = Date.parse("2026-11-21T12:00:00Z"), DAY = 86_400_000;
const CH = "UC" + "a".repeat(22), CH2 = "UC" + "b".repeat(22);
const vid = (id: string, views: number, o: Partial<YtVideo> = {}): YtVideo =>
  ({ id: id.padEnd(11, "x").slice(0, 11), title: `T ${id}`, channelId: CH, channel: "A", views, durationSec: 40, uploadedAt: null, isShort: true, thumb: "", ...o });

test("baseline: median of recent uploads skipping the two newest; low confidence under 5", () => {
  assert.deepEqual(channelBaseline([9e9, 9e9, 10, 20, 30, 40, 50]), { median: 30, n: 5, lowConfidence: false });
  assert.equal(channelBaseline([1, 2, 3, 4, 5]).lowConfidence, true);
  assert.equal(channelBaseline([]).median, null);
});

test("maturity: log curve to 1, Shorts mature faster, floor and unknown age", () => {
  assert.equal(maturity(null, true), 1);
  assert.equal(maturity(14, true), 1);
  assert.ok(maturity(14, false) < 1);
  assert.ok(maturity(3, true) > maturity(3, false));
  assert.equal(maturity(0, false), 0.15);
  assert.ok(maturity(5, false) > maturity(2, false));
});

test("freshness halves at 180 days; unknown = 0.5", () => {
  assert.equal(freshness(0), 1);
  assert.equal(freshness(180), 0.5);
  assert.equal(freshness(null), 0.5);
});

test("scoreVideo: median basis, projected for a young video, outlier needs 3x and 10k views", () => {
  const base = channelBaseline([0, 0, 10_000, 10_000, 10_000, 10_000, 10_000]);
  const old = scoreVideo(vid("a", 50_000, { uploadedAt: new Date(NOW - 400 * DAY).toISOString() }), base, null, NOW);
  assert.equal(old.basis, "median"); assert.equal(old.ratio, 5); assert.equal(old.projected, 5); assert.ok(old.outlier);
  const young = scoreVideo(vid("b", 20_000, { uploadedAt: new Date(NOW - 2 * DAY).toISOString() }), base, null, NOW);
  assert.ok(young.projected! > young.ratio!, "young video is projected up");
  assert.ok(young.score > old.score, "fresh wins rank higher");
  const tiny = scoreVideo(vid("c", MIN_VIEWS - 1), channelBaseline([0, 0, 100, 100, 100, 100, 100]), null, NOW);
  assert.equal(tiny.outlier, false, "under 10k views never counts");
});

test("scoreVideo: subscriber basis when the median is unreliable; none without either", () => {
  const s = scoreVideo(vid("a", 100_000), channelBaseline([1, 2]), 50_000, NOW);
  assert.equal(s.basis, "subscribers"); assert.equal(s.ratio, 10);
  const n = scoreVideo(vid("a", 100_000), channelBaseline([]), null, NOW);
  assert.equal(n.basis, "none"); assert.equal(n.outlier, false); assert.equal(n.score, 0);
});

test("rankOutliers: per-format baseline, dedupe, outliers first", () => {
  const shorts = Array.from({ length: 9 }, (_, k) => vid(`s${k}`, 10_000));
  const longs = Array.from({ length: 9 }, (_, k) => vid(`l${k}`, 1_000_000, { isShort: false }));
  const ch: ChannelTab = { channelId: CH, channel: "A", subscribers: null, videos: [...shorts, ...longs] };
  const hit = vid("hit", 60_000), r = rankOutliers([hit, hit, vid("meh", 9_000)], new Map([[CH, ch]]), NOW);
  assert.equal(r.length, 2);
  assert.equal(r[0].id, hit.id); assert.equal(r[0].ratio, 6, "a Short is compared with Shorts, not the long videos"); assert.ok(r[0].outlier);
});

test("channelsToRead: most hits first, valid ids only, capped", () => {
  const c = [vid("a", 1), vid("b", 1), vid("c", 5, { channelId: CH2 }), vid("d", 1, { channelId: "bad" })];
  assert.deepEqual(channelsToRead(c, 5), [CH, CH2]);
  assert.deepEqual(channelsToRead(c, 1), [CH]);
});

test("parseSearch / parseChannelTab / parseDetail on yt-dlp JSON", () => {
  const s = parseSearch({ entries: [
    { id: "ksrCwAy4gsk", title: "What If...", channel_id: CH, channel: "P", view_count: 1732955, duration: 2415, url: "https://www.youtube.com/watch?v=ksrCwAy4gsk", thumbnails: [{ url: "https://i.ytimg.com/vi/ksrCwAy4gsk/hq720.jpg?x=1", width: 720 }] },
    { id: "ksrCwAy4gsk", title: "dup", view_count: 1 }, { id: "short", view_count: 5 }, { id: "abcdefghijk", title: "hidden" },
    { id: "bcdefghijkl", title: "S", view_count: 10, url: "https://www.youtube.com/shorts/bcdefghijkl" }, { id: "cdefghijklm", view_count: 3, live_status: "is_live" },
  ] });
  assert.deepEqual(s.map((v) => v.id), ["ksrCwAy4gsk", "bcdefghijkl"]);
  assert.equal(s[0].thumb, "https://i.ytimg.com/vi/ksrCwAy4gsk/hq720.jpg");
  assert.equal(s[1].isShort, true);
  const t = parseChannelTab({ channel_id: CH, channel: "A", channel_follower_count: 1234, entries: [{ id: "abcdefghijk", view_count: 50 }] });
  assert.equal(t?.subscribers, 1234); assert.equal(t?.videos[0].channelId, CH);
  assert.equal(parseChannelTab({ id: "nope" }), null);
  const d = parseDetail({ id: "abcdefghijk", title: "X", view_count: 9, channel_id: CH, timestamp: 1763726400, duration: 50, width: 1080, height: 1920, chapters: [{ title: "Intro", start_time: 0 }],
    heatmap: [{ start_time: 0, end_time: 5, value: 1 }], automatic_captions: { en: [{ ext: "vtt", url: "https://www.youtube.com/api/timedtext?v=1&fmt=vtt" }, { ext: "json3", url: "https://www.youtube.com/api/timedtext?v=1&fmt=json3" }] },
    subtitles: { en: [{ ext: "json3", url: "https://evil.example/x" }] } });
  assert.ok(d); assert.equal(d.isShort, true); assert.equal(d.exactTime, true); assert.equal(d.captionFormat, "json3");
  assert.match(d.captionUrl!, /youtube\.com\/api\/timedtext.*json3/, "a non-YouTube caption URL is never used");
  assert.equal(parseDetail({ id: "abcdefghijk", upload_date: "20260101", view_count: 1 })?.exactTime, false);
});

test("tokens: stop words, framing words, plural folding", () => {
  assert.deepEqual(tokens("What If The Moon Disappeared?", ["moon"]), ["disappeared"]);
  assert.deepEqual(tokens("What if all oceans were gone"), ["ocean", "gone"]);
  assert.deepEqual(tokens("What if countries stopped"), ["country", "stopped"]);
});

test("clusterTitles groups by topic and labels by shared terms", () => {
  const items = [
    { t: "What if the Moon disappeared", w: 5 }, { t: "What if the Moon crashed into Earth", w: 4 }, { t: "What if we had two Moons", w: 3 },
    { t: "What if the oceans dried up", w: 2 }, { t: "What if all oceans froze", w: 2 }, { t: "What if you never slept", w: 1 },
  ];
  const c = clusterTitles(items, (x) => x.t, (x) => x.w, { stop: ["what", "if"] });
  const moon = c.find((g) => g.terms[0] === "moon"), ocean = c.find((g) => g.terms[0] === "ocean");
  assert.equal(moon?.items.length, 3); assert.equal(ocean?.items.length, 2);
  assert.equal(c[0], moon, "heaviest cluster first");
  assert.ok(c.some((g) => g.items.length === 1 && g.items[0].t.includes("slept")));
  assert.deepEqual(clusterTitles([], (x: string) => x, () => 1), []);
});

test("title features", () => {
  const f = titleFeatures("What If EVERY Human Disappeared for 24 Hours?");
  assert.equal(f["starts with What if"], true); assert.equal(f["is a question"], true); assert.equal(f["has a number"], true);
  assert.equal(f["has a CAPS word"], true); assert.equal(f["extreme stakes (all / never / disappear)"], true); assert.equal(f["time frame (for 24 hours)"], true);
  assert.equal(f["talks to you"], false); assert.equal(f["short (7 words or less)"], false);
  assert.equal(titleFeatures("WHAT IF")["has a CAPS word"], false, "an all-caps title isn't a CAPS-word pattern");
  assert.equal(titleFeatures("What if you were the last one 😱")["emoji"], true);
});

test("featureLift: smoothed lift, needs 2 winners with the feature, sorted", () => {
  const winners = ["What if the sun vanished?", "What if Earth stopped?", "What if you never slept?", "Moon facts"];
  const others = ["Moon facts 2", "Sun facts", "Ocean facts", "What if cats ruled", "Space trip"];
  const l = featureLift(winners, others);
  const q = l.find((x) => x.feature === "is a question")!;
  assert.equal(q.winners, 3); assert.equal(q.inOthers, 0); assert.ok(q.lift > 2);
  assert.ok(l.every((x) => x.winners >= 2));
  assert.ok(l.every((x, k) => k === 0 || l[k - 1].lift >= x.lift));
});

test("captions: json3 and vtt (auto-caption rolling repeats collapsed), hook, wpm", () => {
  const j = parseJson3({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "What if " }, { utf8: "the moon" }] }, { tStartMs: 31000, segs: [{ utf8: "later" }] }, { tStartMs: 5 }] });
  assert.deepEqual(j.map((c) => c.text), ["What if the moon", "later"]);
  assert.equal(hookText(j, 30), "What if the moon");
  const v = parseVtt("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<c>what if</c>\n\n00:00:02.000 --> 00:00:04.000\nwhat if\n\n00:00:04.000 --> 00:00:06.000\nwhat if the moon\n");
  assert.deepEqual(v.map((c) => c.text), ["what if", "the moon"]);
  assert.equal(wordsPerMinute([{ start: 0, end: 30, text: "one two three four five six seven eight nine ten" }], 30), 20);
  assert.equal(wordsPerMinute([], 30), null);
});

test("pacing and posting time", () => {
  const p = pacing({ durationSec: 600, chapters: [{ title: "a", start: 0 }, { title: "b", start: 300 }], heatmap: [{ start: 0, end: 10, value: 1 }, { start: 40, end: 50, value: 0.3 }, { start: 100, end: 110, value: 0.2 }] }, []);
  assert.equal(p.avgChapterSec, 300); assert.equal(p.replayNote, "people replay the opening most"); assert.equal(p.replayPeakSec, 0);
  assert.equal(pacing({ durationSec: 30, chapters: [], heatmap: [] }, []).replayNote, "YouTube shows no replay graph for it");
  assert.deepEqual(postingTime("2026-11-19T15:30:00Z", true), { day: "Thursday", hourUtc: 15 });
  assert.deepEqual(postingTime("2026-11-19T12:00:00Z", false), { day: "Thursday", hourUtc: null });
  assert.deepEqual(postingTime(null, true), { day: null, hourUtc: null });
});

test("trends + reddit parsing", () => {
  const vals = parseTrendsTimeline(`)]}',\n${JSON.stringify({ default: { timelineData: [10, 10, 10, 10, 10, 10, 20, 20].map((v) => ({ value: [v] })) } })}`);
  assert.equal(vals.length, 8); assert.equal(trendDirection(vals), "rising");
  assert.equal(trendDirection([20, 20, 20, 20, 20, 20, 5, 5]), "falling");
  assert.equal(trendDirection([5, 5, 5, 5, 5, 5, 5, 5]), "steady");
  assert.equal(trendDirection([1, 2]), "unknown"); assert.deepEqual(parseTrendsTimeline("garbage"), []);
  const r = parseRedditSearch({ data: { children: [{ data: { title: "What if the moon", subreddit: "space", score: 99, num_comments: 0 } }, { data: { title: "nsfw", over_18: true } }, { data: {} }] } });
  assert.deepEqual(r, [{ title: "What if the moon", sub: "space", score: 99, comments: 0 }]);
});

test("why / thumb validation and the rules-only fallback never says to copy content", () => {
  assert.equal(validWhy({ why: "" }), null);
  assert.deepEqual(validWhy({ why: "Big stakes.", copy: ["a", 2, ""], avoid: ["x", "y", "z"] }), { why: "Big stakes.", copy: ["a", "2"], avoid: ["x", "y"] });
  assert.equal(validThumb({ faces: 99, contrast: "neon" })?.faces, 20);
  assert.equal(validThumb({ contrast: "neon" })?.contrast, "medium");
  const e: Evidence = { id: "a", title: "What if?", channel: "c", views: 1, projected: 8, basis: "median", age: 3, isShort: true, features: ["is a question"], thumb: null, hook: "",
    pacing: { durationSec: 40, chapters: 0, avgChapterSec: null, wpm: null, replayPeakSec: null, replayNote: "people replay the opening most" }, posted: { day: null, hourUtc: null }, cluster: "moon" };
  const w = fallbackWhy(e, [{ feature: "is a question", inWinners: 1, inOthers: 0, lift: 3, winners: 3 }]);
  assert.match(w.why, /8×/); assert.match(w.why, /guess/); assert.ok(w.copy.includes("Title: is a question")); assert.match(w.avoid[0], /exact title/);
});

test("researchInput: bounded plan from the niche", () => {
  assert.equal(typeof researchInput({}), "string");
  const r = researchInput({ niche: "what if explainers", perQuery: 999 });
  assert.ok(typeof r !== "string");
  assert.deepEqual(r.queries, ["what if explainers", "what if explained", "what if animation"]);
  assert.equal(r.perQuery, 40); assert.equal(r.top, 5);
});

test("onNiche: the niche phrase or its content words; loose search hits dropped", () => {
  assert.equal(onNiche("What If You Could Stop Time?", "what if explainers"), true);
  assert.equal(onNiche("AI Animation", "what if explainers"), false);
  assert.equal(onNiche("What would happen without bees", "bees explained"), true);
  assert.equal(onNiche("Bee facts", "bees"), true);
  assert.equal(onNiche("Anything", "explainers"), true);
});

test("channelsThatFit: channel reads leave room for the detail reads under the call cap", () => {
  assert.equal(channelsThatFit(4, 5, 12, 50), 12); // 4 + 24 + 15 = 43 ≤ 50
  assert.equal(channelsThatFit(4, 5, 15, 40), 10); // the old 40 cap: 12 channels would starve details
  assert.equal(channelsThatFit(4, 5, 12, 10), 1);
  const r = researchInput({ niche: "what if explainers", maxChannels: 99 });
  assert.ok(typeof r !== "string" && r.queries.length + 2 * r.maxChannels + 3 * r.top <= 50);
});
