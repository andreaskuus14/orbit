// ARCH floor-plan generator (pure, tested in tests/arch-plan.test.ts). A brief (plot, floors, rooms with target areas,
// adjacency wishes) → 3–5 rectangular layout options. Each option is a slicing tree: the ordered room list is split in two
// halves of ~equal area and the rectangle cut across its longer side, recursively. Hill climbing then swaps rooms (and moves
// them between floors) to raise the score. No model calls; a fixed seed gives the same options every time.
// Areas are gross (to wall centre lines). With 2+ floors a stair core + hall strip is added on the west side (withCore).
import { fitOpenings, MAX, RULES, type Face, type Part, type Scene } from "./arch-pure.ts";

export type ThermalZone = "heated" | "unheated" | "outdoor";
export type Room = { name: string; area: number; floor?: number; thermal?: ThermalZone }; // floor 1-based; unset = the solver picks
export type Brief = { plot: { w: number; d: number }; floors: number; rooms: Room[]; adj: [string, string][]; core?: { stair: number[]; circ: number[] } };
export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Cut = Rect & { a: number[]; b: number[] }; // a wall line (x0 = x1 or z0 = z1) with the rooms on either side
export type Breakdown = {
  areaErr: number; adjMet: number; adjTotal: number; corridorPct: number; daylight: number; thin: number;
  connectivity?: number; heatedAreaM2?: number; outdoorAreaM2?: number;
};
export type ConnectivityResult = { root: number | null; reachable: number[]; unreachable: number[]; score: number };
export type PlanFloor = { rooms: { i: number; r: Rect }[]; cuts: Cut[]; doors?: [number, number][] };
export type PlanOption = {
  score: number; parts: Breakdown; w: number; d: number; floors: PlanFloor[]; met: [number, number][];
  unreachableRooms: string[]; connectivityScore: number; heatedAreaM2: number; outdoorAreaM2: number;
};

export const PLAN = { maxRooms: 16, maxFloors: 3, slab: 0.2, wallH: 2.8, inner: 0.2, setback: 2, minShare: 1, door: 0.9, window: 1.2, options: 5 };
const OUTSIDE = "outside"; // adjacency pseudo-room: "Entrance - outside" = the room has an exterior wall on floor 1
const OUTDOOR_RE = /terrace|balcony|porch|patio|deck|veranda|carport|terrass|rõdu|varjualune/i;
const UNHEATED_RE = /garage|garaaž|garaaz|storage|panipaik|shed|kuur|cellar|kelder/i;
const COMPACT_WIN = /bath|wc|toilet|utility|laundry|vann|tualett|pesu/i;
const DARK_OK = /bath|wc|toilet|sauna|stor|closet|wardrobe|pantry|utility|laundry|hall|corridor|entr|lobby|stair|landing|garage|garaaž|garaaz|panipaik/i; // no window needed
const CIRC = /hall|corridor|entr|lobby|landing|esik|koridor/i;
const EPS = 1e-6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Classify a space as heated, unheated (garage/storage), or outdoor (terrace/balcony/porch/deck/veranda/carport). */
export function classifySpace(name: string): ThermalZone {
  if (OUTDOOR_RE.test(name)) return "outdoor";
  if (UNHEATED_RE.test(name)) return "unheated";
  return "heated";
}
const roomThermal = (r: Room): ThermalZone => r.thermal ?? classifySpace(r.name);

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

/** Stair for a storey height H (m), by the 2R + G = 600–650 mm rule with R ≤ 190 mm and G ≥ 250 mm (Nordic rules of
 *  thumb for a house stair; a teaching estimate). Returns the straight run and a dogleg (two 1.0 m flights + 1.0 m landing). */
