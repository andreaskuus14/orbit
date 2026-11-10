// ARCH concept generator: a short brief (floor area, bedrooms, sauna, which side the view is) → three different house layouts as
// real ARCH scenes, built by rules rather than a model so they're free, instant and always valid. Each concept states its idea and
// its trade-off, the way a studio pin-up does. Tests: tests/arch-concepts.test.ts.
import { fitOpening, MAX, RULES, type Face, type Part, type Scene } from "./arch-pure.ts";

export type Brief = { area: number; bedrooms: number; sauna: boolean; view: Face };
export type Concept = { name: string; idea: string; tradeoff: string; area: number; rooms: string[]; scene: Scene };

const T = RULES.wallThick, H = 2.8, r1 = (n: number) => Math.round(n * 10) / 10;

/** Clamp and default a raw brief (trust boundary: it comes from the request body). */
export function parseBrief(b: unknown): Brief {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
  return { area: n(o.area, 50, 300, 120), bedrooms: n(o.bedrooms, 1, 5, 2), sauna: o.sauna === true, view: (["n", "e", "s", "w"] as const).includes(o.view as Face) ? (o.view as Face) : "s" };
}

type Box = { id: string; x: number; z: number; w: number; d: number };
type Room = { name: string; box: Box; x0: number; x1: number }; // a slice of a box along its length (local x)

/** Shell of one box: slab, four walls, flat roof. Openings are added later onto these wall ids. */
function shell(b: Box): Part[] {
  const y = 0.2, half = (n: number) => n / 2;
  return [
    { id: `${b.id}-slab`, kind: "slab", name: `Floor ${b.id}`, x: b.x, y: 0, z: b.z, w: b.w, d: b.d, h: 0.2 },
    { id: `${b.id}-n`, kind: "wall", name: `North wall ${b.id}`, x: b.x, y, z: b.z - half(b.d) + T / 2, w: b.w, d: T, h: H },
    { id: `${b.id}-s`, kind: "wall", name: `South wall ${b.id}`, x: b.x, y, z: b.z + half(b.d) - T / 2, w: b.w, d: T, h: H },
    { id: `${b.id}-w`, kind: "wall", name: `West wall ${b.id}`, x: b.x - half(b.w) + T / 2, y, z: b.z, w: T, d: b.d - 2 * T, h: H },
    { id: `${b.id}-e`, kind: "wall", name: `East wall ${b.id}`, x: b.x + half(b.w) - T / 2, y, z: b.z, w: T, d: b.d - 2 * T, h: H },
    { id: `${b.id}-roof`, kind: "roof", name: `Roof ${b.id}`, x: b.x, y: y + H, z: b.z, w: b.w + 0.8, d: b.d + 0.8, h: 0.35 },
  ];
}

/** Split a box's length into rooms by weight; partitions between them. */
function slice(b: Box, names: [string, number][]): { rooms: Room[]; parts: Part[] } {
  const total = names.reduce((s, [, w]) => s + w, 0), rooms: Room[] = [], parts: Part[] = [];
  let x = b.x - b.w / 2;
  names.forEach(([name, wt], i) => {
    const len = (b.w * wt) / total; rooms.push({ name, box: b, x0: x, x1: x + len }); x += len;
    if (i < names.length - 1) parts.push({ id: `${b.id}-p${i}`, kind: "wall", name: `Partition ${b.id}${i + 1}`, x: r1(x), y: 0.2, z: b.z, w: 0.12, d: b.d - 2 * T, h: H });
  });
  return { rooms, parts };
}

