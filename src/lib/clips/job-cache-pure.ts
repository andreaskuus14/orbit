// STUDIO job list cache (efficiency pass 2). listJobs used to read and JSON.parse every job file ever made on each 2-5 s poll.
// Now a parsed job is reused while its file's stamp (mtime, size, inode) is unchanged; this process's own saves drop the entry
// too (factory.ts saveState), so a rewrite inside one mtime tick is never missed. Pure; tested in tests/efficiency2.test.ts.
// ORBIT_JOB_CACHE=0 = read every file every time, as before.

export type Stamp = { mtimeMs: number; size: number; ino: number };
export const stampOf = (s: { mtimeMs: number; size: number; ino?: number | bigint }): Stamp => ({ mtimeMs: s.mtimeMs, size: s.size, ino: Number(s.ino ?? 0) });
const same = (a: Stamp, b: Stamp) => a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino;

export function createJobCache<T>() {
  const map = new Map<string, { stamp: Stamp; v: T }>();
  return {
    /** The cached value when the file is unchanged, else undefined. */
    get(id: string, stamp: Stamp): T | undefined { const e = map.get(id); return e && same(e.stamp, stamp) ? e.v : undefined; },
    set(id: string, stamp: Stamp, v: T) { map.set(id, { stamp, v }); },
    drop(id: string) { map.delete(id); },
    /** Forget files that are gone (deleted or quarantined). */
    keepOnly(ids: Iterable<string>) { const keep = new Set(ids); for (const k of [...map.keys()]) if (!keep.has(k)) map.delete(k); },
    get size() { return map.size; },
  };
}

/** A strong ETag for a JSON body (the clip list): same bytes, same tag. */
export const etagFor = (hashHex: string) => `"${hashHex.slice(0, 32)}"`;
/** If-None-Match matches this tag (a list, `*`, or a weak form of it). */
export function etagMatches(header: string | null, tag: string): boolean {
  if (!header) return false;
  return header.split(",").map((t) => t.trim().replace(/^W\//, "")).some((t) => t === tag || t === "*");
}
