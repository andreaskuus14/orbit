// Hype timeline (pure, tested in tests/hype.test.ts): chat replay + audio → one per-second hype curve → peaks (the stream's big moments).
// I/O (yt-dlp chat download, sidecar files): hype.ts. Times are seconds into the VOD.
import { SAMPLE_RATE, WIN_SEC, type Span } from "./pure.ts";

export type ChatKind = "msg" | "donation" | "sub" | "raid";
export type ChatMsg = { t: number; author: string; text: string; kind: ChatKind };

// ---- chat parsers ----

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const s = (x: unknown) => (typeof x === "string" ? x : "");
// Bot lines (StreamElements, Nightbot, Kick/YouTube notices) that announce money or subs in plain chat.
const EVENT_TEXT: [ChatKind, RegExp][] = [
  ["raid", /\b(is raiding|raided|raid from|raiders)\b/i],
  ["sub", /\b(just subscribed|subscribed (for|with)|gifted (a|\d+) (tier \d )?sub|resubscribed|new member|became a member)\b/i],
  ["donation", /\b(donated|tipped|cheered)\s*(\$|€|£|\d)|\bcheer\d{2,}\b/i],
];
const kindOfText = (text: string): ChatKind => EVENT_TEXT.find(([, re]) => re.test(text))?.[0] ?? "msg";

/** One YouTube live chat replay item (yt-dlp `--sub-langs live_chat` writes one JSON action per line). */
function ytItem(item: Record<string, unknown>, t: number): ChatMsg | null {
  const [type, r] = Object.entries(item)[0] ?? [];
  if (!isObj(r)) return null;
  const runs = isObj(r.message) && Array.isArray(r.message.runs) ? r.message.runs : isObj(r.headerSubtext) && Array.isArray(r.headerSubtext.runs) ? r.headerSubtext.runs : [];
  const text = runs.map((x) => (isObj(x) ? s(x.text) || (isObj(x.emoji) ? s((x.emoji.shortcuts as unknown[] | undefined)?.[0]) || s(x.emoji.emojiId) : "") : "")).join("").trim();
  const author = s(r.authorExternalChannelId) || (isObj(r.authorName) ? s(r.authorName.simpleText) : "");
  const kind: ChatKind | null = type === "liveChatTextMessageRenderer" ? kindOfText(text)
    : type === "liveChatPaidMessageRenderer" || type === "liveChatPaidStickerRenderer" ? "donation"
    : type === "liveChatMembershipItemRenderer" || type === "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer" ? "sub" : null;
  return kind ? { t, author, text, kind } : null;
}

