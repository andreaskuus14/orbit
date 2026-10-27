// Time questions IO (rules: when-pure.ts): Chronicle's gathering (journal never read) → the range's facts for CORE, or Rewind's timeline.
// No model call. A birthday comes from a current belief (memory_facts) mentioning it; only its date is used.
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDay } from "./week-pure";
import { buildChronicle } from "./chronicle-pure";
import { gather } from "./chronicle";
import { anchorRange, birthdayRange, parseWhen, rangeBlock, rewindDays, timeQuestion, type Range, type When } from "./when-pure";

async function resolve(sb: SupabaseClient, userId: string, w: When, now: number) {
  const c = buildChronicle(await gather(sb, userId, false, now));
  let r: Range | null = null;
  if ("from" in w) r = w;
  else if ("anchor" in w) r = anchorRange(c.moments, w.anchor, localDay(now));
  else {
    const { data } = await sb.from("memory_facts").select("statement").eq("user_id", userId).eq("status", "current").or("subject.ilike.%birth%,statement.ilike.%birth%").limit(5);
    for (const f of data ?? []) if ((r = birthdayRange(String(f.statement), now))) break;
  }
  return { r, moments: c.moments };
}

/** CORE's block for a time question ("" when the message isn't one, or on any failure). */
export async function rangeContext(sb: SupabaseClient, userId: string, question: string, now = Date.now()): Promise<string> {
  try {
    const w = timeQuestion(question, now);
    if (!w) return "";
    const { r, moments } = await resolve(sb, userId, w, now);
    return r ? rangeBlock(moments, r) : `TIME RANGE: couldn't place "${w.label}" in ORBIT's records (no stored date or matching moment). Say so.`;
  } catch (e) { console.warn("[when] skipped:", e instanceof Error ? e.message : e); return ""; }
}

/** MEMORY → Rewind: a time phrase → its timeline. */
export async function rewind(sb: SupabaseClient, userId: string, phrase: string, now = Date.now()) {
  const w = parseWhen(phrase, now);
  if (!w) return { error: "Try a time like “in March”, “last week” or “between Oct 1 and 15”." };
  const { r, moments } = await resolve(sb, userId, w, now);
  return r ? { range: r, days: rewindDays(moments, r) } : { error: `Couldn't find ${w.label} in ORBIT's records.` };
}
