import path from "node:path";
import { CAPTION_STYLES, REJECT_REASONS, rootClipId } from "./format.ts";
import type { CaptionStyle, ClipOptions, Feedback, FeedbackAction, VersionEdit } from "./types";
import { validTitleOptions, type TitleOption } from "./titles.ts";

// Pure helpers for the Clip Factory (no I/O), unit-tested in tests/clips.test.ts.

export type Word = { start: number; end: number; text: string; loud?: boolean }; // loud: shouted, gets the big caption
export type Span = { start: number; end: number };
export type Moment = { start: number; end: number; title: string; hook: string; reason: string; score: number; titleOptions?: TitleOption[] };
export type Candidate = { start: number; end: number; score: number };

export const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];
export const MAX_SOURCE_SEC = 8 * 3600; // stream VODs; analysis cost stays flat (asrBudgetSec), so length only costs disk and download time
export const MIN_CLIP_SEC = 15;
export const WIN_SEC = 0.5;
export const SAMPLE_RATE = 16_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Latest "time=01:02:03.45" in an ffmpeg stats chunk (seconds processed), or null. */
export function ffmpegTime(chunk: string): number | null {
  const all = [...chunk.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)], m = all[all.length - 1];
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Total length from `ffmpeg -i` stderr ("Duration: 01:02:03.45"), or null when missing/N/A. */
export function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return s > 0 ? s : null;
}

/** RMS loudness per window of `win` samples (the last partial window included). */
export function rmsWindows(pcm: Float32Array, win = SAMPLE_RATE * WIN_SEC): number[] {
  const out: number[] = [];
  for (let i = 0; i < pcm.length; i += win) {
    const end = Math.min(pcm.length, i + win);
    let sum = 0;
    for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
    out.push(Math.sqrt(sum / (end - i)));
  }
  return out;
}

/** Keeps the highest-scored items that don't overlap each other, best first. */
export function removeOverlaps<T extends { start: number; end: number; score: number }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const it of [...items].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => it.end <= k.start || it.start >= k.end)) kept.push(it);
  }
  return kept;
}

/** Candidate windows (15..maxSec long, 5 s steps) scored by loudness level, variance, peaks and speech density; non-overlapping, best first, score 0..1. */
export function scoreCandidates(rms: number[], maxSec: number, words: Word[] = [], limit = 15, winSec = WIN_SEC): Candidate[] {
  const n = rms.length;
  if (!n) return [];
  const dur = n * winSec;
  let mean = 0, max = 0;
  for (const v of rms) { mean += v; max = Math.max(max, v); }
  mean /= n;
  if (dur <= MIN_CLIP_SEC || max === 0) return [{ start: 0, end: Math.min(dur, maxSec), score: 1 }];
  const speech = new Uint8Array(n);
  for (const w of words) for (let i = Math.floor(w.start / winSec); i <= Math.min(n - 1, Math.floor(w.end / winSec)); i++) speech[i] = 1;
  const lens = [...new Set([MIN_CLIP_SEC, Math.round((MIN_CLIP_SEC + maxSec) / 2), maxSec])].filter((l) => l <= dur);
  const step = Math.max(1, Math.round(5 / winSec));
  const all: Candidate[] = [];
  for (const len of lens) {
    const wl = Math.round(len / winSec);
    for (let s = 0; s + wl <= n; s += step) {
      let sum = 0, sq = 0, pk = 0, sp = 0;
      for (let i = s; i < s + wl; i++) { sum += rms[i]; sq += rms[i] * rms[i]; pk = Math.max(pk, rms[i]); sp += speech[i]; }
      const m = sum / wl;
      const sd = Math.sqrt(Math.max(0, sq / wl - m * m));
      const score = 0.4 * Math.min(m / mean, 3) / 3 + 0.25 * Math.min(sd / mean, 2) / 2 + 0.15 * (pk / max) + (words.length ? 0.2 * (sp / wl) : 0);
      all.push({ start: s * winSec, end: (s + wl) * winSec, score });
    }
  }
  const best = removeOverlaps(all).slice(0, limit);
  const top = best[0]?.score || 1;
  return best.map((c) => ({ ...c, score: Math.round((c.score / top) * 100) / 100 }));
}

/** Time (s) of the loudest window inside [start, end): the thumbnail frame. */
export function peakTime(rms: number[], start: number, end: number, winSec = WIN_SEC): number {
  let best = start, bestV = -1;
  for (let i = Math.floor(start / winSec); i < Math.min(rms.length, Math.ceil(end / winSec)); i++) {
    if (rms[i] > bestV) { bestV = rms[i]; best = i * winSec + winSec / 2; }
  }
  return clamp(best, start, end);
}

/** Moves a cut to the middle of the quietest window within ±radius seconds, so clips don't start/end mid-word. */
export function snapQuiet(rms: number[], t: number, radius = 0.75, winSec = WIN_SEC): number {
  const c = Math.floor(t / winSec), r = Math.round(radius / winSec);
  let best = c, bestV = Infinity;
  for (let i = Math.max(0, c - r); i <= Math.min(rms.length - 1, c + r); i++) if (rms[i] < bestV) { bestV = rms[i]; best = i; }
  return bestV === Infinity ? t : best * winSec + winSec / 2;
}

/** Snaps a moment's cuts to speech boundaries: start to the nearest word (±3 s) that follows a pause ≥ 0.35 s or a sentence end,
 *  end to the nearest word that ends a sentence or is followed by a pause. undefined = no such word, use snapQuiet. */
