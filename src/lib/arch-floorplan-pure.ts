// ARCH studio floor plan (pure, tested in tests/arch-floorplan.test.ts). The editable source of a house drawn from a sketch photo,
// a reference photo or a text brief: walls as centre lines between shared corner points, doors and windows sitting on walls,
// room names as points. Everything measurable is computed here, never by a model: the model only reads a picture into rough
// coordinates (arch-sketch-pure), then this file cleans them the way a draughtsperson would (weld corners, square up walls that
// are nearly square, snap to a 50 mm grid, split walls where others meet them), finds the rooms as the closed faces of the wall
// network, measures gross (wall centre line) and net (inside wall faces) areas, runs the few rules that have a written source,
// and turns the plan into ARCH scene parts so the 3D view, walk, sun, daylight, IFC and costs all work on it.
// Axes as the rest of ARCH: metres, x east, z south (north is −z, up on the plan).
import { fitOpenings, MAX, type Face, type Part, type Scene } from "./arch-pure.ts";
import { generatePlans, parseBrief as parseRoomsBrief, type Brief, type PlanOption, type Rect } from "./arch-plan-pure.ts";

export type FpNode = { id: string; x: number; z: number };
/** t: wall thickness in metres. Derived by cleanPlan (outer walls FP.outerT, inner FP.innerT); kept in the file for other readers. */
export type FpWall = { id: string; a: string; b: string; t: number };
export type FpOpeningKind = "door" | "window";
/** at: distance of the opening's centre from the wall's first point (a), metres. w is the clear opening width. */
export type FpOpening = { id: string; wall: string; kind: FpOpeningKind; at: number; w: number; h: number; sill: number };
export type FpLabel = { name: string; x: number; z: number };
export type PlanSource = "sketch" | "photo" | "brief" | "sample" | "file";
/** height: clear room height (floor to ceiling), metres. unsure: what the reader of the picture could not be sure of. */
export type FloorPlan = { v: 1; name: string; source: PlanSource; height: number; nodes: FpNode[]; walls: FpWall[]; openings: FpOpening[]; labels: FpLabel[]; unsure: string[] };

export const FP = {
  weld: 0.15, orthoDeg: 12, grid: 0.05, outerT: 0.3, innerT: 0.12, minWall: 0.1, maxCoord: 100,
  maxNodes: 300, maxWalls: 300, maxOpenings: 120, maxLabels: 60, maxUnsure: 12,
  height: 2.7, door: { w: 0.9, h: 2.1 }, window: { w: 1.2, h: 1.2, sill: 0.9 }, end: 0.3 /* clear wall kept at each end of an opening */, attach: 0.8,
  slab: 0.2, footing: 0.8,
};

type P = [number, number];
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const snap = (n: number) => r3(Math.round(n / FP.grid) * FP.grid);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max) : "");

// ---------- small geometry ----------
export const dist = (a: P, b: P) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Shoelace area, signed: positive for faces traced by findRooms (interior faces), negative for the outer boundary. */
export function signedArea(poly: P[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; s += x0 * z1 - x1 * z0; }
  return s / 2;
}
export const polyArea = (poly: P[]) => Math.abs(signedArea(poly));
/** Ray casting; points on the edge count as inside half the time, so callers test points clearly inside. */
export function inPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Distance from p to segment ab, and the parameter (0..1) of the closest point. */
export function toSegment(p: P, a: P, b: P): { d: number; s: number } {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  const s = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return { d: Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dz), s };
}
/** Proper crossing of two segments (inside both, not at an end) → the point, else null. */
function crossing(a: P, b: P, c: P, d: P): P | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  const e = 1e-6;
  return t > e && t < 1 - e && u > e && u < 1 - e ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

// ---------- plan access ----------
export function nodeMap(plan: FloorPlan): Map<string, FpNode> { return new Map(plan.nodes.map((n) => [n.id, n])); }
export function wallEnds(plan: FloorPlan, w: FpWall, nm = nodeMap(plan)): [P, P] | null {
  const a = nm.get(w.a), b = nm.get(w.b);
  return a && b ? [[a.x, a.z], [b.x, b.z]] : null;
}
export const wallLength = (plan: FloorPlan, w: FpWall, nm = nodeMap(plan)) => { const e = wallEnds(plan, w, nm); return e ? dist(e[0], e[1]) : 0; };
export type Orient = "h" | "v" | "diag";
export function orient(e: [P, P]): Orient { return Math.abs(e[0][1] - e[1][1]) < 1e-9 ? "h" : Math.abs(e[0][0] - e[1][0]) < 1e-9 ? "v" : "diag"; }
/** World point of an opening's centre. */
export function openingPoint(plan: FloorPlan, o: FpOpening, nm = nodeMap(plan)): P | null {
  const w = plan.walls.find((x) => x.id === o.wall), e = w && wallEnds(plan, w, nm);
  if (!e) return null;
  const L = dist(e[0], e[1]) || 1, k = o.at / L;
  return [e[0][0] + (e[1][0] - e[0][0]) * k, e[0][1] + (e[1][1] - e[0][1]) * k];
}

// ---------- input (trust boundary: model replies, uploaded JSON, the editor) ----------
/** A loose description → a FloorPlan, cleaned. Accepts the model's shape ({walls:[{a:[x,z],b:[x,z]}], openings:[{kind,x,z,w}],
 *  rooms:[{name,x,z}], unsure:[…]}) and the saved shape ({nodes, walls:[{a:id,b:id}], openings:[{wall,at}], labels}). */
