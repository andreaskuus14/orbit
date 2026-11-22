// ARCH → real building geometry (pure, tested in tests/arch-mesh.test.ts). One source for the three.js preview (ArchHouse.tsx)
// and the Blender render (arch-blender-pure.ts), so what he sees in the browser is what Blender renders.
// The scene stays simple blocks (quantities, IFC and the AI edit them); this turns them into what an architect draws:
//  - walls with their real thickness (an outer shell is four walls, not a solid box) and openings cut through as holes, so each
//    hole has reveals; windows get a frame set back in the reveal, mullions, a transom on tall glazing, glass, an outside metal
//    sill and an inside window board; doors get a frame, a leaf (planks outside, panels inside), a handle and a threshold;
//  - roofs by form (gable / hip / shed / flat with parapet), eaves overhang, fascia, gutters with downpipes, a ridge cap and the
//    gable triangles filled in the wall plane;
//  - slabs as a floor with an edge band (concrete plinth at ground level), stairs as real steps.
// Everything is axis-aligned triangles grouped by material, with world-space UVs in metres (textures repeat per metre).
// Units metres, y up, x east, −z north (ARCH axes).
import { isInteriorDoor, isOpening, isStraightWall, RULES, ridgeOf, roofForm, styleOf, type Facade, type Part, type Scene } from "./arch-pure.ts";
import { wallPieces } from "./arch-ifc-pure.ts";

export const MATS = ["plaster", "timber", "brick", "concrete", "inner", "plinth", "floor", "deck", "roofMetal", "roofTile", "roofMembrane",
  "fascia", "gutter", "frame", "glass", "sill", "doorExt", "doorInt", "metal", "stair", "prop", "trim", "coping", "fail"] as const;
export type MatKey = (typeof MATS)[number];
type V3 = [number, number, number];
/** lift: the roof part this group belongs to (Blender's fly-through lifts the roof away), or null. tri[i] = the part triangle i came from. */
export type MeshGroup = { mat: MatKey; lift: string | null; pos: number[]; nor: number[]; uv: number[]; tri: string[] };
export type HouseMesh = { groups: MeshGroup[]; min: V3; max: V3; tris: number };
export type MeshOpts = { hideRoof?: boolean; fail?: ReadonlySet<string> };

/** Opening and roof detail sizes (m): what a joiner and a roofer would use, kept in one place. */
export const DETAIL = {
  reveal: 0.12, frame: 0.07, frameDepth: 0.08, mullion: 0.06, paneMax: 1.0, transomFrom: 1.9, glass: 0.024,
  sillOut: 0.05, leaf: 0.05, roofT: 0.22, fascia: 0.03, gutterW: 0.12, gutterH: 0.1, pipe: 0.08, parapet: 0.45, parapetT: 0.25,
  corner: 0.12, riser: 0.19, gableOverhang: 0.3, eaveOverhang: 0.5,
};
const EPS = 1e-6;
const FACADE_MAT: Record<Facade, MatKey> = { plaster: "plaster", timber: "timber", brick: "brick", concrete: "concrete" };
const ROOF_MAT = { metal: "roofMetal", tile: "roofTile", membrane: "roofMembrane" } as const;
const OUTER_NAME = /outer|exterior|välis/i;

