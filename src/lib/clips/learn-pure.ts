// Learning loop (pure, tested in tests/learn.test.ts): what works on the owner's channel, from published Shorts' stats and his review decisions.
import { isVideoId } from "../yt-analytics-pure.ts";
import { baseEdit } from "./pure.ts";
import type { Clip, ClipJob, VersionEdit } from "./types";

export const LEARN_V = 1;
export const MIN_SAMPLE = 3; // a bucket needs this many clips before it says anything
export const NOTES_MAX = 3000; // room for 5 worked + 5 flopped title/hook pairs before the other taste hints
export const LEARN_EVERY_MS = 6 * 3_600_000;
const H = 3_600_000;

export type Stats = { at: string; views: number; likes: number; comments: number; avgViewPct?: number; avgViewSec?: number; subs?: number };
/** Missing/delayed Analytics metrics stay absent, never zero-filled into a snapshot. */
export function analyticsStats(row: Record<string, string | number>): Pick<Stats, "avgViewPct" | "avgViewSec" | "subs"> {
  const out: Pick<Stats, "avgViewPct" | "avgViewSec" | "subs"> = {};
  for (const [metric, field] of [["averageViewPercentage", "avgViewPct"], ["averageViewDuration", "avgViewSec"], ["subscribersGained", "subs"]] as const) {
    const value = row[metric];
    if (value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) out[field] = Math.round(Number(value) * 10) / 10;
  }
  return out;
}
export type SnapKey = "24h" | "48h" | "72h" | "7d";
export const SNAPS: [SnapKey, number][] = [["24h", 24 * H], ["48h", 48 * H], ["72h", 72 * H], ["7d", 168 * H]];
export const RESULTS_POLL_MS = 15 * 60_000;
export const RESULTS_AGE_MS = 48 * H;
export type Features = { hookStyle: string; hookLen: string; length: string; layout: string; captions: string; creator: string; kind: string };
export type LearnRec = { videoId: string; jobId: string; clipId: string; title: string; hook: string; reason: string; layout: string; captions: string;
  durationSec: number; publishedAt?: string; sourceChannel: string; kind: string; snaps: Partial<Record<SnapKey, Stats>>; latest?: Stats;
  feat?: Record<string, number> }; // feat: the virality features stored on the clip when it was made (score-pure.ts learns from them)
export type LearnState = { v: number; checkedAt?: string; warnings: string[]; clips: Record<string, LearnRec> };

export const emptyLearn = (): LearnState => ({ v: LEARN_V, warnings: [], clips: {} });
/** Normal refresh every 6 h; retry a missing 48 h snapshot every 15 min while its capture window is open. */
export const learnDue = (s: LearnState, now: number) => !s.checkedAt || !(now - Date.parse(s.checkedAt) < LEARN_EVERY_MS)
  || (now - Date.parse(s.checkedAt) >= RESULTS_POLL_MS && Object.values(s.clips).some((r) => needs48h(r, now)));
export const needs48h = (r: LearnRec, now: number) => {
  const age = now - Date.parse(r.publishedAt ?? "");
  return !r.snaps["48h"] && age >= RESULTS_AGE_MS && age < RESULTS_AGE_MS + LEARN_EVERY_MS;
};

const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
const isStats = (x: unknown) => { const s = x as Stats; return !!s && typeof s.at === "string" && isNum(s.views) && isNum(s.likes) && isNum(s.comments)
  && (["avgViewPct", "avgViewSec", "subs"] as const).every((k) => s[k] === undefined || isNum(s[k])); };

/** "" when learn.json is usable, else why not (readState quarantines it). */
export function learnProblem(x: unknown): string {
  const s = x as LearnState;
  if (!s || typeof s !== "object" || s.v !== LEARN_V) return "not a learn state";
  if (!Array.isArray(s.warnings) || !s.clips || typeof s.clips !== "object" || Array.isArray(s.clips)) return "bad shape";
  for (const [id, r] of Object.entries(s.clips)) {
    if (!isVideoId(id) || r?.videoId !== id || typeof r.jobId !== "string" || typeof r.clipId !== "string" || typeof r.title !== "string" || !isNum(r.durationSec)
      || (["hook", "reason", "layout", "captions", "sourceChannel", "kind"] as const).some((k) => typeof r[k] !== "string")) return `bad clip ${id.slice(0, 20)}`;
    if (!r.snaps || typeof r.snaps !== "object" || Object.values(r.snaps).some((v) => !isStats(v)) || (r.latest && !isStats(r.latest))) return `bad stats ${id}`;
    if (r.feat !== undefined && (!r.feat || typeof r.feat !== "object" || !Object.values(r.feat).every(isNum))) return `bad features ${id}`;
  }
  return "";
}

