// ARCH building kit (pure, tested in tests/arch-kit.test.ts): one small furnished house in ARCH's own scene format, plus the
// reusable pieces it is made of. Names read "Subgroup · item"; part.group says structure / interior / exterior.
// Metres; x east, y up (y = bottom), −z north. Interior pieces stand on the slab top (0.2 m), garden pieces on the ground.
import { fitOpenings, isOpening, MAX, OPENING, type Group, type Part, type Scene } from "./arch-pure.ts";

type P = Omit<Part, "id" | "x" | "y" | "z" | "d"> & Partial<Pick<Part, "x" | "y" | "z" | "d">>;
const part = (id: string, group: Group, p: P): Part => ({ x: 0, y: 0, z: 0, d: OPENING.depth, ...p, id, group });
const prop = (id: string, group: Group, name: string, x: number, z: number, w: number, d: number, h: number): Part =>
  part(id, group, { kind: "prop", name, x, y: group === "interior" ? 0.2 : 0, z, w, d, h });

/** Window and door types an opening can be swapped for. Size and sill change; host wall, face and position stay. */
export const OPENING_TYPES: { key: string; kind: "window" | "door"; name: string; w: number; h: number; sill?: number }[] = [
  { key: "W12", kind: "window", name: "W12 window 1.2 × 1.2", w: 1.2, h: 1.2, sill: 0.9 },
  { key: "W24", kind: "window", name: "W24 wide window 2.4 × 1.2", w: 2.4, h: 1.2, sill: 0.9 },
  { key: "W06", kind: "window", name: "W06 slot window 0.6 × 1.6", w: 0.6, h: 1.6, sill: 0.6 },
  { key: "D09", kind: "door", name: "D09 door 0.9 × 2.1", w: 0.9, h: 2.1 },
  { key: "D10", kind: "door", name: "D10 entrance door 1.0 × 2.1", w: 1.0, h: 2.1 },
];
const opening = (id: string, name: string, type: string, host: string, face: Part["face"], off: number): Part => {
  const t = OPENING_TYPES.find((o) => o.key === type)!;
  return part(id, "structure", { kind: t.kind, name: `${name} (${t.key})`, w: t.w, h: t.h, sill: t.sill, host, face, off });
};

/** The kit house: 10 × 8 m single storey, gable roof, living/kitchen west of a partition, bedroom east. 29 parts. */
export function kitHouse(): Scene {
  return { plot: { w: 30, d: 25, ground: "grass", trees: 4 }, parts: fitOpenings([
    part("k-found", "structure", { kind: "foundation", name: "Shell · strip foundation", x: 0, y: -0.8, z: 0, w: 10, d: 8, h: 0.8 }),
    part("k-slab", "structure", { kind: "slab", name: "Shell · ground floor slab", x: 0, y: 0, z: 0, w: 10, d: 8, h: 0.2 }),
    part("k-walls", "structure", { kind: "wall", name: "Shell · outer walls", x: 0, y: 0.2, z: 0, w: 10, d: 8, h: 2.8 }),
    part("k-part", "structure", { kind: "wall", name: "Shell · partition wall", x: 1, y: 0.2, z: 0, w: 0.15, d: 7.4, h: 2.8 }),
    part("k-roof", "structure", { kind: "roof", name: "Shell · gable roof", x: 0, y: 3, z: 0, w: 11, d: 9, h: 2 }),
    opening("k-door", "Openings · front door", "D10", "k-walls", "s", -3.4),
    opening("k-w-liv", "Openings · living window", "W24", "k-walls", "s", -0.8),
    opening("k-w-west", "Openings · west window", "W12", "k-walls", "w", 0),
    opening("k-w-kit", "Openings · kitchen window", "W12", "k-walls", "n", -2.2),
    opening("k-w-bed", "Openings · bedroom window", "W12", "k-walls", "e", 0),
    opening("k-w-bed2", "Openings · bedroom south window", "W12", "k-walls", "s", 3),
    opening("k-d-bed", "Openings · bedroom door", "D09", "k-part", "e", 1.6),
    prop("k-counter", "interior", "Kitchen · counter", -2.6, -3.4, 3, 0.6, 0.9),
    prop("k-fridge", "interior", "Kitchen · fridge", -4.35, -3.4, 0.6, 0.6, 1.8),
    prop("k-table", "interior", "Dining · table", -2.5, -1.5, 1.6, 0.9, 0.75),
    ...[[-3.1, -2.2], [-1.9, -2.2], [-3.1, -0.8], [-1.9, -0.8]].map(([x, z], i) => prop(`k-chair${i + 1}`, "interior", `Dining · chair ${i + 1}`, x, z, 0.45, 0.45, 0.9)),
    prop("k-sofa", "interior", "Living · sofa", -2.5, 2.9, 2.2, 0.9, 0.8),
    prop("k-ctable", "interior", "Living · coffee table", -2.5, 1.8, 1, 0.6, 0.4),
    prop("k-bed", "interior", "Bedroom · double bed", 3, 1.6, 1.6, 2.1, 0.5),
    prop("k-wardrobe", "interior", "Bedroom · wardrobe", 4.35, -2.5, 0.6, 1.6, 2.1),
    prop("k-path", "exterior", "Garden · front path", -3.4, 5.8, 1.2, 3.6, 0.05),
    prop("k-plant1", "exterior", "Garden · planter west", -4.4, 4.5, 0.6, 0.6, 0.5),
    prop("k-plant2", "exterior", "Garden · planter east", -2.2, 4.5, 0.6, 0.6, 0.5),
    prop("k-bench", "exterior", "Garden · bench", 2, 4.6, 1.6, 0.5, 0.45),
    prop("k-mail", "exterior", "Garden · mailbox", -1.9, 7.4, 0.3, 0.3, 1.1),
    prop("k-hedge", "exterior", "Garden · north hedge", 0, -6, 10, 0.6, 1.2),
  ]) };
}