export function planFromRaw(raw: unknown, source: PlanSource): FloorPlan {
  const o = isObj(raw) ? raw : {};
  const c = (v: unknown) => num(v, -FP.maxCoord, FP.maxCoord);
  const pt = (v: unknown): P | null => (Array.isArray(v) && v.length >= 2 && c(v[0]) !== undefined && c(v[1]) !== undefined ? [v[0] as number, v[1] as number] : null);
  const nodes: FpNode[] = [], walls: FpWall[] = [];
  const savedNodes = new Map<string, P>();
  if (Array.isArray(o.nodes)) for (const n of o.nodes.slice(0, FP.maxNodes)) if (isObj(n) && typeof n.id === "string" && c(n.x) !== undefined && c(n.z) !== undefined) savedNodes.set(n.id.slice(0, 24), [n.x as number, n.z as number]);
  const nodeAt = (p: P) => { const id = `n${nodes.length + 1}`; nodes.push({ id, x: p[0], z: p[1] }); return id; };
  const list = Array.isArray(o.walls) ? o.walls.slice(0, FP.maxWalls) : [];
  for (const w of list) {
    if (!isObj(w)) continue;
    const a = typeof w.a === "string" ? savedNodes.get(w.a) ?? null : pt(w.a), b = typeof w.b === "string" ? savedNodes.get(w.b) ?? null : pt(w.b);
    if (!a || !b || dist(a, b) < FP.minWall) continue;
    walls.push({ id: `w${walls.length + 1}`, a: nodeAt(a), b: nodeAt(b), t: FP.innerT });
  }
  // openings: saved ones sit on a wall (by index in the saved list), the model's are points that attach to the nearest wall
  const pending: { kind: FpOpeningKind; p: P; w: number; h?: number; sill?: number }[] = [];
  const savedWalls = new Map<string, [P, P]>();
  list.forEach((w) => { if (isObj(w) && typeof w.id === "string" && typeof w.a === "string" && typeof w.b === "string") { const a = savedNodes.get(w.a), b = savedNodes.get(w.b); if (a && b) savedWalls.set(w.id, [a, b]); } });
  if (Array.isArray(o.openings)) for (const x of o.openings.slice(0, FP.maxOpenings)) {
    if (!isObj(x)) continue;
    const kind: FpOpeningKind = x.kind === "door" ? "door" : "window";
    let p: P | null = null;
    if (typeof x.wall === "string" && savedWalls.has(x.wall) && num(x.at, 0, 2 * FP.maxCoord) !== undefined) {
      const [a, b] = savedWalls.get(x.wall)!, L = dist(a, b) || 1, k = (x.at as number) / L;
      p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    } else if (c(x.x) !== undefined && c(x.z) !== undefined) p = [x.x as number, x.z as number];
    const w = num(x.w, 0.3, 6) ?? (kind === "door" ? FP.door.w : FP.window.w);
    if (p) pending.push({ kind, p, w, h: num(x.h, 0.3, 3), sill: num(x.sill, 0, 2.5) });
  }
  const labels: FpLabel[] = [];
  for (const l of [...(Array.isArray(o.rooms) ? o.rooms : []), ...(Array.isArray(o.labels) ? o.labels : [])].slice(0, FP.maxLabels))
    if (isObj(l) && text(l.name, 40) && c(l.x) !== undefined && c(l.z) !== undefined) labels.push({ name: text(l.name, 40), x: l.x as number, z: l.z as number });
  const unsure = (Array.isArray(o.unsure) ? o.unsure : []).map((s) => text(s, 160)).filter(Boolean).slice(0, FP.maxUnsure);
  const plan: FloorPlan = { v: 1, name: text(o.name, 60) || "House", source, height: num(o.height, 2.1, 4) ?? FP.height, nodes, walls, openings: [], labels, unsure };
  return cleanPlan(plan, pending);
}

type Pending = { kind: FpOpeningKind; p: P; w: number; h?: number; sill?: number };

/** The draughting clean-up, idempotent: weld → square up → grid → split at junctions and crossings → drop duplicates → re-attach
 *  doors and windows by where they were → wall thickness from the rooms. `extra` are new openings given as points. */
