// SCHOOL planner (pure, tested in tests/school.test.ts). IO: school.ts (<data dir>/school.json, local only), API: /api/school,
// UI: LIFE → School (SchoolPanel.tsx). Courses, assignments / studio deadlines with hour estimates, and exams. ORBIT plans work
// blocks backwards from each deadline (as late as possible, with a buffer) into his free time: his study window, never quiet
// hours (23-08), never on top of calendar events / focus blocks (busy). Warns when a week gets too heavy; one brief line a morning.
// All times are the server's local time (ORBIT runs on his PC).

export const KINDS = ["assignment", "studio", "exam"] as const;
export type Kind = (typeof KINDS)[number];
export type Course = { id: string; name: string };
export type ArchLink = { at: string; parts: number; scene: { parts: unknown[] } & Record<string, unknown> };
export type SchoolItem = { id: string; courseId: string; kind: Kind; title: string; due: string; hours: number; done?: boolean; prepped?: string; arch?: ArchLink };
export type Settings = { weekday: [string, string]; weekend: [string, string]; maxDay: number; maxWeek: number; bufferDays: number };
export type SchoolStore = { courses: Course[]; items: SchoolItem[]; settings: Settings };
export type Busy = { start: number; end: number };
export type Block = { itemId: string; start: number; end: number };
export type WeekLoad = { week: string; hours: number; deadlines: number; short: number; over: boolean };
export type Plan = { blocks: Block[]; short: Record<string, number>; weeks: WeekLoad[] };

export const DEFAULTS: Settings = { weekday: ["16:00", "22:00"], weekend: ["10:00", "20:00"], maxDay: 4, maxWeek: 20, bufferDays: 1 };
export const MAX_COURSES = 30, MAX_ITEMS = 200, MAX_TITLE = 120, MAX_SCENE = 20_000, HORIZON_DAYS = 180, PREP_DAYS = 21;
export const KIND_LABEL: Record<Kind, string> = { assignment: "Assignment", studio: "Studio project", exam: "Exam" };
const SLOT = 30 * 60_000, DAY = 86_400_000;
export const emptyStore = (): SchoolStore => ({ courses: [], items: [], settings: { ...DEFAULTS } });

const hm = (s: unknown) => { const m = typeof s === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s) : null; return m ? +m[1] * 60 + +m[2] : NaN; };
const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Local Monday of t's week, "YYYY-MM-DD". */
export const weekKey = (t: number) => { const d = new Date(t); return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime()); };
const quiet = (t: number) => { const h = new Date(t).getHours(); return h >= 23 || h < 8; };
export const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** "YYYY-MM-DD" (end of that day, 23:59) or "YYYY-MM-DDTHH:MM", local → ms; NaN when malformed. */
export function dueMs(due: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(due);
  if (!m) return NaN;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[4] ? +m[5] : 59);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() : NaN;
}

/** POST body → a new item's fields, or why not. */
export function validateItem(b: Record<string, unknown>, courses: Course[], now: number): Omit<SchoolItem, "id"> | string {
  const title = clean(b.title, MAX_TITLE), kind = b.kind as Kind, due = typeof b.due === "string" ? b.due : "", hours = Number(b.hours);
  if (!title) return `Title must be 1–${MAX_TITLE} characters`;
  if (!KINDS.includes(kind)) return "Kind must be assignment, studio or exam";
  const courseId = typeof b.courseId === "string" ? b.courseId : "";
  if (courseId && !courses.some((c) => c.id === courseId)) return "Unknown course";
  const t = dueMs(due);
  if (Number.isNaN(t) || t < now - DAY || t > now + 400 * DAY) return "Due must be a date (YYYY-MM-DD, optional THH:MM) within the next 400 days";
  const h = hoursOk(hours);
  if (h === null) return "Hours must be 0–200 (half hours)";
  return { courseId, kind, title, due, hours: h };
}
export const hoursOk = (h: unknown) => (typeof h === "number" && Number.isFinite(h) && h >= 0 && h <= 200 ? Math.round(h * 2) / 2 : null);

