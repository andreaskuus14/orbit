import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_UNITS, DEFAULTS, looksLikeChannel, skipSummary, autoPicks, baselineVph, buildPicks, charge, emptyScout, parseRanking, parseScout, planRun, pureScore, quotaDay, scoutDue, skipReason,
  toCandidates, usedToday, validSettings, videoIdOf, type Candidate, type ScoutPick,
} from "../src/lib/clips/scout-pure.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const cand = (extra: Partial<Candidate> = {}): Candidate => ({ id: "aaaaaaaaaaa", title: "t", channel: "c", channelId: "UC" + "x".repeat(22), publishedAt: hAgo(10),
  durationSec: 3600, live: "none", description: "", stats: { views: 10_000, likes: 500, comments: 100 }, source: "watchlist", ...extra });
const UC = (c: string) => "UC" + c.repeat(22);

test("validSettings: patches, bounds, dedupe, cleaning", () => {
  const s = validSettings({ keywords: [" minecraft  speedrun ", "minecraft speedrun", "pod"], maxAgeHours: 24, dailyAuto: 0 }, DEFAULTS);
  assert.ok(typeof s !== "string");
  assert.deepEqual(s.keywords, ["minecraft speedrun", "pod"]);
  assert.equal(s.maxAgeHours, 24); assert.equal(s.dailyAuto, 0); assert.equal(s.minMinutes, 8); assert.equal(s.creatorMaxAgeDays, 7); assert.equal(s.runAt, 6);
  assert.match(validSettings({ runAt: 24 }, DEFAULTS) as string, /runAt/);
  assert.match(validSettings({ maxAgeHours: 1.5 }, DEFAULTS) as string, /maxAgeHours/);
  assert.match(validSettings({ keywords: ["x"] }, DEFAULTS) as string, /keyword/);
  assert.match(validSettings({ watchlist: [{ channelId: "bad", autoClip: true }] }, DEFAULTS) as string, /channelId/);
  const w = validSettings({ watchlist: [{ channelId: UC("a"), title: "A\n<b>", autoClip: true }, { channelId: UC("a"), title: "dup", autoClip: false }] }, DEFAULTS);
  assert.ok(typeof w !== "string");
  assert.deepEqual(w.watchlist, [{ channelId: UC("a"), title: "A <b>", autoClip: true }]);
});

test("parseScout: defaults, rejects bad files, drops bad picks", () => {
  assert.equal(typeof parseScout(null), "string");
  assert.equal(typeof parseScout({ v: 3 }), "string");
  const m = parseScout({ v: 1, minMinutes: 15 }), kept = parseScout({ v: 1, minMinutes: 20 }), v2 = parseScout({ v: 2, minMinutes: 15 });
  assert.ok(typeof m !== "string" && typeof kept !== "string" && typeof v2 !== "string");
  assert.equal(m.minMinutes, 8); assert.equal(m.v, 2); assert.equal(kept.minMinutes, 20); assert.equal(v2.minMinutes, 15); // migrated once, old default only
  assert.equal(typeof parseScout({ v: 1, runAt: 99 }), "string");
  const s = parseScout({ v: 1, picks: [{ videoId: "nope" }, { videoId: "aaaaaaaaaaa", url: "u", title: "t", score: 5, status: "new", source: "keyword", stats: {} }], seen: ["bbbbbbbbbbb", 3] });
  assert.ok(typeof s !== "string");
  assert.equal(s.picks.length, 1); assert.deepEqual(s.seen, ["bbbbbbbbbbb"]); assert.equal(s.maxAgeHours, 48);
});

