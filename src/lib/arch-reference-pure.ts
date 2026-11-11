// G01 reference house (pure, tested in tests/arch-reference.test.ts): a two-storey house in ARCH's own scene format with round,
// hand-checkable numbers, so every quantity, opening position and floor level can be verified against arithmetic on paper.
// Metres; x east, y up (y = bottom), −z north. Shell walls are RULES.wallThick (0.3 m) thick; floor-to-floor is 3.0 m.
import { fitOpenings, type Part, type Scene } from "./arch-pure.ts";

/** The numbers the house is built from, kept separate so the tests compare against them, not against the scene. */
export const REF = { w: 10, d: 8, slab: 0.2, wallH: 2.8, floorToFloor: 3.0, found: 0.8, roofW: 11, roofD: 9, roofH: 2 } as const;

const o = (id: string, kind: "window" | "door", name: string, host: string, face: Part["face"], off: number, w: number, h: number, sill?: number): Part =>
  ({ id, kind, name, host, face, off, w, h, sill, x: 0, y: 0, z: 0, d: 0.08 });

/** Foundation, two floors (slab + shell walls each), gable roof; one door and three windows of different types. */
export function referenceHouse(): Scene {
  const { w, d, slab, wallH, found } = REF, f2 = REF.floorToFloor;
  return { plot: { w: 30, d: 25, ground: "grass", trees: 0 }, parts: fitOpenings([
    { id: "r-found", kind: "foundation", name: "Strip foundation", x: 0, y: -found, z: 0, w, d, h: found },
    { id: "r-slab1", kind: "slab", name: "Floor 1 slab", x: 0, y: 0, z: 0, w, d, h: slab },
    { id: "r-walls1", kind: "wall", name: "Floor 1 walls", x: 0, y: slab, z: 0, w, d, h: wallH },
    { id: "r-slab2", kind: "slab", name: "Floor 2 slab", x: 0, y: f2, z: 0, w, d, h: slab },
    { id: "r-walls2", kind: "wall", name: "Floor 2 walls", x: 0, y: f2 + slab, z: 0, w, d, h: wallH },
    { id: "r-roof", kind: "roof", name: "Gable roof", x: 0, y: 2 * f2, z: 0, w: REF.roofW, d: REF.roofD, h: REF.roofH },
    o("r-door", "door", "Entrance door 1.0 × 2.1", "r-walls1", "s", 0, 1.0, 2.1),
    o("r-win1", "window", "Living window 1.2 × 1.2, sill 0.9", "r-walls1", "s", 3, 1.2, 1.2, 0.9),
    o("r-win2", "window", "Bedroom window 2.4 × 1.2, sill 0.9", "r-walls2", "n", -2, 2.4, 1.2, 0.9),
    o("r-win3", "window", "Stair slot window 0.6 × 1.6, sill 0.6", "r-walls2", "e", 1, 0.6, 1.6, 0.6),
  ]) };
}
