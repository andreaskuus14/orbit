// Small in-memory TTL + LRU cache with in-flight sharing (efficiency pass, Nov 2026). Pure: no IO, the clock is passed in.
// Used where the same input gives the same answer within minutes: query embeddings (embeddings.ts), article text (news.ts).
// Only results that pass `keep` are stored, so a failure (null) is retried next time instead of being remembered.

export type TtlCache<V> = {
  /** A fresh cached value, or undefined (expired entries are dropped). */
  get(key: string): V | undefined;
  set(key: string, v: V): void;
  /** Cached value, else the in-flight promise for the same key, else run(); a result passing keep() is cached. */
  memo(key: string, run: () => Promise<V>, keep?: (v: V) => boolean): Promise<V>;
  readonly size: number;
  clear(): void;
};

export function createTtlCache<V>(o: { max: number; ttlMs: number; now?: () => number }): TtlCache<V> {
  const now = o.now ?? Date.now;
  const map = new Map<string, { at: number; v: V }>();
  const inflight = new Map<string, Promise<V>>();
  const get = (key: string): V | undefined => {
    const e = map.get(key);
    if (!e) return undefined;
    if (now() - e.at >= o.ttlMs) { map.delete(key); return undefined; }
    map.delete(key); map.set(key, e); // LRU: most recent last
    return e.v;
  };
  const set = (key: string, v: V) => {
    map.delete(key);
    map.set(key, { at: now(), v });
    while (map.size > o.max) map.delete(map.keys().next().value as string);
  };
  return {
    get, set,
    memo(key, run, keep = (v) => v !== null && v !== undefined) {
      const hit = get(key);
      if (hit !== undefined) return Promise.resolve(hit);
      const cur = inflight.get(key);
      if (cur) return cur;
      const p = run().then((v) => { if (keep(v)) set(key, v); return v; }).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    get size() { return map.size; },
    clear() { map.clear(); },
  };
}

/** An env switch that is on unless set to "0" / "off" / "false". */
export const envOn = (raw: string | undefined) => !/^(0|off|false|no)$/i.test((raw ?? "").trim());