test("quota: per Pacific day, budget caps keyword searches and rotates them", () => {
  const now = new Date("2026-10-16T05:00:00Z"); // still Oct 15 in California
  assert.equal(quotaDay(now), "2026-10-15");
  let q = charge({ day: "2026-10-14", used: 1400 }, 5, now);
  assert.deepEqual(q, { day: "2026-10-15", used: 5 }); // yesterday's spend doesn't count
  q = charge(q, 10, now);
  assert.equal(usedToday(q, now), 15);
  assert.equal(usedToday(q, new Date("2026-10-16T09:00:00Z")), 0);

  const s = { ...emptyScout(), keywords: ["a", "b", "c", "d"], watchlist: [{ channelId: UC("a"), title: "A", autoClip: false }] };
  const p1 = planRun(s, now);
  assert.ok(typeof p1 !== "string");
  assert.deepEqual(p1.keywords, ["a", "b", "c"]); assert.equal(p1.kwNext, 3);
  const p2 = planRun({ ...s, kwNext: 3 }, now);
  assert.ok(typeof p2 !== "string");
  assert.deepEqual(p2.keywords, ["d", "a", "b"]);
  const tight = planRun({ ...s, quota: { day: "2026-10-15", used: DAILY_UNITS - 150 } }, now); // room for 1 search
  assert.ok(typeof tight !== "string");
  assert.deepEqual(tight.keywords, ["a"]);
  assert.match(planRun({ ...s, watchlist: [], quota: { day: "2026-10-15", used: DAILY_UNITS - 50 } }, now) as string, /budget/);
  assert.match(planRun(emptyScout(), now) as string, /creator or a keyword/);
});

test("scoutDue: once per local day after runAt, catches up a missed day", () => {
  const s = { ...emptyScout(), keywords: ["a"], runAt: 6 };
  const at = (h: number) => new Date(2026, 9, 16, h);
  assert.equal(scoutDue(s, at(5)), false);
  assert.equal(scoutDue(s, at(6)), true);
  assert.equal(scoutDue(s, at(22)), true); // ORBIT was off at 6: runs on start
  assert.equal(scoutDue({ ...s, lastScheduled: "2026-10-16" }, at(22)), false);
  assert.equal(scoutDue({ ...emptyScout(), runAt: 6 }, at(8)), false); // nothing to scout
});

test("skipReason: seen/made, live, too short, too long, too old", () => {
  const o = { now: NOW, maxAgeHours: 48, creatorMaxAgeDays: 7, minMinutes: 15, seen: new Set(["sssssssssss"]), made: new Set(["mmmmmmmmmmm"]) };
  assert.equal(skipReason(cand(), o), "");
  assert.equal(skipReason(cand({ id: "sssssssssss" }), o), "seen");
  assert.equal(skipReason(cand({ id: "mmmmmmmmmmm" }), o), "made");
  assert.equal(skipReason(cand({ live: "live" }), o), "live");
  assert.equal(skipReason(cand({ live: "upcoming", durationSec: 0 }), o), "live");
  assert.equal(skipReason(cand({ durationSec: 14 * 60 }), o), "short");
  assert.equal(skipReason(cand({ durationSec: 6 * 3600 }), o), ""); // stream VODs are the best source
  assert.equal(skipReason(cand({ durationSec: 8 * 3600 + 1 }), o), "long");
  assert.equal(skipReason(cand({ publishedAt: hAgo(49), source: "keyword" }), o), "old");
  assert.equal(skipReason(cand({ publishedAt: hAgo(49) }), o), ""); // watchlist: 7-day window
  assert.equal(skipReason(cand({ publishedAt: hAgo(8 * 24) }), o), "oldCreator");
  assert.equal(skipReason(cand({ publishedAt: "garbage", source: "keyword" }), o), "old");
});