class Builder {
  private map = new Map<string, MeshGroup>();
  part = "";
  lift: string | null = null;
  get groups() { return [...this.map.values()].filter((g) => g.pos.length); }
  private g(mat: MatKey): MeshGroup {
    const k = `${mat}|${this.lift ?? ""}`;
    return this.map.get(k) ?? this.map.set(k, { mat, lift: this.lift, pos: [], nor: [], uv: [], tri: [] }).get(k)!;
  }
  /** A planar convex polygon, fan-triangulated; the winding is flipped if needed so its normal points along `out`. */
  face(mat: MatKey, pts: V3[], uv: [number, number][], out: V3) {
    if (pts.length < 3) return;
    const [a, b, c] = pts, u = sub(b, a), v = sub(c, a);
    let n = norm(cross(u, v));
    if (!Number.isFinite(n[0]) || (n[0] === 0 && n[1] === 0 && n[2] === 0)) return; // degenerate
    let P = pts, U = uv;
    if (dot(n, out) < 0) { P = [...pts].reverse(); U = [...uv].reverse(); n = [-n[0], -n[1], -n[2]]; }
    const g = this.g(mat);
    for (let i = 1; i + 1 < P.length; i++) {
      for (const k of [0, i, i + 1]) { g.pos.push(...P[k]); g.nor.push(...n); g.uv.push(...U[k]); }
      g.tri.push(this.part);
    }
  }
  /** Axis-aligned box [x0,x1]×[y0,y1]×[z0,z1]; world UVs (z,y) on ±x, (x,z) on ±y, (x,y) on ±z. */
  box(mat: MatKey, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    if (x1 - x0 < EPS || y1 - y0 < EPS || z1 - z0 < EPS) return;
    const q = (pts: V3[], uv: (p: V3) => [number, number], out: V3) => this.face(mat, pts, pts.map(uv), out);
    q([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], (p) => [p[2], p[1]], [1, 0, 0]);
    q([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], (p) => [-p[2], p[1]], [-1, 0, 0]);
    q([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], (p) => [p[0], p[2]], [0, 1, 0]);
    q([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], (p) => [p[0], -p[2]], [0, -1, 0]);
    q([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], (p) => [p[0], p[1]], [0, 0, 1]);
    q([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], (p) => [-p[0], p[1]], [0, 0, -1]);
  }
  /** A convex profile in the (across, y) plane, extruded along `axis` from e0 to e1. caps: material of the two end faces. */
  prism(mat: MatKey, prof: [number, number][], axis: "x" | "z", e0: number, e1: number, caps: MatKey = mat) {
    if (e1 - e0 < EPS || prof.length < 3) return;
    const P = (a: number, y: number, e: number): V3 => (axis === "x" ? [e, y, a] : [a, y, e]);
    const ca = prof.reduce((s, p) => s + p[0], 0) / prof.length, cy = prof.reduce((s, p) => s + p[1], 0) / prof.length;
    const along: V3 = axis === "x" ? [1, 0, 0] : [0, 0, 1];
    this.face(caps, prof.map(([a, y]) => P(a, y, e1)), prof.map(([a, y]) => [a, y]), along);
    this.face(caps, prof.map(([a, y]) => P(a, y, e0)), prof.map(([a, y]) => [-a, y]), [-along[0], 0, -along[2]]);
    for (let i = 0; i < prof.length; i++) {
      const p = prof[i], q = prof[(i + 1) % prof.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < EPS) continue;
      const da = (q[0] - p[0]) / len, dy = (q[1] - p[1]) / len, mid = [(p[0] + q[0]) / 2 - ca, (p[1] + q[1]) / 2 - cy];
      const out: V3 = axis === "x" ? [0, mid[1], mid[0]] : [mid[0], mid[1], 0];
      const v = (pt: [number, number]) => pt[0] * da + pt[1] * dy; // distance along the edge: rows of tiles run down the slope
      this.face(mat, [P(p[0], p[1], e0), P(q[0], q[1], e0), P(q[0], q[1], e1), P(p[0], p[1], e1)], [[e0, v(p)], [e0, v(q)], [e1, v(q)], [e1, v(p)]], out);
    }
  }
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export type Hole = { u0: number; u1: number; y0: number; y1: number };
/** A wall face [lo, hi] × [yb, yt] minus rectangular holes → solid rectangles (column strips merged where they line up). */
export function cutFace(lo: number, hi: number, yb: number, yt: number, holes: Hole[]): Hole[] {
  const hs = holes.map((h) => ({ u0: Math.max(lo, h.u0), u1: Math.min(hi, h.u1), y0: Math.max(yb, h.y0), y1: Math.min(yt, h.y1) })).filter((h) => h.u1 - h.u0 > EPS && h.y1 - h.y0 > EPS);
  const us = [...new Set([lo, hi, ...hs.flatMap((h) => [h.u0, h.u1])].map((u) => Math.round(u * 1e6) / 1e6))].sort((a, b) => a - b);
  const out: Hole[] = [];
  let open: Hole[] = [];
  for (let i = 0; i + 1 < us.length; i++) {
    const a = us[i], b = us[i + 1];
    if (b - a < EPS) continue;
    const cover = hs.filter((h) => h.u0 <= a + EPS && h.u1 >= b - EPS).sort((p, q) => p.y0 - q.y0);
    const solid: [number, number][] = [];
    let y = yb;
    for (const h of cover) { if (h.y0 > y + EPS) solid.push([y, h.y0]); y = Math.max(y, h.y1); }
    if (yt > y + EPS) solid.push([y, yt]);
    const next: Hole[] = [];
    for (const [y0, y1] of solid) {
      const o = open.find((r) => Math.abs(r.y0 - y0) < EPS && Math.abs(r.y1 - y1) < EPS && Math.abs(r.u1 - a) < EPS);
      if (o) { o.u1 = b; next.push(o); } else next.push({ u0: a, u1: b, y0, y1 });
    }
    for (const o of open) if (!next.includes(o)) out.push(o);
    open = next;
  }
  return [...out, ...open];
}

type WallBox = { x: number; y: number; z: number; w: number; d: number; h: number };
const alongXOf = (b: WallBox) => b.w >= b.d;

/** An outer wall: a shell, a straight wall marked or named outer, or one as thick as an outer wall (partitions are 0.1-0.2 m). */
export const isOuterWall = (p: Part) => !isStraightWall(p) || p.group === "exterior" || OUTER_NAME.test(p.name) || (p.group !== "interior" && Math.min(p.w, p.d) >= 0.25);
/** The facade material of a wall part: outer walls wear the facade; partitions are white plaster. */
export function wallMat(p: Part, facade: MatKey, fail?: ReadonlySet<string>): MatKey {
  if (fail?.has(p.id)) return "fail";
  return isOuterWall(p) ? facade : "inner";
}

/** Which wall piece an opening sits in: for a shell the piece on its face, for a straight wall the wall itself. */
function pieceFor(o: Part, pieces: { face?: string; box: WallBox }[]) { return pieces.find((q) => !q.face || q.face === o.face); }

/** Window or door detail inside its hole. Exported for tests. */
export function openingDetail(b: Builder, o: Part, box: WallBox, wall: Part) {
  const ns = o.face === "n" || o.face === "s", sg = o.face === "s" || o.face === "e" ? 1 : -1;
  const t = ns ? box.d : box.w, cw = ns ? box.z : box.x, outer = cw + sg * t / 2, inner = cw - sg * t / 2;
  const c = ns ? o.x : o.z, u0 = c - o.w / 2, u1 = c + o.w / 2, y0 = o.y, y1 = o.y + o.h;
  const D = DETAIL, r = Math.min(D.reveal, t * 0.4), fb = D.frame, fd = Math.min(D.frameDepth, t - r);
  const f0 = outer - sg * r, f1 = f0 - sg * fd; // the frame's outer and inner planes (depth along the wall normal)
  const put = (mat: MatKey, a0: number, a1: number, b0: number, b1: number, d0: number, d1: number) => {
    const [lo, hi] = d0 < d1 ? [d0, d1] : [d1, d0];
    if (ns) b.box(mat, a0, a1, b0, b1, lo, hi); else b.box(mat, lo, hi, b0, b1, a0, a1);
  };
  b.part = o.id;
  if (o.kind === "window") {
    put("frame", u0, u0 + fb, y0, y1, f0, f1); put("frame", u1 - fb, u1, y0, y1, f0, f1);
    put("frame", u0 + fb, u1 - fb, y1 - fb, y1, f0, f1); put("frame", u0 + fb, u1 - fb, y0, y0 + fb, f0, f1);
    const panes = o.w > 1.3 ? Math.max(2, Math.round(o.w / D.paneMax)) : 1;
    for (let i = 1; i < panes; i++) { const m = u0 + (o.w * i) / panes; put("frame", m - D.mullion / 2, m + D.mullion / 2, y0 + fb, y1 - fb, f0, f1); }
    if (o.h >= D.transomFrom) { const ty = y0 + o.h * 0.72; put("frame", u0 + fb, u1 - fb, ty - D.mullion / 2, ty + D.mullion / 2, f0, f1); }
    const gm = (f0 + f1) / 2;
    put("glass", u0 + fb, u1 - fb, y0 + fb, y1 - fb, gm - D.glass / 2, gm + D.glass / 2);
    if (o.y > wall.y + 0.05) {
      put("sill", u0 - 0.03, u1 + 0.03, y0 - 0.025, y0 + 0.005, f0, outer + sg * D.sillOut); // folded metal sill, sheds rain past the render
      put("inner", u0 - 0.02, u1 + 0.02, y0 - 0.02, y0, f1, inner - sg * 0.02); // window board inside
    }
  } else {
    put("frame", u0, u0 + fb, y0, y1, f0, f1); put("frame", u1 - fb, u1, y0, y1, f0, f1); put("frame", u0 + fb, u1 - fb, y1 - fb, y1, f0, f1);
    const ext = !isInteriorDoor(o, wall), leaf: MatKey = ext ? "doorExt" : "doorInt", lm = (f0 + f1) / 2, l0 = lm - D.leaf / 2, l1 = lm + D.leaf / 2;
    const a0 = u0 + fb, a1 = u1 - fb, top = y1 - fb, face = sg > 0 ? l1 : l0; // the leaf's outer face
    put(leaf, a0, a1, y0 + 0.01, top, l0, l1);
    if (ext) for (let k = 1; k <= 3; k++) { const yy = y0 + ((top - y0) * k) / 4; put("metal", a0 + 0.06, a1 - 0.06, yy - 0.006, yy + 0.006, face, face + sg * 0.004); } // plank grooves
    else for (const [b0, b1] of [[y0 + 0.15, y0 + 0.9], [y0 + 1.05, top - 0.15]]) put("doorInt", a0 + 0.1, a1 - 0.1, b0, b1, face, face + sg * 0.008); // raised panels
    const hx = sg > 0 ? a1 - 0.09 : a0 + 0.06; // handle on the lock side, both faces
    put("metal", hx, hx + 0.03, y0 + 0.9, y0 + (ext ? 1.3 : 1.05), face, face + sg * 0.06);
    put("metal", hx, hx + 0.03, y0 + 0.9, y0 + 1.05, sg > 0 ? l0 : l1, (sg > 0 ? l0 : l1) - sg * 0.06);
    if (ext) put("sill", u0, u1, y0 - 0.005, y0 + 0.02, outer + sg * 0.03, inner); // threshold
  }
}

/** One wall part → its pieces with the holes cut out, plus every opening's frame, glass or leaf. */
function wallMesh(b: Builder, wall: Part, openings: Part[], facade: MatKey, fail?: ReadonlySet<string>, trim = false) {
  const pieces = wallPieces(wall) as { face?: string; box: WallBox }[], mat = wallMat(wall, facade, fail);
  const mine = openings.filter((o) => o.host === wall.id && o.face);
  for (const pc of pieces) {
    const bx = pc.box, ax = alongXOf(bx), lo = ax ? bx.x - bx.w / 2 : bx.z - bx.d / 2, hi = ax ? bx.x + bx.w / 2 : bx.z + bx.d / 2;
    const here = mine.filter((o) => pieceFor(o, pieces) === pc);
    const holes = here.map((o) => { const c = ax ? o.x : o.z; return { u0: c - o.w / 2, u1: c + o.w / 2, y0: o.y, y1: o.y + o.h }; });
    b.part = wall.id;
    for (const r of cutFace(lo, hi, bx.y, bx.y + bx.h, holes)) {
      if (ax) b.box(mat, r.u0, r.u1, r.y0, r.y1, bx.z - bx.d / 2, bx.z + bx.d / 2);
      else b.box(mat, bx.x - bx.w / 2, bx.x + bx.w / 2, r.y0, r.y1, r.u0, r.u1);
    }
    for (const o of here) openingDetail(b, o, bx, wall);
  }
  if (trim && !isStraightWall(wall)) { // timber corner boards, a hand's width proud of the cladding
    b.part = wall.id;
    const c = DETAIL.corner, x0 = wall.x - wall.w / 2, x1 = wall.x + wall.w / 2, z0 = wall.z - wall.d / 2, z1 = wall.z + wall.d / 2;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as const) {
      const xa = x === x0 ? x0 - 0.02 : x1 + 0.02 - c, za = z === z0 ? z0 - 0.02 : z1 + 0.02 - c;
      b.box("trim", xa, xa + c, wall.y, wall.y + wall.h, za, za + c);
    }
  }
}

