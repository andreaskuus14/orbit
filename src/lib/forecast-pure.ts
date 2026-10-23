// Goal forecast (pure, tested in tests/forecast.test.ts): from a goal's metric samples, a robust trend (Theil–Sen slope over the
// last WINDOW daily readings) and a bootstrap fan (p10/p50/p90 at the deadline) from resampled day-over-day rates. Deterministic.
// Used by GoalsPanel (fan chart + sentence) and CORE's world model (sentence only).

export type Sample = { at: string; value: number };
export type Forecast = {
  onTrack: boolean;
  projected: { p10: number; p50: number; p90: number } | null; // value at the deadline; null without deadline/target/data
  neededPerDay: number | null; // from now to the deadline
  currentPerDay: number | null; // Theil–Sen slope
  etaDate?: string; // YYYY-MM-DD when the trend reaches the target
  summary: string;
};

const DAY = 86_400_000, WINDOW = 30, SIMS = 400, MAX_DAYS = 3650;
export const MIN_DAYS = 3;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (sorted: number[], q: number) => sorted[Math.round(q * (sorted.length - 1))];
/** mulberry32: a tiny seeded PRNG so the fan is the same on every render. */
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const round = (x: number) => (Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10);
export const fmtNum = (x: number) => round(x).toLocaleString("en-US");
export const fmtRate = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : "±"}${fmtNum(Math.abs(x))}/day`;
const fmtDay = (ms: number, nowMs: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC", ...(new Date(ms).getUTCFullYear() !== new Date(nowMs).getUTCFullYear() ? { year: "numeric" } : {}) });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Last reading per UTC day, oldest first, at most WINDOW days: several readings a day would otherwise fake a trend. */
export function daily(samples: Sample[]): { t: number; v: number }[] {
  const byDay = new Map<number, { t: number; v: number }>();
  for (const s of samples) {
    const t = Date.parse(s.at);
    if (!Number.isFinite(t) || !Number.isFinite(s.value)) continue;
    const d = Math.floor(t / DAY), cur = byDay.get(d);
    if (!cur || t >= cur.t) byDay.set(d, { t, v: s.value });
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t).slice(-WINDOW);
}

/** Median of all pairwise slopes, per day: one outlier reading can't swing it. */
export function theilSen(pts: { t: number; v: number }[]): number {
  const s: number[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j].t > pts[i].t) s.push((pts[j].v - pts[i].v) / ((pts[j].t - pts[i].t) / DAY));
  return s.length ? median(s) : 0;
}

/** deadline "YYYY-MM-DD" counts to the end of that day (UTC). now: ms. */
export function forecast(samples: Sample[], target: number | undefined, deadline: string | undefined, now = Date.now()): Forecast {
  const pts = daily(samples);
  const none = (summary: string, onTrack = false): Forecast => ({ onTrack, projected: null, neededPerDay: null, currentPerDay: null, summary });
  const last = pts.at(-1);
  if (last && target !== undefined) {
    const dir0 = Math.sign(target - pts[0].v) || 1;
    if (dir0 * (last.v - target) >= 0) return none(`Target reached: ${fmtNum(last.v)} of ${fmtNum(target)}.`, true);
  }
  if (pts.length < MIN_DAYS) return none(`Not enough data yet: a forecast needs readings on ${MIN_DAYS} different days (${pts.length} so far).`);
  const cur = last!.v, slope = theilSen(pts);
  if (target === undefined) return { ...none(`Trend ${fmtRate(slope)}; set a target to get a forecast.`), currentPerDay: slope };
  const dir = Math.sign(target - pts[0].v) || 1, toward = dir * slope > 0;
  const eta = toward ? last!.t + ((target - cur) / slope) * DAY : undefined;
  const etaDate = eta !== undefined && eta - now < MAX_DAYS * DAY ? iso(eta) : undefined;
  const base = { currentPerDay: slope, ...(etaDate ? { etaDate } : {}) };
  if (!deadline || !Number.isFinite(Date.parse(`${deadline}T00:00:00Z`))) {
    return { ...base, onTrack: toward, projected: null, neededPerDay: null,
      summary: etaDate ? `At ${fmtRate(slope)} you reach ${fmtNum(target)} around ${fmtDay(eta!, now)}.` : `No progress toward ${fmtNum(target)} lately (${fmtRate(slope)}); at this pace you won't get there.` };
  }
  const end = Date.parse(`${deadline}T00:00:00Z`) + DAY, by = fmtDay(end - 1, now);
  if (end <= now) return { ...base, onTrack: false, projected: null, neededPerDay: null, summary: `The deadline (${by}) has passed at ${fmtNum(cur)} of ${fmtNum(target)}.` };
  // Bootstrap: daily rates between readings, recentred on the robust slope, drawn once per remaining day and summed.
  const rates: number[] = [];
  for (let i = 1; i < pts.length; i++) rates.push((pts[i].v - pts[i - 1].v) / ((pts[i].t - pts[i - 1].t) / DAY));
  const mid = median(rates), resid = rates.map((r) => r - mid);
  const days = Math.min(MAX_DAYS, Math.max(0, Math.round((end - last!.t) / DAY))), rand = rng(42), sums: number[] = [];
  for (let k = 0; k < SIMS; k++) { let s = 0; for (let d = 0; d < days; d++) s += slope + resid[Math.floor(rand() * resid.length)]; sums.push(cur + s); }
  sums.sort((a, b) => a - b);
  const [lo, p50, hi] = [quantile(sums, 0.1), quantile(sums, 0.5), quantile(sums, 0.9)];
  const projected = dir > 0 ? { p10: lo, p50, p90: hi } : { p10: hi, p50, p90: lo }; // p10 = the pessimistic side
  const needed = (target - cur) / Math.max(1, (end - now) / DAY), onTrack = dir * (p50 - target) >= 0;
  const pace = `you'd need ${fmtRate(needed)}, you're doing ${fmtRate(slope)}`;
  return { ...base, onTrack, projected, neededPerDay: needed,
    summary: onTrack
      ? `On track: at your current pace you reach ~${fmtNum(p50)} of ${fmtNum(target)} by ${by}${etaDate ? ` (target around ${fmtDay(eta!, now)})` : ""}; ${pace}.`
      : `At your current pace you reach ~${fmtNum(p50)} of ${fmtNum(target)} by ${by}; ${pace}.` };
}
