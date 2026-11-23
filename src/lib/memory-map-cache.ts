// The MEMORY map's per-process cache (one server on the owner's PC), shared so an edit can drop it: the key is the row count,
// so an add or delete misses it by itself, but a title or tag edit used to wait out the 5-minute TTL (stale names on the map).
const cache = new Map<string, { at: number; body: unknown }>();
export const MAP_TTL = 5 * 60_000;
export function mapCacheGet(userId: string, count: number): unknown | null {
  const hit = cache.get(`${userId}:${count}`);
  return hit && Date.now() - hit.at < MAP_TTL ? hit.body : null;
}
export function mapCacheSet(userId: string, count: number, body: unknown) {
  bustMapCache(userId);
  cache.set(`${userId}:${count}`, { at: Date.now(), body });
}
export function bustMapCache(userId: string) { for (const k of cache.keys()) if (k.startsWith(`${userId}:`)) cache.delete(k); }
