import type { SupabaseClient } from "@supabase/supabase-js";
import { rrfMerge, toOrQuery } from "./pure.ts";
import { exactMatchIds, exactTerms, isMissingColumn, PROVENANCE_COLUMNS } from "./provenance-pure.ts";
import { isCurrent, type Legacy } from "./memory-types-pure.ts";
import { CANDIDATE_LIMIT, memoryLimit, memoryProject, memoryProjectFilter, selectCoreMemoryIds, type MemoryMetadata } from "./memory-retrieval-pure.ts";

export const MEMORY_COLUMNS = "id, kind, title, content, source, url, storage_path, tags, folder, visibility, created_at, updated_at";
// includeJournal: only the owner's own MEMORY search. CORE and agents never get journal entries (LIFE data; it would also leave
// the turn untainted while private text is in context). The vector pool can't filter, so hydration drops them too.
// journalVectors: false when journal vectors come from another model than the query's (embeddings journalVectorsComparable):
// journals are then ranked by keyword only and the mode says so.
export type MemorySearchOptions = { projectName?: string; projectScope?: string; projectLegacy?: Legacy; chatId?: string; coreSummariesOnly?: boolean; includeJournal?: boolean; kind?: string; exact?: boolean; journalVectors?: boolean }; // kind: only that kind (episodes.ts recall); exact: names/ids first (CORE); chatId: the chat asking (chat-scoped memories)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped rows the client returned before
type Hydrated = { data: any[] | null; error: { code?: string; message?: string } | null };
type EmbedQuery = (text: string, type: "query") => Promise<number[] | null>;

/** Candidate retrieval is separate from the Claude bridge so the real query flow can be tested offline. */
export async function retrieveMemories(sb: SupabaseClient, query: string, limit: number, userId: string | undefined, embed: EmbedQuery, options: MemorySearchOptions = {}) {
  const count = memoryLimit(limit);
  if (!count) return { results: [], mode: "fulltext" };
  const project = options.coreSummariesOnly ? "" : memoryProject(options.projectName);
  const ftsIds = async (text: string) => {
    const q = toOrQuery(text);
    if (!q) return { data: [] as { id: string }[], error: null };
    let base = sb.from("memories").select("id");
    if (options.coreSummariesOnly) base = base.eq("kind", "conversation").eq("source", "core-summary");
    if (!options.includeJournal) base = base.neq("kind", "journal");
    if (options.kind) base = base.eq("kind", options.kind);
    return await (userId ? base.eq("user_id", userId) : base)
      .textSearch("fts", q, { type: "websearch", config: "english" })
      .limit(CANDIDATE_LIMIT);
  };
  // Names and ids in the question ("Marko", "pet sim", a uuid) match exactly and go first; best-effort.
  const terms = !options.exact || options.coreSummariesOnly ? [] : exactTerms(query).slice(0, 5);
  const [fts, vec, context, exact] = await Promise.all([
    ftsIds(query),
    embed(query, "query").then((e) => e ? sb.rpc(options.coreSummariesOnly ? "match_core_summaries" : "match_memories", { query_embedding: JSON.stringify(e), match_count: CANDIDATE_LIMIT }) : null),
    project ? (async () => {
      const base = sb.from("memories").select("id,title,tags,folder");
      return await (userId ? base.eq("user_id", userId) : base).or(memoryProjectFilter(project))
        .order("updated_at", { ascending: false }).order("id").limit(CANDIDATE_LIMIT);
    })().catch(() => null) : Promise.resolve(null),
    terms.length ? (async () => {
      const ors = terms.map((t) => /^[0-9a-f-]{36}$/.test(t) ? `id.eq.${t}` : memoryProjectFilter(t)).join(",");
      let base = sb.from("memories").select("id,kind,title,tags,folder").or(ors).neq("kind", "journal");
      if (options.kind) base = base.eq("kind", options.kind);
      return await (userId ? base.eq("user_id", userId) : base).order("updated_at", { ascending: false }).limit(CANDIDATE_LIMIT);
    })().catch(() => null) : Promise.resolve(null),
  ]);
  if (fts.error) throw fts.error;
  if (vec?.error) throw vec.error;
  // A project hint is best-effort: a failed extra lookup must not break ordinary memory search.
  const projectRows = context?.error ? [] : (context?.data ?? []) as MemoryMetadata[];
  const ranked = rrfMerge([
    (fts.data ?? []).map((r) => r.id as string),
    ((vec?.data ?? []) as { id: string; kind?: string }[]).filter((r) => options.journalVectors !== false || r.kind !== "journal").map((r) => r.id), // never mixed models
  ]);
  const exactIds = exact?.error ? [] : exactMatchIds(terms, (exact?.data ?? []) as (MemoryMetadata & { kind: string })[]).slice(0, 3);
  const ids = [...new Set([...exactIds, ...selectCoreMemoryIds(ranked.map((r) => r.id), projectRows, query, count, project)])].slice(0, count);
  const mode = !vec ? "fulltext" : options.includeJournal && options.journalVectors === false ? "hybrid-journal-keyword" : "hybrid";
  if (!ids.length) return { results: [], mode };
  const hydrate = (cols: string) => {
    let base = sb.from("memories").select(cols).in("id", ids);
    if (options.coreSummariesOnly) base = base.eq("kind", "conversation").eq("source", "core-summary");
    if (!options.includeJournal) base = base.neq("kind", "journal");
    if (options.kind) base = base.eq("kind", options.kind);
    // Keep the explicit owner filter on hydration too: admin/background clients bypass RLS.
    return userId ? base.eq("user_id", userId) : base;
  };
  let { data, error } = await hydrate(`${MEMORY_COLUMNS}, ${PROVENANCE_COLUMNS}`) as Hydrated;
  if (isMissingColumn(error)) ({ data, error } = await hydrate(MEMORY_COLUMNS) as Hydrated); // until migration 0019
  if (error) throw error;
  const byId = new Map((data ?? []).map((m) => [m.id as string, m]));
  const candidates = ids.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m)
    // Model-facing searches (CORE, agents, court, episodes) only get what is current HERE: never another chat's or project's
    // scoped instruction, an expired one or a superseded copy. The owner's own MEMORY search (includeJournal) sees everything.
    .filter((m) => options.includeJournal || isCurrent(m, { now: Date.now(), project: options.projectScope, chat: options.chatId, legacy: options.projectLegacy })); // projectName only ranks; scope decides
  return { results: candidates, mode };
}
