// People (moons in MEMORY), server side. His own entries live only in <data dir>/people.json; BUSINESS prospects he has
// contacted join read-only from Supabase. Last contact comes from his logged contacts, BUSINESS stage events and his own
// memories that name the person. Nothing here leaves ORBIT; CORE gets peopleBlock() only for people he mentions.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { STAGE_LABEL, type Stage } from "./business-pure";
import {
  TOUCH_STAGES, businessTouches, lastContact, likeSafe, mentioned, overdue, ownNotes, peopleBlock, timeline,
  type Affinity, type LogEntry, type Person, type PersonInput, type Touch,
} from "./people-pure";

type Store = { people: Person[] };
const file = () => path.join(orbitDataDir(), "people.json");
const g = globalThis as unknown as { __orbitPeople?: Promise<unknown> };

async function read(): Promise<Store> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8"));
    return { people: Array.isArray(s.people) ? s.people : [] };
  } catch (e) {
    // Only a missing file means "nobody yet"; a locked or corrupt file must not be overwritten with an empty list.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { people: [] };
    throw e;
  }
}
/** Read-modify-write, one at a time; tmp + rename so a crash never leaves a half-written file. */
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitPeople ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await read();
    const out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 2));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitPeople = p;
  return p;
}

export async function addPerson(input: PersonInput): Promise<Person> {
  const at = new Date().toISOString();
  const p: Person = { ...input, id: randomUUID(), log: [], draft: "", created_at: at, updated_at: at };
  return update((s) => { if (s.people.length >= 500) throw new Error("People list is full (500)"); s.people.push(p); return p; });
}
/** Applies `fn` to person `id`; null when there is no such person. */
export function editPerson(id: string, fn: (p: Person) => void): Promise<Person | null> {
  return update((s) => { const p = s.people.find((x) => x.id === id); if (!p) return null; fn(p); p.updated_at = new Date().toISOString(); return p; });
}
export const patchPerson = (id: string, patch: Partial<PersonInput>) => editPerson(id, (p) => Object.assign(p, patch));
export const logContact = (id: string, e: LogEntry) => editPerson(id, (p) => { p.log = [e, ...p.log].slice(0, 200); });
export const deletePerson = (id: string) => update((s) => { const n = s.people.length; s.people = s.people.filter((p) => p.id !== id); return s.people.length < n; });
export const localPeople = async () => (await read()).people;
export const getPerson = async (id: string) => (await read()).people.find((p) => p.id === id) ?? null;

type ProspectRow = { id: string; name: string; stage: Stage; notes: string | null; created_at: string };
/** His people plus contacted BUSINESS prospects not already kept as a person (id "p:<prospect id>", read-only). */
async function everyone(sb: SupabaseClient): Promise<(Person & { local: boolean })[]> {
  const [{ people }, pr] = await Promise.all([read(), sb.from("prospects").select("id, name, stage, notes, created_at").in("stage", [...TOUCH_STAGES]).limit(300)]);
  const kept = new Set(people.map((p) => p.prospectId).filter(Boolean));
  const fromBusiness = ((pr.data ?? []) as ProspectRow[]).filter((r) => !kept.has(r.id)).map((r) => ({
    id: `p:${r.id}`, name: r.name, relation: STAGE_LABEL[r.stage], affinity: "business" as Affinity, notes: ownNotes(r.notes ?? ""), cares: "", next: "",
    importance: 3, remindDays: 21, prospectId: r.id, log: [], draft: "", created_at: r.created_at, updated_at: r.created_at, local: false,
  }));
  return [...people.map((p) => ({ ...p, local: true })), ...fromBusiness];
}

/** His own memories naming the person (not CORE's chat summaries: talking about someone isn't contact). */
async function memoryTouches(sb: SupabaseClient, userId: string, name: string, limit: number): Promise<Touch[]> {
  const n = likeSafe(name);
  if (!n) return [];
  const { data } = await sb.from("memories").select("title, content, created_at, source").eq("user_id", userId)
    .or(`title.ilike.%${n}%,content.ilike.%${n}%`).neq("source", "core-summary").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).filter((m) => mentioned(`${m.title} ${String(m.content).slice(0, 20_000)}`, [{ name }]).length)
    .map((m) => ({ at: m.created_at, what: `Memory: ${String(m.title).slice(0, 80)}`, via: "memory" as const }));
}
async function stageEvents(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("events").select("created_at, payload").eq("user_id", userId).eq("type", "business.stage")
    .gte("created_at", new Date(Date.now() - 730 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(2000);
  return (data ?? []) as { created_at: string; payload: { prospect?: unknown; to?: unknown } }[];
}
const touchesOf = (p: Person, ev: Awaited<ReturnType<typeof stageEvents>>, mem: Touch[]) =>
  timeline(p.log.map((l) => ({ at: l.at, what: l.note, via: "logged" as const })), p.prospectId ? businessTouches(ev, p.prospectId) : [], mem);

export type PersonView = Person & { local: boolean; last: string | null; overdue: boolean };
/** Everyone with last contact and the reminder flag. shortcut: one memory query per person, fine for tens; batch if it grows to hundreds. */
export async function listPeople(sb: SupabaseClient, userId: string): Promise<PersonView[]> {
  const [all, ev] = await Promise.all([everyone(sb), stageEvents(sb, userId)]);
  const now = Date.now();
  return Promise.all(all.map(async (p) => {
    const last = lastContact(touchesOf(p, ev, await memoryTouches(sb, userId, p.name, 1).catch(() => [])));
    return { ...p, last, overdue: overdue(p, last, now) };
  }));
}

/** One person (local id or "p:<prospect>") with the full timeline. */
export async function personTimeline(sb: SupabaseClient, userId: string, id: string): Promise<{ person: Person & { local: boolean }; timeline: Touch[] } | null> {
  const p = (await everyone(sb)).find((x) => x.id === id);
  if (!p) return null;
  const [ev, mem] = await Promise.all([stageEvents(sb, userId), memoryTouches(sb, userId, p.name, 12).catch(() => [])]);
  return { person: p, timeline: touchesOf(p, ev, mem).slice(0, 40) };
}

/** CORE's people block for the people named in `question` (names, relation, last contact); "" on none or any failure. */
export async function peopleContext(sb: SupabaseClient, userId: string, question: string): Promise<string> {
  try {
    const hit = mentioned(question, await everyone(sb));
    if (!hit.length) return "";
    const ev = await stageEvents(sb, userId);
    const rows = await Promise.all(hit.map(async (p) => ({ name: p.name, relation: p.relation, last: lastContact(touchesOf(p, ev, await memoryTouches(sb, userId, p.name, 1).catch(() => []))) })));
    return peopleBlock(rows, Date.now());
  } catch { return ""; }
}
