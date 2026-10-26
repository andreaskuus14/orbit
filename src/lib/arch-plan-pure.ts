// ARCH floor-plan generator (pure, tested in tests/arch-plan.test.ts). A brief (plot, floors, rooms with target areas,
// adjacency wishes) → 3–5 rectangular layout options. Each option is a slicing tree: the ordered room list is split in two
// halves of ~equal area and the rectangle cut across its longer side, recursively. Hill climbing then swaps rooms (and moves
// them between floors) to raise the score. No model calls; a fixed seed gives the same options every time.
// Areas are gross (to wall centre lines). No stairs are added: put "Stairs 5" in the brief if the house has floors.
import { fitOpenings, MAX, RULES, type Face, type Part, type Scene } from "./arch-pure.ts";

export type Room = { name: string; area: number; floor?: number }; // floor 1-based; unset = the solver picks
export type Brief = { plot: { w: number; d: number }; floors: number; rooms: Room[]; adj: [string, string][] };
export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Cut = Rect & { a: number[]; b: number[] }; // a wall line (x0 = x1 or z0 = z1) with the rooms on either side
export type Breakdown = { areaErr: number; adjMet: number; adjTotal: number; corridorPct: number; daylight: number; thin: number };
export type PlanOption = { score: number; parts: Breakdown; w: number; d: number; floors: { rooms: { i: number; r: Rect }[]; cuts: Cut[] }[]; met: [number, number][] };

export const PLAN = { maxRooms: 16, maxFloors: 3, slab: 0.2, wallH: 2.8, inner: 0.2, setback: 2, minShare: 1, door: 0.9, window: 1.2, options: 5 };
const OUTSIDE = "outside"; // adjacency pseudo-room: "Entrance - outside" = the room has an exterior wall on floor 1
const DARK_OK = /bath|wc|toilet|sauna|stor|closet|wardrobe|pantry|utility|hall|corridor|entr|lobby|stair/i; // no window needed
const CIRC = /hall|corridor|entr|lobby/i;
const EPS = 1e-6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** mulberry32: small seeded PRNG so the same brief always gives the same options. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Text → brief. Rooms: "Bedroom 12" or "Bedroom: 12 m² @2" (@ = floor). Adjacency: "Kitchen - Living" (also ~ or "next to").
 *  Unknown adjacency names, repeats and junk are dropped; numbers are clamped. */
export function parseBrief(roomsText: string, adjText: string, plot: { w: number; d: number }, floors: number): Brief {
  const rooms: Room[] = [];
  for (const line of roomsText.split("\n")) {
    const m = line.match(/^\s*(.+?)[\s:=]+(\d+(?:[.,]\d+)?)\s*(?:m2|m²|sqm)?\s*(?:@\s*(\d))?\s*$/i);
    if (!m || rooms.length >= PLAN.maxRooms) continue;
    const name = m[1].trim().slice(0, 30), area = Number(m[2].replace(",", "."));
    if (!name || !(area >= 1 && area <= 200) || rooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) continue;
    const f = m[3] ? Number(m[3]) : undefined;
    rooms.push({ name, area, ...(f && f >= 1 && f <= PLAN.maxFloors ? { floor: f } : {}) });
  }
  const known = (s: string) => (s.toLowerCase() === OUTSIDE ? OUTSIDE : rooms.find((r) => r.name.toLowerCase() === s.toLowerCase())?.name);
  const adj: [string, string][] = [];
  for (const line of adjText.split("\n")) {
    const p = line.split(/\s+(?:-|–|~|next to|near)\s+|\s*[~–]\s*/i).map((s) => s.trim());
    if (p.length !== 2) continue;
    const a = known(p[0]), b = known(p[1]);
    if (a && b && a !== b && !adj.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) adj.push([a, b]);
  }
  const fl = Math.round(Math.min(PLAN.maxFloors, Math.max(1, floors || 1)));
  return { plot: { w: Math.min(MAX.plot, Math.max(5, plot.w || 0)), d: Math.min(MAX.plot, Math.max(5, plot.d || 0)) }, floors: fl, rooms: rooms.map((r) => (r.floor && r.floor > fl ? { ...r, floor: fl } : r)), adj };
}