export function cleanPlan(plan: FloorPlan, extra: Pending[] = []): FloorPlan {
  let nm = nodeMap(plan);
  const pending: Pending[] = [...plan.openings.flatMap((o) => { const p = openingPoint(plan, o, nm); return p ? [{ kind: o.kind, p, w: o.w, h: o.h, sill: o.sill }] : []; }), ...extra];
  // 1. weld corners closer than FP.weld (greedy, in file order, so the result never depends on hash order)
  const pos = new Map(plan.nodes.map((n) => [n.id, [n.x, n.z] as P]));
  const rep = new Map<string, string>(), reps: { id: string; sum: P; n: number }[] = [];
  for (const n of plan.nodes) {
    const p = pos.get(n.id)!, hit = reps.find((r) => dist([r.sum[0] / r.n, r.sum[1] / r.n], p) < FP.weld);
    if (hit) { hit.sum = [hit.sum[0] + p[0], hit.sum[1] + p[1]]; hit.n++; rep.set(n.id, hit.id); } else { reps.push({ id: n.id, sum: [...p], n: 1 }); rep.set(n.id, n.id); }
  }
  let nodes = reps.map((r) => ({ id: r.id, x: r.sum[0] / r.n, z: r.sum[1] / r.n }));
  let walls = plan.walls.map((w) => ({ ...w, a: rep.get(w.a) ?? w.a, b: rep.get(w.b) ?? w.b })).filter((w) => w.a !== w.b && pos.has(w.a) && pos.has(w.b));
  // 2. square up: a wall within FP.orthoDeg of level/plumb ties its two ends to one z (or x); each tied group takes its mean
  const find = (m: Map<string, string>, k: string): string => { let r = k; while (m.get(r) !== r) r = m.get(r)!; m.set(k, r); return r; };
  const ux = new Map(nodes.map((n) => [n.id, n.id])), uz = new Map(nodes.map((n) => [n.id, n.id]));
  nm = new Map(nodes.map((n) => [n.id, n]));
  for (const w of walls) {
    const a = nm.get(w.a)!, b = nm.get(w.b)!, deg = (Math.atan2(Math.abs(b.z - a.z), Math.abs(b.x - a.x)) * 180) / Math.PI;
    if (deg < FP.orthoDeg) uz.set(find(uz, w.a), find(uz, w.b));
    else if (deg > 90 - FP.orthoDeg) ux.set(find(ux, w.a), find(ux, w.b));
  }
  const mean = (u: Map<string, string>, k: "x" | "z") => {
    const acc = new Map<string, [number, number]>();
    for (const n of nodes) { const r = find(u, n.id), s = acc.get(r) ?? [0, 0]; acc.set(r, [s[0] + n[k], s[1] + 1]); }
    return (id: string) => { const s = acc.get(find(u, id))!; return s[0] / s[1]; };
  };
  const mx = mean(ux, "x"), mz = mean(uz, "z");
  // 3. grid, then merge points that landed on the same spot
  nodes = nodes.map((n) => ({ id: n.id, x: snap(mx(n.id)), z: snap(mz(n.id)) }));
  // 3b. a free end that stops just short of another wall is put on it (a partition drawn up to, but not quite touching, a wall)
  const deg0 = new Map<string, number>();
  for (const w of walls) for (const k of [w.a, w.b]) deg0.set(k, (deg0.get(k) ?? 0) + 1);
  const nmB = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (deg0.get(n.id) !== 1) continue;
    let best: { p: P; d: number } | null = null;
    for (const w of walls) {
      if (w.a === n.id || w.b === n.id) continue;
      const a = nmB.get(w.a)!, b = nmB.get(w.b)!, q = toSegment([n.x, n.z], [a.x, a.z], [b.x, b.z]);
      if (q.d > 1e-9 && q.d < FP.weld && (!best || q.d < best.d)) best = { p: [a.x + (b.x - a.x) * q.s, a.z + (b.z - a.z) * q.s], d: q.d };
    }
    if (best) { n.x = snap(best.p[0]); n.z = snap(best.p[1]); }
  }
  const at = new Map<string, string>(), rep2 = new Map<string, string>();
  for (const n of nodes) { const k = `${n.x},${n.z}`; if (!at.has(k)) at.set(k, n.id); rep2.set(n.id, at.get(k)!); }
  nodes = nodes.filter((n) => rep2.get(n.id) === n.id);
  walls = walls.map((w) => ({ ...w, a: rep2.get(w.a)!, b: rep2.get(w.b)! }));
  // 4. crossings get a corner point; then every wall is split wherever a corner point lies on it
  nm = new Map(nodes.map((n) => [n.id, n]));
  const P_ = (id: string): P => { const n = nm.get(id)!; return [n.x, n.z]; };
  let nextNode = nodes.reduce((m, n) => Math.max(m, Number(n.id.replace(/\D/g, "")) || 0), 0) + 1;
  const addNode = (p: P) => { const x = snap(p[0]), z = snap(p[1]), k = `${x},${z}`; if (at.has(k)) return at.get(k)!; const id = `n${nextNode++}`; at.set(k, id); const n = { id, x, z }; nodes.push(n); nm.set(id, n); return id; };
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const p = crossing(P_(walls[i].a), P_(walls[i].b), P_(walls[j].a), P_(walls[j].b));
    if (p) addNode(p);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < walls.length && !changed; i++) {
      const w = walls[i], a = P_(w.a), b = P_(w.b);
      for (const n of nodes) {
        if (n.id === w.a || n.id === w.b) continue;
        const q = toSegment([n.x, n.z], a, b);
        if (q.d < 0.01 && q.s > 1e-6 && q.s < 1 - 1e-6) { walls.splice(i, 1, { ...w, b: n.id }, { ...w, id: `${w.id}x`, a: n.id }); changed = true; break; }
      }
    }
  }
  // 5. drop zero-length and duplicate walls, renumber, keep only used points
  const deg1 = new Map<string, number>();
  for (const w of walls) for (const k of [w.a, w.b]) deg1.set(k, (deg1.get(k) ?? 0) + 1);
  walls = walls.filter((w) => !((deg1.get(w.a) === 1 || deg1.get(w.b) === 1) && dist(P_(w.a), P_(w.b)) < FP.weld)); // overshoot stubs
  const seen = new Set<string>();
  walls = walls.filter((w) => { const k = [w.a, w.b].sort().join("|"); if (w.a === w.b || seen.has(k) || dist(P_(w.a), P_(w.b)) < FP.minWall) return false; seen.add(k); return true; }).slice(0, FP.maxWalls);
  const used = new Set(walls.flatMap((w) => [w.a, w.b]));
  const keep = nodes.filter((n) => used.has(n.id)), renum = new Map(keep.map((n, i) => [n.id, `n${i + 1}`]));
  const out: FloorPlan = {
    ...plan,
    nodes: keep.map((n) => ({ id: renum.get(n.id)!, x: n.x, z: n.z })),
    walls: walls.map((w, i) => ({ id: `w${i + 1}`, a: renum.get(w.a)!, b: renum.get(w.b)!, t: w.t })),
    openings: [],
    labels: plan.labels.slice(0, FP.maxLabels).map((l) => ({ name: l.name, x: r3(l.x), z: r3(l.z) })),
  };
  // 6. doors and windows back onto the nearest wall (within FP.attach), clamped to fit, overlaps dropped
  const nm2 = nodeMap(out);
  for (const q of pending.slice(0, FP.maxOpenings)) {
    let best: { w: FpWall; s: number; d: number; L: number } | null = null;
    for (const w of out.walls) {
      const e = wallEnds(out, w, nm2)!, t = toSegment(q.p, e[0], e[1]);
      if (t.d < FP.attach && (!best || t.d < best.d)) best = { w, s: t.s, d: t.d, L: dist(e[0], e[1]) };
    }
    if (!best) continue;
    const usable = best.L - 2 * FP.end;
    if (usable < 0.3) continue;
    const w = r3(Math.min(q.w, usable)), atM = r3(Math.min(best.L - FP.end - w / 2, Math.max(FP.end + w / 2, best.s * best.L)));
    const clash = out.openings.some((o) => o.wall === best!.w.id && Math.abs(o.at - atM) < (o.w + w) / 2 + 0.1);
    if (clash) continue;
    const door = q.kind === "door";
    out.openings.push({ id: `o${out.openings.length + 1}`, wall: best.w.id, kind: q.kind, at: atM, w,
      h: r3(q.h ?? (door ? FP.door.h : FP.window.h)), sill: door ? 0 : r3(q.sill ?? FP.window.sill) });
  }
  // 7. thickness follows from the rooms: a wall between two rooms is inner, everything else outer (a free stub inside a room: inner)
  const rooms = findRooms(out), sides = wallSides(rooms);
  const stubs = new Set(danglingWalls(out));
  out.walls = out.walls.map((w) => ({ ...w, t: (sides.get(w.id)?.length ?? 0) === 2 || stubs.has(w.id) ? FP.innerT : FP.outerT }));
  return out;
}

// ---------- rooms: closed faces of the wall network ----------
export type RoomKind = "living" | "kitchen" | "wet" | "other";
export type Room = {
  id: string; name: string; kind: RoomKind; nodes: string[]; walls: string[];
  poly: P[]; netPoly: P[]; gross: number; net: number; perimeter: number; rect: { w: number; d: number } | null; centre: P;
};

/** Words that make a room a living / work / bed room or a kitchen for määrus nr 85 (English and Estonian), and wet rooms. */
const LIVING = /\b(living|lounge|bed(room)?|office|study|work ?room|den|kids|nursery|guest|family|dining)\b|room\b|elutuba|magamis|t[öo][öo]tuba|kabinet|lastetuba|\btuba\b/i;
const KITCHEN = /kitchen|k[öo][öo]k|kook/i;
const WET = /\b(bath(room)?|wc|toilet|shower|washroom|lavatory|vannituba|vann|tualett|du[šs]{1,2}|pesuruum)\b/i;
const NOT_LIVING = /\b(hall|corridor|entr(y|ance)|lobby|storage|store|closet|wardrobe|pantry|utility|laundry|garage|sauna|steam|boiler|technical|tech|esik|koridor|panipaik|garderoob|saun|leiliruum|tehnoruum|katlaruum|pesuruum)\b/i;
export function roomKind(name: string): RoomKind {
  if (WET.test(name)) return "wet";
  if (KITCHEN.test(name)) return "kitchen";
  if (NOT_LIVING.test(name)) return "other";
  return LIVING.test(name) ? "living" : "other";
}

/** Walls with a free end (repeatedly), e.g. a partition stub: they stand in 3D but close no room. */
export function danglingWalls(plan: FloorPlan): string[] {
  const deg = new Map<string, number>(), live = new Set(plan.walls.map((w) => w.id)), out: string[] = [];
  for (const w of plan.walls) { deg.set(w.a, (deg.get(w.a) ?? 0) + 1); deg.set(w.b, (deg.get(w.b) ?? 0) + 1); }
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of plan.walls) if (live.has(w.id) && ((deg.get(w.a) ?? 0) < 2 || (deg.get(w.b) ?? 0) < 2)) {
      live.delete(w.id); out.push(w.id); deg.set(w.a, deg.get(w.a)! - 1); deg.set(w.b, deg.get(w.b)! - 1); changed = true;
    }
  }
  return out;
}

