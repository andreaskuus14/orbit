import path from "node:path";

// Pure helpers for the Clip Factory (no I/O), unit-tested in tests/clips.test.ts.

export type Word = { start: number; end: number; text: string };
export type Moment = { start: number; end: number; title: string; hook: string; reason: string; score: number };
export type Candidate = { start: number; end: number; score: number };

export const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];
export const MAX_SOURCE_SEC = 3 * 3600;
export const MIN_CLIP_SEC = 15;
export const WIN_SEC = 0.5;
export const SAMPLE_RATE = 16_000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
    let score = Number(r.score);
    if (!Number.isFinite(score)) score = 0.5;
    else if (score > 1) score /= 100; // some replies use 0..100
    const title = str(r.title, 70) || `Clip at ${mmss(start)}`;
    const hook = str(r.hook, 60).split(" ").slice(0, 6).join(" ").slice(0, 40).trim();
    out.push({ start, end, title, hook, reason: str(r.reason, 300), score: Math.round(clamp(score, 0, 1) * 100) / 100 });
  }
  return removeOverlaps(out).slice(0, o.count);
}

/** Fallback when Claude is unavailable: top candidates with generic titles. */
export function fallbackMoments(cands: Candidate[], count: number): Moment[] {
  return cands.slice(0, count).map((c, i) => ({
    start: c.start, end: c.end, score: c.score, title: `Highlight ${i + 1} (${mmss(c.start)})`, hook: "Wait for this", reason: "Loudest, most active stretch",
  }));
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

export function captionLines(words: Word[]): Word[] {
  const lines: Word[] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ") }); cur = []; };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    const breakHere = !next || cur.length >= 4 || (cur.length >= 2 && (chars > 16 || /[.!?,;:]$/.test(w.text) || next.start - w.end > 0.6));
    if (breakHere) flush();
  });
  return lines;
}

const CHERRY_ASS = "&H00632EFF"; // #ff2e63 as &HAABBGGRR

/** Subtitle file for one clip: the hook on top for the first 2.5 s, then word-timed captions lower-middle. Times are clip-relative. */
export function buildAss(o: { hook: string; words: Word[]; duration: number }): string {
  const ev: string[] = [];
  if (o.hook.trim()) ev.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(2.5, o.duration))},Hook,,0,0,0,,${assText(o.hook).toUpperCase()}`);
  const lines = captionLines(cleanWords(o.words));
  lines.forEach((l, i) => {
    // Never overlap: libass stacks simultaneous captions into a wall of text, so each line ends where the next begins.
    const start = Math.max(0, l.start), next = lines[i + 1]?.start ?? Infinity;
    const end = Math.min(o.duration, Math.max(l.end, start + 0.3), next);
    if (end - start < 0.05 || start >= o.duration) return;
    // A single long word ("CONGRATULATIONS!") can't wrap and would run off a 1080 px wide screen: shrink the line to fit ~13 chars.
    const long = Math.max(...l.text.split(" ").map((w) => w.length));
    ev.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${long > 13 ? `{\\fs${Math.floor((88 * 13) / long)}}` : ""}${assText(l.text).toUpperCase()}`);
  });
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Cap,Arial,88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,2,2,60,60,560,1",
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

/** 1080x1920: blurred, darkened cover copy behind the clip scaled to fit. Blur at quarter size, it's far cheaper. */
export function verticalFilter(ass?: string): string {
  // The ass filter's path is parsed by the filter-graph syntax; ffmpeg runs with cwd = the clip folder so a bare safe name suffices.
  if (ass !== undefined && !/^[\w.-]+\.ass$/.test(ass)) throw new Error("unsafe ass file name");
  return "[0:v]split=2[bg0][fg0];" +
    "[bg0]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:2,scale=1080:1920,setsar=1,eq=brightness=-0.28[bg];" +
    "[fg0]scale=1080:1920:force_original_aspect_ratio=decrease,setsar=1[fg];" +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p${ass ? `,ass=${ass}` : ""}[v]`;
}

export const renderArgs = (o: { input: string; start: number; duration: number; ass?: string; out: string }) => [
  "-hide_banner", "-nostdin", "-y", "-ss", sec(o.start), "-t", sec(o.duration), ...IN, o.input,
  "-filter_complex", verticalFilter(o.ass), "-map", "[v]", "-map", "0:a:0?",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", "30",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", o.out,
];

export const frameArgs = (input: string, at: number, out: string) =>
  ["-hide_banner", "-nostdin", "-y", "-ss", sec(at), ...IN, input, "-filter_complex", verticalFilter(), "-map", "[v]", "-frames:v", "1", "-q:v", "2", out];

// ---- yt-dlp ("Add from link") ----

export { cleanPermission, parseClipUrl } from "./format.ts";

export const YTDLP_FILE_MARK = "ORBIT_FILE=";

/** yt-dlp argv (spawned without a shell, cwd = inbox). The URL is always the last element, after "--", so it can't be read as an option. */
export const ytdlpArgs = (url: string, ffmpegDir: string) => [
  "--ignore-config", // cwd is the inbox: a dropped yt-dlp.conf there could otherwise add --exec etc.
  "--encoding", "utf-8", // printed paths must decode as UTF-8 even under a non-UTF-8 Windows code page
  "--no-playlist", "--no-part", "--no-mtime", "--restrict-filenames", "--newline", "--progress",
  "--max-downloads", "1", // a channel/playlist page would otherwise pull every video into the inbox
  "--match-filter", "duration<=10800 & !is_live", "--max-filesize", "4G",
  "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b", "--merge-output-format", "mp4",
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
  [/does not pass filter|is live|live event|currently live|premieres in/i, "Live streams and videos over 3 hours can't be downloaded; wait for the finished VOD (up to 3 h)."],
  [/larger than max-filesize/i, "The video is bigger than 4 GB."],
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

/** Clip options from a request body (defaults 5 clips, 45 s, captions) or an error message. */
export function validOptions(b: Record<string, unknown>): { count: number; maxSec: number; captions: boolean } | string {
  const { count = 5, maxSec = 45, captions = true } = b;
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 10) return "count must be 1-10";
  if (!Number.isInteger(maxSec) || (maxSec as number) < 15 || (maxSec as number) > 120) return "maxSec must be 15-120";
  if (typeof captions !== "boolean") return "captions must be a boolean";
  return { count: count as number, maxSec: maxSec as number, captions };
}

export const isJobId = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(s);
export const isDownloadId = (s: unknown): s is string => typeof s === "string" && /^dl-[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(s);
export const isClipId = (s: unknown): s is string => typeof s === "string" && /^clip-\d{1,2}$/.test(s);

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
