// MEMORY web: similarity edges between memories and how they age. No Three/React, clock, or random state.
export const EDGE_THRESHOLD = 0.65, EDGE_K = 3, DAY = 86_400_000;
const HALF_LIFE = 30, FLOOR = 0.2; // days until a link loses half its glow; old links never fully vanish

/** Edges [a, b, sim] (a < b, item indexes) whose cosine similarity ≥ threshold, keeping each node's top-k.
 * An edge kept by either end is kept (so a hub may exceed k). Items without a vector, or with a vector of a
 * different length than the first valid one, get no edges. Sorted by a, then b. */
export function similarEdges(vecs: (number[] | undefined)[], threshold = EDGE_THRESHOLD, k = EDGE_K): [number, number, number][] {
  const n = vecs.length, len = vecs.find((v) => v?.length)?.length ?? 0;
  if (n < 2 || !len || k < 1) return [];
  let dim = 0; // embeddings are zero-padded to the DB width: skip the shared all-zero tail
  for (const v of vecs) if (v?.length === len) for (let d = len - 1; d >= dim; d--) if (v[d] !== 0) { dim = d + 1; break; }
  const ok: number[] = [], unit = new Float64Array(n * dim);
  vecs.forEach((v, i) => {
    if (v?.length !== len) return;
    let s = 0;
    for (let d = 0; d < dim; d++) s += v[d] * v[d];
    if (!(s > 0)) return;
    const inv = 1 / Math.sqrt(s);
    for (let d = 0; d < dim; d++) unit[i * dim + d] = v[d] * inv;
    ok.push(i);
  });
  // best[i] holds up to k [sim, j] pairs, sorted descending
  const best: [number, number][][] = Array.from({ length: n }, () => []);
  const offer = (i: number, j: number, s: number) => {
    const b = best[i];
    if (b.length === k && s <= b[k - 1][0]) return;
    let at = b.length;
    while (at > 0 && b[at - 1][0] < s) at--;
    b.splice(at, 0, [s, j]);
    if (b.length > k) b.pop();
  };
  const hit = (i: number, j: number, s: number) => { if (s >= threshold) { offer(i, j, s); offer(j, i, s); } };
  for (let x = 0; x < ok.length; x++) {
    const i = ok[x], oi = i * dim;
    let y = x + 1;
    // Four columns share each row read: the O(n²·d) loop is the whole cost (~2000 memories on the owner's PC).
    for (; y + 3 < ok.length; y += 4) {
      const j0 = ok[y] * dim, j1 = ok[y + 1] * dim, j2 = ok[y + 2] * dim, j3 = ok[y + 3] * dim;
      let a = 0, b = 0, c = 0, e = 0;
      for (let d = 0; d < dim; d++) {
        const u = unit[oi + d];
        a += u * unit[j0 + d]; b += u * unit[j1 + d]; c += u * unit[j2 + d]; e += u * unit[j3 + d];
      }
      hit(i, ok[y], a); hit(i, ok[y + 1], b); hit(i, ok[y + 2], c); hit(i, ok[y + 3], e);
    }
    for (; y < ok.length; y++) {
      const oj = ok[y] * dim;
      let s = 0;
      for (let d = 0; d < dim; d++) s += unit[oi + d] * unit[oj + d];
      hit(i, ok[y], s);
    }
  }
  const out = new Map<number, [number, number, number]>();
  best.forEach((b, i) => b.forEach(([s, j]) => {
    const a = Math.min(i, j), c = Math.max(i, j);
    out.set(a * n + c, [a, c, Math.round(Math.min(1, s) * 1000) / 1000]);
  }));
  return [...out.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/** A link exists once its newer memory does. */
export const edgeBorn = (aMs: number, bMs: number) => Math.max(aMs, bMs);

/** Brightness 0..1 of a link born at `bornMs`, seen at `atMs`: 0 before it exists, 1 when brand new,
 * halving every HALF_LIFE days down to FLOOR. Stronger similarity glows a little more. */
export function edgeGlow(bornMs: number, atMs: number, sim = 1): number {
  if (!Number.isFinite(bornMs) || !Number.isFinite(atMs) || bornMs > atMs) return 0;
  const age = (atMs - bornMs) / DAY, fresh = FLOOR + (1 - FLOOR) * Math.pow(0.5, age / HALF_LIFE);
  return fresh * (0.6 + 0.4 * Math.min(1, Math.max(0, sim)));
}
