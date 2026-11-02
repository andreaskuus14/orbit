import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "./proactive-pure";
import { extractFacts, planFact, factsBlock, type Fact } from "./facts-pure";
import { OWNER, entityBlock, factEntityId, pickCards, withFacts, type Card } from "./entity-memory-pure";

export type { Fact };
export const FACTS_MISSING_MSG = "Apply supabase/migrations/0012_fact_history.sql in the Supabase SQL editor. Apply 0008_memory_facts.sql first only if the memory_facts table is missing.";
const COLUMNS = "id, subject, statement, status, source, source_ref, confidence, supersedes, superseded_by, superseded_at, restored_from, created_at, updated_at";
const RECHECK_MS = 10 * 60_000;
let missingAt = 0, logged = false;
const unavailable = () => missingAt > 0 && Date.now() - missingAt < RECHECK_MS;
function gone(error: { code?: string; message?: string } | null): boolean {
  if (!isMissingTable(error) && !["42703", "PGRST202", "PGRST204"].includes(error?.code ?? "")) return false;
  missingAt = Date.now();
  if (!logged) { logged = true; console.warn(`[facts] history upgrade missing; beliefs are off. ${FACTS_MISSING_MSG}`); }
  return true;
}
export class FactsMissing extends Error { constructor() { super(FACTS_MISSING_MSG); } }
export class FactConflict extends Error { constructor() { super("That belief changed meanwhile; reload and try again."); } }
const check = (error: { code?: string; message?: string } | null) => {
  if (!error) return;
  if (error.code === "23505" || error.code === "PT409") throw new FactConflict();
  throw gone(error) ? new FactsMissing() : error;
};

/** Keep every version available for review/restore; page past Supabase's response limit. */
export async function listFacts(sb: SupabaseClient, userId: string): Promise<Fact[]> {
  if (unavailable()) throw new FactsMissing();
  const rows = new Map<string, Fact>();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await sb.from("memory_facts").select(COLUMNS).eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
    check(error);
    for (const f of (data ?? []) as Fact[]) rows.set(f.id, f);
    if (!data || data.length < 500) break;
  }
  missingAt = 0;
  const facts = [...rows.values()];
  const refs = [...new Set(facts.filter((f) => f.source === "user_said" && f.source_ref).map((f) => f.source_ref!))];
  if (!refs.length) return facts;
  const sources = new Map<string, { content: string; created_at: string }>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data } = await sb.from("messages").select("id, content, created_at").eq("user_id", userId).eq("role", "user").in("id", refs.slice(i, i + 200)).limit(200);
    for (const m of data ?? []) sources.set(m.id, m);
  }
  return facts.map((f) => {
    const source = f.source === "user_said" && f.source_ref ? sources.get(f.source_ref) : null;
    return source ? { ...f, source_text: String(source.content).slice(0, 1000), source_created_at: source.created_at } : f;
  });
}

// entity_id arrives with migration 0024; until then it is worked out from the subject on every read.
let entityCol = true;
async function current(sb: SupabaseClient, userId: string, subjects?: string[]): Promise<Fact[]> {
  const run = (cols: string) => {
    let q = sb.from("memory_facts").select(cols).eq("user_id", userId).eq("status", "current");
    if (subjects) q = q.in("subject", subjects);
    return q.order("created_at", { ascending: false }).limit(200);
  };
  let r = await run(entityCol ? `${COLUMNS}, entity_id` : COLUMNS);
  if (entityCol && r.error?.code === "42703") { entityCol = false; r = await run(COLUMNS); }
  check(r.error); return (r.data ?? []) as unknown as Fact[];
}
const cards = (userId: string): Promise<Card[]> => import("./entity-graph").then((m) => m.cardsOf(userId)).catch(() => []); // no scan yet / unreadable: no cards
const entityOf = (f: Fact, cs: Card[]) => f.entity_id || factEntityId(f.subject, cs);

/** Authenticated RPC: one transaction, with owner/message provenance checked again in the database. */
async function writeFact(sb: SupabaseClient, params: Record<string, unknown>): Promise<{ fact: Fact; changed: boolean }> {
  if (unavailable()) throw new FactsMissing();
  const { data, error } = await sb.rpc("write_memory_fact", params);
  check(error);
  if (!data?.fact?.id) throw new Error("Belief update was not confirmed.");
  return data;
}

