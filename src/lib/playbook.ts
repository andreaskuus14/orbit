import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./proactive-pure";
import { applyEdits, pushHistory, playbookPrompt, type PlaybookEdit, type PlaybookHistoryEntry } from "./playbook-pure";

export type { PlaybookEdit, PlaybookHistoryEntry };
export { playbookPrompt };

export const PLAYBOOK_MISSING_MSG = "Learned rules need migration 0007 (supabase/migrations/0007_orbit_playbook.sql). Run it in the Supabase SQL editor to turn this on.";

export class PlaybookError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

type Row = { rules: string[]; version: number; history: PlaybookHistoryEntry[] };

/** Full row ({rules:[],version:0,history:[]} if none yet). Throws PlaybookError(503) if the table is missing. */
export async function loadPlaybookRow(sb: SupabaseClient, userId: string): Promise<Row> {
  const { data, error } = await sb.from("core_playbook").select("rules, version, history").eq("user_id", userId).maybeSingle();
  if (error) throw isMissingTable(error) ? new PlaybookError(PLAYBOOK_MISSING_MSG, 503) : error;
  return { rules: data?.rules ?? [], version: data?.version ?? 0, history: Array.isArray(data?.history) ? data.history : [] };
}

// Read on every CORE turn, written only by mutatePlaybook (which drops the entry); the TTL covers edits made outside ORBIT.
const TTL = 60_000;
const G = globalThis as unknown as { __orbitPlaybook?: Map<string, { at: number; v: Promise<{ rules: string[]; version: number } | null> }> };

/** null = table missing or unavailable (CORE then just runs without learned rules). */
export function getPlaybook(sb: SupabaseClient, userId: string): Promise<{ rules: string[]; version: number } | null> {
  const cache = (G.__orbitPlaybook ??= new Map()), hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = loadPlaybookRow(sb, userId).then(({ rules, version }) => ({ rules, version }), () => null);
  cache.set(userId, { at: Date.now(), v });
  return v;
}

/**
 * Read-modify-write with an optimistic version check, so CORE and the UI can't silently overwrite each other.
 * `change` returns the new rules, or null for "nothing to save".
 */
export async function mutatePlaybook(sb: SupabaseClient, userId: string, change: (cur: Row) => string[] | null, source: string): Promise<Row & { changed: boolean }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await loadPlaybookRow(sb, userId);
    const rules = change(cur);
    if (!rules) return { ...cur, changed: false };
    const version = cur.version + 1;
    const at = new Date().toISOString();
    const history = pushHistory(cur.history, { version, rules, source: source.slice(0, 60), at });
    const next = { rules, version, history, updated_at: at };
    const { data, error } = cur.version === 0
      ? await sb.from("core_playbook").insert({ user_id: userId, ...next }).select("version")
      : await sb.from("core_playbook").update(next).eq("user_id", userId).eq("version", cur.version).select("version");
    if (error && error.code !== "23505") throw isMissingTable(error) ? new PlaybookError(PLAYBOOK_MISSING_MSG, 503) : error;
    if (!error && data?.length) { G.__orbitPlaybook?.delete(userId); return { rules, version, history, changed: true }; }
    // Someone else saved in between (unique violation on insert, or 0 rows updated): re-read and retry.
  }
  throw new PlaybookError("The playbook changed while saving; try again.", 409);
}

/** CORE's entry point. Never throws: invalid/unsafe edits are skipped and errors count as 0 applied. */
export async function applyPlaybookEdits(sb: SupabaseClient, userId: string, edits: PlaybookEdit[], source: string): Promise<{ applied: number }> {
  try {
    let applied = 0;
    await mutatePlaybook(sb, userId, (cur) => {
      const r = applyEdits(cur.rules, edits);
      applied = r.applied;
      return r.applied ? r.rules : null;
    }, typeof source === "string" && source ? source : "core");
    return { applied };
  } catch (e) {
    console.warn("[playbook] edits not saved:", e instanceof Error ? e.message : e);
    return { applied: 0 };
  }
}