/** Faces of the planar wall graph (walls split at every junction by cleanPlan). Interior faces are traced with positive
 *  signedArea; the outer boundary of each connected group comes out negative and is returned separately as the footprint.
 *  shortcut: a closed loop standing free inside a room (a column) is a room of its own and is not subtracted from the room. */
export function faces(plan: FloorPlan): { inner: { nodes: string[]; walls: string[] }[]; outer: { nodes: string[]; walls: string[] }[] } {
  const nm = nodeMap(plan), drop = new Set(danglingWalls(plan));
  const adj = new Map<string, { to: string; wall: string; ang: number }[]>();
  for (const w of plan.walls) {
    if (drop.has(w.id)) continue;
    const a = nm.get(w.a), b = nm.get(w.b);
    if (!a || !b) continue;
    (adj.get(w.a) ?? adj.set(w.a, []).get(w.a)!).push({ to: w.b, wall: w.id, ang: Math.atan2(b.z - a.z, b.x - a.x) });
    (adj.get(w.b) ?? adj.set(w.b, []).get(w.b)!).push({ to: w.a, wall: w.id, ang: Math.atan2(a.z - b.z, a.x - b.x) });
  }
  for (const l of adj.values()) l.sort((p, q) => p.ang - q.ang);
  const seen = new Set<string>(), inner: { nodes: string[]; walls: string[] }[] = [], outer: { nodes: string[]; walls: string[] }[] = [];
  for (const [u0, l0] of adj) for (const e0 of l0) {
    if (seen.has(`${u0}>${e0.to}`)) continue;
    const ns: string[] = [], ws: string[] = [];
    let u = u0, e = e0, guard = 0;
    while (!seen.has(`${u}>${e.to}`) && guard++ < 4 * FP.maxWalls) {
      seen.add(`${u}>${e.to}`); ns.push(u); ws.push(e.wall);
      const out = adj.get(e.to)!, back = out.findIndex((x) => x.to === u && x.wall === e.wall);
      const next = out[(back - 1 + out.length) % out.length]; // the edge just clockwise of the way back: the face stays on the left
      u = e.to; e = next;
    }
    const poly = ns.map((id) => [nm.get(id)!.x, nm.get(id)!.z] as P), A = signedArea(poly);
    if (A > 0.05) inner.push({ nodes: ns, walls: ws });
    else if (A < -0.05) outer.push({ nodes: ns, walls: ws });
  }
  return { inner, outer };
}

/** Offset a closed polygon by d per edge (positive = to the left of travel = inward for a positive face). Consecutive
 *  collinear edges with the same offset are merged; with different offsets the corner gets a small step. */
export function offsetPoly(poly: P[], d: number[]): P[] {
  const E: { a: P; b: P; d: number }[] = [];
  for (let i = 0; i < poly.length; i++) E.push({ a: poly[i], b: poly[(i + 1) % poly.length], d: d[i] });
  const dir = (e: { a: P; b: P }) => { const L = dist(e.a, e.b) || 1; return [(e.b[0] - e.a[0]) / L, (e.b[1] - e.a[1]) / L] as P; };
  const col = (p: { a: P; b: P }, q: { a: P; b: P }) => { const u = dir(p), v = dir(q); return Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-9 && u[0] * v[0] + u[1] * v[1] > 0; };
  for (let i = 0; E.length > 3 && i < E.length; ) { // merge straight runs
    const j = (i + 1) % E.length;
    if (col(E[i], E[j]) && Math.abs(E[i].d - E[j].d) < 1e-9) { E[i] = { a: E[i].a, b: E[j].b, d: E[i].d }; E.splice(j, 1); if (j < i) i--; } else i++;
  }
  const line = (e: { a: P; b: P; d: number }) => { const u = dir(e), n: P = [-u[1], u[0]]; return { p: [e.a[0] + n[0] * e.d, e.a[1] + n[1] * e.d] as P, q: [e.b[0] + n[0] * e.d, e.b[1] + n[1] * e.d] as P, u }; };
  const out: P[] = [];
  for (let i = 0; i < E.length; i++) {
    const A = line(E[(i - 1 + E.length) % E.length]), B = line(E[i]);
    const den = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(den) < 1e-9) { out.push(A.q, B.p); continue; }
    const t = ((B.p[0] - A.p[0]) * B.u[1] - (B.p[1] - A.p[1]) * B.u[0]) / den;
    out.push([A.p[0] + A.u[0] * t, A.p[1] + A.u[1] * t]);
  }
  return out.map(([x, z]) => [r3(x), r3(z)] as P);
}

/** Rooms with gross area (to wall centre lines) and net area (to the inside faces of the walls, the floor you can stand on). */
export function findRooms(plan: FloorPlan): Room[] {
  const nm = nodeMap(plan), wt = new Map(plan.walls.map((w) => [w.id, w.t]));
  const used = new Set<number>();
  return faces(plan).inner.map((f, i) => {
    const poly = f.nodes.map((id) => [nm.get(id)!.x, nm.get(id)!.z] as P);
    const netPoly = offsetPoly(poly, f.walls.map((w) => (wt.get(w) ?? FP.innerT) / 2));
    const gross = polyArea(poly), net0 = signedArea(netPoly), net = net0 > 0 && net0 <= gross + 1e-6 ? net0 : 0;
    const xs = netPoly.map((p) => p[0]), zs = netPoly.map((p) => p[1]);
    const ortho = netPoly.every((p, k) => { const q = netPoly[(k + 1) % netPoly.length]; return Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6; });
    const rect = netPoly.length === 4 && ortho ? { w: r3(Math.max(...xs) - Math.min(...xs)), d: r3(Math.max(...zs) - Math.min(...zs)) } : null;
    const li = plan.labels.findIndex((l, k) => !used.has(k) && inPoly([l.x, l.z], poly));
    if (li >= 0) used.add(li);
    const name = li >= 0 ? plan.labels[li].name : `Room ${i + 1}`;
    const cx = xs.reduce((s, x) => s + x, 0) / xs.length, cz = zs.reduce((s, z) => s + z, 0) / zs.length;
    const centre: P = inPoly([cx, cz], poly) ? [r3(cx), r3(cz)] : labelPoint(netPoly);
    return { id: `r${i + 1}`, name, kind: roomKind(name), nodes: f.nodes, walls: f.walls, poly, netPoly, gross: r3(gross), net: r3(net),
      perimeter: r3(poly.reduce((s, p, k) => s + dist(p, poly[(k + 1) % poly.length]), 0)), rect, centre };
  });
}
/** A point inside an L or U room for its label: the middle of the widest horizontal run through the polygon's mid height. */
function labelPoint(poly: P[]): P {
  const zs = poly.map((p) => p[1]), z = (Math.min(...zs) + Math.max(...zs)) / 2 + 1e-4, xs: number[] = [];
  for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; if ((z0 > z) !== (z1 > z)) xs.push(x0 + ((z - z0) * (x1 - x0)) / (z1 - z0)); }
  xs.sort((a, b) => a - b);
  let best: P = poly[0], wide = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > wide) { wide = xs[i + 1] - xs[i]; best = [r3((xs[i] + xs[i + 1]) / 2), r3(z)]; }
  return best;
}
/** wall id → the rooms on its sides (0, 1 or 2). One room = an outer wall. */
export function wallSides(rooms: Room[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rooms) for (const w of r.walls) { const l = m.get(w) ?? []; if (!l.includes(r.id)) l.push(r.id); m.set(w, l); }
  return m;
}
/** Outer boundary rings (positive orientation) — the footprint to the outside faces is offsetPoly(ring, −t/2). */
export function footprints(plan: FloorPlan): P[][] {
  const nm = nodeMap(plan), wt = new Map(plan.walls.map((w) => [w.id, w.t]));
  return faces(plan).outer.map((f) => {
    const ring = f.nodes.map((id) => [nm.get(id)!.x, nm.get(id)!.z] as P).reverse(), ws = [...f.walls].reverse();
    // reversing the node order shifts which edge follows which point: edge k now runs ring[k] → ring[k+1] = old wall ws[(k+1)]
    const wsFix = ws.map((_, k) => ws[(k + 1) % ws.length]);
    return offsetPoly(ring, wsFix.map((w) => -(wt.get(w) ?? FP.outerT) / 2));
  });
}

