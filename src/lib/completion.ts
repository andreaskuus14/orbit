import type { SupabaseClient } from "@supabase/supabase-js";
import { matchesStored } from "./completion-pure.ts";

/** Confirm a write with an independent, owner-scoped read. Never retry a side effect when confirmation fails. */
export async function verifyRow(sb: SupabaseClient, userId: string, table: "memories" | "projects" | "tasks" | "automations", id: string, expected: Record<string, unknown>) {
  const { data, error } = await sb.from(table).select(Object.keys(expected).join(",")).eq("user_id", userId).eq("id", id).maybeSingle();
  if (error || !matchesStored(expected, data as Record<string, unknown> | null))
    throw new Error(`Write confirmation failed for ${table} ${id}. It may already exist; inspect it before trying again.`);
}