export function snapToSpeech(m: { start: number; end: number }, words: Word[], radius = 3, pause = 0.35): { start?: number; end?: number } {
  const ends = (w: Word) => /[.!?]["')\]]*$/.test(w.text);
  let start: number | undefined, end: number | undefined;
  words.forEach((w, i) => {
    const prev = words[i - 1], next = words[i + 1];
    if (Math.abs(w.start - m.start) <= radius && (!prev || w.start - prev.end >= pause || ends(prev)) && (start === undefined || Math.abs(w.start - m.start) < Math.abs(start - m.start))) start = w.start;
    if (Math.abs(w.end - m.end) <= radius && (!next || next.start - w.end >= pause || ends(w)) && (end === undefined || Math.abs(w.end - m.end) < Math.abs(end - m.end))) end = w.end;
  });
  return { start, end };
}

/** Whisper output chunks → words. Chunks holding several words (chunk-level timestamps) get their span split evenly. */
export function wordsFromChunks(chunks: { text: string; timestamp: [number | null, number | null] }[], offset = 0): Word[] {
  const out: Word[] = [];
  chunks.forEach((c, i) => {
    const s = c.timestamp?.[0];
    if (typeof s !== "number" || !Number.isFinite(s)) return;
    const nextStart = chunks[i + 1]?.timestamp?.[0];
    let e = c.timestamp?.[1];
    if (typeof e !== "number" || !Number.isFinite(e) || e < s) e = typeof nextStart === "number" && nextStart > s ? nextStart : s + 1;
    const parts = String(c.text ?? "").trim().split(/\s+/).filter(Boolean);
    const step = (e - s) / Math.max(1, parts.length);
    parts.forEach((p, j) => out.push({ start: offset + s + j * step, end: offset + s + (j + 1) * step, text: p }));
  });
  return out;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Transcript as "[83.4s] text" lines for the prompt, one per sentence/pause (max ~10 s), so Claude sees where thoughts start;
 *  when too long, keeps only lines near the candidates, then cuts. */
export function promptTranscript(words: Word[], cands: Candidate[], maxChars = 60_000): string {
  const lines: { t: number; text: string }[] = [];
  words.forEach((w, i) => {
    const last = lines[lines.length - 1], prev = words[i - 1];
    if (last && w.start - last.t < 10 && !/[.!?]["')\]]*$/.test(prev.text) && w.start - prev.end <= 0.6) last.text += " " + w.text;
    else lines.push({ t: w.start, text: w.text });
  });
  // Untrusted text: strip angle brackets so it can't close the <transcript> tag in the prompt.
  const fmt = (ls: typeof lines) => ls.map((l) => `[${l.t.toFixed(1)}s] ${l.text.replace(/[<>]/g, "")}`).join("\n");
  let out = fmt(lines);
  if (out.length > maxChars) out = fmt(lines.filter((l) => cands.some((c) => l.t >= c.start - 30 && l.t <= c.end + 30)));
  return out.slice(0, maxChars);
}

/** A time as seconds: a number, or a "m:ss(.d)" / "h:mm:ss(.d)" string (Claude sometimes answers in clock format). */
const toSec = (v: unknown) => typeof v === "string" && /^\d+(:\d{2}){1,2}(\.\d+)?$/.test(v.trim()) ? v.trim().split(":").reduce((a, p) => a * 60 + Number(p), 0) : Number(v);

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "");
/** On-screen hook text: max 6 words, 40 characters. */
const shortHook = (v: unknown) => str(v, 60).split(" ").slice(0, 6).join(" ").slice(0, 40).trim();

/** Validates Claude's reply: a JSON array of moments → clamped to the video, max maxSec long, ≥5 s, no overlaps, best first. */
export function validateMoments(text: string, o: { duration: number; maxSec: number; count: number }): Moment[] {
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  let raw: unknown;
  try { raw = JSON.parse(text.slice(a, b + 1)); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: Moment[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const s0 = toSec(r.start), e0 = toSec(r.end);
    if (!Number.isFinite(s0) || !Number.isFinite(e0)) continue;
    const end = clamp(e0, 0, o.duration);
    const start = Math.max(clamp(s0, 0, o.duration), end - o.maxSec); // too long: keep the end, that's where the payoff is
    if (end - start < 5) continue;
    // Rubric reply: overall = mean of the 0-10 criteria; else a plain score.
    const crit = r.scores && typeof r.scores === "object" ? Object.values(r.scores).map(Number).filter(Number.isFinite) : [];
    let score = crit.length ? crit.reduce((a, v) => a + clamp(v, 0, 10), 0) / crit.length / 10 : Number(r.score);
    if (!Number.isFinite(score)) score = 0.5;
    else if (score > 1) score /= 100; // some replies use 0..100
    const title = str(r.title, 60) || `Clip at ${mmss(start)}`;
    const hook = shortHook(r.hook);
    const titleOptions = validTitleOptions(r.titles); // optional extra: a bad list just means no options (the single title stays)
    out.push({ start, end, title, hook, reason: str(r.reason, 300), score: Math.round(clamp(score, 0, 1) * 100) / 100, ...(titleOptions.length ? { titleOptions } : {}) });
  }
  return removeOverlaps(out).slice(0, o.count);
}

/** Fallback when Claude is unavailable: top candidates with generic titles. */
export function fallbackMoments(cands: Candidate[], count: number): Moment[] {
  return cands.slice(0, count).map((c, i) => ({
    start: c.start, end: c.end, score: c.score, title: `Highlight ${i + 1} (${mmss(c.start)})`, hook: "Wait for this", reason: "Loudest, most active stretch",
  }));
}

// ---- analysis: what to transcribe, how to split the picking ----

const spanSec = (spans: Span[]) => spans.reduce((s, x) => s + x.end - x.start, 0);
export const totalSec = spanSec;
/** Share (0..1) of a moment that lies inside the transcribed spans: picks outside them have no transcript to back them. */
export const spanCover = (m: { start: number; end: number }, spans: Span[]) =>
  m.end > m.start ? spans.reduce((s, x) => s + Math.max(0, Math.min(m.end, x.end) - Math.max(m.start, x.start)), 0) / (m.end - m.start) : 0;

export const ASR_MAX_SEC = 25 * 60;
/** Seconds of audio Whisper may transcribe: 20% of the video (at least 10 min), ×0.6..1.5 by clips wanted, never over 25 min,
 *  so an 8 h stream costs about what a 2 h video does. */
export const asrBudgetSec = (duration: number, count: number) => Math.min(ASR_MAX_SEC, duration, Math.max(600, 0.2 * duration) * (0.5 + count / 10));

const mergeSpans = (spans: Span[], gap = 5): Span[] => {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end + gap) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
};

/** Whisper is the slow step, so long videos only get their most energetic stretches transcribed, up to asrBudgetSec: loudness
 *  candidates re-ranked by how far they jump above the 2 min before them (a reaction spike, the audio stand-in for a chat spike;
 *  also fair across hours where the game volume changed), padded ±pad s and merged. Short videos are transcribed whole. */
export function asrRegions(rms: number[], duration: number, o: { maxSec: number; count: number }, shortSec = 720, pad = 20, winSec = WIN_SEC): Span[] {
  if (duration <= shortSec) return [{ start: 0, end: duration }];
  const budget = asrBudgetSec(duration, o.count);
  const pre = [0];
  for (const v of rms) pre.push(pre[pre.length - 1] + v);
  const mean = (a: number, b: number) => { a = clamp(a, 0, rms.length); b = clamp(b, a, rms.length); return b > a ? (pre[b] - pre[a]) / (b - a) : 0; };
  const all = mean(0, rms.length) || 1;
  const ranked = scoreCandidates(rms, o.maxSec, [], 200).map((c) => {
    const s = Math.floor(c.start / winSec), e = Math.ceil(c.end / winSec);
    const base = mean(s - Math.round(120 / winSec), s) || all;
    return { ...c, rank: 0.7 * c.score + 0.3 * Math.min(mean(s, e) / base, 4) / 4 };
  }).sort((a, b) => b.rank - a.rank);
  let out: Span[] = [];
  for (const c of ranked) {
    const next = mergeSpans([...out, { start: Math.max(0, c.start - pad), end: Math.min(duration, c.end + pad) }]);
    if (spanSec(next) <= budget) out = next;
  }
  return out;
}

/** Regions → Whisper pieces of ≤ seg s (bounded memory, progress and cancel points). A piece re-reads `overlap` s before its start
 *  (never before its region) so seam words survive; cleanWords drops the doubles. `sec` = new audio, for progress. */
export function asrPieces(regions: Span[], seg = 300, overlap = 5): { from: number; start: number; to: number; sec: number }[] {
  const out: { from: number; start: number; to: number; sec: number }[] = [];
  for (const r of regions) for (let t = r.start; t < r.end - 1; t += seg) out.push({ from: Math.max(r.start, t - overlap), start: t, to: Math.min(r.end, t + seg), sec: Math.min(seg, r.end - t) });
  return out;
}

/** Splits the transcribed spans into ≤ n time-ordered groups of about equal length, one per parallel scout.
 *  A cut inside a span extends that group `overlap` s so a moment across the seam can still be found. */
export function groupSpans(spans: Span[], n: number, overlap = 20): Span[][] {
  const target = spanSec(spans) / Math.max(1, n);
  const groups: Span[][] = [[]];
  let acc = 0;
  for (const s of spans) {
    for (let start = s.start; start < s.end - 1e-9;) {
      const end = groups.length < n ? Math.min(s.end, start + target - acc) : s.end;
      groups[groups.length - 1].push({ start, end: end < s.end ? Math.min(s.end, end + overlap) : end });
      acc += end - start;
      start = end;
      if (acc >= target - 1e-6 && groups.length < n) { groups.push([]); acc = 0; }
    }
  }
  return groups.filter((g) => g.length);
}

/** The final editor's picks first (only ones that mostly match a scout's proposal, so no invented times), then the scouts' best by score; never overlapping. */
export function mergeRanked(final: Moment[], proposals: Moment[], count: number): Moment[] {
  const matches = (f: Moment) => proposals.some((p) => Math.min(f.end, p.end) - Math.max(f.start, p.start) >= 0.5 * (f.end - f.start));
  const out = removeOverlaps(final.filter(matches)).slice(0, count);
  for (const p of [...proposals].sort((a, b) => b.score - a.score)) {
    if (out.length < count && out.every((k) => p.end <= k.start || p.start >= k.end)) out.push(p);
  }
  return out;
}

// ---- editing: jump cuts, punch-in zooms, loud words (all times clip-relative) ----

export type Pt = { t: number; v: number }; // one loudness window: centre time, RMS
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** The loudness windows inside [start, end), timed relative to start. */
export function clipLoudness(rms: number[], start: number, end: number, winSec = WIN_SEC): Pt[] {
  const out: Pt[] = [];
  for (let i = Math.max(0, Math.floor(start / winSec)); i < Math.min(rms.length, Math.ceil(end / winSec)); i++) out.push({ t: i * winSec + winSec / 2 - start, v: rms[i] });
  return out;
}

/** Parts of a clip to keep once dead air is cut. Dead air = a stretch ≥ minGap s inside a gap between words where the audio is at or
 *  under the clip's median (so a scream or explosion Whisper didn't catch stays); with no words, stretches well under the median.
 *  Each cut leaves `pad` s on both sides; at most `max` cuts (the longest); returns the whole clip if cutting would leave under 5 s. */
export function keepSegments(words: Word[], pts: Pt[], dur: number, o = { minGap: 0.7, pad: 0.15, max: 40 }): Span[] {
  const med = median(pts.map((p) => p.v)), h = WIN_SEC / 2;
  const quietRuns = (g: Span, thr: number) => {
    const runs: Span[] = [];
    let run: Span | null = null;
    for (const p of pts) {
      if (p.t + h <= g.start || p.t - h >= g.end) continue;
      if (p.v <= thr) { if (run) run.end = Math.min(g.end, p.t + h); else run = { start: Math.max(g.start, p.t - h), end: Math.min(g.end, p.t + h) }; }
      else if (run) { runs.push(run); run = null; }
    }
    if (run) runs.push(run);
    return runs.filter((r) => r.end - r.start >= o.minGap);
  };
  let gaps: Span[] = [];
  if (words.length) {
    let edge = 0;
    for (const w of words) { if (w.start - edge >= o.minGap) gaps.push(...quietRuns({ start: edge, end: w.start }, med)); edge = Math.max(edge, w.end); }
    if (dur - edge >= o.minGap) gaps.push(...quietRuns({ start: edge, end: dur }, med));
  } else gaps = quietRuns({ start: 0, end: dur }, 0.35 * med);
  const cuts = gaps.map((g) => ({ start: g.start <= 0 ? 0 : g.start + o.pad, end: g.end >= dur ? dur : g.end - o.pad }))
    .sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, o.max).sort((a, b) => a.start - b.start);
  const keep: Span[] = [];
  let at = 0;
  for (const c of [...cuts, { start: dur, end: dur }]) {
    if (c.start - at >= 0.1) keep.push({ start: at, end: c.start }); // slivers would be 0-3 frames: drop them
    at = Math.max(at, c.end);
  }
  return spanSec(keep) >= Math.min(5, dur) ? keep : [{ start: 0, end: dur }];
}

/** Clip time → time on the jump-cut timeline; an instant that was cut out maps to where the next kept part starts. */
export function retime(t: number, segs: Span[]): number {
  let off = 0;
  for (const s of segs) {
    if (t < s.start) return off;
    if (t <= s.end) return off + t - s.start;
    off += s.end - s.start;
  }
  return off;
}

export const retimeWords = (words: Word[], segs: Span[]): Word[] =>
  words.map((w) => ({ ...w, start: retime(w.start, segs), end: retime(w.end, segs) })).filter((w) => w.end - w.start > 0.01);

/** Punch-in times on the cut timeline: the loudest peaks (well above the clip's median, near its max), ≥ gap s apart, not in cut-out parts. */
export function zoomTimes(pts: Pt[], segs: Span[], gap = 6): number[] {
  const vs = pts.map((p) => p.v), med = median(vs), max = Math.max(0, ...vs);
  if (!max) return [];
  const picked: number[] = [];
  for (const p of pts.filter((p) => p.v >= Math.max(1.4 * med, 0.7 * max)).sort((a, b) => b.v - a.v)) {
    if (!segs.some((s) => p.t >= s.start && p.t <= s.end)) continue;
    const t = retime(p.t, segs);
    if (t >= 0.3 && picked.every((q) => Math.abs(q - t) >= gap)) picked.push(t);
  }
  return picked.sort((a, b) => a - b);
}

const ZOOM = 0.12, RAMP = 0.15, HOLD = 1;
/** zoompan z expression: 1 → 1.12 over 0.15 s ending at each peak, held 1 s, back over 0.15 s. Uses the output frame number (on) at a fixed fps. */
export function zoomExpr(times: number[], fps = 30): string {
  const t = `on/${fps}`;
  return `1+${ZOOM}*(${times.map((p) => `clip((${t}-${sec(p - RAMP)})/${RAMP},0,1)*clip((${sec(p + HOLD + RAMP)}-${t})/${RAMP},0,1)`).join("+")})`;
}

/** Flags shouted words: ALL CAPS or "!" in the transcript, or among the loudest ~15% of the clip (and well above its median). */
export function markLoud(words: Word[], pts: Pt[]): Word[] {
  const vs = pts.map((p) => p.v).sort((a, b) => a - b);
  const thr = vs.length ? Math.max(vs[Math.floor(0.85 * (vs.length - 1))], 1.5 * median(vs)) : Infinity;
  return words.map((w) => {
    const peak = Math.max(0, ...pts.filter((p) => p.t + WIN_SEC / 2 > w.start && p.t - WIN_SEC / 2 < w.end).map((p) => p.v));
    const caps = /\p{Lu}{2,}/u.test(w.text) && w.text === w.text.toUpperCase();
    return { ...w, loud: w.text.includes("!") || caps || (thr > 0 && peak >= thr) };
  });
}

// ---- ASS subtitles ----

/** h:mm:ss.cc */
export function assTime(sec: number): string {
  const cs = Math.round(Math.max(0, sec) * 100);
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Dialogue text: braces start override blocks and backslashes escapes in libass, so swap them for look-alikes; one line only. */
export function assText(s: string): string {
  return s.replace(/\\/g, "＼").replace(/\{/g, "(").replace(/\}/g, ")").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/** 2–4 words per caption line; breaks early on sentence ends and pauses. */
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
/** Whisper hallucination guard: on music/noise it loops one phrase ("I'M GOING TO BE NINE HOURS." ×20). A run of 2-12 words
 *  repeated back-to-back more than twice keeps one copy; bad timestamps (NaN, end < start) are dropped. */
export function cleanWords(words: Word[]): Word[] {
  const ws: Word[] = [];
  // transformers.js chunk overlaps (and our segment overlap) emit some words twice with near-equal times: keep the first copy.
  for (const w of words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start && norm(w.text)).sort((a, b) => a.start - b.start)) {
    if (!ws.length || w.start >= ws[ws.length - 1].end - 0.15) ws.push(w);
  }
  const out: Word[] = [];
  for (let i = 0; i < ws.length;) {
    let skipped = false;
    for (let n = 2; n <= 12 && !skipped; n++) { // shortest period first, so 6 loops of a phrase keep one copy, not two
      if (i + 3 * n > ws.length) continue;
      const key = (k: number) => ws.slice(k, k + n).map((w) => norm(w.text)).join(" ");
      const first = key(i);
      if (key(i + n) !== first || key(i + 2 * n) !== first) continue;
      let j = i + n;
      while (j + n <= ws.length && key(j) === first) j += n;
      out.push(...ws.slice(i, i + n)); // keep one copy
      i = j; skipped = true;
    }
    if (!skipped) out.push(ws[i++]);
  }
  return out;
}

/** 1-3 words per caption, breaking early on punctuation, pauses and length so each fits one line. */
export function captionGroups(words: Word[]): Word[][] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    if (!next || cur.length >= 3 || /[.!?,;:]$/.test(w.text) || next.start - w.end > 0.35 || chars + next.text.length > 14) { groups.push(cur); cur = []; }
  });
  return groups;
}

