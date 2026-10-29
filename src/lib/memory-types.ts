// IO half of memory-types-pure.ts: before CORE sees retrieved memories, pull in scoped corrections of them and keep only
// what is current here (roadmap 24–25). Search already hydrates 0019 provenance; without it everything counts as confirmed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMORY_COLUMNS } from "./memory-search";
import { currentOnly, type Typed } from "./memory-types-pure";

type Row = Record<string, unknown> & Typed & { id: string };
export async function currentMemories<T extends Record<string, unknown>>(sb: SupabaseClient, userId: string, results: T[], project: string, chat?: string): Promise<T[]> {
  const ids = results.map((m) => String(m.id));
  if (!ids.length) return results;
  const fix = await sb.from("memories").select(MEMORY_COLUMNS).eq("user_id", userId).overlaps("tags", ids.map((id) => `corrects:${id}`)).limit(20);
  const corrections = (fix.data ?? []) as unknown as Row[];
  const rows = [...(results as unknown as Row[]), ...corrections];
  const keep = currentOnly(rows, { now: Date.now(), project, chat });
  // A correction that applies here takes the place of the memory it corrects.
  return [...new Map(keep.map((r) => [r.id, r])).values()] as unknown as T[];
}