/** Furniture that tells you what each room is, sized from real pieces. */
function furnish(r: Room, k: number): Part[] {
  const cx = (r.x0 + r.x1) / 2, { z, d } = r.box, y = 0.2, id = (s: string) => `${r.box.id}-${s}${k}`;
  const p = (s: string, name: string, x: number, zz: number, w: number, dd: number, h: number): Part => ({ id: id(s), kind: "prop", name, x: r1(x), y, z: r1(zz), w, d: dd, h });
  if (r.name === "Living") return [p("sofa", "Sofa", cx, z + d / 2 - 1.6, 2.4, 0.9, 0.75), p("ctab", "Coffee table", cx, z + d / 2 - 2.6, 1.1, 0.6, 0.38), p("dine", "Dining table", cx, z - 0.6, 1.8, 0.9, 0.75), p("kit", "Kitchen run", cx, z - d / 2 + T + 0.35, Math.min(3.6, r.x1 - r.x0 - 0.4), 0.65, 0.9)];
  if (r.name === "Kitchen") return [p("kit", "Kitchen run", cx, z - d / 2 + T + 0.35, Math.min(3.6, r.x1 - r.x0 - 0.6), 0.65, 0.9), p("dine", "Dining table", cx, z + 0.4, 1.8, 0.9, 0.75)];
  if (r.name.startsWith("Bedroom")) return [p("bed", "Bed", cx, z, k === 0 ? 1.8 : 1.4, 2.1, 0.5)];
  if (r.name === "Sauna") return [p("bench", "Sauna bench", cx, z - d / 2 + T + 0.4, Math.min(2, r.x1 - r.x0 - 0.3), 0.6, 0.9)];
  return [];
}

/** Windows where each room meets daylight (`winFace`; null = interior/wet room), and the front door on a named wall. */
type Entry = { wall: string; face: Face; off: number };
type Link = [wall: string, face: Face, off: number]; // a doorway through a wall two boxes share (both leaves get one)
function openings(rooms: Room[], walls: Map<string, Part>, winFace: (r: Room) => Face | null, entry: Entry, links: Link[]): Part[] {
  const out: Part[] = [];
  rooms.forEach((r, i) => {
    const f = r.name === "Bath" || r.name === "Sauna" ? null : winFace(r), len = r.x1 - r.x0;
    if (!f || len <= 1.4) return;
    const wall = walls.get(`${r.box.id}-${f}`)!, big = r.name === "Living";
    const o = fitOpening({ id: `${r.box.id}-win${i}`, kind: "window", name: `Window ${r.name}`, x: 0, y: 0, z: 0, w: big ? len - 0.8 : Math.min(1.6, len - 0.8), d: 0, h: big ? 2.5 : 1.3, host: wall.id, face: f, off: (r.x0 + r.x1) / 2 - r.box.x, sill: big ? 0.05 : 0.9 }, wall);
    if (o) out.push(o);
  });
  for (const w of walls.values()) if (/-p\d+$/.test(w.id)) { const o = fitOpening({ id: `${w.id}-door`, kind: "door", name: `Door ${w.name}`, x: 0, y: 0, z: 0, w: 0.9, d: 0, h: 2.1, host: w.id, face: "e", off: 0 }, w); if (o) out.push(o); }
  for (const [id, f, off] of links) { const w = walls.get(id)!, o = fitOpening({ id: `${id}-link`, kind: "door", name: `Door ${w.name}`, x: 0, y: 0, z: 0, w: 0.9, d: 0, h: 2.1, host: id, face: f, off }, w); if (o) out.push(o); }
  const ew = walls.get(entry.wall)!, door = fitOpening({ id: "entry", kind: "door", name: "Front door", x: 0, y: 0, z: 0, w: 1.0, d: 0, h: 2.1, host: ew.id, face: entry.face, off: entry.off }, ew);
  return door ? [...out, door] : out;
}

/** Rotate a scene built facing south so its glazing faces `view` (90° steps about the plot centre). */
export function face(scene: Scene, view: Face): Scene {
  const turns = { s: 0, w: 1, n: 2, e: 3 }[view], next: Record<Face, Face> = { n: "e", e: "s", s: "w", w: "n" };
  let parts = scene.parts;
  for (let t = 0; t < turns; t++) parts = parts.map((p) => ({ ...p, x: r1(-p.z) + 0, z: r1(p.x) + 0, w: p.d, d: p.w, ...(p.face ? { face: next[p.face] } : {}) }));
  return { plot: turns % 2 ? { ...scene.plot, w: scene.plot.d, d: scene.plot.w } : scene.plot, parts };
}