// ---- features ----

const clean = (s: string, max = 40) => s.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Creator from the yt-dlp file name "%(uploader)s - %(title)s [id].ext" (--restrict-filenames turns spaces into _). */
// shortcut: inbox files not downloaded by ORBIT have no creator; read <file>.source.json/uploader if that matters.
export function creatorOf(source: string): string {
  const m = /^(.+?)(?: - |_-_)/.exec(source);
  return m ? clean(m[1].replace(/_/g, " "), 30) : "unknown";
}

export function hookStyle(hook: string): string {
  const h = hook.trim(), letters = h.replace(/[^A-Za-z]/g, "");
  if (!h) return "none";
  if (h.endsWith("?")) return "question";
  if (/\d/.test(h)) return "number";
  if (letters.length >= 4 && letters === letters.toUpperCase()) return "all caps";
  if (h.endsWith("!")) return "exclamation";
  return "statement";
}

const hookLen = (hook: string) => { const n = hook.trim().split(/\s+/).filter(Boolean).length; return n <= 3 ? "1-3" : n <= 6 ? "4-6" : "7+"; };
export const lengthBand = (sec: number) => (sec < 20 ? "<20" : sec < 30 ? "20-30" : sec < 40 ? "30-40" : "40+");

const KINDS: [string, RegExp][] = [
  ["rage", /\b(rage|raging|angry|mad|furious|scream|yell|tilt)/i],
  ["funny", /\b(laugh|funny|hilarious|joke|lol|comedy)/i],
  ["clutch", /\b(clutch|comeback|win|victory|insane play|outplay)/i],
  ["fail", /\b(fail|died|death|dies|lose|lost|choke)/i],
  ["shock", /\b(shock|unbelievable|crazy|insane|wtf|can't believe|plot twist)/i],
  ["story", /\b(story|explain|reveal|confess)/i],
];
/** Coarse moment kind from Claude's reason/title/hook. */
export const kindOf = (text: string) => KINDS.find(([, re]) => re.test(text))?.[0] ?? "other";

export const editOf = (job: ClipJob, clip: Clip): VersionEdit => clip.edit ?? baseEdit(job.options);

export function featuresOf(job: ClipJob, clip: Clip): Features {
  const e = editOf(job, clip);
  return { hookStyle: hookStyle(clip.hook), hookLen: hookLen(clip.hook), length: lengthBand(clip.end - clip.start), layout: e.layout, captions: e.captions,
    creator: creatorOf(job.source), kind: kindOf(`${clip.reason} ${clip.title} ${clip.hook}`) };
}
const recFeatures = (r: LearnRec): Features => ({ hookStyle: hookStyle(r.hook), hookLen: hookLen(r.hook), length: lengthBand(r.durationSec), layout: r.layout,
  captions: r.captions, creator: r.sourceChannel, kind: r.kind });

/** Published clips (with a video id) as records, keeping stats already collected. */
export function syncRecords(jobs: ClipJob[], prev: Record<string, LearnRec>): Record<string, LearnRec> {
  const out: Record<string, LearnRec> = { ...prev }; // a deleted job's clip keeps its record: the video is still on the channel
  for (const job of jobs) for (const c of job.clips) {
    const id = c.publish?.status === "done" || c.publish?.status === "scheduled" ? c.publish.videoId : undefined;
    if (!id || !isVideoId(id)) continue;
    const e = editOf(job, c), old = prev[id];
    out[id] = { videoId: id, jobId: job.id, clipId: c.id, title: clean(c.publish?.title ?? c.title, 100), hook: clean(c.hook, 60), reason: clean(c.reason, 160),
      layout: e.layout, captions: e.captions, durationSec: Math.round((c.end - c.start) * 10) / 10, sourceChannel: creatorOf(job.source),
      kind: kindOf(`${c.reason} ${c.title} ${c.hook}`), publishedAt: old?.publishedAt, snaps: old?.snaps ?? {}, latest: old?.latest };
    const feat = c.virality?.x ?? old?.feat;
    if (feat) out[id].feat = feat as Record<string, number>;
  }
  return out;
}

/** New stats → latest, plus each milestone snapshot the video has reached and doesn't have yet. */
export function applyStats(r: LearnRec, s: Stats, publishedAt: string | undefined, now: number): LearnRec {
  const pub = publishedAt ?? r.publishedAt, age = pub ? now - Date.parse(pub) : NaN;
  const snaps = { ...r.snaps };
  for (const [k, ms] of SNAPS) if (!snaps[k] && age >= ms && age < (k === "48h" ? ms + LEARN_EVERY_MS : 2 * ms)) snaps[k] = s; // never label late lifetime views as 48 h views
  return { ...r, publishedAt: pub, latest: s, snaps };
}

// ---- performance ----

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type ShortResult = { videoId: string; title: string; hook: string; publishedAt?: string; capturedAt: string;
  views48: number; avgViewPct?: number; medianViews: number | null; changePct: number | null; verdict: "worked" | "flopped" | null };

/** Compare only like-aged snapshots from this channel. Three samples and a positive median are needed before judging. */
export function results48(recs: LearnRec[]): ShortResult[] {
  const have = recs.filter((r) => r.snaps["48h"]);
  const mid = median(have.map((r) => r.snaps["48h"]!.views));
  const baseline = have.length >= MIN_SAMPLE && mid > 0 ? mid : null;
  return have.map((r): ShortResult => {
    const s = r.snaps["48h"]!;
    return { videoId: r.videoId, title: r.title, hook: r.hook, publishedAt: r.publishedAt, capturedAt: s.at, views48: s.views, avgViewPct: s.avgViewPct,
      medianViews: baseline, changePct: baseline === null ? null : Math.round((s.views / baseline - 1) * 100),
      verdict: baseline === null ? null : s.views >= baseline ? "worked" : "flopped" };
  }).sort((a, b) => (b.publishedAt ?? b.capturedAt).localeCompare(a.publishedAt ?? a.capturedAt) || a.videoId.localeCompare(b.videoId));
}

export type Scored = { rec: LearnRec; views72: number; score: number };

/** 72 h views ÷ the channel's median, times a retention weight (avg % viewed ÷ its median, sqrt-damped) when Analytics gave one. */
export function scoreClips(recs: LearnRec[]): Scored[] {
  const have = recs.filter((r) => r.snaps["72h"]);
  const mv = median(have.map((r) => r.snaps["72h"]!.views)) || 1;
  const pcts = have.map((r) => r.snaps["72h"]!.avgViewPct ?? r.latest?.avgViewPct).filter((p): p is number => typeof p === "number" && p > 0);
  const mp = median(pcts);
  return have.map((r) => {
    const v = r.snaps["72h"]!.views, p = r.snaps["72h"]!.avgViewPct ?? r.latest?.avgViewPct;
    const w = mp && p ? Math.sqrt(Math.min(3, Math.max(1 / 3, p / mp))) : 1;
    return { rec: r, views72: v, score: Math.round((v / mv) * w * 100) / 100 };
  }).sort((a, b) => b.score - a.score);
}

export type Bucket = { dim: keyof Features; label: string; n: number; value: number; text?: string }; // value: median score ratio, or approval rate
const DIMS: (keyof Features)[] = ["hookStyle", "hookLen", "length", "layout", "captions", "creator", "kind"];

function groups<T>(items: T[], f: (x: T) => Features) {
  const m = new Map<string, { dim: keyof Features; label: string; xs: T[] }>();
  for (const x of items) { const ft = f(x); for (const d of DIMS) { const k = `${d}\0${ft[d]}`; (m.get(k) ?? m.set(k, { dim: d, label: ft[d], xs: [] }).get(k)!).xs.push(x); } }
  return [...m.values()].filter((g) => g.xs.length >= MIN_SAMPLE && g.label !== "unknown" && g.label !== "other");
}

/** Buckets whose median score is ≥ 1.25× (over) or ≤ 0.8× (under) the overall median; only buckets with ≥ MIN_SAMPLE clips. */
export function perfPatterns(scored: Scored[]): { over: Bucket[]; under: Bucket[] } {
  const all = median(scored.map((s) => s.score)) || 1;
  const bs = groups(scored, (s) => recFeatures(s.rec)).map((g) => ({ dim: g.dim, label: g.label, n: g.xs.length, value: Math.round((median(g.xs.map((s) => s.score)) / all) * 100) / 100 }))
    .filter((b) => b.n < scored.length); // a bucket holding every clip says nothing
  return { over: bs.filter((b) => b.value >= 1.25).sort((a, b) => b.value - a.value), under: bs.filter((b) => b.value <= 0.8).sort((a, b) => a.value - b.value) };
}

// ---- review decisions ----

// rejected: the owner's most recent rejected clips (title + reason), so clip picking can avoid similar moments.
export type Decisions = { decided: number; rejects: { reason: string; n: number }[]; liked: Bucket[]; disliked: Bucket[]; versions: { change: string; n: number }[];
  rejected?: { title: string; reason?: string }[] };
export const REJECTED_SHOWN = 8;

/** The owner's latest approve/reject per clip (publishing counts as approval), reject reasons, and what his re-renders change. */
export function decisions(jobs: ClipJob[]): Decisions {
  const items: { f: Features; ok: boolean; reason?: string }[] = [], versions = new Map<string, number>();
  const rejected: { title: string; reason?: string; at: string }[] = [];
  for (const job of jobs) {
    const last = new Map<string, { ok: boolean; reason?: string; at: string }>();
    for (const e of job.feedback ?? []) if (e.action !== "version") last.set(e.clipId, { ok: e.action !== "rejected", reason: e.reason, at: e.at });
    for (const c of job.clips) {
      const d = last.get(c.id);
      if (d) items.push({ f: featuresOf(job, c), ok: d.ok, reason: d.reason });
      if (d && !d.ok) rejected.push({ title: clean(c.title, 60), ...(d.reason ? { reason: d.reason } : {}), at: d.at });
      const root = c.variantOf && job.clips.find((x) => x.id === c.variantOf);
      if (root && c.edit) {
        const a = editOf(job, root);
        for (const k of ["layout", "captions", "jumpCuts", "zooms"] as const) if (c.edit[k] !== a[k]) { const ch = `${k} → ${c.edit[k]}`; versions.set(ch, (versions.get(ch) ?? 0) + 1); }
      }
    }
  }
  const reasons = new Map<string, number>();
  for (const i of items) if (!i.ok && i.reason) reasons.set(i.reason, (reasons.get(i.reason) ?? 0) + 1);
  const rate = items.length ? items.filter((i) => i.ok).length / items.length : 0;
  const bs = groups(items, (i) => i.f).map((g) => ({ dim: g.dim, label: g.label, n: g.xs.length, value: Math.round((g.xs.filter((i) => i.ok).length / g.xs.length) * 100) / 100 }))
    .filter((b) => b.n < items.length);
  const top = (m: Map<string, number>) => [...m].filter(([, n]) => n >= MIN_SAMPLE).sort((a, b) => b[1] - a[1]);
  return { decided: items.length, rejects: top(reasons).map(([reason, n]) => ({ reason, n })),
    liked: bs.filter((b) => b.value - rate >= 0.2).sort((a, b) => b.value - a.value), disliked: bs.filter((b) => rate - b.value >= 0.2).sort((a, b) => a.value - b.value),
    versions: top(versions).map(([change, n]) => ({ change, n })),
    rejected: rejected.sort((a, b) => b.at.localeCompare(a.at)).slice(0, REJECTED_SHOWN).map(({ title, reason }) => ({ title, ...(reason ? { reason } : {}) })) };
}

// ---- summary ----

export type Insights = { checkedAt?: string; warnings: string[]; published: number; scored: number;
  lastShorts?: ShortResult[]; worked?: ShortResult[]; flopped?: ShortResult[];
  top: { videoId: string; title: string; views72: number; score: number; avgViewPct?: number }[]; over: Bucket[]; under: Bucket[];
  winners?: Judged[]; flops?: Judged[]; why?: { winners: string; flops: string }; judged?: number; editHints?: string[] } & Decisions;

export function insights(s: LearnState, jobs: ClipJob[]): Insights {
  const recs = Object.values(s.clips), scored = scoreClips(recs);
  const results = results48(recs);
  const p = scored.length >= MIN_SAMPLE ? perfPatterns(scored) : { over: [], under: [] };
  const js = judgeShorts(recs), d = decisions(jobs), named = (bs: Bucket[]) => bs.map((b) => ({ ...b, text: phrase(b) })); // text: the client can't import this module (node:path via pure.ts)
  return { checkedAt: s.checkedAt, warnings: s.warnings, published: recs.length, scored: scored.length, ...d,
    lastShorts: results.slice(0, 10), worked: results.filter((r) => r.verdict === "worked").slice(0, 5), flopped: results.filter((r) => r.verdict === "flopped").slice(0, 5),
    over: named(p.over), under: named(p.under), liked: named(d.liked), disliked: named(d.disliked),
    judged: js.length, winners: js.filter((j) => j.verdict === "winner").slice(0, 3), flops: js.filter((j) => j.verdict === "flop").reverse().slice(0, 3),
    why: { winners: sharedPattern(js, "winner"), flops: sharedPattern(js, "flop") }, editHints: editHints(js),
    top: scored.slice(0, 3).map((x) => ({ videoId: x.rec.videoId, title: x.rec.title, views72: x.views72, score: x.score, avgViewPct: x.rec.snaps["72h"]?.avgViewPct ?? x.rec.latest?.avgViewPct })) };
}

/** A bucket as words for a prompt or the UI. */
export function phrase(b: Pick<Bucket, "dim" | "label">): string {
  switch (b.dim) {
    case "hookStyle": return b.label === "none" ? "no hook text" : `hook as ${b.label === "all caps" ? "ALL CAPS" : `a ${b.label}`}`;
    case "hookLen": return `${b.label}-word hooks`;
    case "length": return `${b.label.replace("-", "–")} s clips`;
    case "layout": return `${b.label} layout`;
    case "captions": return b.label === "none" ? "no captions" : `${b.label} captions`;
    case "creator": return `clips from ${b.label}`;
    case "kind": return `${b.label} moments`;
  }
}

const ADVICE: Record<string, string> = {
  "no context": "keep the setup before the punchline", "bad cut": "start on the hook and end right on the payoff", boring: "only high-energy moments with a clear payoff",
  "too long": "keep clips tight",
};

/** Short plain-text brief for Claude's clip-picking prompts; "" when nothing is known yet. Never longer than NOTES_MAX. */
export function formatTaste(i: Insights): string {
  const list = (bs: Bucket[]) => bs.slice(0, 4).map(phrase).join(", ");
  const lines: string[] = [];
  // Keep the stored title/hook limits; all 5 + 5 examples fit ahead of the other optional taste hints.
  const example = (s: string, max: number) => clean(s, max).replace(/["\\]/g, "'");
  for (const [label, rows] of [["Worked", i.worked], ["Flopped", i.flopped]] as const) {
    if (rows?.length) lines.push(`${label} at 48h vs channel median (latest 5, quoted title / hook data): ${rows.slice(0, 5)
      .map((r) => JSON.stringify([example(r.title, 100), example(r.hook, 60)])).join("; ")}.`);
  }
  if (i.rejects.length) {
    const tips = [...new Set(i.rejects.map((r) => ADVICE[r.reason]).filter(Boolean))];
    lines.push(`Owner rejects: ${i.rejects.slice(0, 4).map((r) => `${r.reason} (${r.n})`).join(", ")}${tips.length ? ` → ${tips.join("; ")}` : ""}.`);
  }
  // Titles are clip data the model wrote earlier, quoted as examples; never instructions.
  if (i.rejected?.length) lines.push(`Moments he rejected recently (avoid similar ones; quoted data): ${i.rejected.map((r) => `"${r.title.replace(/["\n]/g, "'")}"${r.reason ? ` (${r.reason})` : ""}`).join("; ")}.`);
  if (i.editHints?.length) lines.push(`Editing hints from his channel stats: ${i.editHints.join("; ")}.`);
  if (i.liked.length) lines.push(`Owner approves more often: ${list(i.liked)}.`);
  if (i.disliked.length) lines.push(`Owner approves less often: ${list(i.disliked)}.`);
  if (i.over.length) lines.push(`Best performers on his channel: ${list(i.over)}.`);
  if (i.under.length) lines.push(`Under-performing on his channel: ${list(i.under)}.`);
  let out = "";
  for (const l of lines) { const next = out ? `${out}\n${l}` : l; if (next.length > NOTES_MAX) break; out = next; }
  return out || (lines[0] ?? "").slice(0, NOTES_MAX);
}

// ---- winners vs flops ----
// Every Short with a 24 h or 72 h snapshot: views ÷ the channel's median at that same age, × an engagement weight ((likes + 2×comments) ÷ views
// vs its median, sqrt-damped). ≥ WIN× = winner, ≤ FLOP× = flop. Needs MIN_SAMPLE Shorts, else the median means nothing.

export const WIN = 1.5, FLOP = 0.6, EDIT_MIN = 5;
export type Verdict = "winner" | "average" | "flop";
type JDim = "creator" | "length" | "hookStyle" | "title" | "hour";
export type Judged = { videoId: string; title: string; verdict: Verdict; perf: number; views: number; snap: SnapKey; likeRate: number; commentRate: number; f: Record<JDim, string> };

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function judgeShorts(recs: LearnRec[]): Judged[] {
  const rows = recs.flatMap((r) => { const snap: SnapKey | undefined = r.snaps["72h"] ? "72h" : r.snaps["24h"] ? "24h" : undefined; return snap ? [{ r, snap, s: r.snaps[snap]! }] : []; });
  if (rows.length < MIN_SAMPLE) return [];
  const mv = { "24h": median(recs.flatMap((r) => (r.snaps["24h"] ? [r.snaps["24h"].views] : []))) || 1, "72h": median(recs.flatMap((r) => (r.snaps["72h"] ? [r.snaps["72h"].views] : []))) || 1 };
  const eng = (s: Stats) => (s.views ? (s.likes + 2 * s.comments) / s.views : 0);
  const me = median(rows.map((x) => eng(x.s)).filter((e) => e > 0));
  return rows.map(({ r, snap, s }) => {
    const w = me && s.views ? Math.sqrt(clamp(eng(s) / me, 1 / 3, 3)) : 1;
    const perf = r2((s.views / mv[snap as "24h" | "72h"]) * w), pub = r.publishedAt ? new Date(r.publishedAt) : null;
    return { videoId: r.videoId, title: r.title, perf, views: s.views, snap, likeRate: s.views ? s.likes / s.views : 0, commentRate: s.views ? s.comments / s.views : 0,
      verdict: perf >= WIN ? "winner" : perf <= FLOP ? "flop" : "average",
      f: { creator: r.sourceChannel, length: lengthBand(r.durationSec), hookStyle: hookStyle(r.hook), title: hookStyle(r.title),
        hour: pub && Number.isFinite(pub.getTime()) ? `${String(pub.getUTCHours()).padStart(2, "0")}:00 UTC` : "unknown" } } satisfies Judged;
  }).sort((a, b) => b.perf - a.perf);
}

const jPhrase = (d: JDim, l: string) => d === "title" ? `titles as ${l === "all caps" ? "ALL CAPS" : `a ${l}`}` : d === "hour" ? `posted at ${l}`
  : phrase({ dim: d, label: l });
const JDIMS: JDim[] = ["creator", "length", "hookStyle", "title", "hour"];

/** One line on what the winners (or flops) share: per feature, a label held by ≥ 2 and ≥ half of them that is ≥ 15 points more common than overall. "" if none. */
export function sharedPattern(js: Judged[], v: Verdict): string {
  const xs = js.filter((j) => j.verdict === v);
  if (xs.length < 2) return "";
  const out: string[] = [];
  for (const d of JDIMS) {
    const c = new Map<string, number>();
    for (const x of xs) if (x.f[d] !== "unknown") c.set(x.f[d], (c.get(x.f[d]) ?? 0) + 1);
    const [label, n] = [...c].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const share = n / xs.length, overall = js.filter((j) => j.f[d] === label).length / js.length;
    if (n >= 2 && share >= 0.5 && share - overall >= 0.15) out.push(`${jPhrase(d, label)} (${n} of ${xs.length})`);
  }
  return out.length ? `Mostly ${out.join(", ")}` : "";
}

/** Concrete editing hints (clip length, hook style), only from buckets of ≥ EDIT_MIN Shorts clearly above/below the usual. */
export function editHints(js: Judged[]): string[] {
  if (js.length < EDIT_MIN) return [];
  const all = median(js.map((j) => j.perf)) || 1, out: string[] = [];
  for (const d of ["length", "hookStyle"] as const) {
    const m = new Map<string, number[]>();
    for (const j of js) (m.get(j.f[d]) ?? m.set(j.f[d], []).get(j.f[d])!).push(j.perf);
    const bs = [...m].filter(([, ps]) => ps.length >= EDIT_MIN && ps.length < js.length).map(([l, ps]) => ({ l, n: ps.length, x: r2(median(ps) / all) })).sort((a, b) => b.x - a.x);
    const best = bs[0], worst = bs.at(-1);
    const what = (l: string) => (d === "length" ? `${l.replace("-", "–")} s clips` : jPhrase(d, l));
    if (best && best.x >= 1.25) out.push(`${what(best.l)} work best (${best.x}× usual, ${best.n} Shorts)`);
    if (worst && worst !== best && worst.x <= 0.8) out.push(`${what(worst.l)} under-perform (${worst.x}× usual, ${worst.n} Shorts)`);
  }
  return out;
}
