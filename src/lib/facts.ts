import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./proactive-pure";
import { extractFacts, planFact, factsBlock, type Fact } from "./facts-pure";

export type { Fact };
export const FACTS_MISSING_MSG = "Run the memory upgrade SQL to enable (supabase/migrations/0008_memory_facts.sql in the Supabase SQL editor).";
const COLUMNS = "id, subject, statement, status, source, source_ref, confidence, supersedes, superseded_by, created_at, updated_at";
const RECHECK_MS = 10 * 60_000;

// Until migration 0008 is applied every call falls back to the old behaviour; re-checked every 10 minutes, logged once.
let missingAt = 0, logged = false;
const unavailable = () => missingAt > 0 && Date.now() - missingAt < RECHECK_MS;
function gone(error: { code?: string; message?: string } | null): boolean {
  if (!isMissingTable(error)) return false;
  missingAt = Date.now();
  if (!logged) { logged = true; console.warn(`[facts] memory_facts table missing; beliefs are off. ${FACTS_MISSING_MSG}`); }
  return true;
}
export class FactsMissing extends Error { constructor() { super(FACTS_MISSING_MSG); } }
/** Someone else changed the belief meanwhile (or it is no longer current). */
export class FactConflict extends Error { constructor() { super("That belief changed meanwhile; reload and try again."); } }
const check = (error: { code?: string; message?: string } | null) => { if (error) throw gone(error) ? new FactsMissing() : error; };

/** Every non-retracted fact, newest first (current + superseded history). Throws FactsMissing before the migration. */
export async function listFacts(sb: SupabaseClient, userId: string): Promise<Fact[]> {
  if (unavailable()) throw new FactsMissing();
  const { data, error } = await sb.from("memory_facts").select(COLUMNS).eq("user_id", userId).neq("status", "retracted").order("created_at", { ascending: false }).limit(500);
  check(error);
  missingAt = 0;
  return (data ?? []) as Fact[];
}

async function current(sb: SupabaseClient, userId: string, subjects?: string[]): Promise<Fact[]> {
  let q = sb.from("memory_facts").select(COLUMNS).eq("user_id", userId).eq("status", "current");
  if (subjects) q = q.in("subject", subjects);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
  check(error);
  return (data ?? []) as Fact[];
}

/**
 * Supersede the same-subject facts (only those still current, linked via superseded_by), then insert the new one.
 * Supersede first so the one-current-per-subject index holds; `must` = the edited id, which has to still be current.
 */
async function insertFact(sb: SupabaseClient, userId: string, row: Pick<Fact, "subject" | "statement" | "source" | "source_ref" | "confidence">, supersede: string[], must?: string) {
  const id = crypto.randomUUID();
  let done: string[] = [];
  const restore = async () => { if (done.length) await sb.from("memory_facts").update({ status: "current", superseded_by: null }).eq("user_id", userId).in("id", done); };
  if (supersede.length) {
    const { data, error } = await sb.from("memory_facts").update({ status: "superseded", superseded_by: id }).eq("user_id", userId).eq("status", "current").in("id", supersede).select("id");
    check(error);
    done = (data ?? []).map((r) => r.id as string);
    if (must && !done.includes(must)) { await restore(); throw new FactConflict(); }
  }
  const { data, error } = await sb.from("memory_facts").insert({ id, user_id: userId, ...row, supersedes: done[0] ?? null }).select(COLUMNS).single();
  if (error?.code === "23505") throw new FactConflict(); // a concurrent writer already made a current fact on this subject
  if (error) { await restore(); check(error); }
  return data as Fact;
}

/** "What I know about you" for CORE's prompt; "" when there is nothing or the table is missing. Never throws. */
export async function factsContext(sb: SupabaseClient, userId: string, question: string): Promise<string> {
  if (unavailable()) return "";
  try { return factsBlock(await current(sb, userId), question); }
  catch (e) { if (!(e instanceof FactsMissing)) console.warn("[facts] context skipped:", e instanceof Error ? e.message : e); return ""; }
}

/** After a CORE turn: learn facts from the USER's own message only (never CORE's answer or tool output). Never throws. */
export async function learnFacts(sb: SupabaseClient, userId: string, userText: string, messageId: string | null, attachments = false): Promise<number> {
  if (unavailable()) return 0;
  const found = extractFacts(userText, { attachments });
  if (!found.length) return 0;
  try {
    // Subjects are stored as extracted (lowercase), so an exact match finds the ones a candidate may replace.
    const cur = await current(sb, userId, found.map((c) => c.subject));
    let saved = 0;
    for (const c of found) {
      const plan = planFact(cur, c);
      if (plan.op === "skip") continue;
      try { cur.push(await insertFact(sb, userId, { ...c, source: "user_said", source_ref: messageId }, plan.supersede)); saved++; }
      catch (e) { if (!(e instanceof FactConflict)) throw e; }
    }
    return saved;
  } catch (e) {
    if (!(e instanceof FactsMissing)) console.warn("[facts] not saved:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** User edit: a new current version that supersedes the edited one, so the history shows what changed. */
export async function editFact(sb: SupabaseClient, userId: string, id: string, subject: string, statement: string): Promise<Fact> {
  const others = (await current(sb, userId, [subject])).filter((f) => f.id !== id).map((f) => f.id);
  return insertFact(sb, userId, { subject, statement, source: "user_said", source_ref: null, confidence: 1 }, [id, ...others], id);
}

/** Forget = retracted: CORE stops using it; it disappears from the beliefs screen. */
export async function forgetFact(sb: SupabaseClient, userId: string, id: string): Promise<void> {
  check((await sb.from("memory_facts").update({ status: "retracted" }).eq("user_id", userId).eq("id", id)).error);
}
