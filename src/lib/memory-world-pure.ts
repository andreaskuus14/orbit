// MEMORY world helpers: no Three/React. Layout itself lives in memory-map-pure.ts.

/** Saved by CORE on its own (vs. captured by the user). Same rule the MEMORY list uses for "LEARNED BY CORE". */
export const isLearned = (source: string | null | undefined) => source === "core" || source === "core-auto" || source === "core-summary";

/** pgvector arrives as "[0.1,0.2,…]" over PostgREST; anything else (null, NaN, garbage) is no embedding. */
export function parseEmbedding(v: unknown): number[] | undefined {
  let arr: unknown = v;
  if (typeof v === "string") { try { arr = JSON.parse(v); } catch { return undefined; } }
  return Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === "number" && Number.isFinite(x)) ? arr as number[] : undefined;
}

export type StarMeta = { id: string; title: string; kind: string; tags: string[] };

/** Indices of stars whose title, kind or a tag contains every word of the query (case-insensitive). */
export function searchStars(items: StarMeta[], query: string): number[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: number[] = [];
  items.forEach((m, i) => {
    const hay = `${m.title} ${m.kind} ${m.tags.join(" ")}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push(i);
  });
  return out;
}

/** Centroid of the given points (camera target for a set of search hits); origin when empty. */
export function centroid(pts: { x: number; y: number; z: number }[]): [number, number, number] {
  if (!pts.length) return [0, 0, 0];
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p.x; y += p.y; z += p.z; }
  return [x / pts.length, y / pts.length, z / pts.length];
}