export const STAIR = { maxR: 190, minG: 250, ruleLo: 600, ruleHi: 650, width: 1, gap: 0.1 };
export const stairRule = (R: number, G: number) => ({ rule: Math.round(2 * R + G), ok: R <= STAIR.maxR && G >= STAIR.minG && 2 * R + G >= STAIR.ruleLo && 2 * R + G <= STAIR.ruleHi });
export function stairDesign(H: number) {
  const n = Math.ceil((H * 1000) / STAIR.maxR), R = r2((H * 1000) / n), G = Math.max(STAIR.minG, Math.round(625 - 2 * R));
  const flight = (Math.ceil(n / 2) - 1) * G / 1000;
  return { risers: n, R, G, ...stairRule(R, G), straight: { w: STAIR.width, l: r2(((n - 1) * G) / 1000) }, dogleg: { w: 2 * STAIR.width + STAIR.gap, l: r2(flight + STAIR.width) } };
}
/** The run a straight stair of `len` m would force for storey H: goings squeezed to fit (n − 1 treads). */
export const straightFit = (H: number, len: number) => { const n = Math.ceil((H * 1000) / STAIR.maxR), R = (H * 1000) / n, G = (len * 1000) / (n - 1); return { R: r2(R), G: r2(G), ...stairRule(R, G) }; };

/** Multi-floor brief → the same brief plus a stair core: "Stairs k" on every floor, the first hall/entrance room pinned to
 *  floor 1 (or an added "Hall"), and a "Landing k" on upper floors. Idempotent; a brief that already lists stairs is kept. */
export function withCore(b: Brief): Brief {
  if (b.core || b.floors < 2 || b.rooms.some((r) => /stair/i.test(r.name))) return b;
  const rooms = b.rooms.map((r) => ({ ...r })), D = stairDesign(PLAN.slab + PLAN.wallH), stair: number[] = [], circ: number[] = [];
  for (let f = 0; f < b.floors; f++) {
    let c = f ? -1 : rooms.findIndex((r) => CIRC.test(r.name) && (!r.floor || r.floor === 1));
    if (c >= 0) rooms[c].floor = 1; else { c = rooms.push({ name: f ? `Landing ${f + 1}` : "Hall", area: 8, floor: f + 1 }) - 1; }
    circ.push(c); stair.push(rooms.push({ name: `Stairs ${f + 1}`, area: r2(D.dogleg.w * D.dogleg.l), floor: f + 1 }) - 1);
  }
  return { ...b, rooms, core: { stair, circ } };
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

/** Proportional window sizing for a room: habitable rooms target >= 12% WFR (14% design target, clamped to wall width minus margins);
 *  bathrooms/utility get compact windows; dark-ok utility/circulation and outdoor spaces get none. */
export function windowSizeForRoom(name: string, areaM2: number, wallLen: number): { w: number; h: number; sill: number } | null {
  if (classifySpace(name) === "outdoor") return null;
  if (COMPACT_WIN.test(name)) {
    const maxW = r2(Math.min(1.0, wallLen - 0.6));
    if (maxW < 0.6) return null;
    return { w: r2(Math.min(maxW, 0.9)), h: 0.9, sill: 1.2 };
  }
  if (DARK_OK.test(name)) return null;
  const maxW = r2(Math.min(3.6, wallLen - 0.6));
  if (maxW < 0.8) return null;
  const target = areaM2 * 0.14;
  const isLiving = areaM2 >= 20 || /living|lounge|elutuba|dining/i.test(name);
  let h = isLiving ? 2.0 : 1.5;
  if (target / maxW > h) h = r2(Math.min(2.1, Math.max(h, target / maxW)));
  const sill = h >= 2.0 ? r2(Math.max(0.5, 2.6 - h)) : r2(Math.min(0.9, 2.5 - h));
  const minW = Math.min(1.2, maxW);
  const w = r2(Math.min(maxW, Math.max(minW, target / h)));
  return { w, h, sill };
}

/** BFS reachability check for indoor rooms on a floor, starting from the entry/hall/landing (F1: hall/entry/living; F2+: landing/stair core). */
export function checkConnectivity(
  brief: Brief,
  floor: { rooms: { i: number; r: Rect }[] },
  floorIndex: number,
  doorPairs: [number, number][],
  footprintSize?: { w: number; d: number },
): ConnectivityResult {
  const indoor = floor.rooms.filter(({ i }) => roomThermal(brief.rooms[i]) !== "outdoor");
  if (!indoor.length) return { root: null, reachable: [], unreachable: [], score: 1 };
  const indoorSet = new Set(indoor.map((x) => x.i));
  const hasOuter = (r: Rect) => (footprintSize ? outerFaces(r, footprintSize.w, footprintSize.d).length > 0 : true);
  let root: number | null = null;
  if (brief.core && indoorSet.has(brief.core.circ[floorIndex])) {
    root = brief.core.circ[floorIndex];
  } else if (floorIndex > 0) {
    root = indoor.find(({ i }) => /landing|stair|hall|corridor/i.test(brief.rooms[i].name))?.i ?? indoor[0].i;
  } else {
    root =
      indoor.find(({ i, r }) => CIRC.test(brief.rooms[i].name) && hasOuter(r))?.i ??
      indoor.find(({ i }) => CIRC.test(brief.rooms[i].name))?.i ??
      indoor.find(({ i, r }) => /living|lounge|elutuba/i.test(brief.rooms[i].name) && hasOuter(r))?.i ??
      indoor.find(({ r }) => hasOuter(r))?.i ??
      indoor[0].i;
  }
  const adj = new Map<number, Set<number>>();
  for (const { i } of indoor) adj.set(i, new Set());
  for (const [a, b] of doorPairs) {
    if (indoorSet.has(a) && indoorSet.has(b) && a !== b) { adj.get(a)!.add(b); adj.get(b)!.add(a); }
  }
  if (brief.core) { // stair opens directly onto the hall/landing on each floor
    const s = brief.core.stair[floorIndex], c = brief.core.circ[floorIndex];
    if (indoorSet.has(s) && indoorSet.has(c)) { adj.get(s)!.add(c); adj.get(c)!.add(s); }
  }
  const visited = new Set<number>([root]);
  const queue = [root];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const nxt of adj.get(cur) ?? []) if (!visited.has(nxt)) { visited.add(nxt); queue.push(nxt); }
  }
  const reachable = indoor.map((x) => x.i).filter((i) => visited.has(i));
  const unreachable = indoor.map((x) => x.i).filter((i) => !visited.has(i));
  return { root, reachable, unreachable, score: r2(reachable.length / indoor.length) };
}

