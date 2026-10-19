// Personal virality score (pure, tested in tests/score.test.ts): per-clip features → 0-100 score with a plain-words breakdown.
// Starts from hand-set priors; once ≥ MIN_FIT published Shorts have stored features + 72 h stats, the weights are learned from them
// (ridge regression pulled toward the priors). Target: log(72 h views ÷ channel median) + a like-rate term. 50 = "your usual Short".
import { kindOf, median, type LearnRec } from "./learn-pure.ts";
import { prefOf, type Prefs } from "./autopilot-pure.ts";
import type { Playbook } from "./study-pure.ts";
import type { Hype } from "./hype-pure.ts";
import type { Word } from "./pure.ts";

export const KEYS = ["claude", "hypePeak", "hypeSharp", "chat", "audio", "hook", "length", "creator", "kind", "playbook", "novelty"] as const;
export type FKey = (typeof KEYS)[number];
export type FVec = Partial<Record<FKey, number>>; // 0..1, 0.5 = neutral; missing = no signal (counts as neutral)
export type Detail = { claude10?: number; chatX?: number; len?: number; lo?: number; hi?: number; learnedLen?: boolean; creator?: string; cm?: number; kind?: string; km?: number; similar?: string };
export type Factor = { key: FKey; text: string; pts: number }; // pts: score points this factor adds (+) or costs (−)
export type Conf = "low" | "medium" | "high";
export type Virality = { score: number; mult: number; conf: Conf; learning: boolean; n: number; x: FVec; d: Detail; up: Factor[]; down: Factor[] };
export type Model = { w: Record<FKey, number>; b: number; n: number; learned: boolean };

export const MIN_FIT = 8;
const SLOPE = 1.5; // score = 100·sigmoid(SLOPE·predicted log-performance): 2× usual ≈ 74, ½× ≈ 26
const LAMBDA = 3; // pseudo-Shorts holding each weight at its prior

/** Prior weights: predicted log-performance change from a feature going 0.5 → 1 is w/2 (hypePeak 0.45: ≈ 1.25× views). */
// Deliberately modest: a clip maxing every signal predicts ≈ 2.5× usual (score ≈ 80) until his own Shorts teach it more.
export const PRIOR: Record<FKey, number> = { claude: 0.5, hypePeak: 0.45, hypeSharp: 0.25, chat: 0.4, audio: 0.25, hook: 0.35, length: 0.3, creator: 0.5, kind: 0.3, playbook: 0.2, novelty: 0.2 };
export const priorModel = (): Model => ({ w: { ...PRIOR }, b: 0, n: 0, learned: false });

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const r2 = (x: number) => Math.round(x * 100) / 100;
const sig = (x: number) => 1 / (1 + Math.exp(-x));

// ---- features ----

const HOOK_WORDS = /\b(no way|bro|what|yo+|oh my|wait|watch|bruh|why|how|chat|nah|stop|look|dude|wtf|omg)\b/i;

/** Hook strength from the transcript's first 2.5 s: speech speed, attention words, a question, shouting. null without words there. */
export function hookStrength(words: Word[], start: number): number | null {
  const ws = words.filter((w) => w.start >= start - 0.2 && w.start < start + 2.5);
  if (!ws.length) return words.length ? 0.1 : null; // silence at the start of a transcribed clip is a weak hook, no transcript = unknown
  const text = ws.map((w) => w.text).join(" ");
  return clamp01(0.4 * Math.min(1, ws.length / 2.5 / 3.5) + (HOOK_WORDS.test(text) ? 0.25 : 0) + (/\?/.test(text) ? 0.15 : 0)
    + (ws.some((w) => w.loud) || /!|[A-Z]{4,}/.test(text) ? 0.2 : 0));
}

const BANDS: Record<string, [number, number]> = { "<20": [12, 20], "20-30": [20, 30], "30-40": [30, 40], "40+": [40, 58] };
/** His best length band (highest learned multiplier, ≥ 2 Shorts), else a generic 20–35 s. */
export function bestLength(p?: Prefs): { lo: number; hi: number; learned: boolean } {
  const best = Object.entries(p?.dims.length ?? {}).filter(([l, x]) => BANDS[l] && x.n >= 2).sort((a, b) => b[1].mult - a[1].mult)[0];
  return best && best[1].mult > 1 ? { lo: BANDS[best[0]][0], hi: BANDS[best[0]][1], learned: true } : { lo: 20, hi: 35, learned: false };
}

const toks = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 3));
/** Most similar recent title (token Jaccard), for novelty. */
export function nearest(text: string, recent: string[]): { sim: number; title?: string } {
  const a = toks(text);
  let best = { sim: 0, title: undefined as string | undefined };
  for (const t of recent) {
    const b = toks(t), inter = [...a].filter((x) => b.has(x)).length, uni = new Set([...a, ...b]).size;
    const sim = uni ? inter / uni : 0;
    if (sim > best.sim) best = { sim, title: t };
  }
  return best;
}

