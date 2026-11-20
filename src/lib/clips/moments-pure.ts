// Audience signals → better moments (pure, tested in tests/moments.test.ts). I/O: factory.ts (yt-dlp meta), hype.ts (chat replay).
// Signals, per second of the video:
//   replay — YouTube's "Most replayed" heatmap (yt-dlp info JSON `heatmap`: ~100 points, value 0..1): where real viewers rewatch.
//   chat   — chat messages/second (delay-shifted, × the stream's usual speed: hype.ts chatX).
//   burst  — messages/second that are emote/laugh/caps walls (KEKW, 💀, "W", "LMAOOO", ALL CAPS).
//   loud   — loudness level / jump z-scores from the hype timeline (screams, laughs).
//   talk   — transcript excitement: shouted words, "no way", "oh my god", "!", fast talking. Only inside the transcribed spans.
//   event  — audio-event tagger (audio-events-pure.ts): how sure it is that laughter, screaming, cheering, applause, a gasp or an
//            explosion/gunshot is on the track. Only inside the tagged spans (time-boxed), NaN elsewhere.
// Each signal is robust-normalized per video (median / MAD z-scores), then a weighted mean of the signals present at that second:
// a missing signal (no heatmap, no chat, not transcribed there) drops out and the rest are renormalized.
import { findPeaks, robustZ, smooth, type ChatMsg, type HypePeak } from "./hype-pure.ts";
import { MIN_CLIP_SEC, type Moment, type Span, type Word } from "./pure.ts";
import { eventReason } from "./audio-events-pure.ts";

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;
const meanOf = (xs: number[]) => { let t = 0, n = 0; for (const x of xs) if (Number.isFinite(x)) { t += x; n++; } return n ? t / n : NaN; };
const medianOf = (xs: number[]) => { const a = xs.filter(Number.isFinite).sort((p, q) => p - q), m = a.length >> 1; return !a.length ? NaN : a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---- YouTube "Most replayed" heatmap ----

export type HeatPoint = { start: number; end: number; value: number };

/** yt-dlp info JSON (or its `heatmap` array, or the packed [start, end, value] triples ORBIT stores) → points, time-sorted.
 *  Bad points are dropped; fewer than 10 good ones = no heatmap (YouTube sends ~100 when it has one). */
export function parseHeatmap(x: unknown): HeatPoint[] {
  const list = Array.isArray(x) ? x : isObj(x) && Array.isArray(x.heatmap) ? x.heatmap : [];
  const out: HeatPoint[] = [];
  for (const p of list.slice(0, 2000)) {
    const [start, end, value] = Array.isArray(p) ? p : isObj(p) ? [p.start_time, p.end_time, p.value] : [];
    if (fin(start) && fin(end) && fin(value) && start >= 0 && end > start && value >= 0) out.push({ start, end, value: Math.min(value, 1e6) });
  }
  out.sort((a, b) => a.start - b.start);
  return out.length >= 10 ? out : [];
}

/** Compact form for the job file: [start, end, value] rounded. */
export const packHeatmap = (pts: HeatPoint[]): [number, number, number][] => pts.map((p) => [r2(p.start), r2(p.end), Math.round(p.value * 1e4) / 1e4]);

/** Per-second audience interest from the heatmap (linear between point centres), or null when there's none or it's flat.
 *  The opening is flattened (openingEnd): everyone watches the start, so it is ~1.0 and decays like a retention curve, which says
 *  nothing about a moment (verified on a real yt-dlp heatmap: tests/fixtures/ytdlp-heatmap-info.json). */
export function heatmapCurve(pts: HeatPoint[], duration: number): number[] | null {
  if (pts.length < 10 || !(duration > 0)) return null;
  const secs = Math.max(1, Math.ceil(duration));
  const { lead, cap } = openingEnd(pts.map((p) => p.value));
  const xs = pts.map((p) => (p.start + p.end) / 2), vs = pts.map((p, i) => (i < lead ? Math.min(p.value, cap) : p.value));
  const out = new Array<number>(secs);
  let j = 0;
  for (let t = 0; t < secs; t++) {
    const c = t + 0.5;
    while (j < xs.length - 2 && xs[j + 1] < c) j++;
    if (c <= xs[0]) out[t] = vs[0];
    else if (c >= xs[xs.length - 1]) out[t] = vs[vs.length - 1];
    else { const f = (c - xs[j]) / (xs[j + 1] - xs[j] || 1); out[t] = vs[j] + (vs[j + 1] - vs[j]) * Math.min(1, Math.max(0, f)); }
  }
  const lo = Math.min(...out), hi = Math.max(...out);
  return hi - lo > 1e-6 ? out : null;
}

/** Where the opening's retention decay ends: the first local minimum within the first 15% of points (cap = its value), else 15% in
 *  with the rest's 75th percentile as the cap. Points before `lead` are capped. */
export function openingEnd(vs: number[]): { lead: number; cap: number } {
  const max = Math.max(2, Math.ceil(vs.length * 0.15));
  for (let i = 1; i < Math.min(max, vs.length - 2); i++) if (vs[i] <= vs[i + 1] && vs[i] <= vs[i + 2] && vs[i] < vs[0]) return { lead: i, cap: vs[i] };
  const rest = vs.slice(max).sort((a, b) => a - b);
  return { lead: max, cap: rest.length ? rest[Math.floor(rest.length * 0.75)] : Infinity };
}

export type HeatStats = { peakX: number; peakAt: number; peaks: number; clear: boolean };
/** How useful a heatmap is: the strongest point (opening ignored) × the video's average, where, how many distinct spikes
 *  (local maxima ≥ 1.6× the median), and whether that's a clear signal (peak ≥ 1.8× average). The scout prefers clear ones. */
export function heatStats(pts: HeatPoint[]): HeatStats | null {
  if (pts.length < 10) return null;
  const { lead } = openingEnd(pts.map((p) => p.value)), vs = pts.slice(lead).map((p) => p.value);
  const avg = meanOf(vs), med = medianOf(vs);
  if (!(avg > 0)) return null;
  let best = 0;
  for (let i = 1; i < vs.length; i++) if (vs[i] > vs[best]) best = i;
  let peaks = 0;
  for (let i = 1; i < vs.length - 1; i++) if (vs[i] >= vs[i - 1] && vs[i] > vs[i + 1] && vs[i] >= 1.6 * med) peaks++;
  const peakX = r1(vs[best] / avg), p = pts[best + lead];
  return { peakX, peakAt: Math.round((p.start + p.end) / 2), peaks, clear: peakX >= 1.8 };
}

// ---- chat emote bursts ----

// Twitch/7TV/BTTV/YouTube hype tokens. Case-sensitive "W"/"L" spam; laughs and ALL-CAPS walls by pattern below.
const HYPE_TOKENS = new Set(["LUL", "LULW", "KEKW", "KEK", "KEKL", "OMEGALUL", "ICANT", "PogChamp", "Pog", "POG", "POGGERS", "PogU", "W", "L", "WW", "LL", "WWW", "LLL",
  "monkaS", "monkaW", "PepeLaugh", "NOWAY", "OOOO", "HUH", "Sadge", "EZ", "GG", "💀", "😂", "🤣", "😭", "🔥", "😱", "😳", ":skull:", ":face-with-tears-of-joy:", ":fire:"]);
const LAUGH = /^(a?h[ae]h[ae](h[ae])*h?|l+o+l+|l+m+f*a+o+|xd+|ro+fl|ja(ja)+|ka(ka)+|kek+w?|ded|dead|omg+|wtf+|no+ ?wa+y+)$/i;
const EMOJI = /\p{Extended_Pictographic}/u;

/** The hype token a chat message is (or repeats), else null: emotes, laugh words, emoji, an ALL-CAPS line. */
export function hypeToken(text: string): string | null {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  for (const t of toks) {
    if (HYPE_TOKENS.has(t)) return t;
    if (LAUGH.test(t)) return "LAUGH";
    if (EMOJI.test(t) && t.length <= 16) return t;
  }
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return "CAPS";
  return null;
}

export type ChatBurst = { burst: number[]; top: Map<number, string> };
/** Messages → per-second count of hype-token messages (the "KEKW KEKW 💀 W W" wall), `delay` s earlier (chat reacts late), and each
 *  second's most repeated token. */
export function chatBurst(msgs: ChatMsg[], secs: number, delay = 0): ChatBurst {
  const burst = new Array<number>(secs).fill(0), tally = new Map<number, Map<string, number>>();
  for (const m of msgs) {
    if (m.kind !== "msg") continue;
    const t = Math.floor(m.t - delay);
    if (t < 0 || t >= secs) continue;
    const tok = hypeToken(m.text);
    if (!tok) continue;
    burst[t]++;
    const c = tally.get(t) ?? new Map<string, number>();
    c.set(tok, (c.get(tok) ?? 0) + 1);
    tally.set(t, c);
  }
  const top = new Map<number, string>();
  for (const [t, c] of tally) top.set(t, [...c].sort((a, b) => b[1] - a[1])[0][0]);
  return { burst, top };
}

// ---- transcript excitement ----

const HYPE_SPEECH = /\b(no way|oh my god|oh my gosh|omg|what the (hell|heck|f\w*)|wtf|let'?s go+|holy (shit|crap|cow|moly)|insane|crazy|clip (it|that)|go go|run+|nah+|wait wait|are you (kidding|serious)|oh no+|bro+|dude|yo+o|ha(ha)+|lol|lmao|what\?!|dead|i'?m dead|get out)\b/gi;

/** Per-second excitement of what's said: shouted words (Word.loud), ALL-CAPS words, "!" and hype phrases, plus a little for talking
 *  fast. NaN outside the transcribed spans (unknown, not calm), 0 for silence inside them. */
export function talkExcitement(words: Word[], spans: Span[], secs: number): number[] {
  const out = new Array<number>(secs).fill(NaN);
  for (const s of spans) for (let t = Math.max(0, Math.floor(s.start)); t < Math.min(secs, Math.ceil(s.end)); t++) out[t] = 0;
  const text = new Map<number, string[]>();
  for (const w of words) {
    const t = Math.floor(w.start);
    if (t < 0 || t >= secs) continue;
    if (Number.isNaN(out[t])) out[t] = 0;
    const bare = w.text.replace(/[^\p{L}\p{N}!?']/gu, "");
    out[t] += 0.25 + (w.loud ? 1 : 0) + (/!/.test(w.text) ? 0.6 : 0) + (bare.length >= 3 && /\p{L}/u.test(bare) && bare === bare.toUpperCase() ? 0.6 : 0);
    (text.get(t) ?? text.set(t, []).get(t)!).push(w.text);
  }
  for (const [t, ws] of text) out[t] += 1.5 * (ws.join(" ").match(HYPE_SPEECH)?.length ?? 0);
  return out;
}

// ---- fusion ----

export type SignalKey = "replay" | "chat" | "burst" | "loud" | "talk" | "event";
export type Signals = Partial<Record<SignalKey, number[]>>;
// Real viewers' behaviour weighs most (replays = proven rewatch value), then chat, then what the audio/transcript suggest.
export const WEIGHTS: Record<SignalKey, number> = { replay: 0.3, chat: 0.2, burst: 0.1, loud: 0.2, talk: 0.2, event: 0.2 }; // a missing signal drops out and the mean renormalizes
export const SIGNAL_KEYS = Object.keys(WEIGHTS) as SignalKey[];

/** Robust z-scores over the finite values only (NaN stays NaN = "unknown here"), floored at -2 so one dead signal can't sink a moment. */
export function zFinite(xs: number[]): number[] {
  const idx: number[] = [], vals: number[] = [];
  xs.forEach((x, i) => { if (Number.isFinite(x)) { idx.push(i); vals.push(x); } });
  const out = new Array<number>(xs.length).fill(NaN);
  if (vals.length < 5) return out;
  robustZ(vals).forEach((z, k) => { out[idx[k]] = Math.max(-2, z); });
  return out;
}

export type Fused = { curve: number[]; z: Signals; used: SignalKey[] };

/** Signals (any subset, each per second) → one per-second curve: weighted mean of the z-scores present at each second. */
export function fuseSignals(raw: Signals, secs: number): Fused {
  const z: Signals = {}, used: SignalKey[] = [];
  for (const k of SIGNAL_KEYS) {
    const xs = raw[k];
    if (!xs?.length) continue;
    const pad = Array.from({ length: secs }, (_, t) => (Number.isFinite(xs[t]) ? xs[t] : NaN));
    const zs = zFinite(k === "chat" || k === "burst" ? nanSmooth(pad, 1) : pad);
    if (zs.some(Number.isFinite) && zs.some((v) => v > 0.5)) { z[k] = zs; used.push(k); } // flat: says nothing, drop it
  }
  const curve = Array.from({ length: secs }, (_, t) => {
    let v = 0, w = 0;
    for (const k of used) { const x = z[k]![t]; if (Number.isFinite(x)) { v += WEIGHTS[k] * x; w += WEIGHTS[k]; } }
    return w ? v / w : 0;
  });
  return { curve: smooth(curve, 1), z, used };
}
const nanSmooth = (xs: number[], r: number) => xs.map((x, i) => {
  if (!Number.isFinite(x)) return NaN;
  let t = 0, n = 0;
  for (let j = Math.max(0, i - r); j <= Math.min(xs.length - 1, i + r); j++) if (Number.isFinite(xs[j])) { t += xs[j]; n++; }
  return t / n;
});

export type SignalWindow = { start: number; end: number; score: number; strength: number; reasons: string[] };

const maxIn = (xs: number[] | undefined, a: number, b: number) => { let m = -Infinity; if (xs) for (let i = a; i < b; i++) if (xs[i] > m) m = xs[i]; return m; };

/** Plain-words reasons a stretch [a, b) stands out, strongest first (max 3): "replayed 4.1× avg", "chat 6.0× avg", "KEKW wall ×14", "laughter 3.2× avg"…
 *  `top`: each second's most repeated chat token; `evTop`: each second's strongest audio event group (audio-events-pure.ts). */
export function windowReasons(f: Fused, raw: Signals, a: number, b: number, top?: Map<number, string>, evTop?: Map<number, string>): string[] {
  const out: [number, string][] = [];
  const zMax = (k: SignalKey) => maxIn(f.z[k], a, b);
  if (f.used.includes("replay")) { const x = maxIn(raw.replay, a, b) / meanOf(raw.replay!); if (x >= 1.4) out.push([zMax("replay") + 1, `replayed ${x.toFixed(1)}× avg`]); }
  if (f.used.includes("chat")) { const x = maxIn(raw.chat, a, b) / meanOf(raw.chat!); if (x >= 2) out.push([zMax("chat"), `chat ${x.toFixed(1)}× avg`]); } // chat: pass it smoothed (hype chatX)
  if (f.used.includes("burst") && zMax("burst") >= 2) {
    let n = 0;
    for (let i = a; i < b; i++) n += raw.burst![i] || 0;
    const toks = top ? [...Array(b - a)].map((_, i) => top.get(a + i)).filter((x): x is string => !!x) : [];
    const tok = toks.sort((p, q) => toks.filter((y) => y === q).length - toks.filter((y) => y === p).length)[0];
    out.push([zMax("burst"), `${tok && tok !== "CAPS" ? (tok === "LAUGH" ? "laugh" : tok) : "emote"} wall ×${Math.round(n)}`]);
  }
  if (f.used.includes("event") && evTop && zMax("event") >= 1.5) { const r = eventReason(raw.event!, evTop, a, b); if (r) out.push([zMax("event"), r.text]); }
  if (f.used.includes("loud") && zMax("loud") >= 2) out.push([zMax("loud"), "scream / loud spike"]);
  if (f.used.includes("talk") && zMax("talk") >= 2) out.push([zMax("talk"), "excited speech"]);
  return out.sort((p, q) => q[0] - p[0]).slice(0, 3).map(([, r]) => r);
}

/** Best non-overlapping clip windows (minSec / mid / maxSec long, 2 s steps), scored 0.55 × the window's peak + 0.45 × its mean
 *  of the fused curve (a short window around one spike beats a long lukewarm one). score: 0..1 for the UI / fallback; strength: raw z. */
export function topWindows(f: Fused, raw: Signals, o: { maxSec: number; duration: number; n?: number; minSec?: number; top?: Map<number, string>; evTop?: Map<number, string> }): SignalWindow[] {
  const { n = 8, minSec = MIN_CLIP_SEC } = o, secs = f.curve.length;
  if (!f.used.length || secs < minSec) return [];
  const pre = [0];
  for (const v of f.curve) pre.push(pre[pre.length - 1] + v);
  const lens = [...new Set([minSec, Math.round((minSec + o.maxSec) / 2), o.maxSec])].filter((l) => l <= secs);
  const all: { start: number; end: number; s: number }[] = [];
  for (const len of lens) for (let s = 0; s + len <= secs; s += 2) all.push({ start: s, end: s + len, s: 0.55 * maxIn(f.curve, s, s + len) + 0.45 * ((pre[s + len] - pre[s]) / len) });
  all.sort((a, b) => b.s - a.s);
  const out: SignalWindow[] = [];
  for (const w of all) {
    if (out.length >= n || w.s <= 0.3) break; // ≈ ordinary: not worth suggesting
    if (out.some((x) => w.start < x.end && x.start < w.end)) continue;
    out.push({ start: w.start, end: Math.min(o.duration, w.end), strength: r2(w.s), score: r2(Math.min(1, Math.max(0, 0.5 + w.s / 6))), reasons: windowReasons(f, raw, w.start, w.end, o.top, o.evTop) });
  }
  return out;
}

/** Fused-curve peaks in the hype timeline's shape (for choosing what to transcribe first). */
export function fusedPeaks(f: Fused, raw: Signals, n = 12, top?: Map<number, string>, evTop?: Map<number, string>): HypePeak[] {
  return findPeaks(f.curve, { n, minHeight: 0.6, minProm: 0.6 }).map((p) => ({ ...p, reasons: windowReasons(f, raw, Math.max(0, p.t - 5), p.t + 6, top, evTop) }));
}

/** Windows as prompt lines (data: the caller fences them). */
export const windowLines = (ws: SignalWindow[]) =>
  ws.map((w) => `${w.start.toFixed(0)}-${w.end.toFixed(0)} s (${mmss(w.start)}) strength ${w.strength.toFixed(1)}: ${w.reasons.join(", ") || "above-average activity"}`).join("\n");

/** The audience reasons of the window overlapping a moment most (for the rank prompt and clip reasons). */
export function reasonsFor(m: { start: number; end: number }, ws: SignalWindow[]): string[] {
  let best: SignalWindow | undefined, ov = 0;
  for (const w of ws) { const o = Math.min(m.end, w.end) - Math.max(m.start, w.start); if (o > ov) { ov = o; best = w; } }
  return best && ov >= Math.min(5, (m.end - m.start) / 3) ? best.reasons : [];
}

/** Fallback without Claude: the best windows as moments, with the audience reasons as the clip's reason. */
export function windowMoments(ws: SignalWindow[], count: number): Moment[] {
  return ws.slice(0, count).map((w, i) => ({ start: w.start, end: w.end, score: w.score, title: `Highlight ${i + 1} (${mmss(w.start)})`, hook: "Wait for this",
    reason: w.reasons.length ? `Audience signals: ${w.reasons.join(", ")}` : "Most active stretch (audio, chat and replays combined)" }));
}

/** Downsampled replay curve for the HypeWave (bucket = its max, 0..1). */
export function packReplay(curve: number[], bucketSec: number): number[] {
  const n = Math.ceil(curve.length / bucketSec), m = Math.max(1e-9, ...curve);
  return Array.from({ length: n }, (_, i) => Math.round((Math.max(...curve.slice(i * bucketSec, i * bucketSec + bucketSec)) / m) * 1000) / 1000);
}

// ---- what yt-dlp knows about the source ----

export type SourceMeta = { heatmap: HeatPoint[]; title: string; uploader: string; language: string; categories: string[]; tags: string[]; wasLive: boolean };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

/** yt-dlp info JSON (the ORBIT_META print, an .info.json, or the `meta` saved in <file>.source.json) → the fields ORBIT uses, cleaned. */
export function parseSourceMeta(x: unknown): SourceMeta | null {
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { return null; } }
  if (!isObj(x)) return null;
  return { heatmap: parseHeatmap(x.heatmap), title: str(x.title, 200), uploader: str(x.uploader, 100) || str(x.channel, 100), language: str(x.language, 16),
    categories: strs(x.categories, 5, 40), tags: strs(x.tags, 30, 40), wasLive: x.was_live === true || x.live_status === "was_live" || x.live_status === "post_live" };
}

/** Text the game focus is detected from: the file name (yt-dlp names it "<uploader> - <title> [id]"), title, channel, tags. */
export const focusText = (source: string, m: SourceMeta | null) => [source, m?.title, m?.uploader, ...(m?.tags ?? [])].filter(Boolean).join(" | ");

/** Saved form for <file>.source.json: heatmap packed, the rest as yt-dlp names them. */
export const storeMeta = (m: SourceMeta) => ({ heatmap: packHeatmap(m.heatmap), title: m.title, uploader: m.uploader, language: m.language, categories: m.categories, tags: m.tags, was_live: m.wasLive });
