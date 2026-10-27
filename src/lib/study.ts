import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { localDay } from "./morning-pure";
import { DRAFT_SYSTEM, addCards, cleanDraft, draftPrompt, dueToday, lessonCard, parseDrafts, parseStore, review, stats, studyable,
  type CardSource, type Draft, type Grade, type Store, type UserStudy } from "./study-pure";

// Study cards I/O (logic: study-pure.ts). State: <ORBIT data dir>/study.json (local only). Days are the PC's local days.

const file = () => path.join(orbitDataDir(), "study.json");
const g = globalThis as unknown as { __orbitStudy?: Promise<unknown> };

async function load(): Promise<Store> {
  const s = parseStore(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("study.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}
/** Read-modify-write, one at a time, saved atomically. */
function update<T>(fn: (u: UserStudy) => T, userId: string): Promise<T> {
  const p = (g.__orbitStudy ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn((s.users[userId] ??= { cards: [], log: [] }));
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitStudy = p;
  return p;
}
const today = (now = Date.now()) => localDay(new Date(now));
const mine = async (userId: string) => (await load()).users[userId] ?? { cards: [], log: [] };

/** Cards, today's queue (ids, in order), stats, and kept lessons not yet turned into a card. */
export async function studyView(userId: string) {
  const [u, kept] = await Promise.all([mine(userId), import("./lessons").then((m) => m.lessonsView(userId)).then((v) => v.kept, () => [])]), d = today();
  const carded = new Set(u.cards.filter((c) => c.source === "lesson").map((c) => c.ref));
  return { cards: u.cards, queue: dueToday(u, d).map((c) => c.id), stats: stats(u, d),
    lessons: kept.filter((l) => !carded.has(l.id)).map((l) => ({ id: l.id, ...lessonCard(l) })) };
}

/** How many cards are due today (0 on any failure): the morning brief's "3 minutes of cards". */
export const dueCount = (userId: string, now = Date.now()) => mine(userId).then((u) => dueToday(u, today(now)).length, () => 0);

export const saveCards = (userId: string, drafts: Draft[], source: CardSource, ref?: string) =>
  update((u) => addCards(u, drafts, source, today(), randomUUID, ref).length, userId);

export const gradeCard = (userId: string, id: string, grade: Grade) => update((u) => review(u, id, grade, today()), userId);

export const editCard = (userId: string, id: string, d: Draft) => update((u) => {
  const c = u.cards.find((x) => x.id === id), ok = cleanDraft(d);
  if (c && ok) Object.assign(c, ok);
  return !!(c && ok);
}, userId);

export const deleteCard = (userId: string, id: string) => update((u) => { const n = u.cards.length; u.cards = u.cards.filter((c) => c.id !== id); return u.cards.length < n; }, userId);

/** "Learn this": one fast-model call drafts cards from one of his memories. Nothing is saved; he keeps or edits each draft. Journal memories are refused. */
export async function draftFromMemory(sb: SupabaseClient, userId: string, memoryId: string, signal?: AbortSignal): Promise<{ drafts: Draft[]; title: string } | string> {
  const { data, error } = await sb.from("memories").select("id, title, content, kind, tags").eq("id", memoryId).maybeSingle();
  if (error) throw error;
  if (!data) return "Memory not found";
  if (!studyable(data)) return "Journal entries stay private: they never become cards";
  const { askClaude, FAST_MODEL, recordUsage } = await import("./claude");
  const r = await askClaude(draftPrompt(data.title ?? "", data.content ?? ""), DRAFT_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs: 45_000, purpose: "study.draft", signal });
  void recordUsage(sb, userId, "study.draft", r, FAST_MODEL);
  return { drafts: parseDrafts(r.text), title: data.title ?? "" };
}