const multX = (m: number) => clamp01(0.5 + Math.log(m) / 1.4); // 2.7× → 1, 0.37× → 0

export type ClipIn = { start: number; end: number; score: number; title: string; hook: string; reason: string };
export type Ctx = { hype?: Hype; words: Word[]; creator: string; prefs?: Prefs; playbook?: Playbook; recent: string[]; peakAt?: number };

/** Features of one clip. Every signal that isn't there stays missing (= neutral), so a job without chat scores like before. */
export function features(c: ClipIn, ctx: Ctx): { x: FVec; d: Detail } {
  const x: FVec = {}, d: Detail = {}, len = c.end - c.start;
  const sc = c.score > 1 ? c.score / 100 : c.score;
  x.claude = clamp01(sc); d.claude10 = Math.round(sc * 100) / 10;
  const h = ctx.hype, a = Math.max(0, Math.floor(c.start)), b = Math.max(a + 1, Math.ceil(c.end));
  let peakT = ctx.peakAt;
  if (h && a < h.curve.length) {
    const seg = h.curve.slice(a, b), top = Math.max(...seg), i = a + seg.indexOf(top);
    const before = h.curve.slice(Math.max(0, i - 10), Math.max(1, i - 4));
    x.hypePeak = clamp01(top / 6); x.hypeSharp = clamp01((top - before.reduce((s, v) => s + v, 0) / (before.length || 1)) / 5);
    x.audio = clamp01(Math.max(...h.parts.loud.slice(a, b), ...h.parts.jump.slice(a, b)) / 5);
    peakT = i;
    if (h.chatX.length) {
      const cx = Math.max(...h.chatX.slice(a, b));
      x.chat = clamp01(Math.log(Math.max(1, cx)) / Math.log(8)); d.chatX = Math.round(cx * 10) / 10;
    }
  }
  const hk = hookStrength(ctx.words, c.start);
  if (hk !== null) x.hook = r2(hk);
  const L = bestLength(ctx.prefs);
  x.length = r2(len < L.lo ? clamp01(1 - (L.lo - len) / 15) : len > L.hi ? clamp01(1 - (len - L.hi) / 15) : 1);
  Object.assign(d, { len: Math.round(len), lo: L.lo, hi: L.hi, learnedLen: L.learned });
  const cp = prefOf(ctx.prefs, "creator", ctx.creator);
  if (cp && ctx.creator !== "unknown") { x.creator = r2(multX(cp.mult)); d.creator = ctx.creator; d.cm = cp.mult; }
  const kind = kindOf(`${c.reason} ${c.title} ${c.hook}`), kp = kind === "other" ? undefined : prefOf(ctx.prefs, "kind", kind);
  if (kp) { x.kind = r2(multX(kp.mult)); d.kind = kind; d.km = kp.mult; }
  const pb = ctx.playbook;
  if (pb?.n && pb.lengthSec) {
    const lenFit = 1 - Math.min(1, Math.abs(len - pb.lengthSec) / pb.lengthSec);
    const payFit = peakT !== undefined && pb.payoffAt ? 1 - Math.min(1, Math.abs((peakT - c.start) / Math.max(1, len) - pb.payoffAt) * 2.5) : lenFit;
    x.playbook = r2((lenFit + payFit) / 2);
  }
  if (ctx.recent.length) {
    const nn = nearest(`${c.title} ${c.hook}`, ctx.recent);
    x.novelty = r2(clamp01(1 - nn.sim * 1.6));
    if (nn.sim >= 0.3) d.similar = nn.title;
  }
  return { x, d };
}

// ---- model ----

const centered = (x: FVec) => KEYS.map((k) => (x[k] ?? 0.5) - 0.5);
export const predict = (m: Model, x: FVec) => m.b + centered(x).reduce((s, v, i) => s + v * m.w[KEYS[i]], 0);

