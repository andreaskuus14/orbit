import { blenderSequence, flyPath, type Opts } from "./arch-blender-pure.ts";
import type { Scene } from "./arch-pure.ts";

export const presentationModes = ["finished", "wireframe", "exploded"] as const;
export type PresentationMode = typeof presentationModes[number];

// Exploded view, metres: each part moves from its own base. Walls drift away from the building centre, every layer lifts (the slab only
// ever goes up, so it never sinks below the ground box), and an opening's glass or door leaf moves exactly with its host wall.
const LIFT = { slab: 0.3, wall: 1, roof: 2.2 };
const explode = (scene: Scene) => {
  const parts = Object.fromEntries(scene.parts.flatMap((p) => p.kind === "slab" || p.kind === "wall" || p.kind === "roof" ? [[p.id, [p.kind, ""]]]
    : (p.kind === "window" || p.kind === "door") && p.host ? [[p.id, ["opening", p.host]]] : []));
  return [
    "depsgraph = bpy.context.evaluated_depsgraph_get()",
    `PARTS = ${JSON.stringify(parts)}; LIFT = ${JSON.stringify(LIFT)}`,
    "def mid(o): return sum((o.matrix_world @ Vector(c) for c in o.bound_box), Vector()) / 8  # the box() helper bakes location into the mesh, so measure the geometry",
    "shell = [mid(obj[k]) for k, (kind, host) in PARTS.items() if k in obj and kind in ('wall', 'slab')]",
    "centre = sum(shell, Vector()) / max(1, len(shell))",
    "move = {}",
    "for k, (kind, host) in PARTS.items():",
    "    if k not in obj or kind == 'opening': continue",
    "    d = mid(obj[k]) - centre; d.z = 0",
    "    move[k] = d * 0.22 + Vector((0, 0, LIFT[kind]))",
    "for k, (kind, host) in PARTS.items():",
    "    if k not in obj: continue",
    "    part = obj[k]",
    "    part.data = bpy.data.meshes.new_from_object(part.evaluated_get(depsgraph))  # bake the window and door cut-outs before the cutters stop mattering",
    "    part.modifiers.clear()",
    "    part.location = part.location + move.get(host if kind == 'opening' else k, Vector())",
  ];
};
const wireframe = [
  "for part in obj.values():",
  "    wire = part.modifiers.new('Presentation wireframe', 'WIREFRAME')",
  "    wire.thickness = 0.025",
];

/** One Blender script per mode, all on the same camera path. The roof stays in place for the whole path (the film's lift-away is off). */
export function archPresentation(scene: Scene, options: Opts, frames: number, mode: PresentationMode) {
  const path = flyPath(scene, frames);
  if (path.length < 2 || path.some(({ cam, look }) => [...cam, ...look].some((value) => !Number.isFinite(value)))) {
    throw new Error("The presentation needs at least two finite camera poses and a wall or slab.");
  }
  return blenderSequence(scene, options, path, mode === "wireframe" ? wireframe : mode === "exploded" ? explode(scene) : [], true);
}