/** Slicing tree: split the ordered list where the two halves' areas are closest, cut across the longer side. */
function slice(order: number[], area: number[], r: Rect, out: { i: number; r: Rect }[], cuts: Cut[]) {
  if (order.length === 1) { out.push({ i: order[0], r }); return; }
  const total = order.reduce((s, i) => s + area[i], 0);
  let k = 1, acc = area[order[0]], best = Infinity;
  for (let j = 1, s = 0; j < order.length; j++) { s += area[order[j - 1]]; const e = Math.abs(s - total / 2); if (e < best) { best = e; k = j; acc = s; } }
  const f = acc / total, a = order.slice(0, k), b = order.slice(k);
  if (r.x1 - r.x0 >= r.z1 - r.z0) {
    const x = r2(r.x0 + (r.x1 - r.x0) * f);
    cuts.push({ x0: x, x1: x, z0: r.z0, z1: r.z1, a, b });
    slice(a, area, { ...r, x1: x }, out, cuts); slice(b, area, { ...r, x0: x }, out, cuts);
  } else {
    const z = r2(r.z0 + (r.z1 - r.z0) * f);
    cuts.push({ x0: r.x0, x1: r.x1, z0: z, z1: z, a, b });
    slice(a, area, { ...r, z1: z }, out, cuts); slice(b, area, { ...r, z0: z }, out, cuts);
  }
}

/** Shared edge of two rects (a segment), or null when they only touch at a corner or not at all. */
export function shared(p: Rect, q: Rect): Rect | null {
  if (Math.abs(p.x1 - q.x0) < EPS || Math.abs(q.x1 - p.x0) < EPS) {
    const x = Math.abs(p.x1 - q.x0) < EPS ? p.x1 : p.x0, z0 = Math.max(p.z0, q.z0), z1 = Math.min(p.z1, q.z1);
    return z1 - z0 > EPS ? { x0: x, x1: x, z0, z1 } : null;
  }
  if (Math.abs(p.z1 - q.z0) < EPS || Math.abs(q.z1 - p.z0) < EPS) {
    const z = Math.abs(p.z1 - q.z0) < EPS ? p.z1 : p.z0, x0 = Math.max(p.x0, q.x0), x1 = Math.min(p.x1, q.x1);
    return x1 - x0 > EPS ? { x0, x1, z0: z, z1: z } : null;
  }
  return null;
}
const segLen = (s: Rect) => Math.max(s.x1 - s.x0, s.z1 - s.z0);
/** Exterior faces of a room, longest first (south first on a tie: the sunny side for windows). */
function outerFaces(r: Rect, w: number, d: number): { face: Face; seg: Rect }[] {
  const f: { face: Face; seg: Rect }[] = [];
  if (Math.abs(r.z1 - d / 2) < EPS) f.push({ face: "s", seg: { ...r, z0: r.z1 } });
  if (Math.abs(r.x1 - w / 2) < EPS) f.push({ face: "e", seg: { ...r, x0: r.x1 } });
  if (Math.abs(r.x0 + w / 2) < EPS) f.push({ face: "w", seg: { ...r, x1: r.x0 } });
  if (Math.abs(r.z0 + d / 2) < EPS) f.push({ face: "n", seg: { ...r, z1: r.z0 } });
  return f.sort((a, b) => segLen(b.seg) - segLen(a.seg));
}

type State = number[][]; // per floor, the ordered room indices
const key = (s: State) => s.map((f) => f.join(",")).join("|");

