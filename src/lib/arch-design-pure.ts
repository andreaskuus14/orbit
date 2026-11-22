// ARCH design rules (pure, tested in tests/arch-design.test.ts): a rules layer that checks and fixes the house the generators and
// Claude make, the way an architect marks up a student's model, and says in plain words what it changed and why.
// It never invents rooms; it squares up what is there:
//  - storeys: floor-to-floor about 2.8-3.0 m (a 0.2 m slab plus a 2.6-2.8 m wall); everything above moves with it;
//  - massing: an upper storey sits on the one below (no overhang past its walls); a roof sits on the walls under it; two roofs
//    that together make one rectangle become one roof;
//  - roof form from the brief, else the Estonian / Nordic default: a 35° gable over the long side (sheds snow, reads as a house),
//    a low shed over a narrow lean-to; eaves overhang 0.5 m, gables 0.3 m; a flat roof only when asked (then with a parapet);
//  - windows: widths on a 0.1 m module, one head height per storey, upper windows over the ones below, at least 0.6 m of wall
//    from a corner; window-to-wall ratio per orientation (south most, north least: daylight against heat loss);
//  - entrance: one clear front door (≥ 1.0 × 2.1 m) with a canopy over it and a landing in front;
//  - materials from the brief, else plastered walls with timber-clad gables under a dark standing-seam steel roof.
// Teaching values, not a permit check: anything built needs a designer and an engineer.
import { applyOps, fitOpenings, isInteriorDoor, isOpening, isStraightWall, roofForm, styleOf, type Face, type Facade, type Part, type RoofForm, type RoofMat, type Scene, type Style } from "./arch-pure.ts";
import { DETAIL, frontDoor, isOuterWall, roofBase } from "./arch-mesh-pure.ts";

export const DESIGN = {
  f2f: [2.8, 3.0] as const, wallH: 2.8, slab: 0.2,
  pitch: { gable: 35, hip: 30, shed: 12, flat: 0 } satisfies Record<RoofForm, number>,
  leanTo: 3.2, // a roof piece narrower than this is a lean-to (shed), not a gable of its own
  module: 0.1, cornerMin: 0.6, pierMin: 0.5, alignTol: 0.6,
  /** window-to-wall ratio band per orientation (glazed area / gross wall face of that side), Nordic teaching values */
  wwr: { s: [0.18, 0.4], e: [0.1, 0.25], w: [0.1, 0.25], n: [0.05, 0.15] } satisfies Record<Face, readonly [number, number]>,
  door: { w: 1.0, h: 2.1 },
};

export type Hints = { roof?: RoofForm; facade?: Facade; roofMat?: RoofMat; gable?: Facade };
const HINT: [RegExp, Partial<Hints>][] = [
  [/flat roof|lame katus|lamekatus|funkis|functionalis/i, { roof: "flat", roofMat: "membrane" }],
  [/hip(ped)? roof|kelpkatus|walm/i, { roof: "hip" }],
  [/shed roof|mono.?pitch|lean.?to|ühepoolne|kaldkatus/i, { roof: "shed" }],
  [/gable|viilkatus|saddle roof/i, { roof: "gable" }],
  [/brick|tellis/i, { facade: "brick" }],
  [/concrete|betoon/i, { facade: "concrete" }],
  [/timber|wood(en)?|puit|puidu|laudis|log house|palkmaja/i, { facade: "timber" }],
  [/plaster|render(ed)?|krohv/i, { facade: "plaster" }],
  [/(clay|concrete)? ?tiles?\b|kivikatus|katusekivi/i, { roofMat: "tile" }],
  [/steel roof|metal roof|plekk|valtsplekk|standing seam/i, { roofMat: "metal" }],
];
/** What the owner's words ask for (English or Estonian). Unknown → nothing: the Nordic defaults decide. */
export function readHints(words = ""): Hints {
  const h: Hints = {};
  for (const [re, v] of HINT) if (re.test(words)) for (const [k, x] of Object.entries(v)) if (!(k in h)) (h as Record<string, unknown>)[k] = x;
  if (h.roof && h.roof !== "flat" && h.roofMat === "membrane") delete h.roofMat;
  return h;
}

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const snapM = (n: number) => r2(Math.round(n / DESIGN.module) * DESIGN.module);
const top = (p: Part) => p.y + p.h;
const overlap = (a: Part, b: Part) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 1e-6 && Math.abs(a.z - b.z) < (a.d + b.d) / 2 - 1e-6;
const ext = (p: Part) => ({ x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z - p.d / 2, z1: p.z + p.d / 2 });