/** yt-dlp's `<name>.live_chat.json` (JSON lines of replayChatItemAction) → messages, time-sorted. Bad lines are skipped. */
export function parseYouTubeChat(text: string): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: unknown;
    try { o = JSON.parse(line); } catch { continue; }
    const r = isObj(o) && isObj(o.replayChatItemAction) ? o.replayChatItemAction : null;
    const t = Number(r?.videoOffsetTimeMsec) / 1000;
    if (!r || !Number.isFinite(t) || !Array.isArray(r.actions)) continue;
    for (const a of r.actions) {
      const item = isObj(a) && isObj(a.addChatItemAction) && isObj(a.addChatItemAction.item) ? a.addChatItemAction.item : null;
      const m = item && ytItem(item, Math.max(0, t));
      if (m) out.push(m);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Twitch VOD chat in the "comments" shape (the old rechat/v5 API, and TwitchDownloader's chat JSON export) → messages, time-sorted. */
export function parseTwitchChat(json: unknown): ChatMsg[] {
  const list = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.comments) ? json.comments : [];
  const out: ChatMsg[] = [];
  for (const c of list) {
    if (!isObj(c)) continue;
    const t = Number(c.content_offset_seconds), m = isObj(c.message) ? c.message : {}, who = isObj(c.commenter) ? c.commenter : {};
    if (!Number.isFinite(t)) continue;
    const text = s(m.body).trim(), notice = isObj(m.user_notice_params) ? s(m.user_notice_params["msg-id"]) : "";
    const kind: ChatKind = /raid/.test(notice) ? "raid" : /sub|gift/.test(notice) ? "sub" : Number(m.bits_spent) > 0 ? "donation" : kindOfText(text);
    out.push({ t: Math.max(0, t), author: s(who._id) || s(who.name) || s(who.display_name), text, kind });
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---- chat → per-second series ----

// Hype emotes/words across Twitch, Kick and YouTube streamer chats (case-sensitive where case matters: "W"/"L" spam).
const EMOTES = new Set(["KEKW", "KEK", "KEKL", "OMEGALUL", "LUL", "LULW", "LMAO", "LMFAO", "LOL", "ICANT", "Pog", "POG", "PogChamp", "POGGERS", "PogU", "W", "L", "WW", "LL",
  "monkaS", "monkaW", "Sadge", "PepeLaugh", "xdd", "OOOO", "NOWAY", "Aware", "Clueless", "WAYTOODANK", "catJAM", "HUH", "Stare", "EZ", "GG", "BRO", "NAHH", "NAH", "DEAD",
  "💀", "😂", "🤣", "😭", "🔥", "😱", "😳", ":face-with-tears-of-joy:", ":skull:", ":fire:", ":loudly-crying-face:"]);
const CLIP_RE = /\bclip+\s*(it|that|this)\b|^\s*clip+\s*!*\s*$|\bCLIP\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const isEmote = (tok: string) => EMOTES.has(tok) || EMOTES.has(tok.toUpperCase()) && tok.length > 2 || EMOJI_RE.test(tok) || (/^[A-Z]{3,}$/.test(tok) && tok.length <= 12);

export type ChatSeries = { rate: number[]; uniq: number[]; emote: number[]; events: number[]; clip: number[]; top: Map<number, string>; n: number };

/** Messages → per-second counts over `secs` seconds. emote = messages in that second repeating the second's most common emote/caps token
 *  (the "KEKW KEKW KEKW" wall), top = that token (for the reasons). */
export function chatSeries(msgs: ChatMsg[], secs: number): ChatSeries {
  const z = () => new Array<number>(secs).fill(0);
  const rate = z(), uniq = z(), emote = z(), events = z(), clip = z(), top = new Map<number, string>();
  let i = 0;
  for (let t = 0; t < secs; t++) {
    const who = new Set<string>(), toks = new Map<string, number>();
    for (; i < msgs.length && msgs[i].t < t + 1; i++) {
      const m = msgs[i];
      if (m.t < t) continue;
      if (m.kind !== "msg") { events[t]++; continue; }
      rate[t]++;
      who.add(m.author || `?${i}`);
      if (CLIP_RE.test(m.text)) clip[t]++;
      for (const tok of new Set(m.text.split(/\s+/).filter(isEmote).map((x) => (EMOTES.has(x) ? x : x.toUpperCase())))) toks.set(tok, (toks.get(tok) ?? 0) + 1);
    }
    uniq[t] = who.size;
    const best = [...toks].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) { emote[t] = best[1]; top.set(t, best[0]); }
  }
  return { rate, uniq, emote, events, clip, top, n: msgs.length };
}

// ---- audio ----

/** Band-limited (≈ 250 Hz – 3 kHz: the voice band) RMS per 1 s of 16 kHz PCM: shouting/laughing rises here more than game music does. */
export function voiceWindows(pcm: Float32Array, rate = SAMPLE_RATE): number[] {
  const hp = Math.exp((-2 * Math.PI * 250) / rate), lp = 1 - Math.exp((-2 * Math.PI * 3000) / rate);
  let prevX = 0, h = 0, l = 0;
  const out: number[] = [];
  for (let i = 0; i < pcm.length; i += rate) {
    const end = Math.min(pcm.length, i + rate);
    let sum = 0;
    for (let j = i; j < end; j++) {
      h = hp * (h + pcm[j] - prevX); prevX = pcm[j]; // one-pole high-pass
      l += lp * (h - l); // one-pole low-pass
      sum += l * l;
    }
    out.push(Math.sqrt(sum / (end - i)));
  }
  return out;
}

// ---- stats helpers ----

const median = (xs: ArrayLike<number>) => { const a = Array.from(xs).sort((x, y) => x - y), m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : 0; };
const mean = (xs: ArrayLike<number>) => { let t = 0; for (let i = 0; i < xs.length; i++) t += xs[i]; return xs.length ? t / xs.length : 0; };

/** Robust z-scores: (x − median) / (1.4826·MAD), falling back to the std when over half the values are equal (quiet chat: mostly 0). Capped to [-4, 12]. */
export function robustZ(xs: number[]): number[] {
  const med = median(xs);
  let sc = 1.4826 * median(xs.map((x) => Math.abs(x - med)));
  if (!(sc > 1e-9)) { const m = mean(xs); sc = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); }
  if (!(sc > 1e-9)) return xs.map(() => 0);
  return xs.map((x) => Math.max(-4, Math.min(12, (x - med) / sc)));
}

/** Centered moving average, ±r samples. */
export function smooth(xs: number[], r: number): number[] {
  const pre = [0];
  for (const x of xs) pre.push(pre[pre.length - 1] + x);
  return xs.map((_, i) => { const a = Math.max(0, i - r), b = Math.min(xs.length, i + r + 1); return (pre[b] - pre[a]) / (b - a); });
}

/** out[t] = xs[t + lag]: chat reacts `lag` s after the moment, so shift it earlier. */
export const shiftEarlier = (xs: number[], lag: number) => xs.map((_, t) => xs[t + lag] ?? 0);

const corr = (a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
};

/** Chat delay (s): the lag in [lo, hi] where chat activity best follows the audio reactions; `dflt` when they barely correlate. */
export function estimateDelay(chat: number[], audio: number[], lo = 2, hi = 10, dflt = 5): number {
  let best = dflt, bestC = 0.08; // under this, the match is noise
  for (let lag = lo; lag <= hi; lag++) { const c = corr(shiftEarlier(chat, lag), audio); if (c > bestC) { bestC = c; best = lag; } }
  return best;
}

// ---- the curve ----

export type HypeParts = { loud: number[]; jump: number[]; voice?: number[]; chat?: number[]; uniq?: number[]; emote?: number[]; events?: number[]; clip?: number[] };
export type HypePeak = { t: number; start: number; end: number; height: number; sharp: number; reasons: string[] };
export type Hype = { curve: number[]; parts: HypeParts; chatX: number[]; delay: number; peaks: HypePeak[]; chatMsgs: number };

/** Per-second loudness in dB from the 0.5 s RMS windows. */
export function loudDb(rms: number[], secs: number, winSec = WIN_SEC): number[] {
  const per = Math.max(1, Math.round(1 / winSec));
  return Array.from({ length: secs }, (_, t) => { const w = rms.slice(t * per, t * per + per); return 20 * Math.log10((w.length ? mean(w) : 0) + 1e-5); });
}

/** Scream/laugh proxy: how far each second jumps over the median of the 8 s before it (dB, ≥ 0). */
export function jumps(db: number[], back = 8): number[] {
  return db.map((v, t) => (t < 2 ? 0 : Math.max(0, v - median(db.slice(Math.max(0, t - back), t)))));
}

/** Audio (+ chat, when there is any) → hype curve (smoothed weighted z-scores), chat shifted earlier by the estimated delay, and the peaks. */
export function buildHype(o: { rms: number[]; voice?: number[]; chat?: ChatMsg[]; duration: number; peaks?: number }): Hype {
  const secs = Math.max(1, Math.ceil(o.duration));
  const db = loudDb(o.rms, secs), jump = jumps(db);
  const parts: HypeParts = { loud: robustZ(db), jump: robustZ(jump) };
  if (o.voice?.length) parts.voice = robustZ(Array.from({ length: secs }, (_, t) => 20 * Math.log10((o.voice![t] ?? 0) + 1e-5)));
  let delay = 0, chatX: number[] = [];
  const cs = o.chat && o.chat.length >= 20 ? chatSeries(o.chat, secs) : null; // a handful of messages says nothing
  if (cs) {
    delay = estimateDelay(smooth(cs.rate, 2), smooth(parts.jump, 1));
    const sh = (xs: number[]) => shiftEarlier(xs, delay);
    const rate = sh(cs.rate), avg = mean(rate) || 1;
    chatX = smooth(rate, 2).map((x) => x / avg); // × the stream's usual chat speed
    Object.assign(parts, { chat: robustZ(smooth(rate, 1)), uniq: robustZ(smooth(sh(cs.uniq), 1)), emote: robustZ(smooth(sh(cs.emote), 1)),
      events: sh(cs.events).map((x) => Math.min(4, x)), clip: sh(cs.clip).map((x) => Math.min(4, x)) });
  }
  const W = cs ? { loud: 0.12, jump: 0.1, voice: 0.08, chat: 0.3, uniq: 0.15, emote: 0.15, events: 0.05, clip: 0.05 }
    : { loud: 0.45, jump: 0.3, voice: 0.25 };
  const raw = Array.from({ length: secs }, (_, t) => {
    let v = 0, w = 0;
    for (const [k, wk] of Object.entries(W)) { const p = parts[k as keyof HypeParts]; if (p) { v += wk * (p[t] ?? 0); w += wk; } }
    return v / (w || 1);
  });
  const curve = smooth(raw, 2);
  const hype: Hype = { curve, parts, chatX, delay, peaks: [], chatMsgs: cs?.n ?? 0 };
  hype.peaks = findPeaks(curve, { n: o.peaks ?? 12 }).map((p) => ({ ...p, reasons: reasonsAt(hype, p.t, cs?.top) }));
  return hype;
}

/** Local maxima with enough prominence (height over the higher of the two minima within ±60 s), ≥ minGap s apart, highest first.
 *  start/end: where the curve falls under half the peak height (≤ 25 s before, ≤ 10 s after). sharp: rise over the 10 s before. */
export function findPeaks(curve: number[], o: { n?: number; minGap?: number; minProm?: number; minHeight?: number } = {}): Omit<HypePeak, "reasons">[] {
  const { n = 12, minGap = 20, minProm = 1, minHeight = 0.8 } = o, out: Omit<HypePeak, "reasons">[] = [];
  const cands: number[] = [];
  for (let i = 0; i < curve.length; i++) {
    const v = curve[i];
    if (v < minHeight) continue;
    let top = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(curve.length - 1, i + 3) && top; j++) if (curve[j] > v || (curve[j] === v && j < i)) top = false;
    if (!top) continue;
    const lmin = Math.min(...curve.slice(Math.max(0, i - 60), i + 1)), rmin = Math.min(...curve.slice(i, i + 61));
    if (v - Math.max(lmin, rmin) >= minProm) cands.push(i);
  }
  for (const i of cands.sort((a, b) => curve[b] - curve[a])) {
    if (out.length >= n) break;
    if (out.some((p) => Math.abs(p.t - i) < minGap)) continue;
    const half = curve[i] / 2;
    let a = i, b = i;
    while (a > Math.max(0, i - 25) && curve[a - 1] > half) a--;
    while (b < Math.min(curve.length - 1, i + 10) && curve[b + 1] > half) b++;
    const before = curve.slice(Math.max(0, i - 10), Math.max(1, i - 4));
    out.push({ t: i, start: a, end: b + 1, height: r2(curve[i]), sharp: r2(Math.max(0, curve[i] - mean(before))) });
  }
  return out;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const maxNear = (xs: number[] | undefined, t: number, r = 3) => (xs ? Math.max(...xs.slice(Math.max(0, t - r), t + r + 1)) : 0);

/** Plain-words why a peak is hype, strongest first (max 3). */
export function reasonsAt(h: Hype, t: number, top?: Map<number, string>): string[] {
  const out: [number, string][] = [], p = h.parts;
  const x = maxNear(h.chatX, t);
  if (x >= 2) out.push([x, `chat ${x.toFixed(1)}× normal`]);
  if (top) {
    const near = [...Array(7)].map((_, k) => top.get(t - 3 + k + h.delay)).filter(Boolean) as string[];
    const tok = near.sort((a, b) => near.filter((y) => y === b).length - near.filter((y) => y === a).length)[0];
    if (tok && maxNear(p.emote, t) >= 2) out.push([maxNear(p.emote, t), `${tok} spam`]);
  }
  const ev = p.events ? p.events.slice(Math.max(0, t - 5), t + 6).reduce((a, b) => a + b, 0) : 0;
  if (ev >= 2) out.push([ev, `${Math.round(ev)} subs/donations`]);
  const cl = p.clip ? p.clip.slice(Math.max(0, t - 5), t + 6).reduce((a, b) => a + b, 0) : 0;
  if (cl >= 2) out.push([cl + 2, `"clip it" ×${Math.round(cl)}`]);
  if (maxNear(p.jump, t) >= 2.5) out.push([maxNear(p.jump, t), "scream / laugh spike"]);
  else if (maxNear(p.loud, t) >= 2) out.push([maxNear(p.loud, t), "loud moment"]);
  return out.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, r]) => r);
}

