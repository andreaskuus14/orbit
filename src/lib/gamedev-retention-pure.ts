// GAME DEV DEV06: retention from the owner's own Roblox analytics CSV export (Creator Dashboard → Download), joined to his
// release packages by date. Every number carries its dates and sample size; a cohort too young for D1/D7 stays unknown;
// nothing here says a release caused a change (windows are compared, not explained). Pure; tested in tests/gamedev-retention.test.ts.
import { no, rec, str } from "./gamedev-pure.ts";

export type DayRow = { date: string; users: number; d1?: number; d7?: number; sessions?: number; minutes?: number }; // d1/d7 as 0–1
export type FunnelStep = { step: string; users: number };
export type Retention = { game: string; importedAt: string; asOf: string; rows: DayRow[]; funnel: FunnelStep[] };

const MAX_ROWS = 400, MAX_STEPS = 20, DAY = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 4180-ish: quoted fields, doubled quotes, commas/semicolons/tabs. */
export function csvRows(text: string): string[][] {
  const first = text.split("\n", 1)[0], sep = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.trim() || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some(Boolean));
}

const toDay = (s: string) => { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ""; };
const count = (s: string) => { const n = Number(s.replace(/[\s,]/g, "")); return Number.isFinite(n) && n >= 0 ? n : NaN; };
/** "34.5%", "34.5" (percent) or "0.345" → 0.345. */
const rate = (s: string) => { if (!s) return undefined; const pct = s.includes("%"), n = Number(s.replace(/[%\s]/g, "")); if (!Number.isFinite(n) || n < 0) return undefined; const v = pct || n > 1 ? n / 100 : n; return v <= 1 ? v : undefined; };

const COLS = {
  date: /^(date|day)\b/i, users: /new (users|players)|first[- ]time|installs|cohort size|^new$/i,
  d1: /\b(d1|day ?1)\b/i, d7: /\b(d7|day ?7)\b/i, sessions: /^sessions?$|session count|total sessions/i, minutes: /session (length|time|duration)|playtime/i,
  step: /\b(step|funnel|event)\b/i, stepUsers: /\b(users|players|count)\b/i,
} as const;

/** One CSV export → day rows (retention/engagement) or funnel steps. Unmatched columns are reported, never guessed. */
export function parseExport(text: string): { rows: DayRow[]; funnel: FunnelStep[]; errors: string[]; ignored: string[] } {
  const all = csvRows(text.slice(0, 200_000)), head = all[0] ?? [], body = all.slice(1), errors: string[] = [];
  const col = (re: RegExp, not?: RegExp) => head.findIndex((h) => re.test(h) && !(not?.test(h)));
  const di = col(COLS.date);
  if (di < 0) {
    const si = col(COLS.step), ui = col(COLS.stepUsers, COLS.step);
    if (si < 0 || ui < 0) return { rows: [], funnel: [], errors: ["No Date column (retention) or Step + Users columns (funnel) found"], ignored: head };
    const funnel = body.slice(0, MAX_STEPS).flatMap((r, i) => { const u = count(r[ui] ?? ""); if (!r[si] || !Number.isFinite(u)) { errors.push(`Row ${i + 2}: needs a step and a user count`); return []; } return [{ step: r[si].slice(0, 60), users: u }]; });
    return { rows: [], funnel, errors, ignored: head.filter((_, i) => i !== si && i !== ui) };
  }
  const idx = { users: col(COLS.users), d1: col(COLS.d1), d7: col(COLS.d7), sessions: col(COLS.sessions), minutes: col(COLS.minutes) };
  if (idx.users < 0) return { rows: [], funnel: [], errors: ["No new-users column: sample sizes are required"], ignored: head };
  const seen = new Set<string>(), rows: DayRow[] = [];
  body.forEach((r, i) => {
    const date = toDay(r[di] ?? ""), users = count(r[idx.users] ?? "");
    if (!date || !Number.isFinite(users)) return void errors.push(`Row ${i + 2}: needs a date and a new-user count`);
    if (seen.has(date)) return void errors.push(`Row ${i + 2}: ${date} is listed twice`);
    if (rows.length >= MAX_ROWS) return void errors.push(`At most ${MAX_ROWS} days`);
    seen.add(date);
    const d: DayRow = { date, users };
    const d1 = rate(r[idx.d1] ?? ""), d7 = rate(r[idx.d7] ?? ""), s = count(r[idx.sessions] ?? ""), m = Number(r[idx.minutes] ?? "");
    if (idx.d1 >= 0 && d1 !== undefined) d.d1 = d1;
    if (idx.d7 >= 0 && d7 !== undefined) d.d7 = d7;
    if (idx.sessions >= 0 && Number.isFinite(s) && r[idx.sessions]) d.sessions = s;
    if (idx.minutes >= 0 && Number.isFinite(m) && m >= 0 && r[idx.minutes]) d.minutes = m;
    rows.push(d);
  });
  const used = new Set([di, ...Object.values(idx)]);
  return { rows: rows.sort((a, b) => a.date.localeCompare(b.date)), funnel: [], errors, ignored: head.filter((_, i) => !used.has(i)) };
}

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

