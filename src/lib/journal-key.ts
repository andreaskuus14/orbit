import { readFileSync } from "node:fs";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { journalWriteBlocked, JOURNAL_CLOUD_TEXT } from "./role-pure.ts";
import { isSealed, keyId, memoryAad, parseKeyFile, seal, lifeAad } from "./journal-crypt-pure.ts";

// The journal key: one file on this PC, outside the repo and outside Supabase. Made once by tools\backup\setup.ps1
// (scripts/journal-key.ts init), which also shows the recovery key to write down. No key file = journal stays as before
// (plain text in life.json / Supabase) and the doctor says so; it never makes a key by itself, because a key nobody saved
// would make the journal unreadable after a reinstall.

export const journalKeyFile = () => path.resolve(process.env.ORBIT_JOURNAL_KEY_FILE?.trim() || path.join(orbitDataDir(), "keys", "journal.key"));

const g = globalThis as unknown as { __orbitJournalKey?: { file: string; key: Buffer | null; at: number } };
/** The key, or null when the file is missing or not a key. Re-read at most once a minute (setup while ORBIT runs). */
export function journalKey(): Buffer | null {
  const file = journalKeyFile(), c = g.__orbitJournalKey;
  if (c && c.file === file && (c.key || Date.now() - c.at < 60_000)) return c.key;
  let key: Buffer | null = null;
  try { key = parseKeyFile(readFileSync(file, "utf8")); } catch { key = null; }
  g.__orbitJournalKey = { file, key, at: Date.now() };
  return key;
}
export const journalKeyId = () => { const k = journalKey(); return k ? keyId(k) : null; };

/** Seal one life.json day (plain text when there is no key yet: the doctor shows that). */
export function sealLifeDay(date: string, text: string): string {
  const k = journalKey();
  if (journalWriteBlocked(process.env, !!k)) throw new Error(JOURNAL_CLOUD_TEXT);
  return k && !isSealed(text) ? seal(k, text, lifeAad(date)) : text;
}
/** Seal a journal memory's title and content for Supabase. */
export function sealJournalMemory(userId: string, title: string, content: string): { title: string; content: string } {
  const k = journalKey();
  if (journalWriteBlocked(process.env, !!k)) throw new Error(JOURNAL_CLOUD_TEXT);
  if (!k) return { title, content };
  return {
    title: isSealed(title) ? title : seal(k, title, memoryAad(userId, "title")),
    content: isSealed(content) ? content : seal(k, content, memoryAad(userId, "content")),
  };
}
