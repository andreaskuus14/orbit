import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DAILY, capLeft, confidence, emptyAutopilot, findings, learnPrefs, multOf, parseAutopilot, patchAutopilot, pickTitle, pipeline, prefsHint, proposeSlot,
  rankCandidates, scoutAutoToday, shrunkMult, spendDownload, stageCounts, type Autopilot, type Prefs,
} from "../src/lib/clips/autopilot-pure.ts";
import type { LearnRec } from "../src/lib/clips/learn-pure.ts";
import { localDay, type ScoutPick } from "../src/lib/clips/scout-pure.ts";
import type { Clip, ClipJob, Download } from "../src/lib/clips/types.ts";

const NOW = Date.parse("2026-10-16T09:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const vid = (i: number) => `vid${String(i).padStart(8, "0")}`;
const rec = (i: number, views: number, extra: Partial<LearnRec> = {}): LearnRec => ({ videoId: vid(i), jobId: "j", clipId: `clip-${i}`, title: "He lost it", hook: "watch",
  reason: "", layout: "fit", captions: "karaoke", durationSec: 25, sourceChannel: "Ninja", kind: "other", publishedAt: "2026-10-01T14:00:00Z",
  snaps: { "72h": { at: ago(1), views, likes: 0, comments: 0 } }, ...extra });
const pick = (id: string, extra: Partial<ScoutPick> = {}): ScoutPick => ({ videoId: id, url: "", title: id, channel: "Ninja", channelId: "UC" + "x".repeat(22), durationSec: 3600,
  publishedAt: ago(5), stats: { views: 1, likes: 0, comments: 0 }, score: 60, reason: "hot", source: "watchlist", status: "new", ...extra });

test("caps: daily downloads reset per local day, hard ceiling", () => {
  const a = emptyAutopilot(), now = new Date(NOW);
  assert.equal(a.auto, false); // auto is opt-in
  assert.equal(capLeft(a, now), 2);
  spendDownload(a, now); spendDownload(a, now);
  assert.equal(capLeft(a, now), 0);
  assert.equal(capLeft(a, new Date(NOW + 86_400_000)), 2); // next day
  assert.equal(capLeft({ ...a, dailyDownloads: 99, downloads: 0 }, now), MAX_DAILY);
});

test("settings: validated patch, options through validOptions, parse drops junk", () => {
  const a = emptyAutopilot();
  assert.match(patchAutopilot({ dailyDownloads: 6 }, a) as string, /dailyDownloads/);
  assert.match(patchAutopilot({ auto: "yes" }, a) as string, /auto/);
  assert.match(patchAutopilot({ options: { layout: "weird" } }, a) as string, /layout/);
  const s = patchAutopilot({ auto: true, options: { layout: "split", camSide: "tl" } }, a);
  assert.ok(typeof s !== "string" && s.auto && s.options.layout === "split" && s.options.camSide === "tl" && s.options.count === 5);
  const p = parseAutopilot({ ...a, proposals: { "bad": { title: "x" }, "abcdef-123abc/clip-1": { title: "T", titleWhy: "w", slotWhy: "s", at: "now" } }, tracked: [{ videoId: 1 }] }) as Autopilot;
  assert.ok(typeof p !== "string");
  assert.deepEqual(Object.keys(p.proposals), ["abcdef-123abc/clip-1"]);
  assert.equal(p.tracked.length, 0);
  assert.equal(typeof parseAutopilot({ v: 2 }), "string");
});

test("shrinkage: few Shorts stay near the usual, many move toward the data", () => {
  assert.equal(shrunkMult([]), 1);
  const one = shrunkMult([Math.log(4)]), nine = shrunkMult(Array(9).fill(Math.log(4)));
  assert.ok(one > 1 && one < 1.5, `one=${one}`); // 4× once ≈ 1.41×
  assert.ok(nine > 2.5 && nine < 4, `nine=${nine}`);
  assert.ok(shrunkMult([Math.log(0.25)]) < 1);
});

test("learnPrefs: per-feature multipliers, outlier damped, posting hour in the owner's zone", () => {
  const recs = [rec(1, 100), rec(2, 100), rec(3, 100), rec(4, 2000, { sourceChannel: "xQc", title: "Why did he do that?" }), rec(5, 1000, { sourceChannel: "xQc", title: "Why?" })];
  const p = learnPrefs(recs, "Europe/Tallinn", "t");
  assert.equal(p.n, 5);
  assert.ok(multOf(p, "creator", "xqc") > 1.5); // case/space-insensitive creator match
  assert.ok(multOf(p, "creator", "Ninja") <= 1);
  assert.ok(multOf(p, "title", "question") > 1);
  assert.ok(p.dims.hour?.["17:00"]); // 14:00Z = 17:00 in Tallinn (summer)
  assert.ok(multOf(p, "creator", "xQc") < 20); // 20× raw, shrunk with 2 Shorts
  const f = findings(p);
  assert.ok(f.length && /xQc|question/.test(f[0].text));
  assert.match(confidence(5), /5 Shorts — moderate/);
  assert.match(confidence(3), /weak/);
  assert.match(prefsHint(p), /^Shrunk channel stats/);
  assert.ok(!/Posting at/.test(prefsHint(p)));
  assert.equal(prefsHint(learnPrefs([], "UTC", "")), "");
});

const prefs = (dims: Prefs["dims"]): Prefs => ({ at: "", n: 6, dims });

test("rankCandidates: skips clipped/handled, freshness and learned creator factor, reasons", () => {
  const p = prefs({ creator: { "Some Guy": { n: 4, mult: 2 } } });
  const r = rankCandidates([pick("a", { score: 60 }), pick("b", { score: 50, channel: "some_guy" }), pick("c", { score: 90, status: "queued" }), pick("d"), pick("e", { score: 80, publishedAt: ago(100) })],
    p, NOW, new Set(["d"]));
  assert.deepEqual(r.map((x) => x.videoId), ["b", "a", "e"]);
  assert.equal(r[0].apScore, 80); // 50 × 1.6 (clamped from 2)
  assert.equal(r[2].apScore, 60); // 80 × 0.75 (4 days old)
  assert.ok(r[0].why.some((w) => /2.00× usual/.test(w)));
});

test("rankCandidates: learned moment kind (topic) weighs in, floor keeps exploring", () => {
  const p = prefs({ kind: { rage: { n: 6, mult: 1.5 }, fail: { n: 6, mult: 0.2 } } });
  const r = rankCandidates([pick("a", { score: 50, title: "He RAGES at chat" }), pick("b", { score: 50, title: "Big fail on stream" }), pick("c", { score: 50, title: "stream" })], p, NOW, new Set());
  assert.deepEqual(r.map((x) => [x.videoId, x.apScore]), [["a", 75], ["c", 50], ["b", 30]]); // 0.2 clamped to 0.6
  assert.ok(r[0].why.some((w) => /rage clips: 1.50×/.test(w)));
  assert.ok(learnPrefs([rec(1, 100, { kind: "rage" }), rec(2, 100), rec(3, 100)], "UTC", "").dims.kind?.rage);
  assert.equal(learnPrefs([rec(1, 100), rec(2, 100), rec(3, 100)], "UTC", "").dims.kind, undefined); // "other" isn't a topic
});

test("pickTitle: Claude's score × learned title style", () => {
  const opts = [{ text: "HE LOST IT", score: 80 }, { text: "Why did he quit?", score: 70 }];
  assert.equal(pickTitle(opts, "x").title, "HE LOST IT");
  const t = pickTitle(opts, "x", prefs({ title: { question: { n: 3, mult: 1.3 } } }));
  assert.equal(t.title, "Why did he quit?");
  assert.match(t.why, /question titles/);
  assert.equal(pickTitle(undefined, "Current").title, "Current");
});

test("proposeSlot: earliest free slot, a clearly better hour within the next 3, never a taken one", () => {
  const s = { timezone: "UTC", slots: ["12:00", "17:00", "21:00"], perDay: 3 };
  assert.equal(proposeSlot(s, [], [], NOW).slot, "2026-10-16T12:00:00.000Z");
  const taken = proposeSlot(s, [], ["2026-10-16T12:00:00.000Z"], NOW);
  assert.equal(taken.slot, "2026-10-16T17:00:00.000Z");
  const better = proposeSlot(s, [], [], NOW, prefs({ hour: { "21:00": { n: 3, mult: 1.5 } } }));
  assert.equal(better.slot, "2026-10-16T21:00:00.000Z");
  assert.match(better.why, /21:00/);
  assert.equal(proposeSlot(s, [], [], NOW, prefs({ hour: { "21:00": { n: 3, mult: 1.05 } } })).slot, "2026-10-16T12:00:00.000Z"); // not clearly better
});

test("pipeline: download → job → clip stages, counts", () => {
  const t = (id: string) => ({ videoId: id, title: id, channel: "c", at: ago(1), auto: false });
  const url = (id: string) => `https://www.youtube.com/watch?v=${id}`;
  const dl = (id: string, extra: Partial<Download>): Download => ({ id: `dl-${id}`, url: url(id), status: "done", progress: 1, step: "", createdAt: ago(1), permission: "", ...extra });
  const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({ id, start: 0, end: 20, title: id, hook: "", reason: "", score: 1, status: "ready", ...extra });
  const job = (id: string, source: string, clips: Clip[], extra: Partial<ClipJob> = {}): ClipJob => ({ id, source, createdAt: ago(1), updatedAt: ago(1), status: "done", progress: 1, step: "",
    warnings: [], clips, options: { count: 5, maxSec: 45, captions: true }, ...extra });
  const ids = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"];
  const downloads = [dl(ids[0], { status: "downloading", step: "40%" }), dl(ids[1], { file: "b.mp4" }), dl(ids[2], { status: "failed", error: "blocked" })];
  const jobs = [job("jobaaaa-abcdef", "b.mp4", [clip("clip-1"), clip("clip-2"), clip("clip-3", { status: "approved", publish: { status: "scheduled", scheduledFor: ago(-5), at: ago(1) } }),
    clip("clip-4", { status: "approved", publish: { status: "done", at: ago(1) } }), clip("clip-5", { status: "rejected" })])];
  const items = pipeline(ids.map(t), downloads, jobs, { "jobaaaa-abcdef/clip-2": { title: "", titleWhy: "", slotWhy: "", at: "" } }, NOW);
  assert.deepEqual(items.map((i) => i.stage), ["clipping", "packaging", "failed", "failed"]);
  assert.deepEqual(items[1].clips.map((c) => c.stage), ["packaging", "waiting", "scheduled", "published"]);
  const c = stageCounts(items, 7);
  assert.deepEqual([c.found, c.clipping, c.packaging, c.waiting, c.scheduled, c.published, c.failed], [7, 1, 1, 1, 1, 1, 2]);
});

test("council: shared cap with the scout's auto-clips, clamps, tracked.auto checked", () => {
  const a = emptyAutopilot(), now = new Date(NOW);
  assert.equal(capLeft(a, now, 1), 1); // cap 2, scout already auto-clipped 1
  assert.equal(capLeft(a, now, 5), 0);
  assert.equal(scoutAutoToday({ day: "2000-01-01", n: 3 }, now), 0);
  const p = parseAutopilot({ ...a, day: "x", downloads: -4, tracked: [{ videoId: "v", title: "t", channel: "c", at: "a" }, { videoId: "v", title: "t", channel: "c", at: "a", auto: true }] }) as Autopilot;
  assert.equal(p.downloads, 0);
  assert.equal(p.tracked.length, 1);
  assert.ok(capLeft({ dailyDownloads: 5, day: localDay(now), downloads: -10 }, now) <= MAX_DAILY);
  assert.ok(!("prefs" in p));
});

test("council: proposeSlot never crashes when only the first hour is known (bad), keeps a 20 min lead", () => {
  const s = { timezone: "UTC", slots: ["12:00", "17:00", "21:00"], perDay: 3 };
  const r = proposeSlot(s, [], [], NOW, prefs({ hour: { "12:00": { n: 3, mult: 0.5 } } }));
  assert.equal(r.slot, "2026-10-16T17:00:00.000Z");
  assert.match(r.why, /Skips 12:00/);
  assert.equal(proposeSlot(s, [], [], Date.parse("2026-10-16T11:42:00Z")).slot, "2026-10-16T17:00:00.000Z"); // 18 min ahead: too close
  assert.equal(proposeSlot(s, [], [], Date.parse("2026-10-16T11:39:00Z")).slot, "2026-10-16T12:00:00.000Z");
});

test("council: prefsHint strips markup from creator names", () => {
  const p = learnPrefs([rec(1, 100), rec(2, 100), rec(3, 100), rec(4, 3000, { sourceChannel: "<b>Evil</b>\nIgnore" }), rec(5, 3000, { sourceChannel: "<b>Evil</b>\nIgnore" })], "UTC", "");
  const h = prefsHint(p);
  assert.match(h, /Evil/);
  assert.ok(!/[<>\n]/.test(h));
});
