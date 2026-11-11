import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { localDay } from "./morning-pure";
import { BOOK_SYSTEM, DRAFT_SYSTEM, addCards, bookCards, bookPrompt, bookRef, quizPick, editCard as editCardPure, sourceCorrected, draftPrompt, dueToday, lessonCard, parseDrafts, parseStore, review, stats, studyable,
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
  return { cards: u.cards, log: u.log.slice(-500), queue: dueToday(u, d).map((c) => c.id), stats: stats(u, d),
    lessons: kept.filter((l) => !carded.has(l.id)).map((l) => ({ id: l.id, ...lessonCard(l) })) };
}

/** Cards he graded today (the daily mission's study target); throws when study.json is unreadable. */
export const reviewedToday = (userId: string, now = Date.now()) => mine(userId).then((u) => u.log.filter((r) => r.day === today(now)).length);
/** How many cards are due today (0 on any failure): the morning brief's "3 minutes of cards". */
export const dueCount = (userId: string, now = Date.now()) => mine(userId).then((u) => dueToday(u, today(now)).length, () => 0);

export const saveCards = (userId: string, drafts: Draft[], source: CardSource, ref?: string) =>
  update((u) => addCards(u, drafts, source, today(), randomUUID, ref).length, userId);

export const gradeCard = (userId: string, id: string, grade: Grade) => update((u) => review(u, id, grade, today()), userId);

export const editCard = (userId: string, id: string, d: Draft) => update((u) => editCardPure(u, id, d, today()), userId);

/** MEM07: a memory was corrected; its cards keep their history and get a "source changed" mark. Best-effort (0 on failure). */
export const markSourceCorrected = (userId: string, memoryId: string) =>
  mine(userId).then((u) => (u.cards.some((c) => c.ref === memoryId) ? update((x) => sourceCorrected(x, memoryId, today()), userId) : 0)).catch(() => 0);

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

/** The books that already have a Book to Skill file in VAULT (their names without the extension). */
export async function studyBooks(): Promise<string[]> {
  const { listVault } = await import("./vault"), { isSkillFile } = await import("./book-skill-pure");
  return (await listVault()).filter((f) => isSkillFile(f.name)).map((f) => f.name.replace(/\.skill\.json$/, ""));
}

/** Cards for the next few chapters of a book that have none yet, read from the book's own text (not the skill summaries). Saved straight
 *  away: each card carries a quote checked against the chapter plus "Book, Chapter", and he can still edit or delete it. */
export async function bookDeck(sb: SupabaseClient, userId: string, book: string, max = 3, signal?: AbortSignal): Promise<{ added: number; left: number } | string> {
  const { listVault, readVaultText } = await import("./vault"), { chapters, isSkillFile } = await import("./book-skill-pure");
  const files = await listVault(), src = files.find((f) => !isSkillFile(f.name) && f.name.replace(/\.[^.]+$/, "") === book);
  if (!src || !files.some((f) => f.name === `${book}.skill.json`)) return "Make that book's skill in VAULT first";
  const text = await readVaultText(src.name, 600_000);
  if (!text) return "No readable text in that book";
  const have = new Set((await mine(userId)).cards.map((c) => c.ref)), todo = chapters(text).filter((p) => !have.has(bookRef(book, p.title)));
  const { askClaude, recordUsage } = await import("./claude");
  let added = 0;
  for (const p of todo.slice(0, max)) {
    if (signal?.aborted) break;
    const r = await askClaude(bookPrompt(book, p.title, p.body), BOOK_SYSTEM, { lane: "foreground", timeoutMs: 90_000, purpose: "study.book", signal });
    void recordUsage(sb, userId, "study.book", r);
    added += await saveCards(userId, bookCards(r.text, book, p.title, p.body), "book", bookRef(book, p.title));
  }
  return { added, left: Math.max(0, todo.length - max) };
}

/** This week's quiz: up to 10 due book cards. */
export const weeklyQuiz = (userId: string) => mine(userId).then((u) => quizPick(u, today()));