const CHERRY_ASS = "&H00632EFF"; // #ff2e63 as &HAABBGGRR
const CAP_FS = 92, CAP_CHARS = 15; // ~15 uppercase chars of bold Arial 92 fit 960 px
const ASS_YELLOW = "&H00E5FF&", ASS_CHERRY = "&H632EFF&"; // #ffe500, #ff2e63 (override colours are &HBBGGRR&)

/** Subtitle file for one clip: the hook on top for the first 2.5 s, then karaoke captions lower-middle: 1-3 words on screen, the spoken
 *  word yellow and popping to 115% (a shouted word: cherry, 135%). Times are relative to the (jump-cut) clip. */
export function buildAss(o: { hook: string; words: Word[]; duration: number; style?: "karaoke" | "classic" }): string {
  const ev: string[] = [];
  if (o.hook.trim()) ev.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(2.5, o.duration))},Hook,,0,0,0,,${assText(o.hook).toUpperCase()}`);
  const groups = captionGroups(cleanWords(o.words));
  let last = 0;
  groups.forEach((g, gi) => {
    const nextGroup = groups[gi + 1]?.[0].start ?? Infinity;
    const text = g.map((w) => assText(w.text).toUpperCase());
    // A long line can't wrap nicely and would run off a 1080 px screen: shrink it (+3 chars of room for the pop).
    const len = text.join(" ").length + 3;
    const fs = len > CAP_CHARS ? `{\\fs${Math.floor((CAP_FS * CAP_CHARS) / len)}}` : "";
    if (o.style === "classic") { // plain white line per group, no per-word highlight
      const start = Math.max(last, g[0].start), end = Math.min(o.duration, Math.max(g[g.length - 1].end, start + 0.3), nextGroup);
      if (end - start < 0.05 || start >= o.duration) return;
      last = end;
      ev.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${fs}${text.join(" ")}`);
      return;
    }
    g.forEach((w, i) => {
      // Never overlap: libass stacks simultaneous captions into a wall of text, so each event ends where the next begins.
      const start = Math.max(last, w.start);
      const end = Math.min(o.duration, i < g.length - 1 ? g[i + 1].start : Math.min(Math.max(w.end, start + 0.3), nextGroup));
      if (end - start < 0.05 || start >= o.duration) return;
      last = end;
      const pop = w.loud ? 135 : 115;
      const line = text.map((t, j) => (j === i ? `{\\c${w.loud ? ASS_CHERRY : ASS_YELLOW}\\t(0,80,\\fscx${pop}\\fscy${pop})}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}` : t)).join(" ");
      ev.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${fs}${line}`);
    });
  });
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Arial,${CAP_FS},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,8,3,2,60,60,560,1`,
    `Style: Hook,Arial,92,&H00FFFFFF,&H00FFFFFF,${CHERRY_ASS},${CHERRY_ASS},-1,0,0,0,100,100,0,0,3,18,0,8,80,80,260,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...ev, "",
  ].join("\n");
}

// ---- ffmpeg arguments (always an args array, never a shell) ----

const sec = (s: number) => (Math.round(s * 1000) / 1000).toString();

// ffmpeg sniffs formats by content: a playlist disguised as .mp4 could pull in other local files. Only real video containers, only plain files.
const IN = ["-format_whitelist", "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm", "-protocol_whitelist", "file", "-i"];
export const probeArgs = (input: string) => ["-hide_banner", "-nostdin", ...IN, input];
export const audioArgs = (input: string, out: string) =>
  ["-hide_banner", "-nostdin", "-y", ...IN, input, "-t", String(MAX_SOURCE_SEC), "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE),
    "-af", "aresample=async=1:first_pts=0", "-f", "f32le", out]; // fill audio gaps/late starts with silence so PCM time = video time

export type Layout = NonNullable<ClipOptions["layout"]>;
type CamSide = NonNullable<ClipOptions["camSide"]>;

/** Source video [inp] → 1080x1920 [out]. fit: whole frame over a blurred, darkened cover copy (blurred at quarter size, far cheaper);
 *  fill: centre crop; split: gameplay (the 9:8 middle of the non-cam two thirds) on top, the cam third below. */
export function layoutFilter(inp: string, out: string, layout: Layout = "fit", camSide: CamSide = "right"): string {
  if (layout === "fill") return `[${inp}]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[${out}]`;
  if (layout === "split") {
    const w = "min(iw*2/3,ih*9/8)", x = camSide === "right" ? "(iw*2/3-ow)/2" : "iw/3+(iw*2/3-ow)/2";
    // shortcut: the cam is assumed to fill a full-height third (centre-cropped); add a cam box option if real layouts need it.
    return `[${inp}]split=2[g0][c0];[g0]crop='${w}':'${w}*8/9':'${x}':'(ih-oh)/2',scale=1080:960,setsar=1[g1];` +
      `[c0]crop=iw/3:ih:${camSide === "right" ? "iw*2/3" : "0"}:0,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[c1];[g1][c1]vstack[${out}]`;
  }
  return `[${inp}]split=2[bg0][fg0];` +
    "[bg0]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:2,scale=1080:1920,setsar=1,eq=brightness=-0.28[bg];" +
    "[fg0]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg];" +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[${out}]`;
}

export type RenderOpts = { duration: number; segs?: Span[]; audio?: boolean; layout?: Layout; camSide?: CamSide; zooms?: number[]; ass?: string };

/** The whole edit as one filter graph: jump cuts (trim/atrim + concat: frame/sample exact and A/V stay in sync per part), layout,
 *  punch-in zooms, captions, then loudness-normalised stereo 48 kHz audio. Outputs [v] and, with audio, [a]. */
export function renderFilter(o: RenderOpts): string {
  // The ass filter's path is parsed by the filter-graph syntax; ffmpeg runs with cwd = the clip folder so a bare safe name suffices.
  if (o.ass !== undefined && !/^[\w.-]+\.ass$/.test(o.ass)) throw new Error("unsafe ass file name");
  const segs = o.segs?.length ? o.segs : [{ start: 0, end: o.duration }];
  // Loudness first, on the uncut audio: after concat, loudnorm drops the last second or so of a short clip (ffmpeg 6).
  const f: string[] = o.audio ? ["[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[an]"] : []; // loudnorm resamples to 192 kHz
  let v = "0:v", a = "an";
  if (segs.length > 1 || segs[0].start > 0 || segs[0].end < o.duration) {
    const n = segs.length, ids = segs.map((_, i) => i);
    f.push(`[0:v]fps=30,split=${n}${ids.map((i) => `[vs${i}]`).join("")}`, ...segs.map((s, i) => `[vs${i}]trim=start=${sec(s.start)}:end=${sec(s.end)},setpts=PTS-STARTPTS[vt${i}]`));
    if (o.audio) f.push(`[an]asplit=${n}${ids.map((i) => `[as${i}]`).join("")}`, ...segs.map((s, i) => `[as${i}]atrim=start=${sec(s.start)}:end=${sec(s.end)},asetpts=PTS-STARTPTS[at${i}]`));
    f.push(`${ids.map((i) => `[vt${i}]${o.audio ? `[at${i}]` : ""}`).join("")}concat=n=${n}:v=1:a=${o.audio ? 1 : 0}[vc]${o.audio ? "[ac]" : ""}`);
    v = "vc"; a = "ac";
  }
  f.push(layoutFilter(v, "lay", o.layout, o.camSide));
  const zoom = o.zooms?.length ? `zoompan=z='${zoomExpr(o.zooms)}':d=1:x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':s=1080x1920:fps=30,setsar=1,` : "";
  f.push(`[lay]fps=30,${zoom}format=yuv420p${o.ass ? `,ass=${o.ass}` : ""}[v]`);
  if (o.audio) f.push(`[${a}]anull[a]`);
  return f.join(";");
}

export const renderArgs = (o: RenderOpts & { input: string; start: number; out: string }) => [
  "-hide_banner", "-nostdin", "-y", "-ss", sec(o.start), "-t", sec(o.duration), ...IN, o.input,
  "-filter_complex", renderFilter(o), "-map", "[v]", ...(o.audio ? ["-map", "[a]"] : []),
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", "30",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", o.out,
];

export const frameArgs = (input: string, at: number, out: string, layout?: Layout, camSide?: CamSide) =>
  ["-hide_banner", "-nostdin", "-y", "-ss", sec(at), ...IN, input, "-filter_complex", layoutFilter("0:v", "v", layout, camSide), "-map", "[v]", "-frames:v", "1", "-q:v", "2", out];

// ---- yt-dlp ("Add from link") ----

export { cleanPermission, parseClipUrl } from "./format.ts";

export const YTDLP_FILE_MARK = "ORBIT_FILE=";

/** yt-dlp argv (spawned without a shell, cwd = inbox). The URL is always the last element, after "--", so it can't be read as an option. */
export const ytdlpArgs = (url: string, ffmpegDir: string) => [
  "--ignore-config", // cwd is the inbox: a dropped yt-dlp.conf there could otherwise add --exec etc.
  "--encoding", "utf-8", // printed paths must decode as UTF-8 even under a non-UTF-8 Windows code page
  "--no-playlist", "--no-part", "--no-mtime", "--restrict-filenames", "--newline", "--progress",
  "--max-downloads", "1", // a channel/playlist page would otherwise pull every video into the inbox
  "--match-filter", `duration<=${MAX_SOURCE_SEC} & !is_live`, "--max-filesize", "12G",
  // ≤1080p; a video stream over 4 GB (≈ 3 h of 1080p: duration can't be used in a format filter) drops to ≤720p, over 10 GB to ≤480p.
  // shortcut: file size stands in for length (yt-dlp can't filter formats by duration); upgrade if VODs land in the wrong quality
  "-f", "bv*[height<=1080][ext=mp4][filesize<?4G][filesize_approx<?4G]+ba[ext=m4a]/bv*[height<=720][ext=mp4][filesize<?10G][filesize_approx<?10G]+ba[ext=m4a]" +
    "/bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=720]/b", "--merge-output-format", "mp4",
  "--ffmpeg-location", ffmpegDir, "-o", "%(uploader).40s - %(title).80s [%(id)s].%(ext)s",
  "--print", `after_move:${YTDLP_FILE_MARK}%(filepath)s`, // marked: other plain lines ("Aborting remaining downloads") reach stdout too
  "--no-quiet", // --print implies --quiet, which hides the "Destination:" lines used to clean up partial files
  "--", url,
];

/** Fraction 0..1 from a `--newline` progress line ("[download]  12.3% of ..."), else null. */
export function parseYtdlpProgress(line: string): number | null {
  const m = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/.exec(line);
  return m ? Math.min(1, Math.round(Number(m[1]) * 10) / 1000) : null;
}

/** A file yt-dlp is writing ("[download] Destination: x", "[Merger] Merging formats into \"x\""), else null. */
export function ytdlpOutputFile(line: string): string | null {
  const m = /^\[download\] Destination: (.+)$/.exec(line) ?? /^\[Merger\] Merging formats into "(.+)"$/.exec(line);
  return m ? m[1].trim() : null;
}

const YTDLP_ERRORS: [RegExp, string][] = [
  [/confirm you.?re not a bot/i, "YouTube blocked the download; try again later or update yt-dlp: `yt-dlp -U`"],
  [/members[- ]only|join this channel|subscriber[- ]only/i, "This video is for channel members/subscribers only; ORBIT can't download it."],
  [/confirm your age|age[- ]restricted|inappropriate for some users/i, "This video is age-restricted; ORBIT can't download it."],
  [/does not pass filter|is live|live event|currently live|premieres in/i, `Live streams and videos over ${MAX_SOURCE_SEC / 3600} hours can't be downloaded; wait for the finished VOD (up to ${MAX_SOURCE_SEC / 3600} h).`],
  [/larger than max-filesize/i, "The video is bigger than 12 GB."],
  [/private video/i, "This video is private."],
  [/video unavailable|has been removed|does not exist/i, "The video is unavailable (removed, private or region-locked)."],
];
/** yt-dlp output → a friendly error: known cases first, else its last ERROR line. */
export function ytdlpError(out: string): string {
  for (const [re, msg] of YTDLP_ERRORS) if (re.test(out)) return msg;
  const last = out.split(/\r?\n/).filter((l) => l.startsWith("ERROR:")).pop();
  return last ? last.slice(6).trim().slice(0, 300) : "yt-dlp finished without a video file";
}

// ---- input validation ----

/** A plain inbox file name with a video extension: no separators, "..", NUL, control chars or ':' (Windows streams/drives). */
export function isInboxName(name: unknown): name is string {
  return isPlainName(name) && VIDEO_EXTS.includes(path.extname(name).toLowerCase());
}

/** A plain file name: no separators, NUL, control chars or ':'. */
export function isPlainName(name: unknown): name is string {
  if (typeof name !== "string" || !name || name.length > 255 || name !== name.trim()) return false;
  return !/[\\/:\0]|[\x00-\x1f]/.test(name); // separators are banned, so ".." inside a name ("So... this.mp4") is harmless
}

const LAYOUTS = ["fit", "fill", "split"], SIDES = ["left", "right"], LANGS = ["auto", "en"];
/** Clip options from a request body (defaults: 5 clips, 45 s, captions, fit layout, jump cuts, zooms, English) or an error message. */
export function validOptions(b: Record<string, unknown>): Required<ClipOptions> | string {
  const { count = 5, maxSec = 45, captions = true, layout = "fit", camSide = "right", jumpCuts = true, zooms = true, language = "en" } = b;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) return "count must be 1-10";
  if (!Number.isInteger(maxSec) || (maxSec as number) < 15 || (maxSec as number) > 120) return "maxSec must be 15-120";
  for (const [k, v] of Object.entries({ captions, jumpCuts, zooms })) if (typeof v !== "boolean") return `${k} must be a boolean`;
  if (!LAYOUTS.includes(layout as string)) return "layout must be fit, fill or split";
  if (!SIDES.includes(camSide as string)) return "camSide must be left or right";
  if (!LANGS.includes(language as string)) return "language must be auto or en";
  return { count, maxSec, captions, layout, camSide, jumpCuts, zooms, language } as Required<ClipOptions>;
}

