// While the galaxy idles (its background shader warm-up done), the code of the worlds the owner is likely to open next is
// fetched ahead, so opening one skips the chunk download and parse. No GL work: each world has its own context.

/** The worlds to prefetch, most visited first (ties keep `all`'s order), at most `n`. */
export function prefetchOrder(visits: Readonly<Record<string, number>>, all: readonly string[], n = 3): string[] {
  const v = (id: string) => (Number.isFinite(visits[id]) ? visits[id] : 0);
  return all.map((id, i) => ({ id, i })).sort((a, b) => v(b.id) - v(a.id) || a.i - b.i).slice(0, Math.max(0, n)).map((x) => x.id);
}

/** Visit counts as stored (JSON); anything malformed reads as no visits. */
export function parseVisits(raw: string | null): Record<string, number> {
  try {
    const o: unknown = JSON.parse(raw ?? "{}");
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    return Object.fromEntries(Object.entries(o).filter(([, x]) => typeof x === "number" && Number.isFinite(x) && x > 0)) as Record<string, number>;
  } catch { return {}; }
}
