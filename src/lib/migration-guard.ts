// Fail-closed guard for migrations the code can't run safely without (version-pure GUARDED). One cached probe of their marker
// columns, refreshed every few minutes, so work unblocks by itself once the owner applies the file. Doctor uses the same probe.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./proactive-pure.ts";
import { blockedMsg, GUARDED, MIGRATION_MARKERS, type GuardedId } from "./version-pure.ts";

/** Read-only probe: a head select of the marker column. true = applied, false = confirmed missing, absent = couldn't tell. */
export async function probeMarkers(sb: SupabaseClient, ids = Object.keys(MIGRATION_MARKERS)): Promise<Record<string, boolean>> {
  const applied: Record<string, boolean> = {};
  await Promise.all(ids.map(async (id) => {
    const m = MIGRATION_MARKERS[id];
    const { error } = await sb.from(m.table).select(m.column ?? "*", { head: true }).limit(1).abortSignal(AbortSignal.timeout(5000));
    if (!error) applied[id] = true;
    else if (isMissingTable(error) || /column .* does not exist|42703/i.test(`${error.code} ${error.message}`)) applied[id] = false;
  }));
  return applied;
}

export class MigrationBlocked extends Error {}

const TTL = 3 * 60_000;
const g = globalThis as unknown as { __orbitMigGuard?: { at: number; v: Promise<Record<string, boolean>> } };
function guarded(sb: SupabaseClient, now = Date.now()) {
  const hit = g.__orbitMigGuard;
  if (hit && now - hit.at < TTL) return hit.v;
  const v = probeMarkers(sb, Object.keys(GUARDED));
  g.__orbitMigGuard = { at: now, v };
  v.catch(() => { g.__orbitMigGuard = undefined; });
  return v;
}

/** Guarded migrations confirmed missing (cached). */
export async function missingGuarded(sb: SupabaseClient): Promise<string[]> {
  const a = await guarded(sb);
  return Object.keys(GUARDED).filter((id) => a[id] === false);
}

/** Throws MigrationBlocked with the owner-facing message when `id` is confirmed missing. A probe that couldn't tell lets the
 *  real query run: without fallbacks it fails loudly on its own (and refuse() below then names the migration). */
export async function requireMigration(sb: SupabaseClient, id: GuardedId) {
  if ((await guarded(sb))[id] === false) throw new MigrationBlocked(blockedMsg(id));
}

/** A query just hit the missing column: drop the cache (so the next check re-probes) and return the refusal. */
export function refuse(id: GuardedId) {
  g.__orbitMigGuard = undefined;
  return new MigrationBlocked(blockedMsg(id));
}