function evaluate(b: Brief, st: State, w: number, d: number): PlanOption {
  const area = b.rooms.map((r) => r.area), floors = st.map((order) => {
    const rooms: { i: number; r: Rect }[] = [], cuts: Cut[] = [];
    if (order.length) slice(order, area, { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 }, rooms, cuts);
    return { rooms, cuts };
  });
  const at = new Map<number, { f: number; r: Rect }>();
  floors.forEach((fl, f) => fl.rooms.forEach(({ i, r }) => at.set(i, { f, r })));
  const sz = (r: Rect) => [r.x1 - r.x0, r.z1 - r.z0];
  let err = 0, circ = 0, total = 0, lit = 0, needLit = 0, thin = 0;
  for (const [i, { r }] of at) {
    const [x, z] = sz(r), a = x * z;
    err += Math.abs(a - area[i]) / area[i]; total += a;
    if (CIRC.test(b.rooms[i].name)) circ += a;
    if (!DARK_OK.test(b.rooms[i].name)) { needLit++; if (outerFaces(r, w, d).some((o) => segLen(o.seg) >= PLAN.window + 0.6)) lit++; }
    if (Math.min(x, z) < 2 || Math.max(x, z) / Math.min(x, z) > 3) thin++;
  }
  const met: [number, number][] = [];
  const idx = (n: string) => (n === OUTSIDE ? -1 : b.rooms.findIndex((r) => r.name === n));
  for (const [an, bn] of b.adj) {
    const ia = idx(an), ib = idx(bn), A = at.get(ia), B = at.get(ib);
    if (ia < 0 || ib < 0) { const R = at.get(Math.max(ia, ib)); if (R && R.f === 0 && outerFaces(R.r, w, d).some((o) => segLen(o.seg) >= PLAN.minShare + 0.6)) met.push([ia, ib]); continue; }
    const s = A && B && A.f === B.f ? shared(A.r, B.r) : null;
    if (s && segLen(s) >= PLAN.minShare + 0.6) met.push([ia, ib]); // + 0.6: the door keeps 0.3 m clear at each end
  }
  const parts: Breakdown = { areaErr: r2(at.size ? err / at.size : 0), adjMet: met.length, adjTotal: b.adj.length, corridorPct: r2(total ? (100 * circ) / total : 0), daylight: r2(needLit ? lit / needLit : 1), thin };
  const score = 30 * Math.max(0, 1 - 3 * parts.areaErr) + 35 * (b.adj.length ? met.length / b.adj.length : 1) + 25 * parts.daylight + 10 * (1 - parts.corridorPct / 100) - 4 * thin;
  return { score: Math.round(score * 10) / 10, parts, w, d, floors, met };
}

/** Footprint for a floor area, shaped like the plot (× stretch), kept `setback` metres inside it. Rounded to 0.1 m. */
function footprint(b: Brief, stretch: number) {
  const a = b.rooms.reduce((s, r) => s + r.area, 0) / b.floors, k = (b.plot.w / b.plot.d) * stretch;
  const w = Math.min(b.plot.w - 2 * PLAN.setback, Math.sqrt(a * k)), d = Math.min(b.plot.d - 2 * PLAN.setback, a / Math.max(w, 1));
  return { w: Math.max(3, Math.round(w * 10) / 10), d: Math.max(3, Math.round(d * 10) / 10) };
}

/** All neighbours of a state: swap two rooms on a floor, or move an unpinned room to another floor's end. */
function* moves(b: Brief, st: State): Generator<State> {
  for (let f = 0; f < st.length; f++) for (let i = 0; i < st[f].length; i++) {
    for (let j = i + 1; j < st[f].length; j++) { const n = st.map((x) => [...x]); [n[f][i], n[f][j]] = [n[f][j], n[f][i]]; yield n; }
    if (b.rooms[st[f][i]].floor) continue;
    for (let g = 0; g < st.length; g++) if (g !== f) { const n = st.map((x) => [...x]); n[g].push(...n[f].splice(i, 1)); yield n; }
  }
}

/** 3–5 options, best first. Several seeded starts per footprint shape, each improved by first-improvement hill climbing;
 *  options with the same room arrangement are kept once. Empty when the brief has no rooms. */