/** Settings patch → new settings, or why not. */
export function patchSettings(b: Record<string, unknown>, cur: Settings): Settings | string {
  const s: Settings = { ...cur, weekday: [...cur.weekday], weekend: [...cur.weekend] };
  for (const k of ["weekday", "weekend"] as const) if (b[k] !== undefined) {
    const v = b[k] as unknown[];
    if (!Array.isArray(v) || v.length !== 2 || !(hm(v[0]) < hm(v[1]))) return `${k} must be ["HH:MM", "HH:MM"], start before end`;
    s[k] = [v[0] as string, v[1] as string];
  }
  const nums = { maxDay: [0.5, 16], maxWeek: [1, 80], bufferDays: [0, 14] } as const;
  for (const [k, [lo, hi]] of Object.entries(nums) as [keyof typeof nums, readonly [number, number]][]) {
    if (b[k] === undefined) continue;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) return `${k} must be ${lo}–${hi}`;
    s[k] = v;
  }
  return s;
}

/** A stored file → a usable store (broken entries dropped, never thrown). */
export function parseStore(j: unknown): SchoolStore {
  const x = (j && typeof j === "object" ? j : {}) as Partial<SchoolStore>;
  const st = patchSettings((x.settings ?? {}) as Record<string, unknown>, DEFAULTS);
  return {
    courses: Array.isArray(x.courses) ? x.courses.filter((c) => c && typeof c.id === "string" && typeof c.name === "string") : [],
    items: Array.isArray(x.items) ? x.items.filter((i) => i && typeof i.id === "string" && typeof i.title === "string" && KINDS.includes(i.kind) && !Number.isNaN(dueMs(i.due)) && hoursOk(i.hours) !== null) : [],
    settings: typeof st === "string" ? { ...DEFAULTS } : st,
  };
}

/** A scene from ARCH's localStorage (orbit.arch.v1 .scene) worth keeping as a link, or why not. */
export function archLink(scene: unknown, now: number): ArchLink | string {
  const s = scene as ArchLink["scene"] | null;
  if (!s || typeof s !== "object" || !Array.isArray(s.parts)) return "No ARCH model to link (build one in ARCH first)";
  if (JSON.stringify(s).length > MAX_SCENE) return "That ARCH model is too big to link";
  return { at: new Date(now).toISOString(), parts: s.parts.length, scene: s };
}

/** Free 30-minute slot starts from now to `end`: inside the day's study window, outside quiet hours and busy times. */
export function freeSlots(now: number, end: number, s: Settings, busy: Busy[]): number[] {
  const out: number[] = [], start = new Date(now);
  for (let d = 0; d <= HORIZON_DAYS; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    if (day.getTime() > end) break;
    const [from, to] = (day.getDay() % 6 === 0 ? s.weekend : s.weekday).map(hm);
    for (let m = from; m + 30 <= to; m += 30) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m).getTime();
      if (t < now || t + SLOT > end || quiet(t) || quiet(t + SLOT - 1)) continue;
      if (!busy.some((b) => b.start < t + SLOT && b.end > t)) out.push(t);
    }
  }
  return out;
}

/** Backward scheduling: latest deadline first, each item's hours placed as late as possible before (due − buffer), at most
 *  maxDay hours a day across all items. Hours that don't fit are `short`. Weeks over maxWeek, or with short items, are `over`. */
export function planSchool(store: SchoolStore, now: number, busy: Busy[] = []): Plan {
  const s = store.settings;
  const open = store.items.filter((i) => !i.done && i.hours > 0 && dueMs(i.due) > now).sort((a, b) => dueMs(b.due) - dueMs(a.due));
  const deadline = (i: SchoolItem) => { const d = dueMs(i.due), b = d - s.bufferDays * DAY; return b > now + DAY ? b : d; }; // buffer only when it leaves time
  const free = open.length ? freeSlots(now, Math.max(...open.map(deadline)), s, busy) : [];
  const taken = new Set<number>(), perDay = new Map<string, number>(), capDay = Math.round(s.maxDay * 2);
  const blocks: Block[] = [], short: Record<string, number> = {};
  for (const it of open) {
    let need = Math.ceil(it.hours * 2);
    const last = deadline(it), mine: number[] = [];
    for (let k = free.length - 1; k >= 0 && need > 0; k--) {
      const t = free[k], dk = dayKey(t);
      if (t + SLOT > last || taken.has(t) || (perDay.get(dk) ?? 0) >= capDay) continue;
      taken.add(t); perDay.set(dk, (perDay.get(dk) ?? 0) + 1); mine.push(t); need--;
    }
    if (need > 0) short[it.id] = need / 2;
    for (const t of mine.sort((a, b) => a - b)) {
      const prev = blocks[blocks.length - 1];
      if (prev?.itemId === it.id && prev.end === t) prev.end = t + SLOT; else blocks.push({ itemId: it.id, start: t, end: t + SLOT });
    }
  }
  blocks.sort((a, b) => a.start - b.start);
  const weeks = new Map<string, WeekLoad>();
  const wk = (t: number) => { const k = weekKey(t); return weeks.get(k) ?? weeks.set(k, { week: k, hours: 0, deadlines: 0, short: 0, over: false }).get(k)!; };
  for (const b of blocks) wk(b.start).hours += (b.end - b.start) / 3_600_000;
  for (const it of open) { const w = wk(dueMs(it.due)); w.deadlines++; w.short += short[it.id] ?? 0; }
  const list = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
  for (const w of list) w.over = w.hours > s.maxWeek || w.short > 0;
  return { blocks, short, weeks: list };
}

