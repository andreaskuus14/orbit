import type { SupabaseClient } from "@supabase/supabase-js";
import { isSealed, lifeAad, memoryAad, open } from "./journal-crypt-pure.ts";
import { journalKey } from "./journal-key.ts";
import { journalHits, snip, type SearchHit } from "./search-pure.ts";

// The ONLY place journal text is decrypted. Callers are owner-facing routes only: LIFE (/api/life), the owner's own search
// palette (/api/search) and the owner's explicit Obsidian export with ?journal=1. Nothing here may be passed to a model,
// a plugin, an agent or any outside service (AGENTS.md: journal/LIFE text never goes to a model or out of ORBIT).

export const LOCKED_TEXT = "🔒 This entry is encrypted and this PC has no matching journal key. Restore the key with your recovery key (tools\\backup\\README.md).";

const tryOpen = <V extends string | null>(v: V, aad: string): V | string => {
  if (!isSealed(v)) return v;
  const k = journalKey();
  if (!k) return LOCKED_TEXT;
  try { return open(k, v, aad); } catch { return LOCKED_TEXT; }
};

/** life.json journal (date → stored value) → plain text, for LIFE → Journal. */
export const openLifeJournal = (journal: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(journal ?? {}).map(([d, v]) => [d, tryOpen(v, lifeAad(d))]));

type MemRow = { id: string; kind: string; title: string; content: string | null; source?: string | null; created_at: string };
export const openMemory = <T extends MemRow>(r: T, userId: string): T =>
  r.kind !== "journal" ? r : { ...r, title: tryOpen(r.title, memoryAad(userId, "title")), content: r.content === null ? null : tryOpen(r.content, memoryAad(userId, "content")) };

export type JournalNote = { id: string; date: string; source: string; text: string };
/** Evening captures and voice-memo journal notes (Supabase memories, kind journal), newest first, opened for LIFE. */
export async function journalNotes(sb: SupabaseClient, userId: string, limit = 60): Promise<JournalNote[]> {
  const { data, error } = await sb.from("memories").select("id, kind, title, content, source, created_at").eq("user_id", userId).eq("kind", "journal")
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return ((data ?? []) as MemRow[]).map((r) => openMemory(r, userId)).map((r) => ({ id: r.id, date: r.created_at, source: r.source ?? "", text: r.content ?? "" }));
}

/** The owner's search palette: every query word must appear (life.json days + journal notes), newest first. */
export async function journalSearch(sb: SupabaseClient, userId: string, journal: Record<string, string>, q: string, limit = 8): Promise<SearchHit[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (t: string) => { const l = t.toLowerCase(); return t !== LOCKED_TEXT && words.every((w) => l.includes(w)); };
  const nav = { nav: { panel: "life", life: "journal" } } as SearchHit["open"];
  const days = journalHits(Object.fromEntries(Object.entries(openLifeJournal(journal)).filter(([, t]) => t !== LOCKED_TEXT)), q, limit);
  const notes: SearchHit[] = (await journalNotes(sb, userId, 500).catch(() => [])).filter((n) => has(n.text))
    .map((n) => ({ source: "journal", id: n.id, title: `Journal note · ${n.date.slice(0, 10)}`, snippet: snip(n.text, q), at: n.date, open: nav }));
  return [...days, ...notes].sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1)).slice(0, limit);
}
