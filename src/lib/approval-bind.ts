// S02, server side: stamp quick-approve cards (Morning brief, Needs you) with the fingerprint of each task's waiting actions as
// they are when the card is served, so the one-tap Approve refuses if they change before the tap. Rules: approval-bind-pure.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { pendingSeen } from "./approval-bind-pure";
import type { Decision } from "./brief-pure";

export async function stampSeen(sb: SupabaseClient, userId: string, cards: Decision[]): Promise<Decision[]> {
  const ids = cards.flatMap((c) => (c.approve && "task" in c.approve ? [c.approve.task] : []));
  if (!ids.length) return cards;
  const { data, error } = await sb.from("tasks").select("id, pending").eq("user_id", userId).in("id", ids);
  if (error) return cards.map((c) => (c.approve && "task" in c.approve ? { ...c, approve: undefined } : c)); // can't fingerprint: open only, never a blind approve
  const seen = new Map((data ?? []).map((t) => [t.id as string, pendingSeen(t.pending ?? [])]));
  return cards.map((c) => (c.approve && "task" in c.approve && seen.has(c.approve.task) ? { ...c, approve: { ...c.approve, seen: seen.get(c.approve.task) } } : c));
}
