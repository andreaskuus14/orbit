// School timetable from an .ics file (pure, tested in tests/ics.test.ts): VEVENTs → the same CalEvent the Google card uses.
// Handles DTSTART/DTEND/DURATION (UTC, TZID, floating, all-day), RRULE DAILY/WEEKLY (INTERVAL, BYDAY, COUNT, UNTIL), EXDATE,
// RECURRENCE-ID overrides and STATUS:CANCELLED. Recurrence runs on the wall clock of the TZID, so 08:15 stays 08:15 over a DST change.
// shortcut: MONTHLY/YEARLY rules and RDATE are not expanded (the first occurrence still shows), upgrade if a feed needs them.
// Text fields are other people's text: plain data only, never DESCRIPTION.
import type { CalEvent } from "./gcal-pure.ts";

const DAY = 86_400_000, MAX_EVENTS = 5000, MAX_LOOP = 20_000;
export const ICS_MAX_BYTES = 1_000_000;

type Line = { name: string; params: Record<string, string>; value: string };
type When = { ms: number; wall: string; allDay: boolean; tz?: string }; // wall = "YYYYMMDDTHHMMSS" local to tz (or floating)

const unfold = (t: string) => t.replace(/\r?\n[ \t]/g, "");
const unescapeText = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? " " : c));
const clean = (v: string, max: number) => unescapeText(v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function parseLine(raw: string): Line | null {
  // the first ':' outside quotes splits name+params from value
  let q = false, i = 0;
  for (; i < raw.length; i++) { if (raw[i] === '"') q = !q; else if (raw[i] === ":" && !q) break; }
  if (i >= raw.length) return null;
  const [name, ...ps] = raw.slice(0, i).split(";"), params: Record<string, string> = {};
  for (const p of ps) { const k = p.indexOf("="); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value: raw.slice(i + 1) };
}

/** Offset (ms) of `tz` at the instant `ms`: zone wall clock minus UTC. */
const fmts = new Map<string, Intl.DateTimeFormat>();
function tzOffset(ms: number, tz: string): number {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock fields in zone `tz` (null = the server's zone) → UTC ms. In a DST gap this lands after it, in an overlap on the first pass (as most calendars do). */
function wallToMs(w: string, tz?: string): number {
  const f = [+w.slice(0, 4), +w.slice(4, 6) - 1, +w.slice(6, 8), +w.slice(9, 11) || 0, +w.slice(11, 13) || 0, +w.slice(13, 15) || 0] as const;
  if (!tz) return new Date(...f).getTime();
  const guess = Date.UTC(...f);
  return guess - tzOffset(guess - tzOffset(guess, tz), tz);
}

const validTz = (tz?: string) => { if (!tz) return undefined; try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return undefined; } };

function when(l: Line): When | null {
  const v = l.value.trim(), m = /^(\d{8})(?:T(\d{6})(Z)?)?$/.exec(v);
  if (!m) return null;
  if (!m[2]) return { ms: wallToMs(`${m[1]}T000000`), wall: `${m[1]}T000000`, allDay: true };
  const wall = `${m[1]}T${m[2]}`;
  if (m[3]) return { ms: Date.UTC(+wall.slice(0, 4), +wall.slice(4, 6) - 1, +wall.slice(6, 8), +wall.slice(9, 11), +wall.slice(11, 13), +wall.slice(13, 15)), wall, allDay: false, tz: "UTC" };
  const tz = validTz(l.params.TZID); // unknown TZID falls back to the server's zone
  return { ms: wallToMs(wall, tz), wall, allDay: false, tz };
}

const addDays = (wall: string, n: number) => { const d = new Date(Date.UTC(+wall.slice(0, 4), +wall.slice(4, 6) - 1, +wall.slice(6, 8) + n)); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${wall.slice(8)}`; };
const dayNum = (wall: string) => Date.UTC(+wall.slice(0, 4), +wall.slice(4, 6) - 1, +wall.slice(6, 8)) / DAY; // days since epoch of the wall date
const dow = (wall: string) => (dayNum(wall) + 3) % 7; // 0 = Monday (1970-01-01 was a Thursday)
const DOW = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const durMs = (s: string) => { const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim()); return m ? (m[1] === "-" ? -1 : 1) * ((+m[2] || 0) * 7 * DAY + (+m[3] || 0) * DAY + (+m[4] || 0) * 3600_000 + (+m[5] || 0) * 60_000 + (+m[6] || 0) * 1000) : 0; };

const iso = (ms: number) => new Date(ms).toISOString();
const dateStr = (wall: string) => `${wall.slice(0, 4)}-${wall.slice(4, 6)}-${wall.slice(6, 8)}`;

type Ev = { uid: string; title: string; location?: string; start: When; endMs: number; rrule?: Record<string, string>; ex: Set<string>; recId?: When; cancelled: boolean };

/** All events overlapping [from, to) as CalEvent, sorted by start. Bad lines/events are skipped, never thrown. */
export function icsEvents(text: string, from: number, to: number): CalEvent[] {
  const evs: Ev[] = [];
  let cur: Line[] | null = null;
  for (const raw of unfold(text).split(/\r?\n/)) {
    if (/^BEGIN:VEVENT$/i.test(raw)) cur = [];
    else if (/^END:VEVENT$/i.test(raw) && cur) { const e = toEv(cur); if (e) evs.push(e); cur = null; }
    else if (cur) { const l = parseLine(raw); if (l) cur.push(l); }
  }
  const moved = new Set(evs.filter((e) => e.recId).map((e) => `${e.uid}|${e.recId!.allDay ? e.recId!.wall.slice(0, 8) : e.recId!.ms}`));
  const out: CalEvent[] = [];
  const push = (e: Ev, startMs: number, wall: string) => {
    const s = e.start, endMs = startMs + (e.endMs - s.ms);
    if (!(startMs < to && Math.max(endMs, startMs + 1) > from)) return;
    const loc = e.location ? { location: e.location } : {};
    if (s.allDay) out.push({ title: e.title, start: dateStr(wall), end: dateStr(addDays(wall, Math.max(1, Math.round((e.endMs - s.ms) / DAY)))), allDay: true, ...loc });
    else out.push({ title: e.title, start: iso(startMs), end: iso(endMs), allDay: false, ...loc });
  };
  for (const e of evs) {
    if (e.cancelled || e.recId) continue; // overrides are added below
    const key = (ms: number, wall: string) => `${e.uid}|${e.start.allDay ? wall.slice(0, 8) : ms}`;
    if (!e.rrule || !/^(DAILY|WEEKLY)$/.test(e.rrule.FREQ ?? "")) { push(e, e.start.ms, e.start.wall); continue; }
    const r = e.rrule, interval = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || Infinity, weekly = r.FREQ === "WEEKLY";
    const days = weekly ? (r.BYDAY ? r.BYDAY.split(",").map((d) => DOW.indexOf(d.slice(-2))).filter((i) => i >= 0) : [dow(e.start.wall)]) : [];
    const until = r.UNTIL ? untilMs(r.UNTIL, e.start) : Infinity, t0 = e.start.wall.slice(8), base = dayNum(e.start.wall), baseWeek = Math.floor((base + 3) / 7);
    let n = 0, wall = e.start.wall.slice(0, 8);
    for (let i = 0; i < MAX_LOOP && n < count; i++, wall = addDays(wall, 1)) {
      const d = dayNum(wall);
      if (weekly ? (Math.floor((d + 3) / 7) - baseWeek) % interval !== 0 || !days.includes(dow(wall)) : (d - base) % interval !== 0) continue;
      const w = wall + t0, ms = e.start.allDay ? wallToMs(w) : wallToMs(w, e.start.tz);
      if (ms > until || ms >= to + DAY) break; // a day of slack: DST and all-day dates
      n++; // EXDATE and moved ones still count toward COUNT (RFC 5545)
      if (e.ex.has(key(ms, w)) || moved.has(key(ms, w))) continue;
      push(e, ms, w);
    }
  }
  for (const e of evs) if (e.recId && !e.cancelled) push(e, e.start.ms, e.start.wall);
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title)).slice(0, MAX_EVENTS);
}

function untilMs(v: string, s: When): number {
  const m = /^(\d{8})(?:T(\d{6})(Z)?)?$/.exec(v);
  if (!m) return Infinity;
  if (m[3]) return wallToMs(`${m[1]}T${m[2]}`, "UTC");
  return wallToMs(m[2] ? `${m[1]}T${m[2]}` : `${m[1]}T235959`, s.allDay ? undefined : s.tz);
}

function toEv(ls: Line[]): Ev | null {
  const get = (n: string) => ls.find((l) => l.name === n), ds = get("DTSTART");
  const start = ds && when(ds);
  if (!start) return null;
  const de = get("DTEND"), dur = get("DURATION"), end = de && when(de);
  const endMs = end ? end.ms : dur ? start.ms + durMs(dur.value) : start.allDay ? start.ms + DAY : start.ms;
  const ex = new Set<string>();
  for (const l of ls) if (l.name === "EXDATE") for (const v of l.value.split(",")) { const w = when({ ...l, value: v }); if (w) ex.add(`${get("UID")?.value ?? ""}|${w.allDay ? w.wall.slice(0, 8) : w.ms}`); }
  const rr = get("RRULE"), rid = get("RECURRENCE-ID");
  return {
    uid: get("UID")?.value ?? "", title: clean(get("SUMMARY")?.value ?? "", 120) || "(no title)", ...(get("LOCATION") && clean(get("LOCATION")!.value, 120) ? { location: clean(get("LOCATION")!.value, 120) } : {}),
    start, endMs: Math.max(endMs, start.ms), ex, cancelled: /^CANCELLED$/i.test(get("STATUS")?.value.trim() ?? ""),
    ...(rr && { rrule: Object.fromEntries(rr.value.split(";").map((p) => { const k = p.indexOf("="); return [p.slice(0, k).toUpperCase(), p.slice(k + 1).toUpperCase()]; })) }),
    ...(rid && { recId: when(rid) ?? undefined }),
  };
}

/** Cheap check before saving: looks like a calendar and has at least one event. */
export const looksLikeIcs = (t: string) => /BEGIN:VCALENDAR/i.test(t) && /BEGIN:VEVENT/i.test(t);
