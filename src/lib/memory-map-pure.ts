// MEMORY constellation coordinates only: no Three/React, clock, or random global state.
export type MapItem = { id: string; embedding?: number[]; kind: string; tags: string[] };
export type MapLink = { from: string; to: string };
export type MapPoint = { id: string; x: number; y: number; z: number };
const RADIUS = 20, GOLDEN = Math.PI * (3 - Math.sqrt(5));

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function random(seed: number): () => number {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
function sphere(i: number, count: number, radius: number): number[] {
  const y = 1 - 2 * (i + 0.5) / count, r = Math.sqrt(1 - y * y), a = i * GOLDEN;
  return [Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius];
}

/** Hierarchical Fibonacci anchors: kind, then first tag, then a seeded local cloud. */
function fallback(items: MapItem[], pos: Float64Array): void {
  const kinds = new Map<string, Map<string, number[]>>();
  items.forEach((item, i) => {
    const tags = kinds.get(item.kind) ?? new Map<string, number[]>(), tag = item.tags[0] ?? "";
    const group = tags.get(tag) ?? []; group.push(i); tags.set(tag, group); kinds.set(item.kind, tags);
  });
  [...kinds.keys()].sort().forEach((kind, ki) => {
    const tags = kinds.get(kind)!, center = kinds.size === 1 ? [0, 0, 0] : sphere(ki, kinds.size, 12);
    [...tags.keys()].sort().forEach((tag, ti) => {
      const members = tags.get(tag)!, offset = tags.size === 1 ? [0, 0, 0] : sphere(ti, tags.size, kinds.size === 1 ? 12 : 5);
      const radius = kinds.size === 1 && tags.size === 1 ? 17 : Math.min(5, Math.cbrt(members.length));
      members.forEach((index, j) => {
        const rng = random(hash(items[index].id) ^ index), local = sphere(j, members.length, radius * (0.4 + 0.6 * Math.cbrt(rng())));
        for (let d = 0; d < 3; d++) pos[index * 3 + d] = center[d] + offset[d] + local[d] + (rng() - 0.5) * 0.35;
      });
    });
  });
}

/** Three centered, deflated power iterations. Matrix-free covariance products cost O(n*d),
 * not O(d*d) storage. A bounded iteration budget keeps full-size embedding layouts interactive. */
function covariance(data: Float32Array, dim: number, vector: Float64Array, next: Float64Array): void {
  next.fill(0);
  // Four rows share vector reads and one accumulator write: keep the dense hot loop small.
  for (let at = 0; at < data.length; at += 4 * dim) {
    let a = 0, b = 0, c = 0, e = 0;
    for (let d = 0; d < dim; d++) {
      const v = vector[d];
      a += data[at + d] * v; b += data[at + dim + d] * v;
      c += data[at + 2 * dim + d] * v; e += data[at + 3 * dim + d] * v;
    }
    for (let d = 0; d < dim; d++) next[d] += data[at + d] * a + data[at + dim + d] * b + data[at + 2 * dim + d] * c + data[at + 3 * dim + d] * e;
  }
}

function center(items: MapItem[], ids: number[], dim: number, max: number): Float32Array {
  const mean = new Float64Array(dim), n = ids.length, scale = 1 / Math.max(max, 1e-300), meanScale = scale / n;
  // Pad with zero rows for the four-row covariance kernel; padded rows do not contribute.
  const data = new Float32Array(Math.ceil(n / 4) * 4 * dim);
  for (let i = 0; i < n; i++) {
    const row = items[ids[i]].embedding!;
    for (let d = 0; d < dim; d++) mean[d] += row[d] * meanScale;
  }
  for (let i = 0; i < n; i++) {
    const row = items[ids[i]].embedding!;
    for (let d = 0; d < dim; d++) data[i * dim + d] = row[d] * scale - mean[d];
  }
  return data;
}

function deflate(data: Float32Array, dim: number, n: number, vector: Float64Array, scores: Float64Array, axis: number): void {
  for (let i = 0; i < n; i++) {
    const at = i * dim; let dot = 0;
    for (let d = 0; d < dim; d++) dot += data[at + d] * vector[d];
    scores[i * 3 + axis] = dot;
    if (axis < 2) for (let d = 0; d < dim; d++) data[at + d] -= dot * vector[d];
  }
}

function principal(data: Float32Array, dim: number, iterations: number, rng: () => number): Float64Array | null {
  let vector = Float64Array.from({ length: dim }, () => rng() - 0.5), next = new Float64Array(dim);
  const initialNorm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  for (let d = 0; d < dim; d++) vector[d] /= initialNorm;
  for (let iteration = 0; iteration < iterations; iteration++) {
    covariance(data, dim, vector, next);
    const norm = Math.sqrt(next.reduce((sum, v) => sum + v * v, 0));
    if (norm < 1e-12) return null;
    let alignment = 0;
    for (let d = 0; d < dim; d++) { next[d] /= norm; alignment += next[d] * vector[d]; }
    [vector, next] = [next, vector];
    if (Math.abs(alignment) > 0.999999) break;
  }
  return vector;
}

function pca(items: MapItem[], pos: Float64Array): void {
  const dimensions = new Map<number, number>(), valid: number[] = [];
  let max = 0;
  items.forEach((item, i) => {
    const e = item.embedding;
    if (!e?.length) return;
    let peak = 0;
    for (let d = 0; d < e.length; d++) { if (!Number.isFinite(e[d])) return; peak = Math.max(peak, Math.abs(e[d])); }
    max = Math.max(max, peak);
    valid.push(i); dimensions.set(e.length, (dimensions.get(e.length) ?? 0) + 1);
  });
  const dim = [...dimensions.keys()].sort((a, b) => dimensions.get(b)! - dimensions.get(a)! || a - b)[0];
  if (!dim) return;
  const ids = valid.filter((i) => items[i].embedding!.length === dim), n = ids.length;
  if (n < 2) return;
  if (!max) return;
  const data = center(items, ids, dim, max), scores = new Float64Array(n * 3);
  const rng = random(0x6d2b79f5);
  let rank = 0;
  for (let axis = 0; axis < Math.min(3, dim); axis++) {
    const vector = principal(data, dim, n * dim > 250_000 ? 3 : 12, rng);
    if (!vector) break; // constant or rank-deficient remainder
    deflate(data, dim, n, vector, scores, axis);
    rank++;
  }
  let extent = 0;
  for (let i = 0; i < n; i++) extent = Math.max(extent, Math.hypot(scores[i * 3], scores[i * 3 + 1], scores[i * 3 + 2]));
  if (extent < 1e-12) return; // identical vectors retain the metadata fallback
  for (let i = 0; i < n; i++) {
    const jitter = random(hash(items[ids[i]].id) ^ ids[i]);
    // Fan out collapsed axes before relaxation; otherwise a rank-one matrix starts with quadratic collisions.
    for (let d = 0; d < 3; d++) pos[ids[i] * 3 + d] = (d < rank ? scores[i * 3 + d] * (RADIUS / extent) : pos[ids[i] * 3 + d] * 0.45) + (jitter() - 0.5) * 0.08;
  }
}

function confine(pos: Float64Array, at: number): void {
  const r2 = pos[at] ** 2 + pos[at + 1] ** 2 + pos[at + 2] ** 2;
  if (r2 > RADIUS * RADIUS) {
    const scale = RADIUS / Math.sqrt(r2);
    for (let d = 0; d < 3; d++) pos[at + d] *= scale;
  }
}

function repel(pos: Float64Array, forces: Float64Array, heads: Int32Array, next: Int32Array, cells: Int32Array, offsets: number[]): void {
  for (let i = 0; i < cells.length; i++) for (let k = 0; k < offsets.length; k++) {
    const offset = offsets[k];
    for (let j = offset === 0 ? next[i] : heads[cells[i] + offset]; j !== -1; j = next[j]) {
      const a = i * 3, b = j * 3;
      let x = pos[a] - pos[b], y = pos[a + 1] - pos[b + 1], z = pos[a + 2] - pos[b + 2];
      let dist2 = x * x + y * y + z * z;
      if (dist2 >= 2.25) continue;
      if (dist2 < 1e-20) { x = Math.cos((i + j) * GOLDEN) * 0.001; y = Math.sin((i + j) * GOLDEN) * 0.001; z = 0.001; dist2 = x * x + y * y + z * z; }
      const dist = Math.sqrt(dist2), strength = 0.2 * (1.5 - dist) / dist;
      x *= strength; y *= strength; z *= strength;
      forces[a] += x; forces[a + 1] += y; forces[a + 2] += z;
      forces[b] -= x; forces[b + 1] -= y; forces[b + 2] -= z;
    }
  }
}

function move(pos: Float64Array, forces: Float64Array): void {
  for (let at = 0; at < pos.length; at += 3) {
    const length2 = forces[at] ** 2 + forces[at + 1] ** 2 + forces[at + 2] ** 2, scale = length2 > 0.36 ? 0.6 / Math.sqrt(length2) : 1;
    for (let d = 0; d < 3; d++) pos[at + d] += forces[at + d] * scale;
    confine(pos, at);
  }
}

/** 1.5-unit spatial grid: only nearby pairs repel; links are undirected and deduplicated. */
function relax(pos: Float64Array, edges: number[][]): void {
  const n = pos.length / 3, forces = new Float64Array(pos.length), heads = new Int32Array(32 ** 3), next = new Int32Array(n), cells = new Int32Array(n);
  const offsets: number[] = [];
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const offset = x + y * 32 + z * 1024;
    if (offset >= 0) offsets.push(offset); // half the neighbors: visit every unordered pair once
  }
  for (let i = 0; i < n; i++) confine(pos, i * 3);
  for (let step = 0; step < 30; step++) {
    forces.fill(0); heads.fill(-1);
    for (let i = 0; i < n; i++) {
      const at = i * 3;
      // One cell of padding keeps all 27 neighbor offsets inside the fixed grid.
      const cell = 1 + Math.floor((pos[at] + 20) / 1.5) + (1 + Math.floor((pos[at + 1] + 20) / 1.5)) * 32 + (1 + Math.floor((pos[at + 2] + 20) / 1.5)) * 1024;
      cells[i] = cell; next[i] = heads[cell]; heads[cell] = i;
    }
    for (const [i, j] of edges) for (let d = 0; d < 3; d++) {
      const pull = (pos[j * 3 + d] - pos[i * 3 + d]) * 0.02;
      forces[i * 3 + d] += pull; forces[j * 3 + d] -= pull;
    }
    repel(pos, forces, heads, next, cells, offsets);
    move(pos, forces);
  }
}

/** Input order is preserved. Invalid/missing/ragged vectors use kind/tag positions; the most common
 * valid embedding dimension defines the PCA space. Inputs are never mutated. */
export function layout(items: MapItem[], links: MapLink[]): MapPoint[] {
  if (!items.length) return [];
  if (items.length === 1) return [{ id: items[0].id, x: 0, y: 0, z: 0 }];
  const pos = new Float64Array(items.length * 3);
  fallback(items, pos); pca(items, pos);
  const ids = new Map(items.map((item, i) => [item.id, i])), seen = new Set<number>(), edges: number[][] = [];
  for (const link of links) {
    const from = ids.get(link.from), to = ids.get(link.to);
    if (from === undefined || to === undefined || from === to) continue;
    const a = Math.min(from, to), b = Math.max(from, to), key = a * items.length + b;
    if (!seen.has(key)) { edges.push([a, b]); seen.add(key); }
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  relax(pos, edges);
  return items.map((item, i) => ({ id: item.id, x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] }));
}