/** Current owner facts only; a linked predecessor supplies separately labelled historical metadata. Beliefs and memory claims
 *  about another person/company/project named in the question follow, grouped under that entity (entity-memory-pure.ts). */
export async function factsContext(sb: SupabaseClient, userId: string, question: string): Promise<string> {
  const cs = await cards(userId), picked = pickCards(cs, question), ids = new Set(picked.map((c) => c.id));
  const split = (all: Fact[]) => {
    const succ = new Map(all.filter((f) => f.status === "current" && f.supersedes).map((f) => [f.supersedes!, f]));
    const about = (f: Fact) => entityOf(succ.get(f.id) ?? f, cs); // a predecessor belongs to its successor's entity
    // A belief about an entity he did not name (or one without a card yet) stays in his own block, as before.
    const own = all.filter((f) => !ids.has(about(f)));
    return [factsBlock(own, question), entityBlock(picked.map((c) => withFacts(c, all.filter((f) => about(f) === c.id))))].filter(Boolean).join("\n\n");
  };
  if (unavailable()) return split([]);
  try {
    const active = await current(sb, userId);
    const prev = active.filter((f) => f.source === "user_said" && f.supersedes).map((f) => f.supersedes!);
    if (!prev.length) return split(active);
    const { data, error } = await sb.from("memory_facts").select(COLUMNS).eq("user_id", userId).eq("status", "superseded").eq("source", "user_said").in("id", prev).limit(200);
    check(error);
    return split([...active, ...((data ?? []) as Fact[])]);
  } catch (e) { if (!(e instanceof FactsMissing)) console.warn("[facts] context skipped:", e instanceof Error ? e.message : e); return split([]); }
}

/** Only the persisted owner's own message, never an answer, memory, web page, agent result or attachment. */
export async function learnFacts(sb: SupabaseClient, userId: string, userText: string, messageId: string | null, attachments = false): Promise<number> {
  if (unavailable() || attachments || !messageId) return 0;
  const found = extractFacts(userText, { attachments, origin: "user" });
  if (!found.length) return 0;
  try {
    const { data: source, error } = await sb.from("messages").select("id, content").eq("user_id", userId).eq("id", messageId).eq("role", "user").maybeSingle();
    check(error);
    if (!source || source.content !== userText) return 0;
    let cur = await current(sb, userId, found.map((c) => c.subject)), saved = 0;
    const cs = await cards(userId);
    for (const c of found) {
      if (planFact(cur, c).op === "skip") continue;
      try {
        const result = await writeFact(sb, { p_action: "learn", p_subject: c.subject, p_statement: c.statement, p_source_ref: messageId, p_confidence: c.confidence });
        if (result.changed) saved++;
        const entity = factEntityId(result.fact.subject, cs);
        // Pin the entity id on the row (stable if the name later changes); best-effort, skipped until migration 0024.
        if (result.changed && entity !== OWNER && entityCol) {
          const { error: tagErr } = await sb.from("memory_facts").update({ entity_id: entity }).eq("user_id", userId).eq("id", result.fact.id);
          if (tagErr?.code === "42703" || tagErr?.code === "PGRST204") entityCol = false;
        }
        cur = [...cur.filter((f) => f.subject !== result.fact.subject), result.fact];
      } catch (e) { if (!(e instanceof FactConflict)) throw e; }
    }
    return saved;
  } catch (e) { if (!(e instanceof FactsMissing)) console.warn("[facts] not saved:", e instanceof Error ? e.message : e); return 0; }
}

export async function editFact(sb: SupabaseClient, _userId: string, id: string, subject: string, statement: string): Promise<Fact> {
  return (await writeFact(sb, { p_action: "edit", p_id: id, p_subject: subject, p_statement: statement })).fact;
}
/** Mark wrong without losing history or implicitly reactivating an older belief. */
export async function forgetFact(sb: SupabaseClient, _userId: string, id: string): Promise<void> {
  await writeFact(sb, { p_action: "wrong", p_id: id });
}
/** Explicit restore creates a fresh version; it never reverses the old history chain. */
export async function restoreFact(sb: SupabaseClient, _userId: string, id: string): Promise<Fact> {
  return (await writeFact(sb, { p_action: "restore", p_id: id })).fact;
}