/** Ensure every indoor room on a floor has a walkable door path from the entry/hall/landing.
 *  Adds interior doors on shared walls between unreachable and reachable components (preferring hall/landing/corridor walls). */
export function ensureConnectedDoors(
  brief: Brief,
  floor: { rooms: { i: number; r: Rect }[] },
  floorIndex: number,
  initialPairs: [number, number][],
  footprintSize?: { w: number; d: number },
): { pairs: [number, number][]; added: [number, number][]; connectivity: ConnectivityResult } {
  const rect = new Map(floor.rooms.map(({ i, r }) => [i, r]));
  const indoorSet = new Set(floor.rooms.filter(({ i }) => roomThermal(brief.rooms[i]) !== "outdoor").map((x) => x.i));
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  for (const [a, b] of initialPairs) {
    if (!indoorSet.has(a) || !indoorSet.has(b) || a === b) continue;
    const k = pairKey(a, b);
    if (!seen.has(k)) { seen.add(k); pairs.push([a, b]); }
  }
  const added: [number, number][] = [];
  let connectivity = checkConnectivity(brief, floor, floorIndex, pairs, footprintSize);
  const PRIVATE_RE = /bath|wc|toilet|sauna|bed|vann|tualett|magam/i;
  while (connectivity.unreachable.length > 0) {
    const reachSet = new Set(connectivity.reachable);
    type Cand = { u: number; v: number; wide: number; isCirc: number; notStair: number; notPriv: number; len: number };
    const cands: Cand[] = [];
    for (const u of connectivity.reachable) {
      const ru = rect.get(u)!;
      const uname = brief.rooms[u].name;
      for (const v of connectivity.unreachable) {
        if (reachSet.has(v)) continue;
        const rv = rect.get(v)!;
        const s = shared(ru, rv);
        if (!s) continue;
        const len = segLen(s);
        cands.push({
          u, v,
          wide: len >= PLAN.minShare + 0.6 ? 2 : len >= PLAN.door ? 1 : 0,
          isCirc: CIRC.test(uname) ? 1 : 0,
          notStair: /stair/i.test(uname) ? 0 : 1,
          notPriv: PRIVATE_RE.test(uname) ? 0 : 1,
          len,
        });
      }
    }
    if (!cands.length) break;
    cands.sort((a, b) => (b.wide - a.wide) || (b.isCirc - a.isCirc) || (b.notStair - a.notStair) || (b.notPriv - a.notPriv) || (b.len - a.len));
    const pick = cands[0];
    const k = pairKey(pick.u, pick.v);
    if (!seen.has(k)) { seen.add(k); pairs.push([pick.u, pick.v]); added.push([pick.u, pick.v]); }
    connectivity = checkConnectivity(brief, floor, floorIndex, pairs, footprintSize);
  }
  return { pairs, added, connectivity };
}

