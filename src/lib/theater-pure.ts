// THEATER capture (roadmap THE01-THE07), pure: queue + resume positions, timestamped notes for MEMORY, transcript-grounded
// answers, local seek commands, STUDIO candidate sources and player errors. No DOM; the store validates everything it reads
// back from localStorage here. Tested in tests/theater.test.ts.
import { isVideoId } from "./watch-pure.ts";
import { parseHistory, type Watched } from "./theater-history-pure.ts";

export const MAX_QUEUE = 50, MAX_POSITIONS = 200;

// ---- THE01: queue + playback positions ----
export const parseQueue = (raw: unknown): Watched[] => parseHistory(Array.isArray(raw) ? raw.map((v, i) => ({ ...v, at: (v as Watched)?.at ?? i })) : raw)
  .sort((a, b) => a.at - b.at).slice(0, MAX_QUEUE); // queue order = when added (oldest first)
export const enqueue = (q: Watched[], v: Watched): Watched[] => (!isVideoId(v.id) || q.some((x) => x.id === v.id) || q.length >= MAX_QUEUE ? q : [...q, v]);
export const dequeue = (q: Watched[], id: string) => q.filter((x) => x.id !== id);

export type Positions = Record<string, { t: number; at: number }>;
export function parsePositions(raw: unknown): Positions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const ok = Object.entries(raw as Record<string, { t?: unknown; at?: unknown }>)
    .filter(([id, p]) => isVideoId(id) && typeof p?.t === "number" && Number.isFinite(p.t) && p.t > 0 && typeof p.at === "number")
    .map(([id, p]) => [id, { t: Math.floor(p.t as number), at: p.at as number }] as const)
    .sort((a, b) => b[1].at - a[1].at).slice(0, MAX_POSITIONS);
  return Object.fromEntries(ok);
}
/** Remembers where playback is. The first 10 s and the last 20 s (finished) are not worth resuming: the entry is dropped. */
export function setPosition(p: Positions, id: string, t: number, duration: number, at: number): Positions {
  if (!isVideoId(id) || !Number.isFinite(t)) return p;
  const { [id]: _, ...rest } = p;
  if (t < 10 || (duration > 0 && t > duration - 20)) return rest;
  return parsePositions({ ...rest, [id]: { t, at } });
}
export const resumeAt = (p: Positions, id: string) => p[id]?.t ?? 0;

/** The embed: autoplay only when the owner just picked it (a restored / resumed player waits for his click: no surprise audio). */
export const embedParams = (origin: string, start: number, autoplay: boolean) =>
  new URLSearchParams({ autoplay: autoplay ? "1" : "0", rel: "0", enablejsapi: "1", origin, ...(start > 0 ? { start: String(Math.floor(start)) } : {}) });

// ---- THE02: timestamped notes / questions → MEMORY ----
export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};
export const watchLink = (id: string, t: number) => `https://www.youtube.com/watch?v=${id}${t > 0 ? `&t=${Math.floor(t)}s` : ""}`;
export type NoteKind = "note" | "question";
/** The memory body for POST /api/memories (no `url`: that would fetch YouTube's page). The text carries the title, channel and
 *  link, so it still reads right after the video is gone; tags let THEATER find the moment again. */
export function noteMemory(v: Pick<Watched, "id" | "title" | "channel">, t: number, text: string, kind: NoteKind) {
  const body = text.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!isVideoId(v.id) || !body) return null;
  const at = clock(t);
  return {
    kind: "note", title: `${kind === "question" ? "Question" : "Note"} at ${at}: ${v.title}`.slice(0, 300),
    content: `${body}\n\n${kind === "question" ? "Question" : "Note"} at ${at} in “${v.title}”${v.channel ? ` by ${v.channel}` : ""}.\n${watchLink(v.id, t)}`,
    tags: ["theater", kind, `yt:${v.id}`, `t:${Math.floor(Math.max(0, t))}`],
  };
}
/** A memory's tags → the video moment it was captured at, or null. */
export function noteMoment(tags: unknown): { id: string; t: number } | null {
  if (!Array.isArray(tags)) return null;
  const id = tags.find((x) => typeof x === "string" && x.startsWith("yt:"))?.slice(3);
  const t = Number(tags.find((x) => typeof x === "string" && /^t:\d+$/.test(x))?.slice(2) ?? 0);
  return isVideoId(id) ? { id, t } : null;
}

