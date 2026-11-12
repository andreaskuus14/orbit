// Night shift v3: learns what he approves (pure, tested in tests/night-learn.test.ts). IO: night-learn.ts; used by night.ts planInput.
// Each kind of ORBIT's own night work gets a value = how often he approved or used its results (recency-weighted), as a Beta posterior.
// Thompson sampling (seeded per night) orders the work and lets kinds he keeps rejecting fade out; an EXPLORE share still tries them,
// and kinds with little history are never dropped. Pins in the night settings override the learning (autonomy "off" still wins).
// It only reorders and trims the existing queue: same budget caps, Stop-all, window and autonomy checks; no new spend path.
import type { ItemStatus, NightKind } from "./night-pure.ts";
import { translate } from "./i18n-pure.ts";

// His own asks (research), the free tidy-up and the health check always run first; only ORBIT's own initiatives are learned.
export const LEARN_KINDS = ["goal", "business", "clips", "niche", "deals", "personas"] as const satisfies readonly NightKind[];
export const NOUN: Record<string, string> = Object.fromEntries(LEARN_KINDS.map((k) => [k, translate("en", `night.noun.${k}`)])); // UI: t(`night.noun.${k}`)
const DAY = 86_400_000;
export const HALF_LIFE = 21 * DAY, MAX_AGE = 120 * DAY;
export const DROP = 0.25; // a sampled value below this skips the kind tonight…
export const EXPLORE = 0.1; // …except this share of nights (the floor: a faded kind still gets tried)
export const MIN_N = 3; // decided results before a kind can fade at all
export const LAST = 10; // the "Why tonight's plan" counts look at this many latest results

export type Outcome = { kind: NightKind; at: string; ok: boolean };
export type TaskEvent = { at: string; kind: NightKind; status: ItemStatus };
export type Pin = "on" | "off";
export type KindStat = { kind: NightKind; a: number; b: number; y: number; n: number }; // Beta(a, b); y of the last n results were good
export type Learned = { weight: Partial<Record<NightKind, number>>; drop: NightKind[]; stats: KindStat[] };

/** night.task results → one outcome per result he used: a "done" result counts as good. Approval, failed and skipped results say nothing yet. */
export function outcomes(events: TaskEvent[]): Outcome[] {
  return events.flatMap((e): Outcome[] => (e.status === "done" ? [{ kind: e.kind, at: e.at, ok: true }] : []));
}

/** Per learned kind: recency-weighted Beta(1 + good, 1 + bad) and raw counts over the last LAST results. */
export function kindStats(os: Outcome[], now: number): KindStat[] {
  return LEARN_KINDS.map((kind) => {
    const mine = os.filter((o) => o.kind === kind && now - Date.parse(o.at) <= MAX_AGE).sort((x, y) => y.at.localeCompare(x.at));
    let a = 1, b = 1;
    for (const o of mine) { const w = 0.5 ** (Math.max(0, now - Date.parse(o.at)) / HALF_LIFE); if (o.ok) a += w; else b += w; }
    const last = mine.slice(0, LAST);
    return { kind, a, b, y: last.filter((o) => o.ok).length, n: last.length };
  });
}

/** Seeded uniform [0, 1) (mulberry32 over a string hash), so a night's plan is reproducible. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let s = h >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
/** Gamma(k ≥ 1) by Marsaglia–Tsang. */
function gamma(k: number, r: () => number): number {
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = normal(r); v = 1 + c * x; } while (v <= 0);
    v = v ** 3;
    const u = r();
    if (Math.log(1 - u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
export const sampleBeta = (a: number, b: number, r: () => number) => { const x = gamma(a, r); return x / (x + gamma(b, r)); };

/** Tonight's learned weights (planNight's per-kind boost) and the kinds that sit out. Pinned on = first and never dropped; pinned off = dropped. */
export function learnPlan(stats: KindStat[], pins: Partial<Record<NightKind, Pin>>, seed: string): Learned {
  const r = rng(seed), weight: Learned["weight"] = {}, drop: NightKind[] = [];
  for (const s of stats) {
    const v = sampleBeta(s.a, s.b, r), explore = r() < EXPLORE; // both drawn every time, so a pin doesn't shift the other kinds' draws
    if (pins[s.kind] === "off") drop.push(s.kind);
    else if (pins[s.kind] === "on") weight[s.kind] = Infinity;
    else if (v < DROP && s.n >= MIN_N && !explore) drop.push(s.kind);
    else weight[s.kind] = v;
  }
  return { weight, drop, stats };
}

/** "Why tonight's plan": the best-liked kind that's in tonight's queue, and the one that faded, from the raw last-N counts. "" if nothing stands out. */
export function whyLine(l: Learned, planned: NightKind[], pins: Partial<Record<NightKind, Pin>> = {}): string {
  const fair = l.stats.filter((s) => s.n >= MIN_N && !pins[s.kind]);
  const more = fair.filter((s) => planned.includes(s.kind) && s.y / s.n >= 0.6).sort((x, y) => y.y / y.n - x.y / x.n || y.n - x.n)[0];
  const less = fair.filter((s) => l.drop.includes(s.kind)).sort((x, y) => x.y / x.n - y.y / y.n || y.n - x.n)[0];
  return [more && `More ${NOUN[more.kind]}: you approved ${more.y} of the last ${more.n}`, less && `Fewer ${NOUN[less.kind]}: you passed on ${less.n - less.y} of the last ${less.n}`]
    .filter(Boolean).join(". ");
}