type Rect = { x0: number; x1: number; z0: number; z1: number };
/** The walls a roof sits on: the outer extent of every wall whose top meets the roof's base under its footprint. */
export function roofBase(roof: Part, parts: Part[]): Rect {
  const R = { x0: roof.x - roof.w / 2, x1: roof.x + roof.w / 2, z0: roof.z - roof.d / 2, z1: roof.z + roof.d / 2 };
  if (roof.roof && roof.ridge) { // a designed roof (arch-design-pure) carries its overhangs: the walls are the rect minus them
    const f = roof.roof, eave = f === "flat" ? 0 : DETAIL.eaveOverhang, gable = f === "flat" ? 0 : f === "hip" ? eave : DETAIL.gableOverhang;
    const ix = Math.min(roof.ridge === "x" ? gable : eave, roof.w / 4), iz = Math.min(roof.ridge === "x" ? eave : gable, roof.d / 4);
    return { x0: R.x0 + ix, x1: R.x1 - ix, z0: R.z0 + iz, z1: R.z1 - iz };
  }
  const under = parts.filter((p) => p.kind === "wall" && Math.abs(p.y + p.h - roof.y) < 0.06 && p.x - p.w / 2 < R.x1 && p.x + p.w / 2 > R.x0 && p.z - p.d / 2 < R.z1 && p.z + p.d / 2 > R.z0);
  if (!under.length) { const i = Math.min(0.4, roof.w * 0.1, roof.d * 0.1); return { x0: R.x0 + i, x1: R.x1 - i, z0: R.z0 + i, z1: R.z1 - i }; }
  return {
    x0: Math.max(R.x0, Math.min(...under.map((p) => p.x - p.w / 2))), x1: Math.min(R.x1, Math.max(...under.map((p) => p.x + p.w / 2))),
    z0: Math.max(R.z0, Math.min(...under.map((p) => p.z - p.d / 2))), z1: Math.min(R.z1, Math.max(...under.map((p) => p.z + p.d / 2))),
  };
}
/** Pitch of a roof part in degrees: its own, else from its height over half the span across the ridge (whole span for a shed). */
export function pitchOf(p: Part): number {
  if (typeof p.pitch === "number" && Number.isFinite(p.pitch) && p.pitch > 0) return Math.min(60, Math.max(3, p.pitch));
  const span = ridgeOf(p) === "x" ? p.d : p.w, run = roofForm(p) === "shed" ? span : span / 2;
  return Math.min(60, Math.max(3, (Math.atan2(p.h, Math.max(0.5, run)) * 180) / Math.PI));
}
/** Highest point of a roof as drawn (for cameras and shadow boxes). */
export function roofTop(p: Part, parts: Part[]): number {
  const form = roofForm(p);
  if (form === "flat") return p.y + Math.min(0.5, Math.max(0.2, p.h)) + DETAIL.parapet;
  const B = roofBase(p, parts), tan = Math.tan((pitchOf(p) * Math.PI) / 180), across = ridgeOf(p) === "x" ? B.z1 - B.z0 : B.x1 - B.x0;
  const shedRun = ridgeOf(p) === "x" ? p.z + p.d / 2 - B.z0 : p.x + p.w / 2 - B.x0; // a shed rises on past the high wall to its eave
  return p.y + (form === "shed" ? shedRun : across / 2) * tan + DETAIL.roofT;
}