// ---------- rules with a written source ----------
export type Source = { title: string; url: string };
/** Estonia, Majandus- ja taristuministri määrus nr 85 (2 July 2015) "Eluruumile esitatavad nõuded", RT I, 03.07.2015, 34, as amended
 *  (RT I, 24.08.2018, 1; RT I, 09.07.2020, 15). It applies to dwellings in one-dwelling houses (not summer houses) and to flats. */
export const R85 = "https://www.riigiteataja.ee/akt/103072015034?leiaKehtiv";
export const SOURCES = {
  area: { title: "Määrus nr 85 \"Eluruumile esitatavad nõuded\" § 2 lg 1 p 1 (room ≥ 8 m²)", url: R85 },
  width: { title: "Määrus nr 85 § 2 lg 1 p 2 (room ≥ 2.4 m between opposite walls)", url: R85 },
  height: { title: "Määrus nr 85 § 2 lg 1 p 3 (height ≥ 2.5 m; ≥ 2.3 m in a one-dwelling house)", url: R85 },
  door: { title: "Määrus nr 85 § 3 lg 1 (each living room and the kitchen has a door)", url: R85 },
  doorW: { title: "Määrus nr 85 § 3 lg 2 (door clear opening: outer 900 mm, inner 700 mm, bath/WC 600 mm, height 1950 mm)", url: R85 },
  window: { title: "Määrus nr 85 § 3 lg 3 (each living room and the kitchen has an opening window)", url: R85 },
} satisfies Record<string, Source>;
export const RULE = { area: 8, width: 2.4, height: 2.5, heightHouse: 2.3, doorOuter: 0.9, doorInner: 0.7, doorWet: 0.6, doorH: 1.95 };

export type CheckLevel = "fail" | "warn" | "ok" | "info";
export type Check = { id: string; level: CheckLevel; text: string; room?: string; wall?: string; opening?: string; source?: Source };
const m2 = (n: number) => `${n.toFixed(1)} m²`, mm = (m: number) => `${Math.round(m * 1000)} mm`;

/** Checks the plan. Rule checks name their paragraph; drawing checks (no source) say when the plan itself is not finished.
 *  "Üldjuhul" (as a rule) in § 2 means exceptions exist, so a size miss is a warning, not a fail. A study aid, not a permit check. */
export function checkPlan(plan: FloorPlan, rooms = findRooms(plan)): Check[] {
  const out: Check[] = [], sides = wallSides(rooms), nm = nodeMap(plan);
  if (!rooms.length) out.push({ id: "closed", level: "fail", text: "No closed rooms yet: the walls don't meet up. Close the gaps to get rooms and areas." });
  const stubs = danglingWalls(plan);
  if (rooms.length && stubs.length) out.push({ id: "stubs", level: "info", text: `${stubs.length} wall${stubs.length === 1 ? "" : "s"} with a free end (they stand in 3D but close no room).` });
  const diag = plan.walls.filter((w) => orient(wallEnds(plan, w, nm)!) === "diag");
  if (diag.length) out.push({ id: "diag", level: "warn", text: `${diag.length} slanted wall${diag.length === 1 ? "" : "s"}: the 3D model leaves ${diag.length === 1 ? "it" : "them"} out (ARCH builds square blocks).`, wall: diag[0].id });
  for (const r of rooms) if (r.gross < 1) out.push({ id: `tiny:${r.id}`, level: "warn", text: `${r.name} is only ${m2(r.gross)}: probably a drawing slip.`, room: r.id });
  const h = plan.height;
  out.push(h < RULE.heightHouse ? { id: "height", level: "warn", text: `Room height ${h.toFixed(2)} m is under ${RULE.heightHouse} m.`, source: SOURCES.height }
    : h < RULE.height ? { id: "height", level: "info", text: `Room height ${h.toFixed(2)} m: fine for a one-dwelling house (≥ ${RULE.heightHouse} m), under ${RULE.height} m for flats.`, source: SOURCES.height }
    : { id: "height", level: "ok", text: `Room height ${h.toFixed(2)} m (≥ ${RULE.height} m).`, source: SOURCES.height });
  const onRoom = (r: Room, kind: FpOpeningKind) => plan.openings.filter((o) => o.kind === kind && r.walls.includes(o.wall));
  for (const r of rooms) {
    if (r.kind === "living") {
      out.push(r.net < RULE.area ? { id: `area:${r.id}`, level: "warn", text: `${r.name}: ${m2(r.net)} inside, under ${RULE.area} m².`, room: r.id, source: SOURCES.area }
        : { id: `area:${r.id}`, level: "ok", text: `${r.name}: ${m2(r.net)} (≥ ${RULE.area} m²).`, room: r.id, source: SOURCES.area });
      if (r.rect) { const w = Math.min(r.rect.w, r.rect.d);
        out.push(w < RULE.width ? { id: `width:${r.id}`, level: "warn", text: `${r.name}: ${w.toFixed(2)} m between walls, under ${RULE.width} m.`, room: r.id, source: SOURCES.width }
          : { id: `width:${r.id}`, level: "ok", text: `${r.name}: ${w.toFixed(2)} m wide (≥ ${RULE.width} m).`, room: r.id, source: SOURCES.width }); }
      else out.push({ id: `width:${r.id}`, level: "info", text: `${r.name} is not a rectangle: check its narrowest width (≥ ${RULE.width} m) by hand.`, room: r.id, source: SOURCES.width });
    }
    if (r.kind === "living" || r.kind === "kitchen") {
      if (!onRoom(r, "door").length) out.push({ id: `door:${r.id}`, level: "fail", text: `${r.name} has no door.`, room: r.id, source: SOURCES.door });
      const outer = onRoom(r, "window").filter((o) => (sides.get(o.wall)?.length ?? 0) === 1);
      if (!outer.length) out.push({ id: `window:${r.id}`, level: "fail", text: `${r.name} has no outside window.`, room: r.id, source: SOURCES.window });
    }
  }
  for (const o of plan.openings.filter((x) => x.kind === "door")) {
    const rs = (sides.get(o.wall) ?? []).map((id) => rooms.find((r) => r.id === id)!).filter(Boolean);
    const outer = rs.length < 2, wet = rs.some((r) => r.kind === "wet");
    const need = outer ? RULE.doorOuter : wet ? RULE.doorWet : RULE.doorInner, what = outer ? "Front/outer door" : `Door ${rs.map((r) => r.name).join("–")}`;
    if (o.w + 1e-9 < need) out.push({ id: `doorw:${o.id}`, level: "fail", text: `${what}: ${mm(o.w)} wide, needs ${mm(need)}.`, opening: o.id, source: SOURCES.doorW });
    if (o.h + 1e-9 < RULE.doorH) out.push({ id: `doorh:${o.id}`, level: "fail", text: `${what}: ${mm(o.h)} high, needs ${mm(RULE.doorH)}.`, opening: o.id, source: SOURCES.doorW });
  }
  return out;
}