/** Storeys: distinct wall base heights (to the cm), bottom up, each with its walls. */
export function storeys(parts: Part[]): { y: number; walls: Part[] }[] {
  const by = new Map<number, Part[]>();
  for (const p of parts) if (p.kind === "wall") { const k = Math.round(p.y * 100); (by.get(k) ?? by.set(k, []).get(k)!).push(p); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, walls]) => ({ y: k / 100, walls }));
}

/** Compass side a face looks to, from the site's north (true north's bearing clockwise from model −Z, as arch-site-pure). */
export function trueSide(face: Face, north = 0): Face {
  const az = (({ n: 0, e: 90, s: 180, w: 270 })[face] - north + 720) % 360;
  return (["n", "e", "s", "w"] as const)[Math.round(az / 90) % 4];
}

/** Gross outer wall face per side (m²) and glazed area per side, from the outer walls of every storey. */
export function facadeAreas(parts: Part[], north = 0): Record<Face, { wall: number; glass: number }> {
  const out = { n: { wall: 0, glass: 0 }, e: { wall: 0, glass: 0 }, s: { wall: 0, glass: 0 }, w: { wall: 0, glass: 0 } };
  const walls = parts.filter((p) => p.kind === "wall" && isOuterWall(p));
  for (const w of walls) {
    if (!isStraightWall(w)) for (const f of ["n", "s", "e", "w"] as const) out[trueSide(f, north)].wall += (f === "n" || f === "s" ? w.w : w.d) * w.h;
    else { // a straight outer wall: its long side, facing away from the building's centre
      const f = outerFaceOf(w, walls);
      out[trueSide(f, north)].wall += Math.max(w.w, w.d) * w.h;
    }
  }
  for (const o of parts) if (o.kind === "window" && o.face && walls.some((w) => w.id === o.host)) out[trueSide(o.face, north)].glass += o.w * o.h;
  return out;
}
function outerFaceOf(w: Part, walls: Part[]): Face {
  const cx = walls.reduce((s, p) => s + p.x, 0) / walls.length, cz = walls.reduce((s, p) => s + p.z, 0) / walls.length;
  return w.w >= w.d ? (w.z < cz ? "n" : "s") : (w.x < cx ? "w" : "e");
}

export type Designed = { scene: Scene; notes: string[] };
type Opts = { north?: number; words?: string };