export const isJobId = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(s);
export const isDownloadId = (s: unknown): s is string => typeof s === "string" && /^dl-[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(s);
export const isClipId = (s: unknown): s is string => typeof s === "string" && /^clip-\d{1,2}(-v\d{1,2})?$/.test(s); // -vN: another version

/** Resolves a "/"-separated relative path inside base, or null if it could escape (absolute, drive, UNC, "..", NUL). */
export function resolveInside(base: string, rel: string, p: typeof path = path): string | null {
  if (typeof rel !== "string" || !rel || rel.length > 512 || rel.includes("\0")) return null;
  if (/^[a-zA-Z]:/.test(rel) || /^[\\/]/.test(rel)) return null;
  const parts = rel.split(/[\\/]/);
  if (parts.some((s) => !s || s === "." || s === ".." || s.includes(":"))) return null;
  const root = p.resolve(base);
  const abs = p.resolve(root, ...parts);
  return abs.startsWith(root + p.sep) ? abs : null;
}

/** HTTP Range → inclusive byte span; null = no/ignorable header (send everything), "bad" = 416. Only single ranges. */
export function parseByteRange(h: string | null, size: number): { start: number; end: number } | null | "bad" {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (!m[1] && !m[2])) return h.includes(",") ? null : "bad";
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  return start > end || start >= size ? "bad" : { start, end };
}