// ---- feeding the picker ----

/** Peaks as prompt lines (data: the caller fences them). */
export const hypeLines = (peaks: HypePeak[], mmss: (s: number) => string) =>
  peaks.map((p) => `${p.t}s (${mmss(p.t)}) strength ${p.height.toFixed(1)}: ${p.reasons.join(", ") || "audio spike"}`).join("\n");

/** Transcription regions led by the hype peaks (−40 s … +15 s around each, strongest first), then the loudness regions, within `budget` s. */
export function hypeRegions(peaks: HypePeak[], regions: Span[], budget: number, duration: number): Span[] {
  const want = [...peaks.map((p) => ({ start: Math.max(0, p.t - 40), end: Math.min(duration, p.t + 15) })), ...regions];
  let out: Span[] = [];
  for (const w of want) {
    const next = mergeAll([...out, w]);
    if (next.reduce((a, x) => a + x.end - x.start, 0) <= budget) out = next;
  }
  return out;
}
const mergeAll = (xs: Span[]) => {
  const out: Span[] = [];
  for (const x of [...xs].sort((a, b) => a.start - b.start)) { const l = out[out.length - 1]; if (l && x.start <= l.end + 5) l.end = Math.max(l.end, x.end); else out.push({ ...x }); }
  return out;
};

