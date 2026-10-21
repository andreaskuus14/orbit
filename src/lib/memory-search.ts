import type { SupabaseClient } from "@supabase/supabase-js";
import { rrfMerge, toOrQuery } from "./pure.ts";
import { CANDIDATE_LIMIT, memoryLimit, memoryProject, memoryProjectFilter, selectCoreMemoryIds, type MemoryMetadata } from "./memory-retrieval-pure.ts";

export const MEMORY_COLUMNS = "id, kind, title, content, source, url, storage_path, tags, folder, visibility, created_at, updated_at";
export type MemorySearchOptions = { projectName?: string; coreSummariesOnly?: boolean };
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
    return await (userId ? base.eq("user_id", userId) : base)
      .textSearch("fts", q, { type: "websearch", config: "english" })
      .limit(CANDIDATE_LIMIT);
  };
  const [fts, vec, context] = await Promise.all([
    ftsIds(query),
    embed(query, "query").then((e) => e ? sb.rpc(options.coreSummariesOnly ? "match_core_summaries" : "match_memories", { query_embedding: JSON.stringify(e), match_count: CANDIDATE_LIMIT }) : null),
    project ? (async () => {
      const base = sb.from("memories").select("id,title,tags,folder");
      return await (userId ? base.eq("user_id", userId) : base).or(memoryProjectFilter(project))
        .order("updated_at", { ascending: false }).order("id").limit(CANDIDATE_LIMIT);
    })().catch(() => null) : Promise.resolve(null),
  ]);
  if (fts.error) throw fts.error;
  if (vec?.error) throw vec.error;
  // A project hint is best-effort: a failed extra lookup must not break ordinary memory search.
  const projectRows = context?.error ? [] : (context?.data ?? []) as MemoryMetadata[];
  const ranked = rrfMerge([
    (fts.data ?? []).map((r) => r.id as string),
    ((vec?.data ?? []) as { id: string }[]).map((r) => r.id),
  ]);
  const ids = selectCoreMemoryIds(ranked.map((r) => r.id), projectRows, query, count, project);
  const mode = vec ? "hybrid" : "fulltext";
  if (!ids.length) return { results: [], mode };
  let base = sb.from("memories").select(MEMORY_COLUMNS).in("id", ids);
  if (options.coreSummariesOnly) base = base.eq("kind", "conversation").eq("source", "core-summary");
  // Keep the explicit owner filter on hydration too: admin/background clients bypass RLS.
  const { data, error } = await (userId ? base.eq("user_id", userId) : base);
  if (error) throw error;
  const byId = new Map((data ?? []).map((m) => [m.id as string, m]));
  const candidates = ids.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);
  return { results: candidates, mode };
}
