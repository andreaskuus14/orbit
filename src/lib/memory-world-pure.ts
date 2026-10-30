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

type P3 = { id: string; x: number; y: number; z: number };
/** MEM06: stars keep their place between refreshes. Known ids keep their previous position; new ones keep the fresh layout's
 *  position, shifted by how far the shared stars' centre moved (a new memory can re-orient the whole PCA layout). */
export function stabilize<T extends P3>(prev: Map<string, [number, number, number]> | undefined, pts: T[]): T[] {
  if (!prev?.size) return pts;
  const shared = pts.filter((p) => prev.has(p.id));
  if (!shared.length) return pts;
  const was = centroid(shared.map((p) => { const [x, y, z] = prev.get(p.id)!; return { x, y, z }; })), now = centroid(shared);
  const d = [was[0] - now[0], was[1] - now[1], was[2] - now[2]];
  return pts.map((p) => { const k = prev.get(p.id); return k ? { ...p, x: k[0], y: k[1], z: k[2] } : { ...p, x: p.x + d[0], y: p.y + d[1], z: p.z + d[2] }; });
}

export type Conn = { i: number; kind: "explicit" | "inferred"; sim?: number };
/** What a selected star is joined to and why: explicit links (stated/confirmed) first, then inferred similarity, strongest first. */
export function connections(i: number, items: { id: string }[], links: { from: string; to: string }[], edges: [number, number, number][] = []): Conn[] {
  const id = items[i]?.id, at = new Map(items.map((m, j) => [m.id, j])), seen = new Set<number>([i]), out: Conn[] = [];
  if (id === undefined) return [];
  for (const l of links) {
    const j = l.from === id ? at.get(l.to) : l.to === id ? at.get(l.from) : undefined;
    if (j !== undefined && !seen.has(j)) { seen.add(j); out.push({ i: j, kind: "explicit" }); }
  }
  const inf = edges.filter(([a, b]) => a === i || b === i).sort((a, b) => b[2] - a[2]);
  for (const [a, b, sim] of inf) { const j = a === i ? b : a; if (!seen.has(j)) { seen.add(j); out.push({ i: j, kind: "inferred", sim }); } }
  return out;
}

/** MEM06: one project's subgraph (its "scope:" tag or folder), with the similarity edges re-indexed to the kept stars. */
export function subgraph<T extends { id: string; tags: string[]; folder?: string | null }>(items: T[], edges: [number, number, number][] | undefined, project: string) {
  const p = project.trim().toLowerCase(), keep: number[] = [];
  items.forEach((m, i) => { const of = (m.tags.find((t) => t.startsWith("scope:"))?.slice(6) || m.folder || "").toLowerCase(); if (of === p) keep.push(i); });
  const map = new Map(keep.map((old, j) => [old, j]));
  return { items: keep.map((i) => items[i]), edges: (edges ?? []).filter(([a, b]) => map.has(a) && map.has(b)).map(([a, b, s]) => [map.get(a)!, map.get(b)!, s] as [number, number, number]) };
}

/** Project names present on the stars, for the project filter. */
export const starProjects = (items: { tags: string[]; folder?: string | null }[]) =>
  [...new Set(items.map((m) => m.tags.find((t) => t.startsWith("scope:"))?.slice(6) || m.folder || "").filter(Boolean))].sort();