// ---- THE03: transcript-grounded answers ----
export type Seg = { t: number; text: string };
const TS = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*[-–]?\s*(.*)$/;
const secs = (s: string) => s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
/** Pasted / exported captions: lines starting "m:ss" or "h:mm:ss" (a line without one continues the previous segment). */
export function parseTranscript(raw: string): Seg[] {
  const out: Seg[] = [];
  for (const line of raw.slice(0, 300_000).split(/\r?\n/)) {
    const l = line.trim(), m = TS.exec(l);
    if (m) out.push({ t: secs(m[1]), text: m[2] });
    else if (l && out.length && !/^\d+$|-->/.test(l)) out[out.length - 1].text += ` ${l}`;
  }
  return out.filter((s) => s.text.trim()).sort((a, b) => a.t - b.t);
}
export type Grounded = { status: "none" | "partial" | "full"; hits: Seg[]; covered: number };
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
const STOP = new Set(["the", "and", "what", "does", "did", "when", "where", "who", "why", "how", "this", "that", "with", "about", "say", "said", "video", "mis", "kas", "kus", "kes", "miks"]);
/** Matching transcript lines only (quoted, with their real timestamps): no transcript → status "none" and no hits, never a
 *  guess from the title or thumbnail. `covered`: share of the video the transcript spans (partial when < 90 %). */
export function groundedAnswer(segs: Seg[], question: string, durationSec: number): Grounded {
  if (!segs.length) return { status: "none", hits: [], covered: 0 };
  const covered = durationSec > 0 ? Math.min(1, (segs[segs.length - 1].t + 10) / durationSec) : 1;
  const q = [...new Set(words(question).filter((w) => !STOP.has(w)))];
  const score = (s: Seg) => { const w = new Set(words(s.text)); return q.filter((x) => w.has(x)).length; };
  const hits = q.length ? segs.map((s) => [score(s), s] as const).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0] || a[1].t - b[1].t).slice(0, 3).map(([, s]) => s) : [];
  return { status: covered < 0.9 ? "partial" : "full", hits, covered };
}
/** A claim "at m:ss" is only kept when the transcript has a line within 5 s of it. */
export const claimMatches = (segs: Seg[], t: number) => segs.some((s) => Math.abs(s.t - t) <= 5);

// ---- THE04: seek by voice (pause/play/next are parseWatchControl) ----
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "half a": 0.5 };
/** Whole-utterance only, so "why did he go back to base" stays discussion. Returns the target relative ("+30"/"-10") or absolute ("=150"). */
export function parseSeek(text: string): string | null {
  const s = text.toLowerCase().replace(/[.!?,]+$/g, "").replace(/^(?:orbit,? )?(?:please )?/, "").trim();
  const abs = /^(?:go to|jump to|skip to|seek to)\s+((?:\d{1,2}:)?\d{1,2}:\d{2})$/.exec(s);
  if (abs) return `=${secs(abs[1])}`;
  if (/^(?:restart|start over|from the (?:start|beginning))$/.test(s)) return "=0";
  const rel = /^(?:(go|skip|jump|rewind|fast forward)\s+)?(back|forward|ahead)?\s*(\d+|half a|an?|one|two|three|five|ten|fifteen|twenty|thirty)\s+(seconds?|secs?|minutes?|mins?)(?:\s+(back|forward|ahead))?$/.exec(s);
  if (!rel || !(rel[1] || rel[2] || rel[5])) return null;
  const n = (/^\d+$/.test(rel[3]) ? Number(rel[3]) : NUM[rel[3]]) * (/^min/.test(rel[4]) ? 60 : 1);
  const back = rel[1] === "rewind" || rel[2] === "back" || rel[5] === "back";
  return n > 0 && n <= 6 * 3600 ? `${back ? "-" : "+"}${n}` : null;
}
export const seekTarget = (cmd: string, now: number, duration: number) => {
  const n = Number(cmd.slice(1)), t = cmd[0] === "=" ? n : now + (cmd[0] === "-" ? -n : n);
  return Math.max(0, duration > 0 ? Math.min(t, duration - 1) : t);
};

// ---- THE06: a moment → STUDIO candidate source ----
export type Candidate = { key: string; url: string; permission: string };
/** The clip factory's add-from-link body for a range of this video. Rights basis is left unset on purpose: STUDIO's production
 *  record then says it needs recording before anything can publish. key: one send per video+range. */
export function candidate(id: string, start: number, end: number, purpose: string): Candidate | string {
  if (!isVideoId(id)) return "Not a YouTube video";
  if (!(end > start) || start < 0) return "The end must be after the start";
  if (end - start > 15 * 60) return "Keep the range under 15 minutes";
  const why = purpose.replace(/[\x00-\x1f\x7f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (why.length < 3) return "Say what it is for";
  const head = `THEATER candidate ${clock(start)}–${clock(end)} of ${id}. Purpose: `, tail = ". Rights basis: not recorded (needs recording before publishing).";
  const room = 300 - head.length - tail.length;
  return { key: `${id}:${Math.floor(start)}-${Math.floor(end)}`, url: watchLink(id, 0), permission: `${head}${why.slice(0, room)}${tail}` };
}

// ---- THE07: YouTube IFrame errors ----
export type PlayerError = "embedDisabled" | "removed" | "invalid" | "html5" | "network";
/** onError codes: 2 bad id, 5 HTML5 player, 100 removed/private, 101 + 150 embedding disabled by the owner. */
export const playerError = (code: unknown): PlayerError =>
  code === 101 || code === 150 ? "embedDisabled" : code === 100 ? "removed" : code === 2 ? "invalid" : code === 5 ? "html5" : "network";