/** The headline numbers. */
export function planStats(plan: FloorPlan, rooms = findRooms(plan)) {
  const fps = footprints(plan);
  return { rooms: rooms.length, net: r3(rooms.reduce((s, r) => s + r.net, 0)), gross: r3(rooms.reduce((s, r) => s + r.gross, 0)),
    footprint: r3(fps.reduce((s, f) => s + polyArea(f), 0)), doors: plan.openings.filter((o) => o.kind === "door").length, windows: plan.openings.filter((o) => o.kind === "window").length };
}

// ---------- plan → ARCH scene ----------
/** An orthogonal polygon → rectangles: vertical strips between distinct x, merged where neighbours have the same span. */
export function rectangles(poly: P[]): Rect[] {
  const xs = [...new Set(poly.map((p) => p[0]))].sort((a, b) => a - b), strips: Rect[][] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2, zs: number[] = [];
    for (let k = 0; k < poly.length; k++) { const [x0, z0] = poly[k], [x1, z1] = poly[(k + 1) % poly.length]; if (Math.abs(z0 - z1) < 1e-9 && (x0 - xm) * (x1 - xm) < 0) zs.push(z0); }
    zs.sort((a, b) => a - b);
    const row: Rect[] = [];
    for (let k = 0; k + 1 < zs.length; k += 2) row.push({ x0: xs[i], x1: xs[i + 1], z0: zs[k], z1: zs[k + 1] });
    strips.push(row);
  }
  const out: Rect[] = [];
  let open: Rect[] = [];
  for (const row of strips) {
    const next: Rect[] = [];
    for (const r of row) { const o = open.find((q) => q.z0 === r.z0 && q.z1 === r.z1 && Math.abs(q.x1 - r.x0) < 1e-9); if (o) { o.x1 = r.x1; next.push(o); } else next.push({ ...r }); }
    for (const o of open) if (!next.includes(o)) out.push(o);
    open = next;
  }
  return [...out, ...open].map((r) => ({ x0: r3(r.x0), x1: r3(r.x1), z0: r3(r.z0), z1: r3(r.z1) }));
}

type Chain = { id: string; o: "h" | "v"; c: number; lo: number; hi: number; t: number; walls: string[] };
/** Walls → ARCH wall blocks. Level walls run as one block through junctions and reach over the plumb walls they meet; plumb walls
 *  stop at the level walls' faces. So every corner, T and cross is filled exactly once (no doubled volume in the quantities). */
export function wallChains(plan: FloorPlan): Chain[] {
  const nm = nodeMap(plan), E = plan.walls.map((w) => ({ w, e: wallEnds(plan, w, nm)! })).filter((x) => x.e);
  const hs = E.filter((x) => orient(x.e) === "h"), vs = E.filter((x) => orient(x.e) === "v");
  const key = (p: P) => `${p[0]},${p[1]}`;
  const hAt = new Map<string, number>(), vAt = new Map<string, number>(); // node → widest level / plumb wall meeting it
  for (const { w, e } of hs) for (const p of e) hAt.set(key(p), Math.max(hAt.get(key(p)) ?? 0, w.t));
  for (const { w, e } of vs) for (const p of e) vAt.set(key(p), Math.max(vAt.get(key(p)) ?? 0, w.t));
  const chains: Chain[] = [];
  const build = (list: typeof hs, o: "h" | "v") => {
    const groups = new Map<string, { lo: number; hi: number; id: string }[]>();
    for (const { w, e } of list) {
      const c = o === "h" ? e[0][1] : e[0][0], a = o === "h" ? e[0][0] : e[0][1], b = o === "h" ? e[1][0] : e[1][1];
      const g = `${c}|${w.t}`;
      (groups.get(g) ?? groups.set(g, []).get(g)!).push({ lo: Math.min(a, b), hi: Math.max(a, b), id: w.id });
    }
    for (const [g, segs] of groups) {
      const [c, t] = g.split("|").map(Number);
      segs.sort((p, q) => p.lo - q.lo);
      let cur: Chain | null = null;
      for (const s of segs) {
        const joint = o === "h" ? key([s.lo, c]) : key([c, s.lo]);
        const join = cur && Math.abs(cur.hi - s.lo) < 1e-9 && (o === "h" || !hAt.has(joint)); // plumb runs break where a level wall meets
        if (cur && join) { cur.hi = s.hi; cur.walls.push(s.id); }
        else { if (cur) chains.push(cur); cur = { id: "", o, c, lo: s.lo, hi: s.hi, t, walls: [s.id] }; }
      }
      if (cur) chains.push(cur);
    }
  };
  build(hs, "h"); build(vs, "v");
  return chains.map((ch, i) => {
    const endLo = ch.o === "h" ? key([ch.lo, ch.c]) : key([ch.c, ch.lo]), endHi = ch.o === "h" ? key([ch.hi, ch.c]) : key([ch.c, ch.hi]);
    const lo = ch.o === "h" ? ch.lo - (vAt.get(endLo) ?? 0) / 2 : ch.lo + (hAt.get(endLo) ?? 0) / 2;
    const hi = ch.o === "h" ? ch.hi + (vAt.get(endHi) ?? 0) / 2 : ch.hi - (hAt.get(endHi) ?? 0) / 2;
    return { ...ch, id: `c${i + 1}`, lo: r3(lo), hi: r3(hi) };
  }).filter((ch) => ch.hi - ch.lo > 0.01);
}