export const groupOf = (p: Part): Group => p.group ?? "structure"; // parts made before the kit (or by the AI) count as structure
export const subgroupOf = (p: Part) => (p.name.includes(" · ") ? p.name.split(" · ")[0] : "Other");

/** Group → subgroup → parts, in scene order: the hierarchy the panel shows. */
export function partTree(parts: Part[]): { group: Group; subs: { name: string; parts: Part[] }[] }[] {
  const out = new Map<Group, Map<string, Part[]>>();
  for (const p of parts) {
    const g = out.get(groupOf(p)) ?? out.set(groupOf(p), new Map()).get(groupOf(p))!;
    (g.get(subgroupOf(p)) ?? g.set(subgroupOf(p), []).get(subgroupOf(p))!).push(p);
  }
  return [...out].map(([group, subs]) => ({ group, subs: [...subs].map(([name, ps]) => ({ name, parts: ps })) }));
}

/** Reusable groups: every subgroup of the kit house that stands on its own (its openings' host walls are inside it). */
export function kitGroups(): { name: string; group: Group; parts: Part[] }[] {
  return partTree(kitHouse().parts).flatMap((g) => g.subs.map((s) => ({ name: s.name, group: g.group, parts: s.parts })))
    .filter((s) => s.parts.every((p) => !isOpening(p.kind) || s.parts.some((q) => q.id === p.host)));
}

/** Copy a group into a scene with fresh ids, its footprint centred on (x, z); hosted openings move to the copied wall. */
export function insertGroup(scene: Scene, parts: Part[], at: { x: number; z: number }, newId: () => string): Scene {
  const solid = parts.filter((p) => !isOpening(p.kind));
  if (!solid.length || scene.parts.length + parts.length > MAX.parts) return scene; // the model's part cap still holds
  const cx = (Math.min(...solid.map((p) => p.x - p.w / 2)) + Math.max(...solid.map((p) => p.x + p.w / 2))) / 2;
  const cz = (Math.min(...solid.map((p) => p.z - p.d / 2)) + Math.max(...solid.map((p) => p.z + p.d / 2))) / 2;
  const ids = new Map(parts.map((p) => [p.id, newId()]));
  const copy = parts.map((p) => ({ ...p, id: ids.get(p.id)!, host: p.host && ids.get(p.host), x: p.x - cx + at.x, z: p.z - cz + at.z }));
  return { ...scene, parts: fitOpenings([...scene.parts, ...copy]) };
}

/** Swap an opening for another type: same id, host wall, face and offset, so the wall's opening (and IFC void) follows. */
export function replaceOpening(scene: Scene, id: string, key: string): Scene {
  const t = OPENING_TYPES.find((o) => o.key === key), o = scene.parts.find((p) => p.id === id);
  if (!t || !o || !isOpening(o.kind) || t.kind !== o.kind) return scene;
  const name = `${o.name.replace(/ \([A-Z]\d+\)$/, "")} (${t.key})`;
  return { ...scene, parts: fitOpenings(scene.parts.map((p) => (p.id === id ? { ...p, name, w: t.w, h: t.h, sill: t.sill } : p))) };
}