export function generatePlans(b: Brief, seed = 1): PlanOption[] {
  if (!b.rooms.length) return [];
  const runs: { o: PlanOption; k: string }[] = [];
  for (const stretch of [1, 1.35, 1 / 1.35]) {
    const { w, d } = footprint(b, stretch);
    for (let s = 0; s < 4; s++) {
      const rand = rng(seed * 1000 + s * 7 + Math.round(stretch * 100));
      const st: State = Array.from({ length: b.floors }, () => []);
      const load = new Array(b.floors).fill(0);
      const order = b.rooms.map((_, i) => i).sort((x, y) => b.rooms[y].area - b.rooms[x].area || rand() - 0.5);
      for (const i of order) { // pinned rooms to their floor, the rest to the lightest floor
        const f = b.rooms[i].floor ? b.rooms[i].floor! - 1 : load.indexOf(Math.min(...load));
        st[f].push(i); load[f] += b.rooms[i].area;
      }
      for (const f of st) for (let i = f.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [f[i], f[j]] = [f[j], f[i]]; }
      let cur = st, best = evaluate(b, cur, w, d);
      for (let it = 0, better = true; better && it < 300; it++) {
        better = false;
        for (const n of moves(b, cur)) { const e = evaluate(b, n, w, d); if (e.score > best.score + 1e-9) { cur = n; best = e; better = true; break; } }
      }
      runs.push({ o: best, k: `${w}x${d}:${key(cur)}` });
    }
  }
  runs.sort((x, y) => y.o.score - x.o.score);
  const seen = new Set<string>(), out: PlanOption[] = [];
  for (const r of runs) {
    const sig = `${r.o.w}x${r.o.d}:` + r.o.floors.map((f) => f.rooms.map(({ i, r }) => `${i}@${r.x0},${r.z0},${r.x1},${r.z1}`).sort().join(";")).join("|");
    if (!seen.has(sig) && out.length < PLAN.options) { seen.add(sig); out.push(r.o); }
  }
  return out;
}

/** An option → an ARCH scene in the usual part format: per floor a slab, an outer shell and one straight wall per slicing
 *  cut; a door wherever a wish is met, the front door on the first floor's entrance/hall, a window on each room that wants
 *  daylight. Openings are fitted by fitOpenings, so they sit inside their wall like hand-made ones. */