/** Moves a moment so the strongest peak within 5 s of it is inside with room: ≥ `lead` s of build-up before it and ≥ 2.5 s of reaction after,
 *  never longer than maxSec (cut from the start, keeping the lead). Unchanged when no peak is near. */
export function alignToPeak<T extends { start: number; end: number }>(m: T, peaks: HypePeak[], maxSec: number, duration: number, lead = 3): T {
  const p = peaks.filter((x) => x.t >= m.start - 5 && x.t <= m.end + 5).sort((a, b) => b.height - a.height)[0];
  if (!p) return m;
  let { start, end } = m;
  if (p.t > end - 2.5) end = Math.min(duration, p.t + 2.5);
  if (p.t < start + lead) start = Math.max(0, p.t - lead);
  if (end - start > maxSec) start = Math.min(p.t - Math.min(lead, 1), end - maxSec);
  if (end - start > maxSec) end = start + maxSec;
  return { ...m, start: r2(start), end: r2(end) };
}

/** The peak a cut range must keep inside (with ≥ 1 s around it), if any. */
export const peakInside = (m: { start: number; end: number }, peaks: HypePeak[]) => peaks.filter((x) => x.t >= m.start && x.t <= m.end).sort((a, b) => b.height - a.height)[0];

// ---- stored on the job, for the UI ----