// ---- thumbnail ----

export const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

/** Up to 4 lines of ~14 characters. */
export function wrapTitle(title: string, width = 14, maxLines = 4): string[] {
  const lines: string[] = [];
  for (const w of title.trim().split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= width) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += "…"; }
  return lines;
}

/** Title overlay for the thumbnail: huge white bold text with a cherry stroke and glow, over a dark band. */
export function thumbSvg(title: string, w = 1080, h = 1920): string {
  const lines = wrapTitle(title.toUpperCase());
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const size = Math.min(170, Math.floor((w - 120) / (longest * 0.85)));
  const lh = Math.round(size * 1.08);
  const top = Math.round(h * 0.42 - (lines.length * lh) / 2 + size * 0.8);
  const text = (attrs: string) => `<text x="${w / 2}" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" ${attrs}>` +
    lines.map((l, i) => `<tspan x="${w / 2}" y="${top + i * lh}">${escapeXml(l)}</tspan>`).join("") + "</text>";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>` +
    `<filter id="f" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter></defs>` +
    `<rect x="0" y="${Math.round(h * 0.2)}" width="${w}" height="${Math.round(h * 0.45)}" fill="url(#g)"/>` +
    text(`fill="#ff2e63" stroke="#ff2e63" stroke-width="${Math.round(size * 0.3)}" filter="url(#f)" opacity="0.8"`) +
    text(`fill="#ff2e63" stroke="#ff2e63" stroke-width="${Math.round(size * 0.16)}" stroke-linejoin="round"`) +
    text(`fill="#ffffff" stroke="#000000" stroke-width="3"`) +
    "</svg>";
}

// ---- state files: validation, quarantine ----

export const STATE_V = 1; // bump when a job/download file's shape changes incompatibly
const JOB_STATUSES = ["queued", "probing", "transcribing", "finding", "rendering", "done", "failed"];
const CLIP_STATUSES = ["rendering", "ready", "failed", "approved", "rejected"];
const PUB_STATUSES = ["uploading", "done", "scheduled", "failed", "unknown"];
const DL_STATUSES = ["queued", "downloading", "done", "failed"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const vProblem = (v: unknown) => v === undefined ? "" : !Number.isInteger(v) ? "bad version field" : (v as number) > STATE_V ? `written by a newer ORBIT (v${v})` : "";

/** Why a parsed job file can't be used ("" = fine). Checks what the server and UI rely on; unknown extra fields are fine. */
export function jobProblem(x: unknown, id?: string): string {
  if (!isObj(x)) return "not a JSON object";
  const v = vProblem(x.v);
  if (v) return v;
  if (!isJobId(x.id) || (id !== undefined && x.id !== id)) return "id missing or doesn't match the file name";
  if (![x.source, x.createdAt, x.updatedAt, x.step].every(isStr)) return "source, dates or step missing";
  if (!JOB_STATUSES.includes(x.status as string) || !isNum(x.progress)) return "status or progress invalid";
  if (!Array.isArray(x.warnings) || !x.warnings.every(isStr)) return "warnings must be a list of text";
  if (!isObj(x.options) || !isNum(x.options.count) || !isNum(x.options.maxSec)) return "options missing";
  if (!Array.isArray(x.clips)) return "clips must be a list";
  for (const [i, c] of x.clips.entries()) {
    const ok = isObj(c) && isClipId(c.id) && isNum(c.start) && isNum(c.end) && [c.title, c.hook, c.reason].every(isStr) && isNum(c.score) &&
      CLIP_STATUSES.includes(c.status as string) && (c.publish === undefined || (isObj(c.publish) && PUB_STATUSES.includes(c.publish.status as string)));
    if (!ok) return `clip ${i + 1} is malformed`;
  }
  if (x.feedback !== undefined && !Array.isArray(x.feedback)) return "feedback must be a list";
  return "";
}

export function downloadProblem(x: unknown, id?: string): string {
  if (!isObj(x)) return "not a JSON object";
  const v = vProblem(x.v);
  if (v) return v;
  if (!isDownloadId(x.id) || (id !== undefined && x.id !== id)) return "id missing or doesn't match the file name";
  if (![x.url, x.step, x.createdAt, x.permission].every(isStr)) return "url, step, date or permission missing";
  if (!DL_STATUSES.includes(x.status as string) || !isNum(x.progress)) return "status or progress invalid";
  if (x.parts !== undefined && !(Array.isArray(x.parts) && x.parts.every(isStr))) return "parts must be a list of file names";
  return "";
}

/** "<id>.<UTC timestamp>.json": the name a damaged state file gets in _quarantine (never overwrites an earlier one). */
export const quarantineName = (id: string, now: Date) => `${id}.${now.toISOString().replace(/[:.]/g, "-")}.json`;

// ---- saved analysis (re-used by new versions: no re-transcribing) ----

export type Analysis = { v: 1; duration: number; hasAudio: boolean; spans: Span[]; words: Word[]; rms: number[]; cands: Candidate[]; moments: Moment[] };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Rounded for size: a 3 h VOD is 21 600 loudness windows. */
export const packAnalysis = (a: Omit<Analysis, "v">): Analysis => ({
  v: 1, ...a, words: a.words.map((w) => ({ start: r3(w.start), end: r3(w.end), text: w.text })), rms: a.rms.map((x) => Math.round(x * 1e5) / 1e5),
});

/** analysis.json text → Analysis, or null when damaged/old (the caller then can't make versions without a new job). */
export function parseAnalysis(text: string): Analysis | null {
  let a: unknown;
  try { a = JSON.parse(text); } catch { return null; }
  if (!isObj(a) || a.v !== 1 || !isNum(a.duration) || typeof a.hasAudio !== "boolean" || !Array.isArray(a.rms) || !a.rms.every(isNum)) return null;
  const words = Array.isArray(a.words) && a.words.every((w) => isObj(w) && isNum(w.start) && isNum(w.end) && isStr(w.text)) ? (a.words as Word[]) : null;
  if (!words) return null;
  const list = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  return { v: 1, duration: a.duration, hasAudio: a.hasAudio, words, rms: a.rms as number[], spans: list(a.spans), cands: list(a.cands), moments: list(a.moments) };
}

// ---- "make another version" ----

export type VersionReq = { edit: Partial<VersionEdit>; hook?: string; title?: string; dStart: number; dEnd: number; suggest: boolean };
export const MAX_NUDGE_SEC = 10;

/** Version request body → request, or a message for a 400. start/end are nudges in seconds (clamped to ±10). */
export function validVersion(b: Record<string, unknown>): VersionReq | string {
  const { layout, camSide, captions, jumpCuts, zooms, hook, title, start = 0, end = 0, suggest = false } = b;
  if (layout !== undefined && !LAYOUTS.includes(layout as string)) return "layout must be fit, fill or split";
  if (camSide !== undefined && !SIDES.includes(camSide as string)) return "camSide must be left or right";
  if (captions !== undefined && !CAPTION_STYLES.includes(captions as CaptionStyle)) return "captions must be karaoke, classic or none";
  for (const [k, v] of Object.entries({ jumpCuts, zooms, suggest })) if (v !== undefined && typeof v !== "boolean") return `${k} must be a boolean`;
  if (hook !== undefined && (typeof hook !== "string" || hook.length > 200)) return "hook must be text";
  if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 200)) return "title must be a non-empty string";
  if (!isNum(start) || !isNum(end)) return "start and end must be numbers of seconds";
  const edit = Object.fromEntries(Object.entries({ layout, camSide, captions, jumpCuts, zooms }).filter(([, v]) => v !== undefined)) as Partial<VersionEdit>;
  return { edit, hook: hook === undefined ? undefined : shortHook(hook), title: title === undefined ? undefined : str(title, 70),
    dStart: clamp(start, -MAX_NUDGE_SEC, MAX_NUDGE_SEC), dEnd: clamp(end, -MAX_NUDGE_SEC, MAX_NUDGE_SEC), suggest: suggest as boolean };
}

/** The edit settings a job's original clips were rendered with. */
export const baseEdit = (o: ClipOptions): VersionEdit =>
  ({ layout: o.layout ?? "fit", camSide: o.camSide ?? "right", captions: o.captions ? "karaoke" : "none", jumpCuts: o.jumpCuts ?? true, zooms: o.zooms ?? true });

/** A clip's span nudged and kept inside the video; a message when the result would be under 5 s or over 3 min (the Shorts limit). */
export function versionSpan(clip: Span, dStart: number, dEnd: number, duration: number): Span | string {
  const start = r3(clamp(clip.start + dStart, 0, duration)), end = r3(clamp(clip.end + dEnd, 0, duration));
  if (end - start < 5) return "That trim would leave less than 5 s";
  return end - start > 180 ? "Shorts can be at most 3 minutes" : { start, end };
}

/** Next free "<root>-vN" (the original counts as v1), or null past v99. */
export function nextVersionId(clips: { id: string }[], id: string): string | null {
  const root = rootClipId(id);
  const n = 1 + Math.max(1, ...clips.filter((c) => rootClipId(c.id) === root).map((c) => Number(/-v(\d+)$/.exec(c.id)?.[1] ?? 1)));
  return n > 99 ? null : `${root}-v${n}`;
}

/** Claude's {"title","hook"} reply → the usable parts (empty ones dropped). */
export function parseSuggestion(text: string): { title?: string; hook?: string } {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  let r: unknown;
  try { r = a >= 0 && b > a ? JSON.parse(text.slice(a, b + 1)) : null; } catch { r = null; }
  if (!isObj(r)) return {};
  const title = str(r.title, 60), hook = shortHook(r.hook);
  return { ...(title ? { title } : {}), ...(hook ? { hook } : {}) };
}

// ---- publish reconciliation ----

export type Upload = { videoId: string; title: string; publishedAt: string; privacy?: string };

/** playlistItems.list (part=snippet,status) JSON → uploads; malformed items are skipped. */
export function uploadsFrom(json: unknown): Upload[] {
  const items = isObj(json) && Array.isArray(json.items) ? json.items : [];
  return items.flatMap((it) => {
    const sn = isObj(it) && isObj(it.snippet) ? it.snippet : null, id = sn && isObj(sn.resourceId) ? sn.resourceId.videoId : null;
    if (!sn || !isStr(id) || !/^[A-Za-z0-9_-]{11}$/.test(id) || !isStr(sn.title) || !isStr(sn.publishedAt)) return [];
    const privacy = isObj(it) && isObj(it.status) && isStr(it.status.privacyStatus) ? it.status.privacyStatus : undefined;
    return [{ videoId: id, title: sn.title, publishedAt: sn.publishedAt, ...(privacy ? { privacy } : {}) }];
  });
}

/** The channel upload that is this interrupted upload: the title sent (whitespace-normalised), added from 10 min before the upload
 *  started (clock skew) to 6 h after; the one closest to the start wins. null = not found here, which doesn't prove it's missing. */
export function matchUpload(items: Upload[], want: { title: string; since: string }): Upload | null {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim(), t0 = Date.parse(want.since), title = norm(want.title);
  if (!Number.isFinite(t0)) return null;
  const hits = items.filter((u) => { const t = Date.parse(u.publishedAt); return norm(u.title) === title && t >= t0 - 600_000 && t <= t0 + 6 * 3600_000; });
  return hits.sort((a, b) => Math.abs(Date.parse(a.publishedAt) - t0) - Math.abs(Date.parse(b.publishedAt) - t0))[0] ?? null;
}

/** Check result → publish patch. Not found stays "unknown", never "failed": the playlist can lag, hold > 10 newer uploads, or show a
 *  later publish time once a video goes public — and a "failed" would invite a duplicate upload. */
export function reconcileOutcome(hit: Upload | null, privacy?: string) {
  return hit
    ? { status: "done" as const, progress: 1, videoId: hit.videoId, url: `https://youtube.com/shorts/${hit.videoId}`, error: undefined, privacy: hit.privacy ?? privacy }
    : { status: "unknown" as const, error: "Not among your 10 newest uploads yet — check again in a few minutes, or upload again" };
}

// ---- review feedback ----

export const isRejectReason = (s: unknown): s is string => REJECT_REASONS.includes(s as (typeof REJECT_REASONS)[number]);

/** Appends a review event (the newest 500 are kept). */
export function addFeedback(job: { feedback?: Feedback[] }, clipId: string, action: FeedbackAction, reason?: string, at = new Date().toISOString()) {
  const f = (job.feedback ??= []);
  f.push({ clipId, action, ...(reason ? { reason } : {}), at });
  if (f.length > 500) f.splice(0, f.length - 500);
}

/** Attaches a reason to the clip's latest reject event (picked after rejecting); false when there is none. */
export function setRejectReason(job: { feedback?: Feedback[] }, clipId: string, reason: string): boolean {
  const ev = job.feedback?.findLast((e) => e.clipId === clipId && e.action === "rejected");
  if (ev) ev.reason = reason;
  return !!ev;
}
