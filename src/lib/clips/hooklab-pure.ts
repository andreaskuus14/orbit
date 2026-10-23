// Hook lab (pure, tested in tests/hooklab.test.ts): three alternative openings of one clip, ranked from data before the owner picks.
// Rendering goes through startVersion (no re-transcribing); publishing still needs the owner's click.
import { clipLoudness, editPlan, type Analysis, type VersionReq } from "./pure.ts";
import { hookLen, hookStyle, results48, type LearnRec } from "./learn-pure.ts";
import type { Clip, ClipJob, VersionEdit } from "./types";

export const PATTERNS = ["cold-open", "first-word", "new-hook"] as const;
export type Pattern = (typeof PATTERNS)[number];
export const LABEL: Record<Pattern, "A" | "B" | "C"> = { "cold-open": "A", "first-word": "B", "new-hook": "C" };
export const PATTERN_TEXT: Record<Pattern, string> = { "cold-open": "cold open from the loudest peak", "first-word": "starts on the first spoken word", "new-hook": "different hook text" };
export type HookLab = { of: string; label: "A" | "B" | "C"; pattern: Pattern; at: string }; // stored on each variant clip

type Tally = { worked: number; flopped: number };
export type HookLabState = { v: 1; patterns: Record<Pattern, Tally>; counted: string[] }; // counted: video ids already recorded
export const emptyHookLab = (): HookLabState => ({ v: 1, patterns: { "cold-open": { worked: 0, flopped: 0 }, "first-word": { worked: 0, flopped: 0 }, "new-hook": { worked: 0, flopped: 0 } }, counted: [] });

const isN = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
/** "" when hooklab.json is usable (readState quarantines it otherwise). */
export function hookLabProblem(x: unknown): string {
  const s = x as HookLabState;
  if (!s || s.v !== 1 || !s.patterns || !Array.isArray(s.counted) || !s.counted.every((id) => typeof id === "string")) return "not a hook lab state";
  return PATTERNS.every((p) => isN(s.patterns[p]?.worked) && isN(s.patterns[p]?.flopped)) ? "" : "bad pattern counts";
}

/** Start shift (s) for variant B: the first word starting after the opening's loudest point, kept 1..2 s in. */
export function firstWordShift(a: Analysis, c: { start: number; end: number }): number {
  const pts = clipLoudness(a.rms, c.start, c.end).filter((p) => p.t < 2);
  const peak = pts.reduce((b, p) => (p.v > b.v ? p : b), { t: 0, v: -1 }).t;
  const w = a.words.find((w) => w.start - c.start >= Math.max(1, peak) && w.start - c.start <= 2);
  return Math.round((w ? Math.max(1, w.start - c.start - 0.05) : 1) * 100) / 100;
}

/** The three version requests (A cold open, B first word, C new hook/title). C takes the best unused title option, Claude suggests the hook. */
export function hookLabPlan(c: Clip, a: Analysis): { pattern: Pattern; req: VersionReq }[] {
  const title = [...(c.titleOptions ?? [])].sort((x, y) => y.score - x.score).find((o) => o.text !== c.title)?.text;
  return [
    { pattern: "cold-open", req: { edit: { coldOpen: true }, dStart: 0, dEnd: 0, suggest: false } },
    { pattern: "first-word", req: { edit: { coldOpen: false }, dStart: firstWordShift(a, c), dEnd: 0, suggest: false } },
    { pattern: "new-hook", req: { edit: {}, ...(title ? { title } : {}), dStart: 0, dEnd: 0, suggest: true } },
  ];
}

// ---- scoring ----

const rate = (t: Tally) => (t.worked + 1) / (t.worked + t.flopped + 2); // Laplace: no data = 0.5
export type HookPrior = { style: Record<string, Tally>; len: Record<string, Tally> };
/** Worked vs flopped (48 h, against the channel median) by hook style and hook length. */
export function hookPrior(recs: LearnRec[]): HookPrior {
  const p: HookPrior = { style: {}, len: {} };
  for (const r of results48(recs)) {
    if (!r.verdict) continue;
    for (const [m, k] of [[p.style, hookStyle(r.hook)], [p.len, hookLen(r.hook)]] as const) (m[k] ??= { worked: 0, flopped: 0 })[r.verdict]++;
  }
  return p;
}

export type Variant = { id: string; label: string; pattern: Pattern; hook: string; start: number; end: number; edit: VersionEdit };
export type Scored = Variant & { score: number; parts: { hook: number; pattern: number; loud: number; words: number }; why: string[] };
const W = { hook: 0.3, pattern: 0.15, loud: 0.3, words: 0.25 };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const tallyText = (t: Tally | undefined) => (t ? `${t.worked} worked, ${t.flopped} flopped` : "no data yet");

