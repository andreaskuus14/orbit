import { BSKY, parseBsky, type ReachItem } from "./pure";
import { getJson, hintFor } from "./net";

/** Top Bluesky posts of the last day per query (anonymous AppView search). */
export async function readBsky(queries: string[], now = Date.now()): Promise<{ items: ReachItem[]; hints: string[] }> {
  const items: ReachItem[] = [], hints: string[] = [];
  for (const q of queries) {
    try { items.push(...parseBsky(await getJson(BSKY.search(q, new Date(now - 86_400_000))))); }
    catch (e) { hints.push(hintFor(`Bluesky "${q}"`, e)); }
  }
  return { items, hints };
}