/** 1D: [lo, hi] minus the given intervals. */
function minus(lo: number, hi: number, cut: [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]];
  for (const [a, b] of cut) out = out.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q]] : [...(a > p ? [[p, a]] : []), ...(b < q ? [[b, q]] : [])]) as [number, number][]);
  return out.filter(([p, q]) => q - p > 0.05);
}

function roofMesh(b: Builder, p: Part, parts: Part[], roofMat: MatKey, gableMat: MatKey) {
  const form = roofForm(p), B = roofBase(p, parts), D = DETAIL, T = RULES.wallThick;
  b.part = p.id; b.lift = p.id;
  if (form === "flat") {
    const th = Math.min(0.5, Math.max(0.2, p.h)), top = p.y + th;
    b.box("roofMembrane", B.x0, B.x1, p.y, top, B.z0, B.z1);
    // parapet on every edge that isn't shared with another flat roof (an L of flat pieces gets one parapet round the outside)
    const others = parts.filter((q) => q !== p && q.kind === "roof" && roofForm(q) === "flat" && Math.abs(q.y - p.y) < 0.06).map((q) => roofBase(q, parts));
    const edges: { o: "x" | "z"; c: number; lo: number; hi: number; s: number }[] = [
      { o: "x", c: B.z0, lo: B.x0, hi: B.x1, s: -1 }, { o: "x", c: B.z1, lo: B.x0, hi: B.x1, s: 1 }, { o: "z", c: B.x0, lo: B.z0, hi: B.z1, s: -1 }, { o: "z", c: B.x1, lo: B.z0, hi: B.z1, s: 1 }];
    const ph = top + D.parapet;
    for (const e of edges) {
      const probe = e.c + e.s * 0.1;
      const shared = others.filter((o) => (e.o === "x" ? probe > o.z0 && probe < o.z1 : probe > o.x0 && probe < o.x1)).map((o): [number, number] => (e.o === "x" ? [o.x0, o.x1] : [o.z0, o.z1]));
      for (const [lo, hi] of minus(e.lo, e.hi, shared)) {
        const i0 = e.s < 0 ? e.c : e.c - D.parapetT, i1 = i0 + D.parapetT;
        if (e.o === "x") { b.box(gableMat, lo, hi, p.y, ph, i0, i1); b.box("coping", lo - 0.03, hi + 0.03, ph, ph + 0.04, i0 - 0.04, i1 + 0.04); }
        else { b.box(gableMat, i0, i1, p.y, ph, lo, hi); b.box("coping", i0 - 0.04, i1 + 0.04, ph, ph + 0.04, lo - 0.03, hi + 0.03); }
      }
    }
    b.lift = null;
    return;
  }
  const ax = ridgeOf(p), tan = Math.tan((pitchOf(p) * Math.PI) / 180), tv = D.roofT;
  // local frame: a = along the ridge, c = across it
  let a0 = ax === "x" ? p.x - p.w / 2 : p.z - p.d / 2, a1 = ax === "x" ? p.x + p.w / 2 : p.z + p.d / 2;
  let c0 = ax === "x" ? p.z - p.d / 2 : p.x - p.w / 2, c1 = ax === "x" ? p.z + p.d / 2 : p.x + p.w / 2;
  const ba0 = ax === "x" ? B.x0 : B.z0, ba1 = ax === "x" ? B.x1 : B.z1, bc0 = ax === "x" ? B.z0 : B.x0, bc1 = ax === "x" ? B.z1 : B.x1;
  const box = (mat: MatKey, A0: number, A1: number, y0: number, y1: number, C0: number, C1: number) => (ax === "x" ? b.box(mat, A0, A1, y0, y1, Math.min(C0, C1), Math.max(C0, C1)) : b.box(mat, Math.min(C0, C1), Math.max(C0, C1), y0, y1, A0, A1));
  const eave = (c: number, s: number, ye: number, A0 = a0, A1 = a1) => { // fascia, gutter, and a downpipe back to the wall at each end
    box("fascia", A0, A1, ye - 0.05, ye + tv, c, c + s * D.fascia);
    const g0 = c + s * D.fascia, g1 = g0 + s * D.gutterW, gy = ye - 0.02;
    box("gutter", A0, A1, gy - D.gutterH, gy, g0, g1);
    const wallFace = s < 0 ? (ax === "x" ? B.z0 : B.x0) : (ax === "x" ? B.z1 : B.x1);
    const keep = b.lift;
    b.lift = null; // downpipes are fixed to the wall: they stay when a fly-through lifts the roof
    for (const pa of [Math.max(A0, ba0) + 0.15, Math.min(A1, ba1) - 0.15 - D.pipe]) {
      const pc0 = wallFace + s * 0.04, pc1 = pc0 + s * D.pipe;
      box("gutter", pa, pa + D.pipe, gy - D.gutterH - 0.06, gy - D.gutterH, pc0, (g0 + g1) / 2); // offset back to the wall
      box("gutter", pa, pa + D.pipe, 0.15, gy - D.gutterH, pc0, pc1);
    }
    b.lift = keep;
  };
  if (form === "gable" || form === "shed") {
    const u = (c: number) => p.y + (form === "gable" ? Math.min(c - bc0, bc1 - c) : c - bc0) * tan; // underside of the roof at c
    const cm = (bc0 + bc1) / 2;
    const slope = (from: number, to: number) => b.prism(roofMat, [[from, u(from)], [to, u(to)], [to, u(to) + tv], [from, u(from) + tv]], ax, a0, a1, "fascia");
    if (form === "gable") {
      slope(c0, cm); slope(cm, c1);
      const top = p.y + (cm - bc0) * tan + tv;
      box(roofMat, a0, a1, top - 0.03, top + 0.04, cm - 0.1, cm + 0.1); // ridge cap
      eave(c0, -1, u(c0)); eave(c1, 1, u(c1));
      b.part = p.id; b.lift = null; // the gable triangles are wall, in the wall plane
      const tri: [number, number][] = [[bc0, p.y], [cm, p.y + (cm - bc0) * tan], [bc1, p.y]];
      b.prism(gableMat, tri, ax, ba0, ba0 + T); b.prism(gableMat, tri, ax, ba1 - T, ba1);
    } else {
      slope(c0, c1);
      eave(c0, -1, u(c0));
      box("fascia", a0, a1, u(c1) - 0.05, u(c1) + tv, c1, c1 + D.fascia);
      b.lift = null;
      const tri: [number, number][] = [[bc0, p.y], [bc1, u(bc1)], [bc1, p.y]];
      b.prism(gableMat, tri, ax, ba0, ba0 + T); b.prism(gableMat, tri, ax, ba1 - T, ba1);
      box(gableMat, ba0, ba1, p.y, u(bc1), bc1 - T, bc1); // the tall side's wall rises to meet the roof
    }
    b.lift = null;
    return;
  }
  // hip: a flat soffit at the eave, a fascia band, four planes up to a ridge (a point when the plan is square)
  // one overhang all round (the smallest the part allows), so all four planes meet the wall tops at the same height
  const ovh = Math.max(0, Math.min(bc0 - c0, c1 - bc1, ba0 - a0, a1 - ba1)), e = p.y - ovh * tan;
  ({ a0, a1, c0, c1 } = { a0: ba0 - ovh, a1: ba1 + ovh, c0: bc0 - ovh, c1: bc1 + ovh });
  const s = (c1 - c0) / 2, cm = (c0 + c1) / 2;
  const r0 = Math.min(a0 + s, (a0 + a1) / 2), r1 = Math.max(a1 - s, (a0 + a1) / 2), yt = e + tv + Math.min(s, (a1 - a0) / 2) * tan;
  const P = (a: number, y: number, c: number): V3 => (ax === "x" ? [a, y, c] : [c, y, a]);
  const ctr = P((a0 + a1) / 2, e, cm), out = (q: V3[]): V3 => { const m = q.reduce((t, v) => [t[0] + v[0] / q.length, t[1] + v[1] / q.length, t[2] + v[2] / q.length] as V3, [0, 0, 0]); return sub(m, ctr); };
  const flat = (q: V3[]) => q.map((v): [number, number] => [v[0], v[2]]);
  const corners = [P(a0, e + tv, c0), P(a1, e + tv, c0), P(a1, e + tv, c1), P(a0, e + tv, c1)], R0 = P(r0, yt, cm), R1 = P(r1, yt, cm);
  const slopeUv = (q: V3[], horiz: "a" | "c") => q.map((v): [number, number] => { const a = ax === "x" ? v[0] : v[2], c = ax === "x" ? v[2] : v[0]; return [horiz === "a" ? a : c, (v[1] - e) / Math.max(0.2, Math.sin(Math.atan(tan)))]; });
  const roofFace = (q: V3[], h: "a" | "c") => b.face(roofMat, q, slopeUv(q, h), out(q));
  roofFace([corners[0], corners[1], R1, R0], "a"); roofFace([corners[2], corners[3], R0, R1], "a");
  roofFace([corners[1], corners[2], R1], "c"); roofFace([corners[3], corners[0], R0], "c");
  const soffit = [P(a0, e, c0), P(a1, e, c0), P(a1, e, c1), P(a0, e, c1)];
  b.face("fascia", soffit, flat(soffit), [0, -1, 0]);
  for (let i = 0; i < 4; i++) { const q = [soffit[i], soffit[(i + 1) % 4], corners[(i + 1) % 4], corners[i]]; b.face("fascia", q, q.map((v) => [v[0] + v[2], v[1]]), out(q)); }
  box(roofMat, r0, r1, yt - 0.03, yt + 0.04, cm - 0.1, cm + 0.1);
  eave(c0, -1, e); eave(c1, 1, e);
  b.lift = null;
}