const longDay = (key: string) => new Date(`${key}T12:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
const weekday = (t: number) => new Date(t).toLocaleDateString("en-GB", { weekday: "long" });
const hhmm = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hrs = (h: number) => `${Math.round(h * 2) / 2} hour${h === 1 ? "" : "s"}`;

/** The morning brief's school line. Spoken words never carry titles (the brief's polish goes to a model); the card detail may. */
export function schoolBrief(store: SchoolStore, plan: Plan, now: number): { id: string; title: string; say: string; detail?: string } | null {
  const soon = weekKey(now + 21 * DAY), name = (id: string) => store.items.find((i) => i.id === id)?.title ?? "";
  const over = plan.weeks.find((w) => w.over && w.week >= weekKey(now) && w.week <= soon);
  if (over) {
    const sh = over.short ? ` and ${hrs(over.short)} won't fit before the deadlines` : "";
    return { id: `school:over:${over.week}`, title: `School: heavy week of ${longDay(over.week)}`, detail: `${hrs(over.hours)} planned${over.short ? `, ${hrs(over.short)} short` : ""}`,
      say: `Heads up on school: the week of ${longDay(over.week)} looks overloaded, ${hrs(over.hours)} planned${sh}. Starting earlier would help.` };
  }
  const today = plan.blocks.filter((b) => dayKey(b.start) === dayKey(now) && b.end > now);
  if (today.length) {
    const h = today.reduce((n, b) => n + (b.end - b.start) / 3_600_000, 0);
    return { id: `school:${dayKey(now)}`, title: `School: ${hrs(h)} today`, detail: `From ${hhmm(today[0].start)} · ${name(today[0].itemId)}`,
      say: `For school, you've got ${hrs(h)} planned today, starting at ${hhmm(today[0].start)}.` };
  }
  const next = store.items.filter((i) => !i.done && dueMs(i.due) > now && dueMs(i.due) < now + 7 * DAY).sort((a, b) => dueMs(a.due) - dueMs(b.due))[0];
  if (next) return { id: `school:due:${next.id}`, title: `School deadline ${weekday(dueMs(next.due))}`, detail: next.title,
    say: `Your next school deadline is on ${weekday(dueMs(next.due))}.` };
  return null;
}

/** Items worth a night-shift reading list: open, due within PREP_DAYS, not queued yet. */
export const prepDue = (items: SchoolItem[], now: number) => items.filter((i) => !i.done && !i.prepped && dueMs(i.due) > now && dueMs(i.due) < now + PREP_DAYS * DAY);

/** The night shift's research ask for one item (≤ 500 chars, night-pure TEXT_MAX). Proposals only: a reading list and notes. */
export function prepText(it: SchoolItem, course?: Course): string {
  const what = it.kind === "exam" ? "a revision reading list and key concepts to study" : "a reading list, precedents and short research notes";
  return `Architecture studies (building and design): prepare ${what} for my ${KIND_LABEL[it.kind].toLowerCase()} "${clean(it.title, 100)}"`
    + `${course ? ` in the course "${clean(course.name, 80)}"` : ""}, due ${it.due.replace("T", " ")}. Sources with links; no actions outside ORBIT.`;
}