/** Place an outdoor space (terrace, deck, balcony, etc.) flush against an exterior face of the heated envelope. */
function placeOutdoorRect(area: number, target: Rect | undefined, w: number, d: number, used: Rect[]): Rect {
  const faces = target ? outerFaces(target, w, d) : [];
  const chosen = faces[0] ?? { face: "s" as Face, seg: { x0: -w / 2, x1: w / 2, z0: d / 2, z1: d / 2 } };
  const ns = chosen.face === "n" || chosen.face === "s";
  const spanLimit = ns ? w : d;
  const alongLen = r2(Math.min(spanLimit, Math.max(2, Math.sqrt(area * 1.8))));
  const depth = r2(Math.max(1.2, area / alongLen));
  const segCenter = ns ? (chosen.seg.x0 + chosen.seg.x1) / 2 : (chosen.seg.z0 + chosen.seg.z1) / 2;
  const half = spanLimit / 2;
  let c0 = r2(Math.max(-half, Math.min(half - alongLen, segCenter - alongLen / 2)));
  const makeRect = (start: number): Rect => {
    const end = r2(start + alongLen);
    if (chosen.face === "s") return { x0: start, x1: end, z0: d / 2, z1: r2(d / 2 + depth) };
    if (chosen.face === "n") return { x0: start, x1: end, z0: r2(-d / 2 - depth), z1: -d / 2 };
    if (chosen.face === "e") return { x0: w / 2, x1: r2(w / 2 + depth), z0: start, z1: end };
    return { x0: r2(-w / 2 - depth), x1: -w / 2, z0: start, z1: end };
  };
  const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS;
  let rect = makeRect(c0);
  if (used.some((u) => overlaps(rect, u))) {
    c0 = r2(c0 + alongLen);
    rect = makeRect(c0);
  }
  return rect;
}

type State = number[][]; // per floor, the ordered indoor room indices
const key = (s: State) => s.map((f) => f.join(",")).join("|");