function stairMesh(b: Builder, p: Part) {
  b.part = p.id;
  const n = Math.max(2, Math.ceil(p.h / DETAIL.riser)), R = p.h / n, alongX = p.w >= p.d, len = alongX ? p.w : p.d, G = len / n;
  const w0 = alongX ? p.z - p.d / 2 : p.x - p.w / 2, w1 = alongX ? p.z + p.d / 2 : p.x + p.w / 2, s0 = alongX ? p.x - p.w / 2 : p.z - p.d / 2;
  for (let i = 0; i < n; i++) {
    const a = s0 + i * G, y1 = p.y + (i + 1) * R;
    if (alongX) b.box("stair", a, a + G, y1 - R - (i ? 0.04 : 0), y1, w0, w1); else b.box("stair", w0, w1, y1 - R - (i ? 0.04 : 0), y1, a, a + G);
  }
}

const PROP_MAT: [RegExp, MatKey][] = [[/canopy/i, "roofMetal"], [/step|paving|pad/i, "concrete"], [/deck|bench|terrace/i, "deck"], [/post|rail/i, "metal"]];
export const propMat = (name: string): MatKey => PROP_MAT.find(([re]) => re.test(name))?.[1] ?? "prop";

/** The whole house. Hidden parts (view filters) should be left out of `scene.parts` by the caller. */
export function houseMesh(scene: Scene, o: MeshOpts = {}): HouseMesh {
  const st = styleOf(scene), facade = FACADE_MAT[st.facade], gable = FACADE_MAT[st.gable ?? st.facade], roofMat = ROOF_MAT[st.roofMat];
  const b = new Builder(), parts = scene.parts, openings = parts.filter((p) => isOpening(p.kind) && p.host && p.face);
  const T = RULES.wallThick;
  for (const p of parts) {
    b.part = p.id; b.lift = null;
    const fail = o.fail?.has(p.id);
    if (p.kind === "wall") {
      wallMesh(b, p, openings, facade, o.fail, st.facade === "timber");
      if (!isStraightWall(p) && p.y > 0.3) { // the floor zone between storeys, faced like the walls (a stairwell hole in the slab never opens the facade)
        const below = parts.filter((q) => q.kind === "wall" && q !== p && q.y + q.h <= p.y + 0.01 && Math.abs(q.x - p.x) < (q.w + p.w) / 2 && Math.abs(q.z - p.z) < (q.d + p.d) / 2);
        const tb = below.length ? Math.max(...below.map((q) => q.y + q.h)) : p.y;
        if (tb < p.y - 0.01) for (const pc of wallPieces({ ...p, y: tb, h: p.y - tb })) { const x = pc.box; b.part = p.id; b.box(wallMat(p, facade, o.fail), x.x - x.w / 2, x.x + x.w / 2, x.y, x.y + x.h, x.z - x.d / 2, x.z + x.d / 2); }
      }
    }
    else if (p.kind === "roof") { if (!o.hideRoof) roofMesh(b, p, parts, fail ? "fail" : roofMat, fail ? "fail" : gable); }
    else if (p.kind === "slab") {
      if (fail) b.box("fail", p.x - p.w / 2, p.x + p.w / 2, p.y, p.y + p.h, p.z - p.d / 2, p.z + p.d / 2);
      else if (p.group === "exterior") b.box("deck", p.x - p.w / 2, p.x + p.w / 2, p.y, p.y + p.h, p.z - p.d / 2, p.z + p.d / 2);
      else { // ground slab: floor inside a concrete plinth band; upper slabs: floor only (the facade ring under each storey closes the edge)
        const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2, y0 = p.y, y1 = p.y + p.h, t = Math.min(T, p.w / 4, p.d / 4);
        if (p.y < 0.05) {
          b.box("plinth", x0, x1, y0, y1, z0, z0 + t); b.box("plinth", x0, x1, y0, y1, z1 - t, z1);
          b.box("plinth", x0, x0 + t, y0, y1, z0 + t, z1 - t); b.box("plinth", x1 - t, x1, y0, y1, z0 + t, z1 - t);
          b.box("floor", x0 + t, x1 - t, y0, y1, z0 + t, z1 - t);
        } else b.box("floor", x0 + t, x1 - t, y0, y1, z0 + t, z1 - t); // inside the walls: its edge never shows (or fights) on the facade
      }
    } else if (p.kind === "foundation") b.box(fail ? "fail" : "plinth", p.x - p.w / 2, p.x + p.w / 2, p.y, p.y + p.h, p.z - p.d / 2, p.z + p.d / 2);
    else if (p.kind === "stair") stairMesh(b, p);
    else if (p.kind === "prop") b.box(propMat(p.name), p.x - p.w / 2, p.x + p.w / 2, p.y, p.y + p.h, p.z - p.d / 2, p.z + p.d / 2);
  }
  const groups = b.groups, min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  for (const g of groups) {
    tris += g.tri.length;
    for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g.pos[i + k]); max[k] = Math.max(max[k], g.pos[i + k]); }
  }
  return { groups, min: tris ? min : [0, 0, 0], max: tris ? max : [0, 0, 0], tris };
}