/** Check and fix a generated house. Returns the fixed scene and one plain line per change (empty when it already follows them). */
export function designHouse(input: Scene, o: Opts = {}): Designed {
  const notes: string[] = [], hints = readHints(o.words), north = o.north ?? 0;
  let parts: Part[] = input.parts.map((p) => ({ ...p }));
  const note = (s: string) => { if (!notes.includes(s)) notes.push(s); };

  // 1. storeys: floor-to-floor 2.8-3.0 m; everything above moves with the change
  let fixedH = 0;
  for (let i = 0; i < storeys(parts).length; i++) {
    const st = storeys(parts)[i];
    const shell = st.walls.find((w) => !isStraightWall(w)) ?? st.walls.reduce((m, w) => (w.h > m.h ? w : m));
    const slab = parts.find((p) => p.kind === "slab" && p.group !== "exterior" && Math.abs(top(p) - st.y) < 0.02 && overlap(p, shell));
    const s = slab ? slab.h : DESIGN.slab, f2f = s + shell.h;
    if (f2f >= DESIGN.f2f[0] - 1e-6 && f2f <= DESIGN.f2f[1] + 1e-6 && st.walls.every((w) => Math.abs(w.h - shell.h) < 0.02)) continue;
    const want = r2(DESIGN.f2f[1] - s), dy = r2(want - shell.h), oldTop = st.y + shell.h;
    for (const p of parts) if (!isOpening(p.kind) && p.y >= oldTop - 0.02) p.y = r2(p.y + dy);
    for (const w of st.walls) { const live = parts.find((p) => p.id === w.id)!; live.h = want; }
    fixedH++;
  }
  if (fixedH) note(`Set the storey height to ${DESIGN.slab + DESIGN.wallH} m floor to floor (0.2 m floor + 2.8 m wall), so rooms get about 2.6 m clear and the floors line up.`);

  // 2. massing: an upper storey stands on the walls below it
  const sts = storeys(parts);
  for (let i = 1; i < sts.length; i++) {
    const below = sts[i - 1].walls.filter((w) => !isStraightWall(w)), up = sts[i].walls.filter((w) => !isStraightWall(w));
    if (!below.length) continue;
    const B = { x0: Math.min(...below.map((w) => ext(w).x0)), x1: Math.max(...below.map((w) => ext(w).x1)), z0: Math.min(...below.map((w) => ext(w).z0)), z1: Math.max(...below.map((w) => ext(w).z1)) };
    for (const w of up) {
      const live = parts.find((p) => p.id === w.id)!, e = ext(live);
      const x0 = Math.max(B.x0, e.x0), x1 = Math.min(B.x1, e.x1), z0 = Math.max(B.z0, e.z0), z1 = Math.min(B.z1, e.z1);
      if (Math.abs(x0 - e.x0) + Math.abs(x1 - e.x1) + Math.abs(z0 - e.z0) + Math.abs(z1 - e.z1) < 0.05 || x1 - x0 < 3 || z1 - z0 < 3) continue;
      Object.assign(live, { x: r2((x0 + x1) / 2), z: r2((z0 + z1) / 2), w: r2(x1 - x0), d: r2(z1 - z0) });
      for (const s of parts) if (s.kind === "slab" && Math.abs(top(s) - live.y) < 0.02 && overlap(s, live)) Object.assign(s, { x: live.x, z: live.z, w: live.w, d: live.d });
      note(`Pulled the upper floor back over the walls below it: an overhanging storey needs a structure ARCH doesn't model.`);
    }
  }

  // 3. roofs: sit on their walls; merge pieces that make one rectangle; form, pitch, ridge and eaves
  let roofs = parts.filter((p) => p.kind === "roof");
  for (const r of roofs) { // a roof sits on the highest wall top under it
    const under = parts.filter((p) => p.kind === "wall" && overlap(p, r) && top(p) <= r.y + 1.5);
    const t = under.length ? Math.max(...under.map(top)) : r.y;
    if (Math.abs(t - r.y) > 0.02) { r.y = r2(t); note("Set the roof down onto the walls (it was floating or cut into them)."); }
  }
  for (let merged = true; merged;) { // two roofs at one height whose wall footprints make one rectangle → one roof
    merged = false;
    roofs = parts.filter((p) => p.kind === "roof");
    for (const a of roofs) for (const b of roofs) {
      if (merged || a === b || Math.abs(a.y - b.y) > 0.02) continue;
      const A = roofBase(a, parts), Bb = roofBase(b, parts);
      const meet = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0, b0) - Math.min(a1, b1) < 0.35; // touch or overlap
      const sameX = Math.abs(A.x0 - Bb.x0) < 0.05 && Math.abs(A.x1 - Bb.x1) < 0.05 && meet(A.z0, A.z1, Bb.z0, Bb.z1);
      const sameZ = Math.abs(A.z0 - Bb.z0) < 0.05 && Math.abs(A.z1 - Bb.z1) < 0.05 && meet(A.x0, A.x1, Bb.x0, Bb.x1);
      if (!sameX && !sameZ) continue;
      const x0 = Math.min(A.x0, Bb.x0), x1 = Math.max(A.x1, Bb.x1), z0 = Math.min(A.z0, Bb.z0), z1 = Math.max(A.z1, Bb.z1);
      Object.assign(a, { x: r2((x0 + x1) / 2), z: r2((z0 + z1) / 2), w: r2(x1 - x0), d: r2(z1 - z0), name: "Roof" });
      parts = parts.filter((p) => p !== b);
      merged = true;
      note("Joined two roof pieces into one roof over the whole block.");
    }
  }
  roofs = parts.filter((p) => p.kind === "roof");
  const main = roofs.reduce<Part | null>((m, r) => (!m || r.w * r.d > m.w * m.d ? r : m), null);
  for (const r of roofs) {
    const B = roofBase(r, parts), bw = B.x1 - B.x0, bd = B.z1 - B.z0, short = Math.min(bw, bd);
    const asked = hints.roof, had = roofForm(r);
    let form: RoofForm = asked ?? (r === main || short >= DESIGN.leanTo ? "gable" : "shed");
    if (form === "gable" && short < 2) form = "shed";
    const ridge: "x" | "z" = bw >= bd ? "x" : "z", pitch = typeof r.pitch === "number" && asked === undefined && had === form && r.pitch > 0 ? r.pitch : DESIGN.pitch[form];
    const eave = form === "flat" ? 0 : DETAIL.eaveOverhang, gableO = form === "flat" ? 0 : form === "hip" ? eave : DETAIL.gableOverhang;
    const W = ridge === "x" ? bw + 2 * gableO : bw + 2 * eave, Dd = ridge === "x" ? bd + 2 * eave : bd + 2 * gableO;
    const across = ridge === "x" ? Dd : W, rise = form === "flat" ? 0.3 : r2(Math.tan((pitch * Math.PI) / 180) * (form === "shed" ? across : across / 2));
    const next = { roof: form, pitch, ridge, x: r2((B.x0 + B.x1) / 2), z: r2((B.z0 + B.z1) / 2), w: r2(W), d: r2(Dd), h: rise };
    const changed = had !== form || r.ridge !== ridge || Math.abs((r.pitch ?? -1) - pitch) > 0.5 || Math.abs(r.w - next.w) > 0.05 || Math.abs(r.d - next.d) > 0.05;
    Object.assign(r, next);
    if (!changed) continue;
    if (form === "gable") note(asked ? `Gave it the gable roof you asked for, ${pitch}°.` : `Gave it a ${pitch}° gable roof with the ridge along the long side: the Estonian default, it sheds snow and rain and keeps the roof low.`);
    else if (form === "shed") note(asked ? `Gave it the shed roof you asked for, ${pitch}°.` : `The narrow wing got a low ${pitch}° lean-to roof that runs into the main house.`);
    else if (form === "hip") note(`Gave it the hipped roof you asked for, ${pitch}° on all four sides.`);
    else note("Gave it the flat roof you asked for, with a parapet round the edge (the membrane needs a slight fall to the drains).");
    if (form !== "flat") note(`Eaves stand out ${eave} m${form === "hip" ? "" : ` and gables ${gableO} m`}: they keep rain off the walls and shade summer sun.`);
  }

  parts = fitOpenings(parts);
  // 4. windows: module widths, one head height per storey, stacked over the ones below, clear of corners
  const wins = () => parts.filter((p) => p.kind === "window" && p.host);
  let snapped = 0, headed = 0, stacked = 0;
  for (const w of wins()) { const s = snapM(w.w); if (Math.abs(s - w.w) > 0.005) { w.w = Math.max(0.6, s); snapped++; } }
  for (const st of storeys(parts)) {
    const ids = new Set(st.walls.map((w) => w.id)), here = wins().filter((w) => ids.has(w.host!) && w.h < 2.2);
    if (here.length < 2) continue;
    const heads = here.map((w) => r2((w.sill ?? 0) + w.h)), mode = heads.sort((a, b) => heads.filter((x) => x === b).length - heads.filter((x) => x === a).length)[0];
    for (const w of here) {
      const head = r2((w.sill ?? 0) + w.h);
      if (Math.abs(head - mode) < 0.03) continue;
      const h = r2(mode - (w.sill ?? 0));
      if (h >= 0.6) { w.h = h; headed++; } else { w.sill = r2(Math.max(0, mode - w.h)); headed++; }
    }
  }
  const all = storeys(parts);
  for (let i = 1; i < all.length; i++) {
    const lowIds = new Set(all[i - 1].walls.map((w) => w.id)), upIds = new Set(all[i].walls.map((w) => w.id));
    const lows = wins().filter((w) => lowIds.has(w.host!));
    for (const u of wins().filter((w) => upIds.has(w.host!))) {
      const ns = u.face === "n" || u.face === "s", c = ns ? u.x : u.z;
      const near = lows.filter((l) => l.face === u.face).map((l) => ({ l, d: (ns ? l.x : l.z) - c })).filter((x) => Math.abs(x.d) > 0.02 && Math.abs(x.d) < DESIGN.alignTol).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
      if (near) { u.off = r2((u.off ?? 0) + near.d); stacked++; }
    }
  }
  parts = fitOpenings(parts);
  let cornered = 0;
  for (const w of wins()) { // at least 0.6 m of wall to a shell corner: the corner carries load and holds the insulation
    const host = parts.find((p) => p.id === w.host);
    if (!host || isStraightWall(host)) continue;
    const len = w.face === "n" || w.face === "s" ? host.w : host.d, lim = len / 2 - DESIGN.cornerMin - w.w / 2;
    if (lim <= 0) { w.w = snapM(Math.max(0.6, len - 2 * DESIGN.cornerMin)); w.off = 0; cornered++; continue; }
    if (Math.abs(w.off ?? 0) > lim + 1e-6) { w.off = r2(Math.sign(w.off ?? 0) * lim); cornered++; }
  }
  parts = fitOpenings(parts);
  if (snapped) note(`Rounded ${snapped} window width${snapped === 1 ? "" : "s"} to whole 10 cm, the steps windows are made in.`);
  if (headed) note("Lined up the window tops on each floor, so the facade reads calm and the lintels are one size.");
  if (stacked) note("Moved upper windows over the ones below: loads go straight down and the facade has a clear rhythm.");
  if (cornered) note("Kept every window at least 0.6 m from a corner.");

  // 5. window-to-wall ratio per orientation
  const A = facadeAreas(parts, north), name = { n: "north", e: "east", s: "south", w: "west" } as const;
  for (const side of ["s", "e", "w", "n"] as const) {
    const { wall, glass } = A[side], [lo, hi] = DESIGN.wwr[side];
    if (wall < 4) continue;
    const ratio = glass / wall, list = wins().filter((w) => w.face && trueSide(w.face, north) === side);
    const before = list.map((w) => `${w.w}x${w.h}`).join();
    const changedNow = () => { parts = fitOpenings(parts); return wins().filter((w) => w.face && trueSide(w.face, north) === side).map((w) => `${w.w}x${w.h}`).join() !== before; };
    if (ratio > hi + 0.03 && list.length) {
      const k = Math.sqrt(((hi - 0.02) * wall) / glass); // shrink width and height alike, keep the sills; land inside the band
      for (const w of list) { w.w = Math.max(0.6, snapM(w.w * k)); if (w.h > 1.3) w.h = Math.max(1.2, r2(w.h * k)); }
      if (changedNow()) note(`The ${name[side]} side was ${Math.round(ratio * 100)} % glass; made its windows smaller (aim ${Math.round(lo * 100)}-${Math.round(hi * 100)} %) to cut heat loss and overheating.`);
    } else if (ratio < lo - 0.03 && list.length && side !== "n") {
      const k = ((lo + 0.02) * wall) / Math.max(glass, 0.01); // up to 3 m per window; the wall's own length caps it too (fitOpenings)
      for (const w of list) w.w = Math.min(3, r2(Math.ceil((w.w * k) / DESIGN.module - 1e-9) * DESIGN.module));
      if (changedNow()) note(`The ${name[side]} side had only ${Math.round(ratio * 100)} % glass; widened its windows (aim ${Math.round(lo * 100)}-${Math.round(hi * 100)} %) for daylight.`);
    } else if (ratio < lo && !list.length && side === "s") note("The south side has no windows: the living rooms should look south for sun. Add some with + Window on that wall.");
  }
  parts = fitOpenings(parts);

  // 6. entrance: one clear front door with a canopy and a landing
  const door = frontDoor(parts);
  const hostOf = (d: Part) => parts.find((p) => p.id === d.host);
  if (!door) { if (parts.some((p) => p.kind === "wall")) note("There's no front door on an outside wall yet: add one where the path arrives."); }
  else {
    const host = hostOf(door)!;
    if (door.w < DESIGN.door.w - 1e-6 || door.h < DESIGN.door.h - 1e-6 || !/front/i.test(door.name)) {
      door.w = Math.max(door.w, DESIGN.door.w); door.h = Math.max(door.h, DESIGN.door.h); door.name = "Front door"; door.group = "exterior";
      note("Made the front door the main one: at least 1.0 × 2.1 m, wider than the inside doors, so you know where to go in.");
    }
    parts = fitOpenings(parts);
    const d = parts.find((p) => p.id === door.id)!;
    if (!parts.some((p) => p.kind === "prop" && /canopy/i.test(p.name))) {
      const ns = d.face === "n" || d.face === "s", sg = d.face === "s" || d.face === "e" ? 1 : -1, depth = 1.1, cw = d.w + 0.8;
      const wallTop = host.y + host.h, y = Math.min(wallTop - 0.15, d.y + d.h + 0.25);
      const face = ns ? d.z : d.x, cx = ns ? d.x : face + sg * depth / 2, cz = ns ? face + sg * depth / 2 : d.z;
      parts.push({ id: `${d.id}-canopy`, kind: "prop", group: "exterior", name: "Entrance canopy", x: r2(cx), y: r2(y), z: r2(cz), w: ns ? cw : depth, d: ns ? depth : cw, h: 0.12 });
      const sx = ns ? d.x : face + sg * 0.7, sz = ns ? face + sg * 0.7 : d.z;
      parts.push({ id: `${d.id}-step`, kind: "prop", group: "exterior", name: "Entrance step", x: r2(sx), y: 0, z: r2(sz), w: ns ? cw : 1.4, d: ns ? 1.4 : cw, h: Math.max(0.05, r2(d.y - 0.02)) });
      note("Added a canopy over the front door and a landing in front of it: shelter while you find the keys, and the entrance reads first.");
    }
  }
  const others = parts.filter((p) => p.kind === "door" && p.id !== door?.id && !isInteriorDoor(p, hostOf(p)) && p.w > (door?.w ?? 9) && p.w < 2); // ≥ 2 m is a garage or terrace door
  if (others.length) note("A side door is wider than the front door; the front door should be the biggest.");

  // 7. materials
  const had = input.style ? styleOf(input) : null;
  const style: Style = {
    facade: hints.facade ?? had?.facade ?? "plaster",
    roofMat: hints.roofMat ?? had?.roofMat ?? (parts.some((p) => p.kind === "roof" && roofForm(p) === "flat") && !parts.some((p) => p.kind === "roof" && roofForm(p) !== "flat") ? "membrane" : "metal"),
    gable: hints.gable ?? had?.gable ?? (hints.facade && hints.facade !== "plaster" ? undefined : "timber"),
  };
  if (!style.gable || style.gable === style.facade) delete style.gable;
  if (!had || had.facade !== style.facade || had.roofMat !== style.roofMat || had.gable !== style.gable) {
    const what = { plaster: "plastered", timber: "timber-clad", brick: "brick", concrete: "concrete" }[style.facade];
    const roof = { metal: "a dark standing-seam steel roof", tile: "a tiled roof", membrane: "a membrane roof" }[style.roofMat];
    note(`Materials: ${what} walls${style.gable ? `, ${style.gable === "timber" ? "vertical timber boards" : style.gable} in the gables` : ""}, ${roof}, a concrete plinth.`);
  }
  // re-run the stacking pass of applyOps on a no-op so every opening is refitted to its (maybe moved) wall
  const scene = applyOps({ ...input, parts, style }, [], () => "x").scene;
  return { scene, notes };
}