function evaluate(b: Brief, st: State, w: number, d: number): PlanOption {
  const D = stairDesign(PLAN.slab + PLAN.wallH).dogleg, cw = b.core ? D.w : 0, X = r2(-w / 2 + cw);
  const area = b.rooms.map((r) => r.area), floors: PlanFloor[] = st.map((order, f) => {
    const rooms: { i: number; r: Rect }[] = [], cuts: Cut[] = [];
    if (order.length) slice(order, area, { x0: X, z0: -d / 2, x1: w / 2, z1: d / 2 }, rooms, cuts);
    if (b.core) { // the core strip: stairs at the north end, the hall/landing below, same place on every floor
      const s = b.core.stair[f], c = b.core.circ[f], zs = r2(-d / 2 + D.l);
      rooms.push({ i: s, r: { x0: -w / 2, z0: -d / 2, x1: X, z1: zs } }, { i: c, r: { x0: -w / 2, z0: zs, x1: X, z1: d / 2 } });
      cuts.push({ x0: X, x1: X, z0: -d / 2, z1: d / 2, a: [s, c], b: rooms.filter(({ r }) => Math.abs(r.x0 - X) < EPS).map(({ i }) => i) });
    }
    return { rooms, cuts };
  });
  const at = new Map<number, { f: number; r: Rect }>();
  floors.forEach((fl, f) => fl.rooms.forEach(({ i, r }) => at.set(i, { f, r })));
  const idx = (n: string) => (n === OUTSIDE ? -1 : b.rooms.findIndex((r) => r.name === n));
  // Attach outdoor spaces (terrace, balcony, deck, etc.) flush outside the heated envelope
  const outdoorUsed: Rect[][] = Array.from({ length: floors.length }, () => []);
  b.rooms.forEach((room, oi) => {
    if (roomThermal(room) !== "outdoor") return;
    const f = Math.min(floors.length - 1, Math.max(0, (room.floor ?? 1) - 1));
    const wish = b.adj.find(([an, bn]) => (idx(an) === oi && idx(bn) >= 0) || (idx(bn) === oi && idx(an) >= 0));
    const partnerIdx = wish ? (idx(wish[0]) === oi ? idx(wish[1]) : idx(wish[0])) : -1;
    const partner = partnerIdx >= 0 ? at.get(partnerIdx) : undefined;
    const targetRect = partner && partner.f === f ? partner.r : undefined;
    const r = placeOutdoorRect(room.area, targetRect, w, d, outdoorUsed[f]);
    outdoorUsed[f].push(r);
    floors[f].rooms.push({ i: oi, r });
    at.set(oi, { f, r });
  });
  const auto = new Set(b.core ? [...b.core.stair, ...b.core.circ.filter((i) => /^(Hall|Landing \d)$/.test(b.rooms[i].name))] : []);
  const sz = (r: Rect) => [r.x1 - r.x0, r.z1 - r.z0];
  let err = 0, circ = 0, total = 0, lit = 0, needLit = 0, thin = 0, heatedAreaM2 = 0, outdoorAreaM2 = 0;
  for (const [i, { r }] of at) {
    const [x, z] = sz(r), a = x * z, thermal = roomThermal(b.rooms[i]);
    if (thermal === "outdoor") { outdoorAreaM2 += a; continue; }
    if (thermal === "heated") heatedAreaM2 += a;
    if (!auto.has(i)) err += Math.abs(a - area[i]) / area[i]; total += a; // the core's size is fixed by the stair
    if (CIRC.test(b.rooms[i].name)) circ += a;
    if (!DARK_OK.test(b.rooms[i].name)) { needLit++; if (outerFaces(r, w, d).some((o) => segLen(o.seg) >= PLAN.window + 0.6)) lit++; }
    if (!DARK_OK.test(b.rooms[i].name) && (Math.min(x, z) < 2 || Math.max(x, z) / Math.min(x, z) > 3)) thin++;
  }
  const met: [number, number][] = [];
  for (const [an, bn] of b.adj) {
    const ia = idx(an), ib = idx(bn), A = at.get(ia), B = at.get(ib);
    if (ia < 0 || ib < 0) { const R = at.get(Math.max(ia, ib)); if (R && R.f === 0 && outerFaces(R.r, w, d).some((o) => segLen(o.seg) >= PLAN.minShare + 0.6)) met.push([ia, ib]); continue; }
    const s = A && B && A.f === B.f ? shared(A.r, B.r) : null;
    if (s && segLen(s) >= PLAN.minShare + 0.6) met.push([ia, ib]); // + 0.6: the door keeps 0.3 m clear at each end
  }
  // Connectivity check + automatic door linking per floor
  const unreachableRooms: string[] = [];
  let totalIndoor = 0, totalReachable = 0;
  floors.forEach((fl, f) => {
    const rect = new Map(fl.rooms.map(({ i, r }) => [i, r]));
    const initialPairs: [number, number][] = met.filter(([ia, ib]) => ia >= 0 && ib >= 0 && rect.has(ia) && rect.has(ib) && roomThermal(b.rooms[ia]) !== "outdoor" && roomThermal(b.rooms[ib]) !== "outdoor");
    if (b.core) {
      const c = b.core.circ[f], C = rect.get(c)!;
      for (const { i, r } of fl.rooms) {
        if (roomThermal(b.rooms[i]) === "outdoor") continue;
        const s = shared(C, r);
        if (i !== b.core.stair[f] && s && segLen(s) >= PLAN.minShare + 0.6 && !initialPairs.some((p) => p.includes(i) && p.includes(c))) initialPairs.push([c, i]);
      }
    }
    const linked = ensureConnectedDoors(b, fl, f, initialPairs, { w, d });
    fl.doors = linked.pairs;
    totalIndoor += linked.connectivity.reachable.length + linked.connectivity.unreachable.length;
    totalReachable += linked.connectivity.reachable.length;
    for (const ui of linked.connectivity.unreachable) unreachableRooms.push(b.rooms[ui].name);
  });
  const connectivityScore = totalIndoor ? r2(totalReachable / totalIndoor) : 1;
  const indoorCount = [...at.keys()].filter((i) => roomThermal(b.rooms[i]) !== "outdoor").length;
  const nonAutoIndoor = Math.max(0, indoorCount - auto.size);
  const parts: Breakdown = {
    areaErr: r2(nonAutoIndoor > 0 ? err / nonAutoIndoor : 0),
    adjMet: met.length,
    adjTotal: b.adj.length,
    corridorPct: r2(total ? (100 * circ) / total : 0),
    daylight: r2(needLit ? lit / needLit : 1),
    thin,
    connectivity: connectivityScore,
    heatedAreaM2: r2(heatedAreaM2),
    outdoorAreaM2: r2(outdoorAreaM2),
  };
  const score = 30 * Math.max(0, 1 - 3 * parts.areaErr) + 35 * (b.adj.length ? met.length / b.adj.length : 1) + 25 * parts.daylight + 10 * (1 - parts.corridorPct / 100) - 4 * thin - 20 * unreachableRooms.length;
  return { score: Math.round(score * 10) / 10, parts, w, d, floors, met, unreachableRooms, connectivityScore, heatedAreaM2: r2(heatedAreaM2), outdoorAreaM2: r2(outdoorAreaM2) };
}

