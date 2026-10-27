import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, FAST_MODEL, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHold } from "./usage-meter";
import { MAX_CHANGES, MAX_TABLE, MAX_VOICE, NOTES_SYSTEM, cleanNotes, economyContext, economyReport, fallbackNotes, notesPrompt, parseEconomy } from "./economy-pure";

// Game dev copilot IO (rules: economy-pure.ts). <ORBIT data dir>/economy.json, per user: the egg/pet table, an example of his update notes
// (the voice), and when notes were last drafted. The simulation itself runs in the browser; nothing here talks to Roblox.
type Store = Record<string, { table?: string; voice?: string; notesAt?: string }>;
const file = () => path.join(orbitDataDir(), "economy.json");
const g = globalThis as unknown as { __orbitEconomy?: Promise<unknown> };

const load = async (): Promise<Store> => { try { const j = JSON.parse(await readFile(file(), "utf8")); return j && typeof j === "object" ? j : {}; } catch { return {}; } };
function update(fn: (s: Store) => void): Promise<void> {
  const p = (g.__orbitEconomy ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(); fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
  });
  g.__orbitEconomy = p;
  return p;
}

export const economyView = async (userId: string) => { const u = (await load())[userId] ?? {}; return { table: u.table ?? "", voice: u.voice ?? "", notesAt: u.notesAt ?? "" }; };
export const saveEconomy = (userId: string, table: string, voice: string) =>
  update((s) => { const u = (s[userId] ??= {}); u.table = table.slice(0, MAX_TABLE); u.voice = voice.slice(0, MAX_VOICE); });

/** The saved table's simulation as persona-walkthrough context, or "" when he hasn't saved a usable table. */
export async function economyContextFor(userId: string): Promise<string> {
  const t = (await load())[userId]?.table;
  if (!t) return "";
  const { economy, errors } = parseEconomy(t);
  return errors.length && !economy.pets.length ? "" : economyContext(economyReport(economy));
}

export class NotesError extends Error {}

/** One fast-model call on his click; any model failure returns the plain list instead. Nothing is posted anywhere. */
export async function draftNotes(sb: SupabaseClient, userId: string, game: string, changes: string): Promise<{ notes: string; ai: boolean }> {
  const held = stopAllOn() ? PAUSED_MSG : usageHold();
  if (held) throw new NotesError(held);
  const c = changes.slice(0, MAX_CHANGES), fallback = fallbackNotes(game, c);
  let notes = fallback, ai = false;
  try {
    const r = await askClaude(notesPrompt(game, c, (await load())[userId]?.voice ?? ""), NOTES_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs: 30_000, purpose: "devworld.notes" });
    void recordUsage(sb, userId, "devworld.notes", r, FAST_MODEL);
    notes = cleanNotes(r.text, fallback); ai = notes !== fallback;
  } catch (e) { console.error("[orbit] update notes draft failed; using the plain list", e instanceof Error ? e.message : e); }
  await update((s) => { (s[userId] ??= {}).notesAt = new Date().toISOString(); });
  return { notes, ai };
}