export type Metric = { value: number | null; n: number; immature: number }; // value null = unknown; n = new users it covers; immature = users too young
export type Cohort = { release: string | null; build: string; from: string; to: string; users: number; days: number; d1: Metric; d7: Metric; sessions: number | null; minutes: number | null; small: boolean };
export const SMALL_SAMPLE = 100;

/** Day rows grouped by the release window they fall in ([release date, next release date)), oldest first.
 *  D1 counts only days with day + 1 ≤ asOf (D7: + 7) and a value in the export; otherwise the users are "immature" and the metric may stay unknown. */
export function cohorts(r: Pick<Retention, "rows" | "asOf">, releases: { id: string; build: string; at: string }[]): Cohort[] {
  const rel = [...releases].sort((a, b) => a.at.localeCompare(b.at)).map((x) => ({ ...x, day: x.at.slice(0, 10) }));
  const groups = new Map<number, DayRow[]>();
  for (const row of r.rows) {
    let k = -1;
    rel.forEach((x, i) => { if (x.day <= row.date) k = i; });
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  const metric = (rows: DayRow[], key: "d1" | "d7", lag: number): Metric => {
    let n = 0, sum = 0, immature = 0;
    for (const x of rows) {
      if (addDays(x.date, lag) > r.asOf || x[key] === undefined) { immature += x.users; continue; }
      n += x.users; sum += x[key]! * x.users;
    }
    return { value: n > 0 ? Math.round((sum / n) * 1000) / 1000 : null, n, immature };
  };
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([k, rows]): Cohort => {
    const users = rows.reduce((a, x) => a + x.users, 0), ses = rows.filter((x) => x.sessions !== undefined), mins = rows.filter((x) => x.minutes !== undefined);
    return { release: k < 0 ? null : rel[k].id, build: k < 0 ? "" : rel[k].build, from: rows[0].date, to: rows.at(-1)!.date, users, days: rows.length,
      d1: metric(rows, "d1", 1), d7: metric(rows, "d7", 7),
      sessions: ses.length ? ses.reduce((a, x) => a + x.sessions!, 0) : null,
      minutes: mins.length ? Math.round((mins.reduce((a, x) => a + x.minutes!, 0) / mins.length) * 10) / 10 : null, small: users < SMALL_SAMPLE };
  });
}

/** Funnel conversion from the step before and from the first step, in %. */
export const funnelRates = (f: FunnelStep[]) => f.map((s, i) => ({ ...s, fromPrev: i && f[i - 1].users ? Math.round((s.users / f[i - 1].users) * 100) : 100, fromStart: f[0]?.users ? Math.round((s.users / f[0].users) * 100) : 0 }));

export function cleanRetention(v: unknown, at: string, games: Set<string>): Retention | null {
  if (!rec(v)) return no(`${at} is invalid`);
  if (!games.has(v.game as string)) return null;
  const day = (x: unknown) => (typeof x === "string" && DAY.test(x) ? x : no(`${at}: dates must be YYYY-MM-DD`));
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
  const r01 = (x: unknown) => { const y = n(x); return y !== undefined && y <= 1 ? y : undefined; };
  const rows = (Array.isArray(v.rows) ? v.rows : []).slice(0, MAX_ROWS).map((x): DayRow => {
    if (!rec(x) || n(x.users) === undefined) return no(`${at}: each day needs a user count`);
    const d: DayRow = { date: day(x.date), users: n(x.users)! };
    const d1 = r01(x.d1), d7 = r01(x.d7), s = n(x.sessions), m = n(x.minutes);
    if (d1 !== undefined) d.d1 = d1; if (d7 !== undefined) d.d7 = d7; if (s !== undefined) d.sessions = s; if (m !== undefined) d.minutes = m;
    return d;
  });
  const funnel = (Array.isArray(v.funnel) ? v.funnel : []).slice(0, MAX_STEPS).flatMap((x) => (rec(x) && str(x.step, 60) && n(x.users) !== undefined ? [{ step: str(x.step, 60), users: n(x.users)! }] : []));
  const importedAt = typeof v.importedAt === "string" && Number.isFinite(Date.parse(v.importedAt)) ? new Date(v.importedAt).toISOString() : no(`${at}: import time must be a date`);
  return { game: v.game as string, importedAt, asOf: day(v.asOf), rows, funnel };
}