export type HypeView = { v: 1; bucketSec: number; curve: number[]; chat?: number[]; audio: number[]; peaks: HypePeak[]; delay: number; chatMsgs: number; chatFrom?: string; hint?: string };

/** Downsampled to ≤ maxPts buckets (bucket = its max: peaks stay visible), curve/audio 0..1, chat as × usual (capped 10). */
export function packHype(h: Hype, o: { chatFrom?: string; hint?: string } = {}, maxPts = 480): HypeView {
  const secs = h.curve.length, bucket = Math.max(1, Math.ceil(secs / maxPts));
  const down = (xs: number[]) => Array.from({ length: Math.ceil(xs.length / bucket) }, (_, i) => Math.max(...xs.slice(i * bucket, i * bucket + bucket)));
  const norm = (xs: number[]) => { const m = Math.max(1e-9, ...xs); return xs.map((x) => Math.round(Math.max(0, x / m) * 1000) / 1000); };
  return { v: 1, bucketSec: bucket, curve: norm(down(h.curve)), audio: norm(down(smooth(h.parts.loud.map((x, i) => Math.max(x, h.parts.jump[i] ?? 0)), 2))),
    ...(h.chatX.length ? { chat: down(h.chatX).map((x) => Math.round(Math.min(10, x) * 100) / 100) } : {}),
    peaks: h.peaks, delay: h.delay, chatMsgs: h.chatMsgs, ...(o.chatFrom ? { chatFrom: o.chatFrom } : {}), ...(o.hint ? { hint: o.hint } : {}) };
}
