// ORBIT's conservative weighted budget, not Google's current granular quota counters.
export const DAILY_UNITS = Math.max(200, Math.min(9000, Number(process.env.ORBIT_YT_DAILY_UNITS) || 4000));
export const SHARES = { herald: 0.40, scout: 0.25, niche: 0.15, manual: 0.20 } as const;
export type QuotaGroup = keyof typeof SHARES;
export type QuotaDay = { day: string; callers: Record<string, { group: QuotaGroup | "legacy"; units: number; calls: number; searches: number; dataUnits: number; analytics: number }>; notified: QuotaGroup[] };
export type QuotaLedger = { v: 1; days: QuotaDay[] };
export const pacificDay = (now: number) => new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
export const weightedCost = (endpoint: string) => endpoint === "search" ? 100 : endpoint === "analytics" ? 0 : 1;
export function today(ledger: QuotaLedger, now: number): QuotaDay {
  const day = pacificDay(now); return ledger.days.find((d) => d.day === day) ?? { day, callers: {}, notified: [] };
}
export const totalUnits = (d: QuotaDay) => Object.values(d.callers).reduce((n, c) => n + c.units, 0);
export function quotaLeft(d: QuotaDay, group: QuotaGroup, budget = DAILY_UNITS): number {
  const entries = Object.values(d.callers), used = entries.filter((c) => c.group === group).reduce((n, c) => n + c.units, 0);
  const background = entries.filter((c) => c.group !== "manual").reduce((n, c) => n + c.units, 0);
  return Math.max(0, Math.min(Math.floor(budget * SHARES[group]) - used, budget - totalUnits(d), group === "manual" ? Infinity : Math.floor(budget * 0.8) - background));
}
export function account(ledger: QuotaLedger, caller: string, group: QuotaGroup, endpoint: string, now: number): QuotaLedger {
  const d = today(ledger, now), old = d.callers[caller] ?? { group, units: 0, calls: 0, searches: 0, dataUnits: 0, analytics: 0 };
  const next = { ...d, callers: { ...d.callers, [caller]: { group, units: old.units + weightedCost(endpoint), calls: old.calls + 1,
    searches: old.searches + Number(endpoint === "search"), dataUnits: old.dataUnits + Number(endpoint !== "search" && endpoint !== "analytics"), analytics: old.analytics + Number(endpoint === "analytics") } } };
  return { v: 1, days: [...ledger.days.filter((x) => x.day !== d.day), next].sort((a, b) => a.day.localeCompare(b.day)).slice(-7) };
}
export function parseQuota(raw: string): QuotaLedger | null {
  let x; try { x = JSON.parse(raw); } catch { return null; }
  if (x?.v !== 1 || !Array.isArray(x.days)) return null;
  const dates = new Set<string>();
  for (const d of x.days) {
    if (!d || typeof d.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.day) || !d.callers || typeof d.callers !== "object" || Array.isArray(d.callers) || !Array.isArray(d.notified)) return null;
    for (const c of Object.values(d.callers) as QuotaDay["callers"][string][]) if (!c || ![...Object.keys(SHARES), "legacy"].includes(c.group) || ![c.units, c.calls, c.searches, c.dataUnits, c.analytics].every((n) => Number.isFinite(n) && n >= 0)) return null;
    if (dates.has(d.day) || d.notified.some((g: string) => !Object.hasOwn(SHARES, g))) return null;
    dates.add(d.day);
  }
  return { v: 1, days: x.days.slice(-7) };
}
export const quotaMessage = (group: QuotaGroup) => `${group === "manual" ? "Manual YouTube reserve" : `${group} YouTube share`} is used up; waiting until midnight Pacific. Cached results remain available.`;
export function quotaSummary(d: QuotaDay): string {
  return Object.entries(d.callers).sort((a, b) => b[1].units - a[1].units).map(([name, c]) => `${name}: ${c.units} budget units (${c.searches} searches, ${c.dataUnits} other Data API units, ${c.analytics} Analytics reports)`).join("; ") || "No metered calls today";
}
/** Stable discovery windows let repeated runs share search/playlist responses without losing pagination or filters. */
export const discoveryAfter = (now: number, age: number, window = 3 * 3_600_000) => new Date(Math.floor(now / window) * window - age).toISOString().replace(/\.\d{3}Z$/, "Z");
export const uniqueVideoIds = (ids: string[]) => [...new Set(ids.filter((id) => /^[\w-]{11}$/.test(id)))];