// ---------- the site around the house: gravel drip strip, a path to the front door, trees and shrubs ----------
export type SiteLayout = { footprint: Rect | null; gravel: Rect[]; path: Rect | null; trees: { x: number; z: number; kind: "spruce" | "birch" | "pine"; s: number }[]; shrubs: { x: number; z: number; s: number }[] };
/** The front door: an exterior door named front/entry, else any exterior door on the lowest floor. */
export function frontDoor(parts: Part[]): Part | null {
  const ext = parts.filter((p) => p.kind === "door" && p.host && !isInteriorDoor(p, parts.find((w) => w.id === p.host)));
  return ext.sort((a, b) => Number(/front|entr|esi/i.test(b.name)) - Number(/front|entr|esi/i.test(a.name)) || a.y - b.y)[0] ?? null;
}
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function siteLayout(scene: Scene): SiteLayout {
  const solid = scene.parts.filter((p) => (p.kind === "wall" || p.kind === "slab") && p.group !== "exterior" && p.y < 0.5);
  const W = scene.plot.w / 2, Dp = scene.plot.d / 2;
  const fp = solid.length ? { x0: Math.min(...solid.map((p) => p.x - p.w / 2)), x1: Math.max(...solid.map((p) => p.x + p.w / 2)), z0: Math.min(...solid.map((p) => p.z - p.d / 2)), z1: Math.max(...solid.map((p) => p.z + p.d / 2)) } : null;
  const g = 0.45, gravel = fp ? [{ x0: fp.x0 - g, x1: fp.x1 + g, z0: fp.z0 - g, z1: fp.z0 }, { x0: fp.x0 - g, x1: fp.x1 + g, z0: fp.z1, z1: fp.z1 + g }, { x0: fp.x0 - g, x1: fp.x0, z0: fp.z0, z1: fp.z1 }, { x0: fp.x1, x1: fp.x1 + g, z0: fp.z0, z1: fp.z1 }] : [];
  const door = frontDoor(scene.parts);
  let path: Rect | null = null;
  if (door && fp) {
    const hw = 0.6;
    if (door.face === "s") path = { x0: door.x - hw, x1: door.x + hw, z0: fp.z1, z1: Dp };
    else if (door.face === "n") path = { x0: door.x - hw, x1: door.x + hw, z0: -Dp, z1: fp.z0 };
    else if (door.face === "e") path = { x0: fp.x1, x1: W, z0: door.z - hw, z1: door.z + hw };
    else path = { x0: -W, x1: fp.x0, z0: door.z - hw, z1: door.z + hw };
  }
  const clear = (x: number, z: number, r: number) => (!fp || x < fp.x0 - r || x > fp.x1 + r || z < fp.z0 - r || z > fp.z1 + r) && (!path || x < path.x0 - r * 0.6 || x > path.x1 + r * 0.6 || z < path.z0 - r * 0.6 || z > path.z1 + r * 0.6);
  const trees: SiteLayout["trees"] = [];
  for (let i = 0; trees.length < Math.min(scene.plot.trees, 60) && i < 400; i++) {
    // along the plot edge in loose clumps, like a Nordic garden edged by forest; the south (sun) side is kept more open
    const side = i % 4, t = hash(i) - 0.5, inset = 0.06 + hash(i + 99) * 0.14;
    const x = side < 2 ? t * scene.plot.w * 0.95 : (side === 2 ? -1 : 1) * W * (1 - inset);
    const z = side < 2 ? (side === 0 ? -1 : 1) * Dp * (1 - inset) : t * scene.plot.d * 0.95;
    if (side === 1 && hash(i + 7) < 0.55) continue;
    if (x > -W * 0.25 && z > -Dp * 0.25) continue; // keep the south-east open: that's where the camera (and the Blender view) look from
    if (!clear(x, z, 3.5)) continue;
    const k = hash(i + 3);
    trees.push({ x, z, kind: k < 0.5 ? "spruce" : k < 0.82 ? "birch" : "pine", s: 0.7 + hash(i + 5) * 0.45 });
  }
  const shrubs: SiteLayout["shrubs"] = [];
  if (fp) for (const [x, z] of [[fp.x0 - 1.2, fp.z1 + 1], [fp.x1 + 1.2, fp.z1 + 1], [fp.x0 - 1.2, fp.z0 - 1], [fp.x1 + 1.2, fp.z0 - 1], [fp.x0 - 1.6, (fp.z0 + fp.z1) / 2], [fp.x1 + 1.6, (fp.z0 + fp.z1) / 2]])
    if (clear(x, z, 0.4) || !fp) shrubs.push({ x, z, s: 0.6 + hash(x * 3 + z) * 0.5 });
  return { footprint: fp, gravel, path, trees, shrubs };
}