/** Footprint for a floor area (indoor rooms only), shaped like the plot (× stretch), kept `setback` metres inside it. Rounded to 0.1 m. */
function footprint(b: Brief, stretch: number) {
  const indoor = b.rooms.filter((r) => roomThermal(r) !== "outdoor");
  const list = indoor.length ? indoor : b.rooms;
  const a = list.reduce((s, r) => s + r.area, 0) / b.floors, k = (b.plot.w / b.plot.d) * stretch;
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
export function generatePlans(brief: Brief, seed = 1): PlanOption[] {
  if (!brief.rooms.length) return [];
  const b = withCore(brief), core = new Set(b.core ? [...b.core.stair, ...b.core.circ] : []);
  const outdoor = new Set(b.rooms.map((r, i) => (roomThermal(r) === "outdoor" ? i : -1)).filter((i) => i >= 0));
  const runs: { o: PlanOption; k: string }[] = [];
  for (const stretch of [1, 1.35, 1 / 1.35]) {
    const { w, d } = footprint(b, stretch);
    for (let s = 0; s < 4; s++) {
      const rand = rng(seed * 1000 + s * 7 + Math.round(stretch * 100));
      const st: State = Array.from({ length: b.floors }, () => []);
      const load = new Array(b.floors).fill(0);
      const order = b.rooms.map((_, i) => i).sort((x, y) => b.rooms[y].area - b.rooms[x].area || rand() - 0.5);
      for (const i of order) { if (core.has(i) || outdoor.has(i)) continue; // pinned rooms to their floor, the rest to the lightest floor
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

/** A w × d slab (centred on 0) with a stairwell hole → the pieces around it: west and east full depth, north and south between. */
export function slabAround(w: number, d: number, h: Rect): { side: string; x: number; z: number; w: number; d: number }[] {
  const X0 = -w / 2, X1 = w / 2, Z0 = -d / 2, Z1 = d / 2, x0 = Math.max(X0, h.x0), x1 = Math.min(X1, h.x1), z0 = Math.max(Z0, h.z0), z1 = Math.min(Z1, h.z1);
  return ([["west", X0, x0, Z0, Z1], ["east", x1, X1, Z0, Z1], ["north", x0, x1, Z0, z0], ["south", x0, x1, z1, Z1]] as const)
    .filter(([, a0, a1, b0, b1]) => a1 - a0 > EPS && b1 - b0 > EPS)
    .map(([side, a0, a1, b0, b1]) => ({ side, x: r2((a0 + a1) / 2), z: r2((b0 + b1) / 2), w: r2(a1 - a0), d: r2(b1 - b0) }));
}

/** An option → an ARCH scene in the usual part format: per floor a slab, an outer shell and one straight wall per slicing
 *  cut; interior doors for met wishes + connectivity, the front door on the first floor's entrance/hall, proportional windows
 *  on indoor rooms, and low exterior deck slabs for outdoor spaces (never enclosed in insulated walls or roof). */
export function planScene(brief: Brief, o: PlanOption): Scene {
  const b = withCore(brief), D = stairDesign(PLAN.slab + PLAN.wallH);
  const { w, d } = o, T = RULES.wallThick, H = PLAN.slab + PLAN.wallH, parts: Part[] = [], openings: Part[] = [];
  let n = 0;
  const id = () => `f${(n++).toString(36)}`;
  const name = (i: number) => b.rooms[i].name;
  const isOutdoor = (i: number) => roomThermal(b.rooms[i]) === "outdoor";
  parts.push({ id: id(), kind: "foundation", name: "Strip foundation", x: 0, y: -0.8, z: 0, w, d, h: 0.8 });
  o.floors.forEach((fl, f) => {
    const y = f * H, shell = id();
    const well = f > 0 && b.core && o.floors[f - 1].rooms.find((r) => r.i === b.core!.stair[f - 1])?.r; // the stair below comes up through here
    if (!well) parts.push({ id: id(), kind: "slab", name: `Floor ${f + 1} slab`, x: 0, y, z: 0, w, d, h: PLAN.slab });
    else for (const s of slabAround(w, d, well)) parts.push({ id: id(), kind: "slab", name: `Floor ${f + 1} slab (${s.side} of stairwell)`, x: s.x, y, z: s.z, w: s.w, d: s.d, h: PLAN.slab });
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
    const indoorRooms = fl.rooms.filter(({ i }) => !isOutdoor(i));
    const outdoorRooms = fl.rooms.filter(({ i }) => isOutdoor(i));
    // Compute connected interior door pairs (reuse fl.doors from evaluate, or compute if absent)
    let pairs: [number, number][];
    if (fl.doors) {
      pairs = fl.doors;
    } else {
      const init = o.met.filter(([ia, ib]) => ia >= 0 && ib >= 0 && rect.has(ia) && rect.has(ib) && !isOutdoor(ia) && !isOutdoor(ib));
      if (b.core) {
        const c = b.core.circ[f], C = rect.get(c)!;
        for (const { i, r } of indoorRooms) { const s = shared(C, r); if (i !== b.core.stair[f] && s && segLen(s) >= PLAN.minShare + 0.6 && !init.some((p) => p.includes(i) && p.includes(c))) init.push([c, i]); }
      }
      pairs = ensureConnectedDoors(b, fl, f, init, { w, d }).pairs;
    }
    if (b.core && f < o.floors.length - 1) {
      const S = rect.get(b.core.stair[f])!;
      parts.push({ id: id(), kind: "stair", name: `Stairs ${f + 1}→${f + 2}: dogleg, ${D.risers} risers ${D.R}/${D.G} mm, 2R+G ${D.rule}`, x: r2((S.x0 + S.x1) / 2), y: y + PLAN.slab, z: r2((S.z0 + S.z1) / 2), w: r2(S.x1 - S.x0 - T), d: r2(S.z1 - S.z0 - T), h: H });
    }
    for (const [ia, ib] of pairs) {
      const A = rect.get(ia), B = rect.get(ib), s = A && B && shared(A, B);
      if (!s) continue;
      const alongX = Math.abs(s.z0 - s.z1) < EPS, c = fl.cuts.find((k) => (alongX ? Math.abs(k.z0 - k.z1) < EPS && Math.abs(k.z0 - s.z0) < EPS && k.x0 <= s.x0 + EPS && k.x1 >= s.x1 - EPS
        : Math.abs(k.x0 - k.x1) < EPS && Math.abs(k.x0 - s.x0) < EPS && k.z0 <= s.z0 + EPS && k.z1 >= s.z1 - EPS));
      const wall = c && parts.find((p) => p.id === wallOf.get(c));
      if (!wall) continue;
      const off = alongX ? (s.x0 + s.x1) / 2 - wall.x : (s.z0 + s.z1) / 2 - wall.z;
      openings.push({ id: id(), kind: "door", group: "interior", name: `Door ${name(ia)}–${name(ib)}`.slice(0, 60), host: wall.id, face: alongX ? "s" : "e", off: r2(off), x: 0, y: 0, z: 0, w: PLAN.door, d: 0, h: 2.1 });
    }
    const along = (face: Face, seg: Rect) => r2(face === "n" || face === "s" ? (seg.x0 + seg.x1) / 2 : (seg.z0 + seg.z1) / 2);
    // Outdoor spaces: low deck/terrace slab flush with the envelope (no insulated walls, roof, or window)
    for (const { i, r } of outdoorRooms) {
      parts.push({ id: id(), kind: "slab", group: "exterior", name: `${name(i)} deck`.slice(0, 60), x: r2((r.x0 + r.x1) / 2), y, z: r2((r.z0 + r.z1) / 2), w: r2(r.x1 - r.x0), d: r2(r.z1 - r.z0), h: 0.15 });
      const touch = indoorRooms
        .map((ir) => ({ ir, s: shared(ir.r, r) }))
        .filter((x): x is { ir: { i: number; r: Rect }; s: Rect } => !!x.s && segLen(x.s) >= PLAN.door)
        .sort((a, b) => segLen(b.s) - segLen(a.s))[0];
      if (touch) {
        const face: Face = Math.abs(touch.s.z0 - d / 2) < EPS ? "s" : Math.abs(touch.s.z0 + d / 2) < EPS ? "n" : Math.abs(touch.s.x0 - w / 2) < EPS ? "e" : "w";
        openings.push({ id: id(), kind: "door", group: "exterior", name: `Terrace door (${name(touch.ir.i)}–${name(i)})`.slice(0, 60), host: shell, face, off: along(face, touch.s), x: 0, y: 0, z: 0, w: 1.2, d: 0, h: 2.1 });
      }
    }
    if (f === 0) { // front door: the entrance/hall room if it has an outer wall, else the first indoor room that does
      const pick = [...indoorRooms].sort((p, q) => Number(CIRC.test(name(q.i))) - Number(CIRC.test(name(p.i)))).find(({ r }) => outerFaces(r, w, d).length);
      const of = pick && outerFaces(pick.r, w, d)[0];
      if (pick && of) openings.push({ id: id(), kind: "door", group: "exterior", name: `Front door (${name(pick.i)})`.slice(0, 60), host: shell, face: of.face, off: along(of.face, of.seg), x: 0, y: 0, z: 0, w: 1, d: 0, h: 2.1 });
    }
    for (const { i, r } of indoorRooms) {
      const faces = outerFaces(r, w, d);
      if (!faces.length) continue;
      const roomArea = (r.x1 - r.x0) * (r.z1 - r.z0);
      const primary = faces.map((of) => ({ of, win: windowSizeForRoom(name(i), roomArea, segLen(of.seg)) })).find((x) => x.win);
      if (!primary || !primary.win) continue;
      openings.push({ id: id(), kind: "window", name: `Window ${name(i)}`.slice(0, 60), host: shell, face: primary.of.face, off: along(primary.of.face, primary.of.seg), sill: primary.win.sill, x: 0, y: 0, z: 0, w: primary.win.w, d: 0, h: primary.win.h });
      // For habitable rooms, if a single face wasn't wide enough for >= 12% WFR, add a second window on a second exterior face
      const glazed = primary.win.w * primary.win.h;
      if (!DARK_OK.test(name(i)) && glazed < roomArea * 0.12 && faces.length > 1) {
        const secondFace = faces.find((x) => x.face !== primary.of.face && segLen(x.seg) >= 1.4);
        if (secondFace) {
          const remaining = Math.max(1.2, roomArea * 0.14 - glazed);
          const secondWin = windowSizeForRoom(name(i), remaining / 0.14, segLen(secondFace.seg));
          if (secondWin) openings.push({ id: id(), kind: "window", name: `Window ${name(i)} 2`.slice(0, 60), host: shell, face: secondFace.face, off: along(secondFace.face, secondFace.seg), sill: secondWin.sill, x: 0, y: 0, z: 0, w: secondWin.w, d: 0, h: secondWin.h });
        }
      }
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
