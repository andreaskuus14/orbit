import { lookup } from "node:dns/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed } from "./embeddings";
import { emit } from "./claude";
import { rrfMerge, isPrivateIp, htmlToText, toOrQuery } from "./pure";

import { KINDS, type Kind } from "./kinds";
export { KINDS, type Kind };

export type MemoryInput = {
  kind: Kind;
  title: string;
  content: string;
  source: string;
  url?: string | null;
  storage_path?: string | null;
  tags?: string[];
  folder?: string | null;
};

export const MEMORY_COLUMNS = "id, kind, title, content, source, url, storage_path, tags, folder, visibility, created_at, updated_at";

const SUGGEST_THRESHOLD = 0.6;

/** Store a memory, embed it, emit a universe event, and suggest (never auto-confirm) related memories. */
export async function createMemory(sb: SupabaseClient, userId: string, input: MemoryInput) {
  const embedding = await embed(`${input.title}\n\n${input.content}`, "document");
  const { data, error } = await sb
    .from("memories")
    .insert({ ...input, user_id: userId, embedding: embedding ? JSON.stringify(embedding) : null })
    .select(MEMORY_COLUMNS)
    .single();
  if (error) throw error;

  let suggested = 0;
  if (embedding) {
    const { data: similar, error: simErr } = await sb.rpc("match_memories", {
      query_embedding: JSON.stringify(embedding), match_count: 3, exclude_id: data.id,
    });
    if (simErr) console.error("[orbit] link suggestion failed", simErr);
    const links = ((similar ?? []) as { id: string; similarity: number }[])
      .filter((s) => s.similarity >= SUGGEST_THRESHOLD)
      .map((s) => ({ user_id: userId, from_id: data.id, to_id: s.id, score: s.similarity, reason: "semantic similarity" }));
    if (links.length) {
      const { error: linkErr } = await sb.from("memory_links").insert(links);
      if (linkErr) console.error("[orbit] failed to store suggestions", linkErr);
      else suggested = links.length;
    }
  }

  await emit(sb, userId, "memory.created", "memory", { id: data.id, title: data.title, kind: data.kind, source: data.source, suggested });
  return { memory: data, embedded: !!embedding, suggested };
}

/** The caller's memories whose embedding is at least `min` cosine-similar to `text` ([] when embeddings are off). Needs a user-session client (match_memories filters by auth.uid()). */
export async function findSimilar(sb: SupabaseClient, text: string, min = 0.9, count = 3) {
  const e = await embed(text, "document");
  if (!e) return [];
  const { data, error } = await sb.rpc("match_memories", { query_embedding: JSON.stringify(e), match_count: count });
  if (error) throw error;
  return ((data ?? []) as { id: string; title: string; kind: string; similarity: number }[]).filter((m) => m.similarity >= min);
}

/** Hybrid search: Postgres full-text + pgvector similarity, fused by reciprocal rank. */
/** userId is required when sb bypasses row-level security (background automations); harmless otherwise. */
export async function searchMemories(sb: SupabaseClient, query: string, limit = 10, userId?: string) {
  const [fts, vec] = await Promise.all([
    toOrQuery(query)
      ? (userId ? sb.from("memories").select("id").eq("user_id", userId) : sb.from("memories").select("id"))
          .textSearch("fts", toOrQuery(query), { type: "websearch", config: "english" }).limit(25)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    embed(query, "query").then((e) =>
      e ? sb.rpc("match_memories", { query_embedding: JSON.stringify(e), match_count: 25 }) : null,
    ),
  ]);
  if (fts.error) throw fts.error;
  if (vec?.error) throw vec.error;

  const ranked = rrfMerge([
    (fts.data ?? []).map((r) => r.id as string),
    ((vec?.data ?? []) as { id: string }[]).map((r) => r.id),
  ]).slice(0, limit);
  if (!ranked.length) return { results: [], mode: vec ? "hybrid" : "fulltext" };

  const base = sb.from("memories").select(MEMORY_COLUMNS).in("id", ranked.map((r) => r.id));
  const { data, error } = await (userId ? base.eq("user_id", userId) : base);
  if (error) throw error;
  const byId = new Map((data ?? []).map((m) => [m.id as string, m]));
  return {
    results: ranked.map((r) => byId.get(r.id)).filter((m): m is NonNullable<typeof m> => !!m),
    mode: vec ? "hybrid" : "fulltext",
  };
}

/** GET a public http(s) URL, following redirects manually and refusing private/internal addresses (SSRF guard). */
export async function safeFetch(rawUrl: string, accept: string, userAgent = "ORBIT/0.2 (personal knowledge assistant)"): Promise<{ res: Response; url: URL }> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) links are allowed");
    const addrs = await lookup(url.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("That address is not publicly reachable");

    // shortcut: DNS is checked before fetch, so a rebinding DNS server could still race it; pin the IP via a custom agent if ORBIT ever runs multi-tenant.
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": userAgent, Accept: accept, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new Error(`The site answered ${res.status}`);
    return { res, url };
  }
  throw new Error("Too many redirects");
}

/** Fetch a public web page for link capture. */
export async function fetchPage(rawUrl: string): Promise<{ title: string; text: string; url: string }> {
  const { res, url } = await safeFetch(rawUrl, "text/html,text/plain");
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html") && !type.includes("text/plain")) throw new Error(`Unsupported content type: ${type || "unknown"}`);
  const body = (await res.text()).slice(0, 2_000_000);
  const page = type.includes("text/html") ? htmlToText(body) : { title: "", text: body };
  return { title: page.title || url.hostname, text: page.text.slice(0, 50_000), url: url.toString() };
}