function build(boxes: Box[], plan: [string, number][][], brief: Brief, winFace: (r: Room) => Face | null, entry: Entry, links: Link[] = []): { scene: Scene; rooms: string[]; area: number } {
  const parts: Part[] = [], rooms: Room[] = [];
  boxes.forEach((b, i) => { const s = slice(b, plan[i]); parts.push(...shell(b), ...s.parts); rooms.push(...s.rooms); });
  const walls = new Map(parts.filter((p) => p.kind === "wall").map((p) => [p.id, p]));
  parts.push(...openings(rooms, walls, winFace, entry, links));
  rooms.forEach((r, k) => parts.push(...furnish(r, k)));
  const area = Math.round(boxes.reduce((s, b) => s + (b.w - 2 * T) * (b.d - 2 * T), 0));
  const span = Math.max(...boxes.map((b) => Math.abs(b.x) + b.w / 2), ...boxes.map((b) => Math.abs(b.z) + b.d / 2));
  const scene: Scene = { plot: { w: Math.ceil(span * 2 + 16), d: Math.ceil(span * 2 + 12), ground: "grass", trees: 8 }, parts: parts.slice(0, MAX.parts) };
  return { scene: face(scene, brief.view), rooms: rooms.map((r) => r.name), area };
}

/** Rooms for a brief, weighted by size: living ~40 %, bedrooms, a bath, an optional sauna. */
function program(b: Brief): [string, number][] {
  return [["Living", 4.5], ...Array.from({ length: b.bedrooms }, (_, i) => [`Bedroom ${i + 1}`, i === 0 ? 1.9 : 1.5] as [string, number]), ["Bath", 1], ...(b.sauna ? [["Sauna", 0.8] as [string, number]] : [])];
}

/** Three concepts for one brief. Depth 7.5 m keeps every room daylit from one side; lengths follow the area. */
export function concepts(raw: unknown): Concept[] {
  const b = parseBrief(raw), prog = program(b), D = 7.5 + 2 * T;
  const south = () => "s" as Face;
  const barW = r1(b.area / 7.5 + 2 * T), bar = build([{ id: "a", x: 0, z: 0, w: barW, d: D }], [prog], b, south, { wall: "a-n", face: "n", off: -barW / 2 + 2 });
  // L: living wing a juts south; along the north runs b: kitchen over a, then the private rooms past a's corner, which look south
  // onto the terrace the two wings shelter
  const wingW = r1((b.area * 0.3) / 7.5 + 2 * T), restW = r1((b.area * 0.42) / 7.5);
  const rest = prog.slice(1), wsum = rest.reduce((n, r) => n + r[1], 0), A: Box = { id: "a", x: 0, z: 0, w: wingW, d: D }, B: Box = { id: "b", x: r1(-wingW / 2 + (wingW + restW) / 2), z: -D, w: r1(wingW + restW), d: D };
  const ell = build([A, B], [prog.slice(0, 1), [["Kitchen", wingW], ...rest.map(([n, w]) => [n, (w / wsum) * restW] as [string, number])]], b,
    (r) => (r.box.id === "a" || (r.x0 + r.x1) / 2 > A.x + A.w / 2 ? "s" : "n"), { wall: "a-w", face: "w", off: 0 }, [["a-n", "n", 0], ["b-s", "s", r1(A.x - B.x)]]);
  // square: private rooms in the north half (windows north), living across the whole south half
  const side = r1(Math.sqrt(b.area) + 2 * T), half = r1(side / 2);
  const sq = build([{ id: "a", x: 0, z: -half / 2, w: side, d: half }, { id: "b", x: 0, z: half / 2, w: side, d: half }], [prog.filter((r) => r[0] !== "Living"), prog.slice(0, 1)], b, (r) => (r.box.id === "a" ? "n" : "s"), { wall: "b-e", face: "e", off: 0 }, [["a-s", "s", 0], ["b-n", "n", 0]]);
  return [
    { name: "Long bar", idea: `Every room in one line facing the view, ${bar.area} m².`, tradeoff: "Longest walls and roof per m², so the most expensive shell; corridor-free but bedrooms open off living space.", ...bar },
    { name: "L-shape", idea: `Living in a wing toward the view, kitchen and private rooms along the north, bedrooms looking onto the sheltered corner terrace, ${ell.area} m².`, tradeoff: "Clear day/night zoning and a wind-sheltered terrace; one extra corner and roof junction to build.", ...ell },
    { name: "Compact square", idea: `Living across the whole view side, private rooms behind, ${sq.area} m².`, tradeoff: "Cheapest shell and easiest to heat; the back rooms face away from the view.", ...sq },
  ];
}