export function planScene(b: Brief, o: PlanOption): Scene {
  const { w, d } = o, T = RULES.wallThick, H = PLAN.slab + PLAN.wallH, parts: Part[] = [], openings: Part[] = [];
  let n = 0;
  const id = () => `f${(n++).toString(36)}`;
  const name = (i: number) => b.rooms[i].name;
  parts.push({ id: id(), kind: "foundation", name: "Strip foundation", x: 0, y: -0.8, z: 0, w, d, h: 0.8 });
  o.floors.forEach((fl, f) => {
    const y = f * H, shell = id();
    parts.push({ id: id(), kind: "slab", name: `Floor ${f + 1} slab`, x: 0, y, z: 0, w, d, h: PLAN.slab });
    parts.push({ id: shell, kind: "wall", name: `Walls, floor ${f + 1}`, x: 0, y: y + PLAN.slab, z: 0, w, d, h: PLAN.wallH });
    const wallOf = new Map<Cut, string>();
    for (const c of fl.cuts) {
      const alongX = Math.abs(c.z0 - c.z1) < EPS, a0 = (alongX ? c.x0 : c.z0), a1 = (alongX ? c.x1 : c.z1), half = (alongX ? w : d) / 2;
      const s0 = Math.abs(a0 + half) < EPS ? a0 + T : a0, s1 = Math.abs(a1 - half) < EPS ? a1 - T : a1, mid = r2((s0 + s1) / 2), len = r2(s1 - s0);
      const wid = id(), label = `Wall ${c.a.map(name).join("/")} | ${c.b.map(name).join("/")}`.slice(0, 60);
      wallOf.set(c, wid);
      parts.push(alongX ? { id: wid, kind: "wall", name: label, x: mid, y: y + PLAN.slab, z: c.z0, w: len, d: PLAN.inner, h: PLAN.wallH }
        : { id: wid, kind: "wall", name: label, x: c.x0, y: y + PLAN.slab, z: mid, w: PLAN.inner, d: len, h: PLAN.wallH });
    }
    const rect = new Map(fl.rooms.map(({ i, r }) => [i, r]));
    for (const [ia, ib] of o.met) {
      if (ia < 0 || ib < 0) continue; // "outside" wishes get the front door below
      const A = rect.get(ia), B = rect.get(ib), s = A && B && shared(A, B);
      if (!s) continue;
      const alongX = Math.abs(s.z0 - s.z1) < EPS, c = fl.cuts.find((k) => (alongX ? Math.abs(k.z0 - k.z1) < EPS && Math.abs(k.z0 - s.z0) < EPS && k.x0 <= s.x0 + EPS && k.x1 >= s.x1 - EPS
        : Math.abs(k.x0 - k.x1) < EPS && Math.abs(k.x0 - s.x0) < EPS && k.z0 <= s.z0 + EPS && k.z1 >= s.z1 - EPS));
      const wall = c && parts.find((p) => p.id === wallOf.get(c));
      if (!wall) continue;
      const off = alongX ? (s.x0 + s.x1) / 2 - wall.x : (s.z0 + s.z1) / 2 - wall.z;
      openings.push({ id: id(), kind: "door", name: `Door ${name(ia)}–${name(ib)}`.slice(0, 60), host: wall.id, face: alongX ? "s" : "e", off: r2(off), x: 0, y: 0, z: 0, w: PLAN.door, d: 0, h: 2.1 });
    }
    const along = (face: Face, seg: Rect) => r2(face === "n" || face === "s" ? (seg.x0 + seg.x1) / 2 : (seg.z0 + seg.z1) / 2);
    if (f === 0) { // front door: the entrance/hall room if it has an outer wall, else the first room that does
      const pick = [...fl.rooms].sort((p, q) => Number(CIRC.test(name(q.i))) - Number(CIRC.test(name(p.i)))).find(({ r }) => outerFaces(r, w, d).length);
      const of = pick && outerFaces(pick.r, w, d)[0];
      if (pick && of) openings.push({ id: id(), kind: "door", name: `Front door (${name(pick.i)})`.slice(0, 60), host: shell, face: of.face, off: along(of.face, of.seg), x: 0, y: 0, z: 0, w: 1, d: 0, h: 2.1 });
    }
    for (const { i, r } of fl.rooms) {
      const of = DARK_OK.test(name(i)) ? undefined : outerFaces(r, w, d).find((x) => segLen(x.seg) >= PLAN.window + 0.6);
      if (of) openings.push({ id: id(), kind: "window", name: `Window ${name(i)}`.slice(0, 60), host: shell, face: of.face, off: along(of.face, of.seg), sill: 0.9, x: 0, y: 0, z: 0, w: PLAN.window, d: 0, h: 1.2 });
    }
  });
  parts.push({ id: id(), kind: "roof", name: "Roof", x: 0, y: o.floors.length * H, z: 0, w: r2(w + 1), d: r2(d + 1), h: 2 });
  // shortcut: past MAX.parts the last windows are dropped; raise MAX.parts if big briefs need them all
  const all = [...parts, ...openings.filter((p) => p.kind === "door"), ...openings.filter((p) => p.kind === "window")].slice(0, MAX.parts);
  return { plot: { w: b.plot.w, d: b.plot.d, ground: "grass", trees: 8 }, parts: fitOpenings(all) };
}

export const STARTER_BRIEF = {
  rooms: "Entrance hall 8\nKitchen+living 30\nBedroom 12\nBedroom 2 10\nBath 6\nWC 3\nStorage 4",
  adj: "Kitchen+living - Entrance hall\nBath - Bedroom\nBedroom - Entrance hall\nBedroom 2 - Entrance hall\nWC - Entrance hall\nEntrance hall - outside",
};