export type SceneBuild = { scene: Scene; offset: P; skipped: string[]; notes: string[] };
/** The plan as ARCH parts (one storey): footings and floor slab under the footprint, a block per wall run, the roof (a gable
 *  over a plain rectangle, flat roof pieces over an L/U), and every door and window fitted into its wall. Centred on the plot. */
export function planToScene(plan: FloorPlan, rooms = findRooms(plan)): SceneBuild {
  const nm = nodeMap(plan), notes: string[] = [], skipped: string[] = [];
  const fps = footprints(plan);
  const all = plan.nodes.map((n) => [n.x, n.z] as P);
  if (!all.length) return { scene: { plot: { w: 30, d: 25, ground: "grass", trees: 6 }, parts: [] }, offset: [0, 0], skipped, notes: ["The plan is empty."] };
  const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
  const off: P = [snap((Math.min(...xs) + Math.max(...xs)) / 2), snap((Math.min(...zs) + Math.max(...zs)) / 2)];
  const X = (x: number) => r3(x - off[0]), Z = (z: number) => r3(z - off[1]);
  const H = plan.height, y0 = FP.slab, parts: Part[] = [], openings: Part[] = [];
  let n = 0;
  const id = () => `s${(n++).toString(36)}`;
  const rects = fps.flatMap((f) => (f.every((p, k) => { const q = f[(k + 1) % f.length]; return p[0] === q[0] || p[1] === q[1]; }) ? rectangles(f) : []));
  if (fps.length && !rects.length) notes.push("The outline has slanted sides, so there is no slab or roof under it.");
  for (const r of rects) parts.push({ id: id(), kind: "foundation", name: "Footing", x: X((r.x0 + r.x1) / 2), y: -FP.footing, z: Z((r.z0 + r.z1) / 2), w: r3(r.x1 - r.x0), d: r3(r.z1 - r.z0), h: FP.footing });
  for (const r of rects) parts.push({ id: id(), kind: "slab", name: "Floor slab", x: X((r.x0 + r.x1) / 2), y: 0, z: Z((r.z0 + r.z1) / 2), w: r3(r.x1 - r.x0), d: r3(r.z1 - r.z0), h: FP.slab });
  const sides = wallSides(rooms), chains = wallChains(plan), hostOf = new Map<string, Part>();
  for (const ch of chains) {
    const mid = (ch.lo + ch.hi) / 2, len = r3(ch.hi - ch.lo), outer = ch.walls.some((w) => (sides.get(w)?.length ?? 0) < 2 && rooms.length > 0);
    const p: Part = ch.o === "h"
      ? { id: id(), kind: "wall", name: `${outer ? "Outer" : "Inner"} wall`, x: X(mid), y: y0, z: Z(ch.c), w: len, d: ch.t, h: H }
      : { id: id(), kind: "wall", name: `${outer ? "Outer" : "Inner"} wall`, x: X(ch.c), y: y0, z: Z(mid), w: ch.t, d: len, h: H };
    parts.push(p);
    for (const w of ch.walls) hostOf.set(w, p);
  }
  for (const w of plan.walls) if (!hostOf.has(w.id)) skipped.push(w.id);
  if (skipped.length) notes.push(`${skipped.length} slanted wall${skipped.length === 1 ? " is" : "s are"} left out of 3D.`);
  const top = y0 + H;
  if (rects.length === 1) { const r = rects[0]; parts.push({ id: id(), kind: "roof", name: "Gable roof", x: X((r.x0 + r.x1) / 2), y: top, z: Z((r.z0 + r.z1) / 2), w: r3(r.x1 - r.x0 + 0.8), d: r3(r.z1 - r.z0 + 0.8), h: 2 }); }
  else for (const r of rects) parts.push({ id: id(), kind: "roof", name: "Flat roof", x: X((r.x0 + r.x1) / 2), y: top, z: Z((r.z0 + r.z1) / 2), w: r3(r.x1 - r.x0 + 0.4), d: r3(r.z1 - r.z0 + 0.4), h: 0.3 });
  const roomPoly = new Map(rooms.map((r) => [r.id, r.poly]));
  for (const o of plan.openings) {
    const host = hostOf.get(o.wall), p = openingPoint(plan, o, nm);
    if (!host || !p) continue;
    const h = host.w >= host.d; // level wall
    const rs = sides.get(o.wall) ?? [];
    let face: Face = h ? "s" : "e";
    if (rs.length === 1) { // outer wall: the face that looks outside
      const poly = roomPoly.get(rs[0])!, probe: P = h ? [p[0], p[1] + 0.3] : [p[0] + 0.3, p[1]];
      face = inPoly(probe, poly) ? (h ? "n" : "w") : (h ? "s" : "e");
    }
    openings.push({ id: id(), kind: o.kind, name: o.kind === "door" ? (rs.length < 2 ? "Front door" : "Door") : "Window", host: host.id, face,
      off: r3(h ? X(p[0]) - host.x : Z(p[1]) - host.z), sill: o.sill, x: 0, y: 0, z: 0, w: o.w, d: 0, h: o.h });
  }
  const ordered = [...parts, ...openings.filter((p) => p.kind === "door"), ...openings.filter((p) => p.kind === "window")];
  if (ordered.length > MAX.parts) notes.push(`ARCH keeps ${MAX.parts} parts, so ${ordered.length - MAX.parts} of the last windows are left out.`);
  const bw = Math.max(...xs) - Math.min(...xs), bd = Math.max(...zs) - Math.min(...zs);
  const plot = { w: Math.min(MAX.plot, Math.max(24, Math.ceil(bw + 16))), d: Math.min(MAX.plot, Math.max(20, Math.ceil(bd + 14))), ground: "grass" as const, trees: 6 };
  return { scene: { plot, parts: fitOpenings(ordered.slice(0, MAX.parts)) }, offset: off, skipped, notes };
}

// ---------- a text brief through the rule-based layout generator (arch-plan-pure) ----------
const CIRC = /hall|corridor|entr|lobby|esik|koridor/i, DARK = /bath|wc|toilet|storage|store|closet|pantry|sauna|utility|laundry|garage|vann|tualett|saun|panipaik|esik|hall|corridor|koridor/i;
/** One generated option (first floor) → a FloorPlan: rectangle edges become walls (cleanPlan splits and de-duplicates the shared
 *  ones), a door on each met adjacency wish, a front door on the hall's outer side, windows on rooms that should have daylight. */
