// Honest A/B tests (pure, tested in tests/abtest.test.ts with simulated data). Anytime-valid: he can look after every new
// video and the chance of ever naming a winner when A and B are really the same stays ≤ ALPHA (5 %).
// Method: mixture sequential probability ratio test (mSPRT, Robbins 1970; Johari et al. 2017, "Always valid inference").
// A normal estimate `est` of B − A with variance V, mixed over effects N(0, tau²), gives the likelihood ratio
//   Λ = sqrt(V / (V + tau²)) · exp(est² tau² / (2 V (V + tau²)))
// and, inverted, a confidence sequence est ± halfWidth(V) that holds at every look at once. Verdicts, fixed up front:
//   better / worse  the whole interval (intersected over all looks) is above / below 0
//   same            the whole interval sits inside ±band (a difference too small to matter)
//   early           anything else, with a rough "needs ~N more" from the current spread
// Nothing is ever decided with fewer than minEach per side: never a winner from a handful of videos.

export const ALPHA = 0.05;
export type Verdict = "early" | "better" | "worse" | "same";
export type Opts = { alpha: number; tau: number; band: number; minEach: number; minVar?: number };
/** One look: estimate of B − A, its variance, how many on each side (Infinity = a known reference, e.g. one-sample). */
export type Step = { est: number; V: number; nA: number; nB: number };
export type Decision = { verdict: Verdict; est: number; lo: number; hi: number; nA: number; nB: number; p: number; more?: number; at?: number };

/** Log views (Shorts): mixing sd 0.5 (≈ ±65 %), "same" = within ±25 %, at least 5 a side. */
export const LOG_OPTS: Opts = { alpha: ALPHA, tau: 0.5, band: Math.log(1.25), minEach: 5, minVar: 0.05 };
/** Rates (worked / failed share): mixing sd 0.15, "same" = within ±5 points, at least 10 a side. */
export const RATE_OPTS: Opts = { alpha: ALPHA, tau: 0.15, band: 0.05, minEach: 10 };
export const MORE_MAX = 500;

export function logLR(est: number, V: number, tau: number): number {
  const t2 = tau * tau;
  return 0.5 * Math.log(V / (V + t2)) + (est * est * t2) / (2 * V * (V + t2));
}
export function halfWidth(V: number, tau: number, alpha = ALPHA): number {
  const t2 = tau * tau;
  return Math.sqrt(((V * (V + t2)) / t2) * (Math.log((V + t2) / V) + 2 * Math.log(1 / alpha)));
}

const inv = (n: number) => (Number.isFinite(n) ? 1 / n : 0);
const enough = (s: Step, o: Opts) => s.nA >= o.minEach && s.nB >= o.minEach && s.V > 0 && Number.isFinite(s.V) && Number.isFinite(s.est);

/** How many more (in total, over the sides that still grow) until the current estimate would settle, or Infinity. */
export function moreNeeded(s: Step, o: Opts): number {
  const sides = (Number.isFinite(s.nA) ? 1 : 0) + (Number.isFinite(s.nB) ? 1 : 0) || 1;
  const short = Math.max(0, o.minEach - Math.min(s.nA, s.nB));
  if (!(s.V > 0) || !Number.isFinite(s.est) || !(s.nA > 0 && s.nB > 0)) return Math.max(short, o.minEach) * sides;
  const base = inv(s.nA) + inv(s.nB), e = Math.abs(s.est);
  for (let m = short; m <= MORE_MAX; m++) {
    const V = (s.V * (inv(s.nA + m) + inv(s.nB + m))) / base, hw = halfWidth(V, o.tau, o.alpha);
    if (m > 0 && (e - hw > 0 || e + hw <= o.band)) return m * sides;
  }
  return Infinity;
}

/** Walks the looks in time order and stops at the first one that settles. */
export function decide(steps: Step[], o: Opts): Decision {
  let lo = -Infinity, hi = Infinity, p = 1;
  const last = steps.at(-1);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!enough(s, o)) continue;
    const hw = halfWidth(s.V, o.tau, o.alpha);
    lo = Math.max(lo, s.est - hw); hi = Math.min(hi, s.est + hw);
    p = Math.min(p, Math.exp(-logLR(s.est, s.V, o.tau)));
    const base = { est: s.est, lo, hi, nA: s.nA, nB: s.nB, p: Math.min(1, p), at: i };
    if (lo >= -o.band && hi <= o.band) return { verdict: "same", ...base };
    if (lo > 0) return { verdict: "better", ...base };
    if (hi < 0) return { verdict: "worse", ...base };
  }
  if (!last) return { verdict: "early", est: 0, lo, hi, nA: 0, nB: 0, p: 1, more: o.minEach * 2 };
  return { verdict: "early", est: last.est, lo, hi, nA: last.nA, nB: last.nB, p: Math.min(1, p), more: moreNeeded(last, o) };
}

