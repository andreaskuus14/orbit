// Memory resurfacing for the morning briefing (pure, tested in tests/resurface.test.ts): "on this day" anniversaries first,
// else a pick among older memories that is stable for the whole local day (seeded by the date, so a refresh doesn't change it).

export type RecallIn = { id: string; title: string; kind: string; created_at: string };
export type Recall = { id: string; title: string; label: string };

const PREFERRED = new Set(["idea", "decision", "goal", "project"]);
const MONTHS = [1, 3, 6]; // plus every whole year, plus 1 week
const DAY = 86_400_000;

/** Local calendar date in `tz` as [year, month 1-12, day]. */
function ymd(t: number, tz: string): [number, number, number] {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t).split("-").map(Number);
  return [y, m, d];
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
/** `k` months after y-m-d, day clamped to the month's end (Jan 31 + 1 month = Feb 28/29). */
function addMonths([y, m, d]: [number, number, number], k: number): string {
  const yy = y + Math.floor((m - 1 + k) / 12), mm = ((m - 1 + k) % 12) + 1;
  return `${yy}-${mm}-${Math.min(d, daysIn(yy, mm))}`;
}
const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"} ago`;

/** "1 month ago" etc. when today is an exact anniversary of `then`, else null. */
export function anniversary(then: number, now: number, tz: string): string | null {
  const a = ymd(then, tz), b = ymd(now, tz), today = `${b[0]}-${b[1]}-${b[2]}`;
  const days = Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY);
  if (days === 7) return "1 week ago";
  for (const k of MONTHS) if (addMonths(a, k) === today) return n(k, "month");
  const years = b[0] - a[0];
  return years >= 1 && addMonths(a, 12 * years) === today ? n(years, "year") : null;
}

/** Rough age for a non-anniversary pick. */
export function roughAgo(then: number, now: number): string {
  const days = Math.floor((now - then) / DAY);
  return days >= 365 ? n(Math.floor(days / 365), "year") : days >= 60 ? n(Math.floor(days / 30), "month") : n(Math.floor(days / 7), "week");
}

/** FNV-1a: a stable pseudo-random order per (day, id). */
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Up to `max` memories to resurface today: anniversaries first, then a per-day stable pick among memories older than 30 days. */
export function pickRecall(mems: RecallIn[], now: number, tz: string, max = 2): Recall[] {
  const seed = ymd(now, tz).join("-");
  const pool = mems.map((m) => ({ m, t: Date.parse(m.created_at) }))
    .filter(({ m, t }) => m.kind !== "conversation" && m.title?.trim() && Number.isFinite(t) && t < now);
  const rank = (x: { m: RecallIn }) => (PREFERRED.has(x.m.kind) ? 0 : 1);
  const annis = pool.map((x) => ({ ...x, label: anniversary(x.t, now, tz) })).filter((x) => x.label)
    .sort((a, b) => rank(a) - rank(b) || a.t - b.t || a.m.id.localeCompare(b.m.id));
  const out: Recall[] = annis.slice(0, max).map(({ m, label }) => ({ id: m.id, title: m.title.trim(), label: label! }));
  if (out.length < max) {
    const taken = new Set(out.map((r) => r.id));
    const old = pool.filter((x) => now - x.t > 30 * DAY && !taken.has(x.m.id))
      .sort((a, b) => rank(a) - rank(b) || hash(seed + a.m.id) - hash(seed + b.m.id));
    out.push(...old.slice(0, max - out.length).map(({ m, t }) => ({ id: m.id, title: m.title.trim(), label: roughAgo(t, now) })));
  }
  return out;
}
