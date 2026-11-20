// Reach baselines: a capped daily history per watched source key, so "hot" means far above that source's own normal.
// Pure (no I/O); the history file is read/written in ./history.ts. Tested in tests/reach-baseline.test.ts.
export const HISTORY_DAYS = 30; // snapshots kept per key
export const BASELINE_DAYS = 14; // window the "normal" is computed from
export const MIN_DAYS = 5; // fewer prior days than this: "learning", today's batch rule applies
export const MAX_KEYS = 120; // sources kept in the file (stalest dropped)
export const Z_HOT = 3; // robust deviations above normal
export const RATIO_HOT = 2; // and at least this many times normal

/** day: local YYYY-MM-DD. q: the day's typical-top rate (75th percentile of the items' per-hour rates, max over the day's scans). */
export type DaySnap = { day: string; q: number };
export type History = Record<string, DaySnap[]>;
export type Baseline = { median: number; mad: number; days: number; learning: boolean };
export type Hotness = { ratio: number; z: number; learning: boolean; days: number };

/** Stable key per watched source: a subreddit / channel, or the whole source where items carry no watched name (Bluesky). */
export const sourceKey = (i: { source: string; channel?: string }): string =>
  i.source === "bsky" ? "bsky" : `${i.source}:${(i.channel ?? "").toLowerCase()}`;

const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const quantile = (xs: number[], p: number): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** Robust normal from the snapshots of days BEFORE `today` within the 14-day window: median and MAD. */
export function baselineFor(snaps: DaySnap[] | undefined, today: string): Baseline {
  const prior = (snaps ?? []).filter((s) => s.day < today).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, BASELINE_DAYS);
  const med = median(prior.map((s) => s.q));
  return { median: med, mad: median(prior.map((s) => Math.abs(s.q - med))), days: prior.length, learning: prior.length < MIN_DAYS || med <= 0 };
}

/** How far above normal a rate is. z uses 1.4826×MAD, floored at 15% of the median so a very steady source doesn't make every wobble "extreme". */
export function hotness(perHour: number, b: Baseline): Hotness {
  if (b.learning) return { ratio: 0, z: 0, learning: true, days: b.days };
  const sigma = Math.max(1.4826 * b.mad, 0.15 * b.median);
  return { ratio: Math.round((perHour / b.median) * 10) / 10, z: Math.round(((perHour - b.median) / sigma) * 10) / 10, learning: false, days: b.days };
}
export const isHotVsNormal = (h: Hotness): boolean => !h.learning && h.z >= Z_HOT && h.ratio >= RATIO_HOT;

/** Folds one scan into the history: per key, today's q = the max of the scan's q and any earlier scan today; old days and extra keys are dropped. */
export function recordScan(hist: History, rates: Map<string, number[]>, today: string): History {
  const out: History = {};
  for (const [k, v] of Object.entries(hist)) out[k] = v.filter((s) => s.day !== today);
  const todays = new Map(Object.entries(hist).map(([k, v]) => [k, v.find((s) => s.day === today)?.q ?? 0]));
  for (const [k, rs] of rates) {
    if (!rs.length) continue;
    out[k] = [...(out[k] ?? []), { day: today, q: Math.max(todays.get(k) ?? 0, quantile(rs, 0.75)) }];
  }
  for (const k of Object.keys(out)) {
    out[k] = out[k].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-HISTORY_DAYS);
    if (!out[k].length) delete out[k];
  }
  const keys = Object.keys(out).sort((a, b) => (out[b].at(-1)!.day < out[a].at(-1)!.day ? -1 : out[b].at(-1)!.day > out[a].at(-1)!.day ? 1 : 0));
  for (const k of keys.slice(MAX_KEYS)) delete out[k];
  return out;
}

/** Stored file → history; anything malformed is dropped entry by entry. */
export function parseHistory(raw: unknown): History {
  const out: History = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_KEYS)) {
    if (k.length > 80 || !Array.isArray(v)) continue;
    const snaps = v.filter((s): s is DaySnap => !!s && typeof s === "object" && typeof (s as DaySnap).day === "string" && /^\d{4}-\d{2}-\d{2}$/.test((s as DaySnap).day)
      && Number.isFinite((s as DaySnap).q) && (s as DaySnap).q >= 0).map((s) => ({ day: s.day, q: Math.round(s.q) }));
    if (snaps.length) out[k] = snaps.slice(-HISTORY_DAYS);
  }
  return out;
}

/** "3.4× its usual" or "learning (2/5 days)". */
export const hotLine = (h: Hotness): string => (h.learning ? `learning (${h.days}/${MIN_DAYS} days)` : `${h.ratio}× its usual`);