export function planFromOption(brief: Brief, o: PlanOption, name = "House from a brief"): FloorPlan {
  const fl = o.floors[0], rect = new Map(fl.rooms.map(({ i, r }) => [i, r])), nameOf = (i: number) => brief.rooms[i]?.name ?? `Room ${i + 1}`;
  const walls: { a: P; b: P }[] = [];
  for (const { r } of fl.rooms) walls.push({ a: [r.x0, r.z0], b: [r.x1, r.z0] }, { a: [r.x1, r.z0], b: [r.x1, r.z1] }, { a: [r.x1, r.z1], b: [r.x0, r.z1] }, { a: [r.x0, r.z1], b: [r.x0, r.z0] });
  const X0 = Math.min(...fl.rooms.map((x) => x.r.x0)), X1 = Math.max(...fl.rooms.map((x) => x.r.x1)), Z0 = Math.min(...fl.rooms.map((x) => x.r.z0)), Z1 = Math.max(...fl.rooms.map((x) => x.r.z1));
  const outerEdges = (r: Rect) => ([[r.x0, r.z0, r.x1, r.z0, Math.abs(r.z0 - Z0) < 1e-6], [r.x1, r.z0, r.x1, r.z1, Math.abs(r.x1 - X1) < 1e-6], [r.x0, r.z1, r.x1, r.z1, Math.abs(r.z1 - Z1) < 1e-6], [r.x0, r.z0, r.x0, r.z1, Math.abs(r.x0 - X0) < 1e-6]] as const)
    .filter((e) => e[4]).map(([a, b, c, d]) => ({ a: [a, b] as P, b: [c, d] as P, len: Math.hypot(c - a, d - b) })).sort((p, q) => q.len - p.len);
  const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const openings: { kind: FpOpeningKind; x: number; z: number; w: number }[] = [];
  for (const [ia, ib] of o.met) {
    const A = rect.get(ia), B = rect.get(ib);
    if (!A || !B) continue;
    const x0 = Math.max(A.x0, B.x0), x1 = Math.min(A.x1, B.x1), z0 = Math.max(A.z0, B.z0), z1 = Math.min(A.z1, B.z1);
    if ((Math.abs(x0 - x1) < 1e-6 && z1 - z0 >= 1.5) || (Math.abs(z0 - z1) < 1e-6 && x1 - x0 >= 1.5)) openings.push({ kind: "door", x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: FP.door.w });
  }
  const front = [...fl.rooms].sort((p, q) => Number(CIRC.test(nameOf(q.i))) - Number(CIRC.test(nameOf(p.i)))).find(({ r }) => outerEdges(r).some((e) => e.len >= 1.6));
  if (front) { const e = outerEdges(front.r).find((x) => x.len >= 1.6)!, m = mid(e.a, e.b); openings.push({ kind: "door", x: m[0], z: m[1], w: 1 }); }
  for (const { i, r } of fl.rooms) {
    if (DARK.test(nameOf(i))) continue;
    const e = outerEdges(r).find((x) => x.len >= 1.8);
    if (!e) continue;
    const big = (r.x1 - r.x0) * (r.z1 - r.z0) > 20 && e.len >= 4.2;
    for (const k of big ? [1 / 3, 2 / 3] : [0.5]) openings.push({ kind: "window", x: e.a[0] + (e.b[0] - e.a[0]) * k, z: e.a[1] + (e.b[1] - e.a[1]) * k, w: FP.window.w });
  }
  const rooms = fl.rooms.map(({ i, r }) => ({ name: nameOf(i), x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }));
  return planFromRaw({ name, walls, openings, rooms }, "brief");
}

/** The model's reading of a text brief ({rooms:[{name, area}], adj:[[a, b]]}) → a one-storey plan via the layout generator. */
export function planFromBrief(raw: unknown, seed = 1): FloorPlan | null {
  const o = isObj(raw) ? raw : {};
  const rooms = (Array.isArray(o.rooms) ? o.rooms : []).filter(isObj).map((r) => ({ name: text(r.name, 30).replace(/[,@\d]+/g, " ").trim(), area: num(r.area, 2, 120) })).filter((r) => r.name && r.area);
  if (!rooms.length) return null;
  const adj = (Array.isArray(o.adj) ? o.adj : []).filter((p): p is unknown[] => Array.isArray(p) && p.length === 2).map((p) => `${text(p[0], 30)} - ${text(p[1], 30)}`).join("\n");
  const total = rooms.reduce((s, r) => s + r.area!, 0), side = Math.ceil(Math.sqrt(total * 1.3)) + 12;
  const brief = parseRoomsBrief(rooms.map((r) => `${r.name} ${r.area}`).join("\n"), adj, { w: side, d: side }, 1);
  const opts = generatePlans(brief, seed);
  return opts.length ? planFromOption(brief, opts[0], text(o.name, 60) || "House from a brief") : null;
}

// ---------- sample: a one-storey L-shaped house with round numbers, checkable by hand ----------
export function samplePlan(): FloorPlan {
  const R = (x0: number, z0: number, x1: number, z1: number) => [{ a: [x0, z0], b: [x1, z0] }, { a: [x1, z0], b: [x1, z1] }, { a: [x1, z1], b: [x0, z1] }, { a: [x0, z1], b: [x0, z0] }];
  const walls = [...R(0, 0, 8, 4.5), ...R(8, 0, 12, 4.5), ...R(4.5, 4.5, 12, 6.3), ...R(0, 4.5, 4.5, 9), ...R(4.5, 6.3, 8, 9), ...R(8, 6.3, 10, 9), ...R(10, 6.3, 12, 9), ...R(8, 9, 12, 12)];
  const rooms = [["Kitchen + living", 4, 2.25], ["Bedroom", 10, 2.25], ["Hall", 8.25, 5.4], ["Bedroom 2", 2.25, 6.75], ["Bath", 6.25, 7.65], ["Sauna", 9, 7.65], ["Utility", 11, 7.65], ["Garage", 10, 10.5]]
    .map(([name, x, z]) => ({ name, x, z }));
  const D = (x: number, z: number, w = FP.door.w) => ({ kind: "door", x, z, w }), W = (x: number, z: number, w = FP.window.w) => ({ kind: "window", x, z, w });
  const openings = [
    D(12, 5.4), D(6.25, 4.5, 1.2), D(10, 4.5), D(4.5, 5.4), D(6.25, 6.3, 0.8), D(8, 7.65, 0.7), D(11, 6.3, 0.8), D(11, 9), D(10, 12, 2.4),
    W(2, 0, 1.8), W(6, 0, 1.8), W(0, 2.25, 1.5), W(10, 0, 1.5), W(12, 2.25), W(0, 6.75, 1.5), W(6.25, 9, 0.6), W(12, 7.65, 0.6),
  ];
  return planFromRaw({ name: "Sample house", height: 2.7, walls, openings, rooms }, "sample");
}

/** The file the owner can download, edit and load back (planFromRaw reads it). */
export const planJson = (plan: FloorPlan) => JSON.stringify(plan, null, 1);
