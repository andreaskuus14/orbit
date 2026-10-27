import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { parseVec } from "./sleep-pure";
import { buildGraph, graphHint, parseGraph, type Graph } from "./memory-graph-pure";

// Knowledge graph cache: <ORBIT data dir>/memory-graph.json, rebuilt nightly (the night shift's hygiene step) from the stored
// embeddings; no embedding or model call. Journal entries are never included. One file: ORBIT has one owner.
const file = () => path.join(orbitDataDir(), "memory-graph.json");
const LIMIT = 500; // shortcut: newest 500 memories only (the silhouette pass is O(n²)); sample or batch when the store outgrows it

export const loadGraph = async (): Promise<Graph | null> => parseGraph(await readFile(file(), "utf8").catch(() => ""));

export async function rebuildGraph(sb: SupabaseClient, userId: string): Promise<Graph> {
  const { data, error } = await sb.from("memories").select("id, title, content, tags, embedding").eq("user_id", userId)
    .neq("kind", "journal").order("created_at", { ascending: false }).limit(LIMIT);
  if (error) throw error;
  const g = buildGraph((data ?? []).map((m) => ({ id: m.id, title: m.title ?? "", content: String(m.content ?? ""), tags: (m.tags ?? []) as string[], embedding: parseVec(m.embedding) })), new Date().toISOString());
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(g));
  await rename(file() + ".tmp", file());
  return g;
}

/** The cached graph; built once on first use so MEMORY isn't empty before the first night. */
export const getGraph = async (sb: SupabaseClient, userId: string) => (await loadGraph()) ?? rebuildGraph(sb, userId);

/** CORE context line with the cluster names; "" without a cache (never computes inside a chat turn). */
export const graphContext = () => loadGraph().then(graphHint, () => "");