test("videoIdOf and toCandidates", () => {
  assert.equal(videoIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://www.youtube.com/live/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(videoIdOf("https://www.twitch.tv/videos/123"), null);
  const cs = toCandidates([{ id: "dQw4w9WgXcQ", snippet: { title: "T", channelTitle: "C", channelId: UC("a"), publishedAt: hAgo(1), liveBroadcastContent: "none" },
    contentDetails: { duration: "PT1H2M" }, statistics: { viewCount: "12", likeCount: "3" } }, { id: "bad" }, null], "keyword");
  assert.equal(cs.length, 1);
  assert.equal(cs[0].durationSec, 3720); assert.deepEqual(cs[0].stats, { views: 12, likes: 3, comments: 0 }); assert.equal(cs[0].source, "keyword");
});

test("pureScore: faster pace, beating the channel's usual, engagement and length all help", () => {
  const base = pureScore(cand(), NOW);
  assert.ok(base >= 0 && base <= 100);
  assert.ok(pureScore(cand({ stats: { views: 100_000, likes: 5000, comments: 1000 } }), NOW) > base);
  assert.ok(pureScore(cand({ baseline: 100 }), NOW) > pureScore(cand({ baseline: 10_000 }), NOW));
  assert.ok(pureScore(cand({ stats: { views: 10_000, likes: 300, comments: 100 } }), NOW) > pureScore(cand({ stats: { views: 10_000, likes: 50, comments: 10 } }), NOW));
  assert.ok(pureScore(cand({ durationSec: 16 * 60 }), NOW) < base);
  assert.equal(pureScore(cand({ stats: { views: 0, likes: 0, comments: 0 } }), NOW) >= 0, true);
  assert.equal(baselineVph([cand(), cand()], NOW), 0); // too few to judge
  assert.equal(baselineVph([cand({ stats: { views: 10, likes: 0, comments: 0 } }), cand(), cand({ stats: { views: 1e6, likes: 0, comments: 0 } })], NOW), 1000);
});

test("parseRanking: strict JSON, known ids once, 0-100, reason required", () => {
  const ids = new Set(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  const ok = parseRanking('Sure:\n```json\n[{"id":"aaaaaaaaaaa","score":40,"reason":"ok"},{"id":"bbbbbbbbbbb","score":90.4,"reason":"Big\\nrage moments"}]\n```', ids);
  assert.deepEqual(ok, [{ id: "bbbbbbbbbbb", score: 90, reason: "Big rage moments" }, { id: "aaaaaaaaaaa", score: 40, reason: "ok" }]);
  assert.equal(parseRanking("not json", ids), null);
  assert.equal(parseRanking("[]", ids), null);
  assert.equal(parseRanking('[{"id":"zzzzzzzzzzz","score":50,"reason":"x"}]', ids), null); // invented id
  assert.equal(parseRanking('[{"id":"aaaaaaaaaaa","score":50,"reason":"x"},{"id":"aaaaaaaaaaa","score":60,"reason":"y"}]', ids), null);
  assert.equal(parseRanking('[{"id":"aaaaaaaaaaa","score":150,"reason":"x"}]', ids), null);
  assert.equal(parseRanking('[{"id":"aaaaaaaaaaa","score":"50","reason":"x"}]', ids), null);
  assert.equal(parseRanking('[{"id":"aaaaaaaaaaa","score":50,"reason":"  "}]', ids), null);
});

test("buildPicks: Claude's order when valid, else the pure score", () => {
  const a = cand({ id: "aaaaaaaaaaa", stats: { views: 100, likes: 0, comments: 0 } }), b = cand({ id: "bbbbbbbbbbb", stats: { views: 100_000, likes: 0, comments: 0 }, source: "keyword" });
  const fb = buildPicks([a, b], null, NOW);
  assert.deepEqual(fb.map((p) => p.videoId), ["bbbbbbbbbbb", "aaaaaaaaaaa"]);
  assert.match(fb[0].reason, /views\/hour/);
  assert.equal(fb[0].url, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  assert.equal(fb[0].source, "keyword"); assert.equal(fb[0].status, "new");
  const cl = buildPicks([a, b], [{ id: "aaaaaaaaaaa", score: 88, reason: "funny" }], NOW);
  assert.deepEqual(cl.map((p) => [p.videoId, p.score, p.reason]), [["aaaaaaaaaaa", 88, "funny"]]);
});

test("autoPicks: only new watchlist picks of autoClip creators, best first, capped; keyword picks never", () => {
  const pick = (id: string, extra: Partial<ScoutPick>): ScoutPick => ({ videoId: id, url: "", title: id, channel: "", channelId: UC("a"), durationSec: 3600,
    publishedAt: hAgo(1), stats: { views: 1, likes: 0, comments: 0 }, score: 50, reason: "", source: "watchlist", status: "new", ...extra });
  const watch = [{ channelId: UC("a"), title: "A", autoClip: true }, { channelId: UC("b"), title: "B", autoClip: false }];
  const picks = [
    pick("k0000000000", { source: "keyword", score: 99 }), // approved creator, but found by keyword: still never auto
    pick("b0000000000", { channelId: UC("b"), score: 95 }), // creator without auto-clip
    pick("c0000000000", { channelId: UC("c"), score: 94 }), // not on the watchlist
    pick("q0000000000", { status: "queued", score: 93 }),
    pick("a1000000000", { score: 60 }), pick("a2000000000", { score: 80 }),
  ];
  assert.deepEqual(autoPicks(picks, watch, 1).map((p) => p.videoId), ["a2000000000"]);
  assert.deepEqual(autoPicks(picks, watch, 5).map((p) => p.videoId), ["a2000000000", "a1000000000"]);
  assert.deepEqual(autoPicks(picks, watch, 0), []);
  assert.deepEqual(autoPicks(picks, watch, -1), []);
});

test("validSettings creator op: toggles or removes one creator on the current list", () => {
  const cur = { ...DEFAULTS, watchlist: [{ channelId: UC("a"), title: "A", autoClip: false }, { channelId: UC("b"), title: "B", autoClip: false }] };
  const t = validSettings({ creator: { channelId: UC("b"), autoClip: true } }, cur);
  assert.ok(typeof t !== "string");
  assert.deepEqual(t.watchlist.map((w) => w.autoClip), [false, true]);
  const r = validSettings({ creator: { channelId: UC("a"), remove: true } }, cur);
  assert.ok(typeof r !== "string");
  assert.deepEqual(r.watchlist.map((w) => w.title), ["B"]);
  assert.match(validSettings({ creator: { channelId: UC("z"), autoClip: true } }, cur) as string, /isn't on the watchlist/);
  assert.match(validSettings({ creator: { channelId: UC("a") } }, cur) as string, /creator needs/);
});

test("parseScout rebuilds pick urls from the video id", () => {
  const s = parseScout({ v: 1, picks: [{ videoId: "aaaaaaaaaaa", url: "https://evil.example/x", title: "t", score: 5, status: "new", source: "keyword", stats: {} }] });
  assert.ok(typeof s !== "string");
  assert.equal(s.picks[0].url, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
});

test("skipSummary explains an empty list", () => {
  assert.equal(skipSummary(25, 0, { short: 14, old: 9, live: 2, made: 0 }, { minMinutes: 15, maxAgeHours: 48, creatorMaxAgeDays: 7 }),
    "25 found · 0 picks — 14 too short (<15 min), 9 older than 48 h, 2 live/upcoming");
  assert.equal(skipSummary(3, 1, {}, DEFAULTS), "3 found · 1 pick");
});

test("wrong box: links and @handles aren't keywords", () => {
  for (const k of ["https://www.youtube.com/@Jynxzi", "@Jynxzi", "youtube.com/@Jynxzi", "youtu.be/abc", "www.twitch.tv/x"]) assert.equal(looksLikeChannel(k), true, k);
  for (const k of ["Funny jynxzi reaction", "rainbow six siege rage", "youtuber fails", "best youtube rage"]) assert.equal(looksLikeChannel(k), false, k);
  // A stored file is never rejected by the keyword guard (it would be quarantined, wiping the watchlist).
  assert.notEqual(typeof parseScout({ ...emptyScout(), keywords: ["youtuber fails", "@odd"] }), "string");
});

// ---- niche finder ----
import { allKeywords, autoApplyNiche, nicheDue, parseNiches, planResearch } from "../src/lib/clips/scout-pure.ts";

const niche = (extra: Record<string, unknown> = {}) => ({ name: "Rage gaming", why: "Rage Shorts avg 52k views/h, 7 of top 20", score: 81,
  keywords: ["rainbow six rage", "jynxzi stream"], creators: [{ name: "Jynxzi", evidence: "3 clips over 1M views" }], ...extra });

test("parseNiches: tolerant — trims prose, drops bad parts, keeps valid niches, best first", () => {
  const ok = parseNiches("Here:\n" + JSON.stringify({ niches: [niche({ name: "Bee", score: 40 }), niche()] }));
  assert.ok(typeof ok !== "string");
  assert.deepEqual(ok.map((n) => n.name), ["Rage gaming", "Bee"]);
  const one = (n: Record<string, unknown>) => { const r = parseNiches(JSON.stringify({ niches: [niche(n)] })); assert.ok(typeof r !== "string", JSON.stringify(n)); return r[0]; };
  assert.ok(one({ why: "word ".repeat(80) }).why.length <= 240); // long prose is trimmed, not fatal
  assert.equal(one({ score: 130 }).score, 100); assert.equal(one({ score: "80" }).score, 80);
  assert.deepEqual(one({ keywords: ["ok kw", "@Jynxzi", "fine kw", "x"] }).keywords, ["ok kw", "fine kw"]); // bad keywords dropped
  assert.equal(one({ creators: [{ name: "x".repeat(41), evidence: "e" }, { name: "Good", evidence: "e" }] }).creators.length, 1);
  // unusable niches are skipped; the report fails only when none is usable
  const mixed = parseNiches(JSON.stringify({ niches: [niche({ keywords: ["one"] }), niche({ name: "Kept" })] }));
  assert.ok(typeof mixed !== "string"); assert.deepEqual(mixed.map((n) => n.name), ["Kept"]);
  assert.equal(typeof parseNiches(JSON.stringify({ niches: [niche({ keywords: ["one"] })] })), "string");
  assert.equal(typeof parseNiches("not json"), "string");
  assert.equal(typeof parseNiches(JSON.stringify({ niches: [] })), "string");
  const dup = parseNiches(JSON.stringify({ niches: [niche(), niche(), niche({ name: "Cc" }), niche({ name: "Dd" })] }));
  assert.ok(typeof dup !== "string"); assert.equal(dup.length, 3); // duplicates dropped, max 3
});

test("AI keywords: kept apart from the owner's, merged without duplicates, replaced as a whole", () => {
  assert.deepEqual(allKeywords({ keywords: ["Jynxzi Stream", "pod"], aiKeywords: ["jynxzi stream", "r6 rage"] }), ["Jynxzi Stream", "pod", "r6 rage"]);
  const s = { ...emptyScout(), keywords: ["pod"], aiKeywords: ["old ai"] };
  const v = validSettings({ aiKeywords: ["new ai", "rage"] }, s);
  assert.ok(typeof v !== "string");
  assert.deepEqual(v.keywords, ["pod"]); assert.deepEqual(v.aiKeywords, ["new ai", "rage"]);
  const p = planRun({ ...emptyScout(), aiKeywords: ["r6 rage"] }, new Date(NOW)); // AI keywords alone are enough to run
  assert.ok(typeof p !== "string"); assert.deepEqual(p.keywords, ["r6 rage"]);
});

test("nicheAuto applies the top niche but never turns on auto-clip", () => {
  const s = { ...emptyScout(), nicheAuto: true, keywords: ["pod"], aiKeywords: ["old"], watchlist: [{ channelId: UC("a"), title: "A", autoClip: true }, { channelId: UC("b"), title: "B", autoClip: false }],
    niche: { at: hAgo(1), niches: [niche({ keywords: ["k1 rage", "k2 rage"] }), niche({ name: "Other", score: 10 })], creators: [
      { channelId: UC("a"), title: "A", subscribers: 5, niche: "Rage gaming", evidence: "e" }, { channelId: UC("c"), title: "C", subscribers: 5, niche: "Rage gaming", evidence: "e" },
      { channelId: UC("d"), title: "D", subscribers: 5, niche: "Other", evidence: "e" }] } };
  assert.deepEqual(autoApplyNiche(s), ["C"]);
  assert.deepEqual(s.aiKeywords, ["k1 rage", "k2 rage"]); assert.deepEqual(s.keywords, ["pod"]);
  assert.deepEqual(s.watchlist.map((w) => [w.title, w.autoClip]), [["A", true], ["B", false], ["C", false]]); // A untouched, C off, D (not top) skipped
});

test("parseScout: a bad niche block is dropped, the file is kept", () => {
  const good = { at: hAgo(1), niches: [niche()], creators: [{ channelId: UC("a"), title: "A", subscribers: 9, niche: "Rage gaming", evidence: "e" }] };
  const ok = parseScout({ ...emptyScout(), niche: good, nicheRun: { at: hAgo(1), ok: true, units: 400, warnings: [] } });
  assert.ok(typeof ok !== "string"); assert.equal(ok.niche?.niches[0].name, "Rage gaming"); assert.equal(ok.nicheRun?.units, 400);
  for (const bad of [{ ...good, niches: [niche({ keywords: ["one"] })] }, { ...good, creators: [{ channelId: "nope" }] }, "junk", { at: 1 }]) {
    const s = parseScout({ ...emptyScout(), keywords: ["pod"], niche: bad, nicheRun: 5 });
    assert.ok(typeof s !== "string", JSON.stringify(bad));
    assert.equal(s.niche, undefined); assert.equal(s.nicheRun, undefined); assert.deepEqual(s.keywords, ["pod"]);
  }
});

test("planResearch: ≤ ~600 units, fewer searches on a tight budget, weekly / daily retry", () => {
  const now = new Date("2026-10-16T18:00:00Z"), day = quotaDay(now);
  const watch = [{ channelId: UC("a"), title: "A", autoClip: false }, { channelId: UC("b"), title: "B", autoClip: false }, { channelId: UC("c"), title: "C", autoClip: false }];
  const full = planResearch({ ...emptyScout(), watchlist: watch }, now);
  assert.ok(typeof full !== "string");
  assert.deepEqual(full.queries, ["stream highlights", "funny stream moments", "A clips", "B clips"]);
  assert.equal(full.units, 2 + 6 + 4 * 101); assert.ok(full.units <= 600);
  const none = planResearch(emptyScout(), now);
  assert.ok(typeof none !== "string"); assert.equal(none.queries.length, 3);
  const tight = planResearch({ ...emptyScout(), watchlist: watch, quota: { day, used: DAILY_UNITS - 250 } }, now);
  assert.ok(typeof tight !== "string"); assert.equal(tight.queries.length, 2); assert.ok(tight.units <= 250);
  assert.match(planResearch({ ...emptyScout(), quota: { day, used: DAILY_UNITS - 100 } }, now) as string, /budget/);
  assert.equal(nicheDue(emptyScout(), now), true);
  const ran = (h: number, ok: boolean) => ({ ...emptyScout(), nicheRun: { at: new Date(now.getTime() - h * 3_600_000).toISOString(), ok, units: 0, warnings: [] } });
  assert.equal(nicheDue(ran(6 * 24, true), now), false); assert.equal(nicheDue(ran(7 * 24, true), now), true);
  assert.equal(nicheDue(ran(12, false), now), false); assert.equal(nicheDue(ran(25, false), now), true);
});

test("keyword finds from clip/recap channels are skipped; watchlist creators are not", () => {
  const base = { id: "abcdefghijk", title: "Speed reacts", channel: "TheXXRecaps", channelId: "c", publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    durationSec: 3600, live: "none", description: "", stats: { views: 1, likes: 0, comments: 0 } };
  const o = { now: Date.now(), maxAgeHours: 48, creatorMaxAgeDays: 7, minMinutes: 8, seen: new Set<string>(), made: new Set<string>() };
  assert.equal(skipReason({ ...base, source: "keyword" }, o), "reupload");
  assert.equal(skipReason({ ...base, source: "watchlist" }, o), "");
  assert.equal(skipReason({ ...base, channel: "IShowSpeed", source: "keyword" }, o), "");
});
