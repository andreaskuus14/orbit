// Audio-event tagging for clip moments (pure parts; tested in tests/audio-events.test.ts). audio-events.ts downloads the model and runs it
// in a child process (audio-events-worker.mjs over asr-pool's createPool), never in the server.
// Model: sherpa-onnx's "zipformer small audio tagging" (icefall Zipformer trained on AudioSet, 527 classes, int8 = 27 MB), from
// k2-fsa/sherpa-onnx's audio-tagging-models release. License: Apache-2.0 (the model card's README front matter says `license: apache-2.0`;
// sherpa-onnx itself is Apache-2.0). Note the training data is Google's AudioSet (YouTube clips); the released weights carry no extra terms.
// Not CED: its code is GPL-3.0. Per second of the video this yields "how sure the tagger is that laughter / screaming / cheering /
// applause / a gasp / an explosion or gunshot is going on", fed to moments-pure.ts as the `event` signal.
import type { Span } from "./pure.ts";

export const AUDIO_EVENTS = {
  dir: "zipformer-small-audio-tagging-2024-04-15",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-zipformer-small-audio-tagging-2024-04-15.tar.bz2",
  sha256: "07e2fafcdcbc461f2816188d9b0bbafced12584030cf67d5652e549ef256a2c6", // the whole archive (111 MB: fp32 + int8 + test wavs); only the int8 files are unpacked
  bytes: 111_034_072,
  archiveDir: "sherpa-onnx-zipformer-small-audio-tagging-2024-04-15",
  files: ["model.int8.onnx", "class_labels_indices.csv"],
  license: "Apache-2.0",
} as const;

/** ORBIT_AUDIO_EVENTS=0 switches the tagger off. */
export const wantAudioEvents = (env: string | undefined) => !/^(0|off|false|no)$/i.test((env ?? "").trim());

export const WIN_SEC = 2; // each tagged window
export const HOP_SEC = 1; // window start step: a per-second curve
export const PIECE_SEC = 60; // audio per worker request (bounded memory, a cancel point)
export const BUDGET_MS = 3 * 60_000; // wall-clock limit for the whole video; what isn't tagged by then is just "unknown" (the signal drops out there)
export const MIN_PROB = 0.03; // the worker drops per-class probabilities below this

export type EventGroup = "laughter" | "scream" | "cheer" | "applause" | "gasp" | "explosion";
// AudioSet display names (class_labels_indices.csv) per group. weight: how much a certain tag counts in the per-second curve.
export const EVENT_GROUPS: Record<EventGroup, { labels: string[]; weight: number; word: string }> = {
  laughter: { labels: ["Laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle, chortle"], weight: 1, word: "laughter" },
  scream: { labels: ["Screaming", "Yell", "Shout", "Battle cry"], weight: 0.9, word: "screaming" }, // plain "Shout"/"Yell" are common in speech: a bit less
  cheer: { labels: ["Cheering", "Whoop"], weight: 1, word: "cheering" },
  applause: { labels: ["Applause", "Clapping"], weight: 1, word: "applause" },
  gasp: { labels: ["Gasp"], weight: 0.8, word: "a gasp" },
  explosion: { labels: ["Explosion", "Boom", "Gunshot, gunfire", "Machine gun", "Fusillade", "Artillery fire", "Cap gun"], weight: 0.9, word: "explosion / gunfire" },
};
export const EVENT_KEYS = Object.keys(EVENT_GROUPS) as EventGroup[];

/** class_labels_indices.csv (`index,mid,display_name` with quoted names) → class index → group, for the classes we use. */
export function parseLabelMap(csv: string): Map<number, EventGroup> {
  const byName = new Map<string, EventGroup>();
  for (const g of EVENT_KEYS) for (const l of EVENT_GROUPS[g].labels) byName.set(l, g);
  const out = new Map<number, EventGroup>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const m = /^(\d{1,4}),[^,]*,"?(.*?)"?$/.exec(line.trim());
    const g = m && byName.get(m[2]);
    if (m && g) out.set(Number(m[1]), g);
  }
  return out;
}