export function scoreVariant(v: Variant, a: Analysis, prior: HookPrior, lab: HookLabState): Scored {
  const dur = v.end - v.start, pts = clipLoudness(a.rms, v.start, v.end);
  const local = a.words.filter((w) => w.start >= v.start && w.end <= v.end).map((w) => ({ ...w, start: w.start - v.start, end: w.end - v.start }));
  const plan = editPlan(local, pts, dur, a.hasAudio, { ...v.edit, captions: true });
  const t0 = plan.teaser?.start ?? plan.segs[0]?.start ?? 0, max = Math.max(0, ...pts.map((p) => p.v));
  const first = pts.filter((p) => p.t >= t0 && p.t < t0 + 1);
  const loud = max > 0 && first.length ? first.reduce((s, p) => s + p.v, 0) / first.length / max : 0;
  const n = plan.words.filter((w) => w.start < 2).length, words = Math.min(n, 5) / 5;
  const style = hookStyle(v.hook), len = hookLen(v.hook), st = prior.style[style], ln = prior.len[len];
  const hook = (rate(st ?? { worked: 0, flopped: 0 }) + rate(ln ?? { worked: 0, flopped: 0 })) / 2, pattern = rate(lab.patterns[v.pattern]);
  const parts = { hook, pattern, loud, words };
  return { ...v, parts, score: Math.round(Object.entries(W).reduce((s, [k, w]) => s + w * parts[k as keyof typeof W], 0) * 1000) / 1000,
    why: [`first second at ${pct(loud)} of the clip's peak loudness`, `${n} word${n === 1 ? "" : "s"} in the first 2 s`,
      `${style} hooks: ${tallyText(st)}; ${len}-word hooks: ${tallyText(ln)}`, `${PATTERN_TEXT[v.pattern]}: ${tallyText(lab.patterns[v.pattern])} in past labs`] };
}

/** Best first; the winner's reason names where it beats the runner-up. */
export function rankHookLab(vs: Variant[], a: Analysis, prior: HookPrior, lab: HookLabState): { ranked: Scored[]; winner?: string; why: string } {
  const ranked = vs.map((v) => scoreVariant(v, a, prior, lab)).sort((x, y) => y.score - x.score);
  const [w, r] = ranked;
  if (!w) return { ranked, why: "" };
  const edges = r ? (Object.keys(W) as (keyof typeof W)[]).filter((k) => W[k] * (w.parts[k] - r.parts[k]) > 0.01) : [];
  const name = { hook: "hook style/length record", pattern: "pattern record", loud: "louder first second", words: "more words in the first 2 s" };
  return { ranked, winner: w.id, why: r ? `${w.label} (${PATTERN_TEXT[w.pattern]}) leads ${r.label} by ${Math.round((w.score - r.score) * 100)} pts${edges.length ? `: ${edges.map((k) => name[k]).join(", ")}` : ""}.`
    : `${w.label} is the only rendered variant so far.` };
}

// ---- learning which pattern wins ----

export type Outcome = { videoId: string; pattern: Pattern; verdict: "worked" | "flopped" };
/** Published hook-lab variants that have a 48 h verdict. */
export function labOutcomes(jobs: ClipJob[], recs: LearnRec[]): Outcome[] {
  const v = new Map(results48(recs).map((r) => [r.videoId, r.verdict]));
  return jobs.flatMap((j) => j.clips.flatMap((c): Outcome[] => {
    const id = c.publish?.videoId, verdict = id ? v.get(id) : null;
    return c.hookLab && id && verdict ? [{ videoId: id, pattern: c.hookLab.pattern, verdict }] : [];
  }));
}

/** Each video counts once; returns the same object when nothing is new (no write needed). */
export function recordOutcomes(s: HookLabState, outs: Outcome[]): HookLabState {
  const seen = new Set(s.counted), fresh = outs.filter((o) => PATTERNS.includes(o.pattern) && !seen.has(o.videoId) && seen.add(o.videoId));
  if (!fresh.length) return s;
  const patterns = Object.fromEntries(PATTERNS.map((p) => [p, { ...s.patterns[p] }])) as HookLabState["patterns"];
  for (const o of fresh) patterns[o.pattern][o.verdict]++;
  return { v: 1, patterns, counted: [...s.counted, ...fresh.map((o) => o.videoId)] };
}
