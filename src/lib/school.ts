import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import {
  MAX_COURSES, MAX_ITEMS, archLink, clean, dayKey, dueMs, emptyStore, hoursOk, parseStore, patchSettings, planSchool, prepText, schoolBrief, validateItem,
  type Busy, type SchoolStore,
} from "./school-pure";

// SCHOOL planner IO (rules: school-pure.ts). Stored locally in <ORBIT data dir>/school.json; never sent anywhere except the one
// item he presses "Prep tonight" on (its title and course go to the night shift's research agent, within the night budget).

const file = () => path.join(orbitDataDir(), "school.json");
const g = globalThis as unknown as { __orbitSchool?: Promise<unknown> };
const DAY = 86_400_000;

async function read(): Promise<SchoolStore> {
  try { return parseStore(JSON.parse(await readFile(file(), "utf8"))); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw e; // a locked/corrupt file must never be overwritten
  }
}
function update<T>(fn: (s: SchoolStore) => T): Promise<T> {
  const p = (g.__orbitSchool ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await read(), out = fn(s);
    s.items = s.items.filter((i) => !(i.done && dueMs(i.due) < Date.now() - 60 * DAY)); // finished work older than 60 days drops out
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 2));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitSchool = p;
  return p;
}

/** Calendar events (next 14 days, if connected) are busy time; the planner never puts study blocks on them. */
async function busy(now: number): Promise<Busy[]> {
  const [ev, f] = await Promise.all([
    import("./gcal").then((m) => m.calendarEvents(14, now)).catch(() => null),
    import("./focus").then((m) => m.focusState().focus).catch(() => null)]); // f: a running focus block stays free of study blocks
  return [...(ev ?? []).filter((e) => !e.allDay).map((e) => ({ start: Date.parse(e.start), end: Date.parse(e.end) })), ...(f ? [{ start: f.startAt, end: f.endAt }] : [])].filter((b) => b.end > b.start);
}

/** Today's planned study blocks (for "Plan my day", where they are fixed items). */
export async function schoolToday(now = Date.now()) {
  const s = await read();
  if (!s.items.length) return [];
  return planSchool(s, now, await busy(now)).blocks.filter((b) => dayKey(b.start) === dayKey(now))
    .map((b) => ({ start: b.start, end: b.end, title: s.items.find((i) => i.id === b.itemId)?.title ?? "school work" }));
}

export async function getSchool(now = Date.now()) {
  const s = await read(), plan = planSchool(s, now, await busy(now));
  return { ...s, items: s.items.map(({ arch, ...i }) => ({ ...i, ...(arch && { arch: { at: arch.at, parts: arch.parts } }) })), plan };
}
export const archScene = async (id: string) => (await read()).items.find((i) => i.id === id)?.arch?.scene ?? null;

/** The morning brief's school line (null when nothing worth saying). */
export async function schoolBriefLine(now = Date.now()) {
  const s = await read();
  return s.items.length ? schoolBrief(s, planSchool(s, now, await busy(now)), now) : null;
}

type R = { error: string } | { ok: true; id?: string };
export async function schoolAction(b: Record<string, unknown>, userId: string): Promise<R> {
  const now = Date.now(), id = typeof b.id === "string" ? b.id : "";
  switch (b.action) {
    case "addCourse": {
      const name = clean(b.name, 80);
      if (!name) return { error: "Course name must be 1–80 characters" };
      return update((s) => {
        if (s.courses.length >= MAX_COURSES) return { error: `Up to ${MAX_COURSES} courses` };
        if (s.courses.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { error: `You already have “${name}”` };
        const c = { id: randomUUID(), name };
        s.courses.push(c);
        return { ok: true as const, id: c.id };
      });
    }
    case "removeCourse":
      return update((s) => {
        if (s.items.some((i) => i.courseId === id && !i.done)) return { error: "That course still has open work; finish or delete it first" };
        s.courses = s.courses.filter((c) => c.id !== id); return { ok: true as const };
      });
    case "addItem":
      return update((s) => {
        const v = validateItem(b, s.courses, now);
        if (typeof v === "string") return { error: v };
        if (s.items.length >= MAX_ITEMS) return { error: `Up to ${MAX_ITEMS} items` };
        const it = { id: randomUUID(), ...v };
        s.items.push(it);
        return { ok: true as const, id: it.id };
      });
    case "updateItem": // hours left and/or done
      return update((s) => {
        const it = s.items.find((i) => i.id === id);
        if (!it) return { error: "Not found" };
        if (b.hours !== undefined) { const h = hoursOk(b.hours); if (h === null) return { error: "Hours must be 0–200" }; it.hours = h; }
        if (b.done !== undefined) { if (typeof b.done !== "boolean") return { error: "done must be true or false" }; it.done = b.done; }
        return { ok: true as const };
      });
    case "removeItem":
      return update((s) => { const n = s.items.length; s.items = s.items.filter((i) => i.id !== id); return n === s.items.length ? { error: "Not found" } : { ok: true as const }; });
    case "settings":
      return update((s) => { const r = patchSettings(b, s.settings); if (typeof r === "string") return { error: r }; s.settings = r; return { ok: true as const }; });
    case "linkArch":
      return update((s) => {
        const it = s.items.find((i) => i.id === id);
        if (!it) return { error: "Not found" };
        if (b.scene === null) { delete it.arch; return { ok: true as const }; }
        const l = archLink(b.scene, now);
        if (typeof l === "string") return { error: l };
        it.arch = l; return { ok: true as const };
      });
    case "prep": { // owner's click: one research item on tonight's night-shift list (existing agent, budget and approvals)
      const s = await read(), it = s.items.find((i) => i.id === id);
      if (!it) return { error: "Not found" };
      const err = await import("./night").then((n) => n.addTonightItem(userId, { text: prepText(it, s.courses.find((c) => c.id === it.courseId)), agent: "atlas" }, "owner"));
      if (err) return { error: err };
      return update((x) => { const y = x.items.find((i) => i.id === id); if (y) y.prepped = new Date(now).toISOString(); return { ok: true as const }; });
    }
  }
  return { error: "Unknown action" };
}