/** Tagger config for the worker. `dir` = the unpacked model folder. */
export function audioEventsConfig(dir: string, threads: number, join: (...p: string[]) => string) {
  return { model: { zipformer: { model: join(dir, "model.int8.onnx") }, numThreads: Math.max(1, Math.min(4, threads)), provider: "cpu", debug: 0 }, labels: join(dir, "class_labels_indices.csv"), topK: 527 };
}

/** What the worker sends back: one entry per window, [start s within the piece, [[class index, probability], ...]]. */
export type RawWins = [number, [number, number][]][];
export type EventWin = { t: number; p: Partial<Record<EventGroup, number>> };

/** Worker windows → per-group probabilities (the best class of each group), `offset` moving the piece onto the video's clock.
 *  Anything malformed is skipped, never thrown on. */
export function parseWins(raw: unknown, labels: Map<number, EventGroup>, offset = 0): EventWin[] {
  if (!Array.isArray(raw)) return [];
  const out: EventWin[] = [];
  for (const w of raw.slice(0, 20_000)) {
    if (!Array.isArray(w) || typeof w[0] !== "number" || !Number.isFinite(w[0]) || !Array.isArray(w[1])) continue;
    const p: EventWin["p"] = {};
    for (const e of w[1].slice(0, 600)) {
      if (!Array.isArray(e) || typeof e[1] !== "number" || !(e[1] >= 0)) continue;
      const g = labels.get(e[0]);
      if (g) p[g] = Math.min(1, Math.max(p[g] ?? 0, e[1]));
    }
    out.push({ t: w[0] + offset, p });
  }
  return out;
}

/** Spans → pieces of ≤ PIECE_SEC. Consecutive pieces overlap by WIN_SEC - HOP_SEC so no window start is lost at a seam. */
export function eventPieces(spans: Span[], seg = PIECE_SEC): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const s of spans) for (let t = Math.floor(s.start); t + WIN_SEC <= s.end; t += seg - (WIN_SEC - HOP_SEC)) out.push({ from: t, to: Math.min(Math.ceil(s.end), t + seg) });
  return out;
}

export type EventCurve = { curve: number[]; top: Map<number, EventGroup> };

/** Windows → per second: the highest weighted group probability among the windows covering that second, and which group it was.
 *  NaN = not tagged (outside the spans, or out of time): "unknown here", so the signal drops out there. null when nothing was tagged. */
export function eventCurve(wins: EventWin[], secs: number): EventCurve | null {
  const curve = new Array<number>(secs).fill(NaN), top = new Map<number, EventGroup>();
  let any = false;
  for (const w of wins) {
    let best = 0, bg: EventGroup | undefined;
    for (const g of EVENT_KEYS) { const v = (w.p[g] ?? 0) * EVENT_GROUPS[g].weight; if (v > best) { best = v; bg = g; } }
    for (let t = Math.floor(w.t); t < Math.min(secs, Math.ceil(w.t + WIN_SEC)); t++) {
      if (t < 0) continue;
      any = true;
      if (!(curve[t] >= best)) { curve[t] = best; if (bg) top.set(t, bg); else top.delete(t); }
    }
  }
  return any ? { curve, top } : null;
}

/** "laughter 3.2× avg": the strongest event in [a, b) over the tagged average (floored, so a mostly silent video doesn't turn 0.3 into 30×).
 *  Null unless the tagger is fairly sure (≥ 0.3) and it stands out (≥ 1.5×). */
export function eventReason(curve: number[], top: Map<number, string>, a: number, b: number): { x: number; text: string } | null {
  let m = 0, at = -1, sum = 0, n = 0;
  for (const v of curve) if (Number.isFinite(v)) { sum += v; n++; }
  for (let t = Math.max(0, a); t < Math.min(curve.length, b); t++) if (curve[t] > m) { m = curve[t]; at = t; }
  if (at < 0 || m < 0.3 || !n) return null;
  const x = m / Math.max(0.05, sum / n), g = top.get(at) as EventGroup | undefined;
  return x >= 1.5 && g ? { x, text: `${EVENT_GROUPS[g]?.word ?? g} ${x.toFixed(1)}× avg` } : null;
}