export type MeanObs = { arm: "A" | "B"; x: number };
/** Two groups of numbers (e.g. log views), in the order they arrived: one look per new number. Pooled spread, widened and floored. */
export function meanSteps(obs: MeanObs[], minVar = 0): Step[] {
  const g = { A: { n: 0, m: 0, ss: 0 }, B: { n: 0, m: 0, ss: 0 } }, out: Step[] = [];
  for (const o of obs) {
    if (!Number.isFinite(o.x)) continue;
    const s = g[o.arm], d = o.x - s.m;
    s.n++; s.m += d / s.n; s.ss += d * (o.x - s.m);
    if (!g.A.n || !g.B.n) { out.push({ est: 0, V: NaN, nA: g.A.n, nB: g.B.n }); continue; }
    // pooled spread × df/(df−2): the t-distribution's extra width, so early looks on a guessed spread aren't over-confident
    const df = g.A.n + g.B.n - 2, pooled = Math.max(minVar, df > 2 ? ((g.A.ss + g.B.ss) / df) * (df / (df - 2)) : Infinity);
    out.push({ est: g.B.m - g.A.m, V: pooled * (1 / g.A.n + 1 / g.B.n), nA: g.A.n, nB: g.B.n });
  }
  return out;
}

export type RateObs = { arm: "A" | "B"; n: number; of: number };
/** Two rates (n good out of `of`), counts arriving in order. Variance from the pooled rate, nudged off 0 and 1. */
export function rateSteps(obs: RateObs[]): Step[] {
  const c = { A: { n: 0, of: 0 }, B: { n: 0, of: 0 } }, out: Step[] = [];
  for (const o of obs) {
    if (!(o.of > 0)) continue;
    c[o.arm].n += o.n; c[o.arm].of += o.of;
    if (!c.A.of || !c.B.of) { out.push({ est: 0, V: NaN, nA: c.A.of, nB: c.B.of }); continue; }
    const p = (c.A.n + c.B.n + 1) / (c.A.of + c.B.of + 2);
    out.push({ est: c.B.n / c.B.of - c.A.n / c.A.of, V: p * (1 - p) * (1 / c.A.of + 1 / c.B.of), nA: c.A.of, nB: c.B.of });
  }
  return out;
}

export type KnownObs = { x: number; v: number };
/** One-sample: each number is "B minus its own usual" with a known variance v (from that video's comparables). A = the usual. */
export function knownSteps(obs: KnownObs[]): Step[] {
  let P = 0, W = 0, n = 0;
  const out: Step[] = [];
  for (const o of obs) {
    if (!Number.isFinite(o.x) || !(o.v > 0)) continue;
    P += 1 / o.v; W += o.x / o.v; n++;
    out.push({ est: W / P, V: 1 / P, nA: Infinity, nB: n });
  }
  return out;
}

export type SpreadObs = { x: number; ss: number; df: number; w: number };
/** One-sample against each video's own comparables: x = log views − mean log views of its comparables (ss, df: their spread).
 *  The spread is pooled over every observation so far (one Short's 5 comparables are too few to trust alone);
 *  v = pooled × w (w = 1 + 1/comparables for one Short; 1 + 1/variants for a pair). An observation with df 0 adds no spread. */
export function pooledSteps(obs: SpreadObs[], minVar = LOG_OPTS.minVar ?? 0): Step[] {
  const ok = obs.filter((o) => Number.isFinite(o.x) && o.df >= 0 && o.ss >= 0 && o.w > 0), out: Step[] = [];
  let ss = 0, df = 0;
  for (let i = 0; i < ok.length; i++) {
    ss += ok[i].ss; df += ok[i].df;
    const s2 = Math.max(minVar, df > 2 ? (ss / df) * (df / (df - 2)) : Infinity);
    out.push(knownSteps(ok.slice(0, i + 1).map((o) => ({ x: o.x, v: s2 * o.w }))).at(-1) ?? { est: 0, V: NaN, nA: Infinity, nB: i + 1 });
  }
  return out;
}

/** Mean and spread of log views of comparable videos. null under 5. */
export function logSpread(views: number[]): { mean: number; ss: number; df: number; n: number } | null {
  const xs = views.filter((v) => Number.isFinite(v) && v >= 0).map((v) => Math.log(Math.max(1, v))), n = xs.length;
  if (n < 5) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return { mean, ss: xs.reduce((a, x) => a + (x - mean) ** 2, 0), df: n - 1, n };
}

// ---- plain words (keys live in i18n-pure: ab.early, ab.earlyMany, ab.better, ab.same) ----
export type AbKey = "ab.early" | "ab.earlyMany" | "ab.better" | "ab.same";
/** The one line he reads. a / b: the names of the two sides ("A", "B", "the usual", "this hook"). */
export function abLine(d: Decision, a = "A", b = "B"): { key: AbKey; vars: Record<string, string | number> } {
  if (d.verdict === "better") return { key: "ab.better", vars: { b } };
  if (d.verdict === "worse") return { key: "ab.better", vars: { b: a } };
  if (d.verdict === "same") return { key: "ab.same", vars: {} };
  return Number.isFinite(d.more) ? { key: "ab.early", vars: { n: Math.max(1, d.more ?? 1) } } : { key: "ab.earlyMany", vars: {} };
}
const EN_AB: Record<AbKey, string> = { "ab.early": "Too early to tell (needs ~{n} more)", "ab.earlyMany": "Too early to tell (needs many more)", "ab.better": "{b} is better (sure enough)", "ab.same": "No real difference" };
/** English text for server-side strings (prompts, findings). */
export function abText(d: Decision, a = "A", b = "B"): string {
  const { key, vars } = abLine(d, a, b);
  return EN_AB[key].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
