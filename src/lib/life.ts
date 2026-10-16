import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  MAX_HABITS, MAX_JOURNAL, MAX_OPEN_REMINDERS, MAX_REMINDER, addDays, cleanDays, cleanEmoji, cleanName, dateKey, dueReminders,
  emptyStore, isDateKey, isRepeat, nextOccurrence, journalText, matchHabit, pruneReminders, reminderTimeError, streak, summaryText, view,
  type Habit, type LifeState, type LifeStore, type Reminder, type Repeat,
} from "./life-pure";

// LIFE workspace (habits, focus, reminders, journal), stored locally in <ORBIT data dir>/life.json like follows.json.

export type { LifeState, Habit, Reminder };

const file = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "life.json");
};
const g = globalThis as unknown as { __orbitLife?: Promise<unknown> };

async function read(): Promise<LifeStore> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8"));
    const e = emptyStore();
    return {
      // Drop hand-edited/broken entries instead of failing every read (writes then save the cleaned file).
      habits: Array.isArray(s.habits) ? s.habits.filter((h: Habit) => h && typeof h.id === "string" && typeof h.name === "string" && Array.isArray(h.days) && Array.isArray(h.done)) : e.habits,
      reminders: Array.isArray(s.reminders) ? s.reminders.filter((r: Reminder) => r && typeof r.id === "string" && typeof r.text === "string" && typeof r.at === "string") : e.reminders,
      focus: s.focus && typeof s.focus === "object" ? s.focus : e.focus, journal: s.journal && typeof s.journal === "object" ? s.journal : e.journal,
    };
  } catch (e) {
    // Only a missing file means empty; a locked/corrupt file must never be overwritten.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw e;
  }
}
function update<T>(fn: (s: LifeStore) => T): Promise<T> {
  const p = (g.__orbitLife ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await read();
    const out = fn(s);
    s.reminders = pruneReminders(s.reminders, Date.now());
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 2));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitLife = p;
  return p;
}
const today = () => dateKey(new Date());

export async function getLife(): Promise<LifeState> { return view(await read(), Date.now()); }
/** The raw stored LIFE data (full journal and focus history), for exports and backups. */
export const exportLife = (): Promise<LifeStore> => read();
/** The last `days` days of journal entries as plain text, newest first ("" when none). */
export const journalDigest = async (days: number): Promise<string> => journalText((await read()).journal, today(), days);

export async function addHabit(name: string, emoji?: string, days?: number[]): Promise<{ habit: Habit } | { error: string }> {
  const n = cleanName(name), e = cleanEmoji(emoji), d = cleanDays(days);
  if (!n) return { error: "Habit name must be 1–60 characters" };
  if (e === null) return { error: "Emoji must be a short symbol" };
  if (!d) return { error: "Days must be weekday numbers 0–6 (0 = Sunday)" };
  return update((s) => {
    if (s.habits.some((h) => h.name.toLocaleLowerCase() === n.toLocaleLowerCase())) return { error: `You already have “${n}”` };
    if (s.habits.length >= MAX_HABITS) return { error: `Up to ${MAX_HABITS} habits` };
    const habit: Habit = { id: randomUUID(), name: n, emoji: e, days: d, created: today(), done: [] };
    s.habits.push(habit);
    return { habit };
  });
}

export async function removeHabit(id: string): Promise<boolean> {
  return update((s) => { const before = s.habits.length; s.habits = s.habits.filter((h) => h.id !== id); return s.habits.length < before; });
}

export async function checkHabit(nameOrId: string, done = true, date?: string): Promise<{ ok: true; name: string; streak: number } | { error: string }> {
  const t = today();
  const day = date ?? t;
  if (!isDateKey(day) || day > t || day < addDays(t, -60)) return { error: "Date must be within the last 60 days" };
  return update((s) => {
    const h = matchHabit(s.habits, String(nameOrId ?? "").slice(0, 80));
    if (!h) return { error: `No habit matches “${nameOrId}”` };
    const set = new Set(h.done);
    if (done) set.add(day); else set.delete(day);
    h.done = [...set].sort().slice(-400); // shortcut: keeps ~400 completions per habit; enough for streak display
    if (day < h.created) h.created = day;
    return { ok: true as const, name: h.name, streak: streak(h, t) };
  });
}

export async function addReminder(text: string, atIso: string, repeat?: Repeat): Promise<{ reminder: Reminder } | { error: string }> {
  const tx = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!tx || tx.length > MAX_REMINDER) return { error: `Reminder text must be 1–${MAX_REMINDER} characters` };
  const err = reminderTimeError(atIso, Date.now());
  if (err) return { error: err };
  if (repeat !== undefined && !isRepeat(repeat)) return { error: "Repeat must be daily, weekdays or weekly" };
  return update((s) => {
    if (s.reminders.filter((r) => !r.fired).length >= MAX_OPEN_REMINDERS) return { error: `Up to ${MAX_OPEN_REMINDERS} open reminders` };
    const d = new Date(atIso);
    const reminder: Reminder = { id: randomUUID(), text: tx, at: d.toISOString(), ...(repeat ? { repeat, time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` } : {}) };
    s.reminders.push(reminder);
    return { reminder };
  });
}
export async function removeReminder(id: string): Promise<boolean> {
  return update((s) => { const before = s.reminders.length; s.reminders = s.reminders.filter((r) => r.id !== id); return s.reminders.length < before; });
}
export async function markFired(id: string): Promise<boolean> {
  return update((s) => {
    const r = s.reminders.find((x) => x.id === id), now = Date.now();
    // false when another window already showed it (one-off already fired, or the recurring one already moved forward)
    if (!r || r.fired || Date.parse(r.at) > now) return false;
    if (isRepeat(r.repeat)) r.at = nextOccurrence(r.at, r.repeat, now, r.time);
    else r.fired = new Date(now).toISOString();
    return true;
  });
}
export async function getDue(): Promise<Reminder[]> { return dueReminders((await read()).reminders, Date.now()); }

export async function logFocus(minutes: number): Promise<number> {
  return update((s) => { const t = today(); s.focus[t] = (s.focus[t] ?? 0) + minutes; return s.focus[t]; });
}
export async function saveJournal(text: string, date?: string): Promise<{ ok: true } | { error: string }> {
  const t = today(), day = date ?? t;
  if (!isDateKey(day) || day > t || day < addDays(t, -6)) return { error: "Only the last 7 days can be edited" };
  if (typeof text !== "string" || text.length > MAX_JOURNAL) return { error: `Journal entry must be at most ${MAX_JOURNAL} characters` };
  return update((s) => { if (text.trim()) s.journal[day] = text; else delete s.journal[day]; return { ok: true as const }; });
}

export async function lifeSummary(): Promise<string> { return summaryText(await getLife(), Date.now()); }