/** Solves A·z = y (Gaussian elimination, partial pivoting). */
function solve(A: number[][], y: number[]): number[] {
  const n = y.length, M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

/** Ridge regression toward the priors (intercept unpenalized): minimizes Σ(y − b − x·w)² + λ·Σ(w − prior)². */
export function fitRidge(rows: { x: FVec; y: number }[], prior: Record<FKey, number> = PRIOR, lambda = LAMBDA): Model {
  const k = KEYS.length, A = Array.from({ length: k + 1 }, () => new Array<number>(k + 1).fill(0)), rhs = new Array<number>(k + 1).fill(0);
  for (const r of rows) {
    const v = [1, ...centered(r.x)];
    for (let i = 0; i <= k; i++) { rhs[i] += v[i] * r.y; for (let j = 0; j <= k; j++) A[i][j] += v[i] * v[j]; }
  }
  for (let i = 1; i <= k; i++) { A[i][i] += lambda; rhs[i] += lambda * prior[KEYS[i - 1]]; }
  const z = solve(A, rhs);
  return { b: Math.round(z[0] * 1000) / 1000, w: Object.fromEntries(KEYS.map((key, i) => [key, Math.round(z[i + 1] * 1000) / 1000])) as Record<FKey, number>, n: rows.length, learned: true };
}

/** Training rows from published Shorts that stored features: y = log(72 h views ÷ median) + 0.3·log(like rate ÷ median), clamped ±2.5. */
export function trainingRows(recs: LearnRec[]): { x: FVec; y: number }[] {
  const have = recs.filter((r) => r.feat && r.snaps["72h"]);
  const mv = median(have.map((r) => r.snaps["72h"]!.views)) || 1;
  const lr = (r: LearnRec) => { const s = r.snaps["72h"]!; return s.views ? s.likes / s.views : 0; };
  const ml = median(have.map(lr).filter((x) => x > 0));
  return have.map((r) => {
    const v = Math.log(Math.max(0.05, r.snaps["72h"]!.views / mv)), l = ml && lr(r) ? 0.3 * Math.log(Math.min(3, Math.max(1 / 3, lr(r) / ml))) : 0;
    return { x: r.feat!, y: Math.max(-2.5, Math.min(2.5, v + l)) };
  });
}

/** The learned model once ≥ MIN_FIT rows, else the priors. */
export function modelFrom(recs: LearnRec[]): Model {
  const rows = trainingRows(recs);
  return rows.length >= MIN_FIT ? fitRidge(rows) : { ...priorModel(), n: rows.length };
}

export const confOf = (m: Model): Conf => (!m.learned ? "low" : m.n < 25 ? "medium" : "high");

// ---- breakdown ----

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** One factor in plain words, worded for its direction. */
export function factorText(k: FKey, up: boolean, x: FVec, d: Detail): string {
  const range = `best ${d.lo}–${d.hi} s${d.learnedLen ? "" : ", a typical Shorts range"}`;
  switch (k) {
    case "claude": return up ? `The editor rated this moment ${d.claude10}/10` : `The editor rated this moment only ${d.claude10}/10`;
    case "hypePeak": return up ? ((x.hypePeak ?? 0) >= 0.9 ? "One of the stream's biggest hype spikes" : "A real hype spike in this clip") : "No real hype spike in this clip";
    case "hypeSharp": return up ? "The hype hits suddenly" : "The hype builds slowly, no sudden spike";
    case "chat": return up ? `Chat exploded (${d.chatX}× normal)` : `Chat stayed calm (${d.chatX}× normal)`;
    case "audio": return up ? "Loud reaction: a scream or laugh" : "Flat audio, no big reaction";
    case "hook": return up ? "Strong first 2 seconds" : "Slow start: little happens in the first 2 s";
    case "length": return up ? `Right length for your channel (${range})` : `${(d.len ?? 0) > (d.hi ?? 0) ? "Too long" : "Too short"} for your channel (${range})`;
    case "creator": return up ? `${d.creator} clips do well for you (${d.cm}×)` : `${d.creator} clips under-perform for you (${d.cm}×)`;
    case "kind": return up ? `${cap(d.kind ?? "")} moments do well for you (${d.km}×)` : `${cap(d.kind ?? "")} moments under-perform for you (${d.km}×)`;
    case "playbook": return up ? "Matches the viral playbook (length and payoff timing)" : "Off the viral playbook (length or payoff timing)";
    case "novelty": return up ? "Fresh compared with your recent uploads" : d.similar ? `Close to a recent upload: “${d.similar.slice(0, 50)}”` : "Close to a recent upload";
  }
}

/** Score + top 3 factors each way, in score points (the score with the factor vs with it neutral). */
export function scoreFrom(m: Model, x: FVec, d: Detail): Virality {
  const pred = predict(m, x), score = 100 * sig(SLOPE * pred);
  const fs = KEYS.filter((k) => x[k] !== undefined).map((k) => {
    const c = m.w[k] * ((x[k] ?? 0.5) - 0.5), pts = score - 100 * sig(SLOPE * (pred - c));
    return { key: k, pts: Math.round(pts * 10) / 10 };
  });
  const pick = (up: boolean) => fs.filter((f) => (up ? f.pts >= 1 : f.pts <= -1)).sort((a, b) => (up ? b.pts - a.pts : a.pts - b.pts)).slice(0, 3)
    .map((f) => ({ ...f, text: factorText(f.key, up, x, d) }));
  return { score: Math.round(score), mult: r2(Math.exp(pred)), conf: confOf(m), learning: !m.learned, n: m.n, x, d, up: pick(true), down: pick(false) };
}

/** Review/packaging order: the virality score, or neutral 50 for clips made before scoring. */
export const rankScore = (c: { score: number; virality?: { score: number } }) => c.virality?.score ?? Math.round(50 + ((c.score > 1 ? c.score / 100 : c.score) - 0.75) * 20); // no virality: near a usual clip (50), editor order kept; its 60-90 rubric is another scale
