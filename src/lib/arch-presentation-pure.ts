import { blenderScript, flyPath, type Opts } from "./arch-blender-pure.ts";
import type { Scene } from "./arch-pure.ts";

export const presentationModes = ["finished", "wireframe", "exploded"] as const;
export type PresentationMode = typeof presentationModes[number];

export function archPresentation(scene: Scene, options: Opts, frames: number, mode: PresentationMode) {
  const poses = flyPath(scene, frames).map(({ cam, look }) => [cam, look]);
  if (poses.length < 2 || poses.some((pose) => pose.flat().some((value) => !Number.isFinite(value)))) {
    throw new Error("The presentation needs at least two finite camera poses and a wall or slab.");
  }
  const offsets = Object.fromEntries(scene.parts.filter(({ kind }) => kind === "wall" || kind === "slab" || kind === "roof")
    .map(({ id, kind, x, z }) => [id, kind === "roof" ? [0, 0, 2] : kind === "slab" ? [0, 0, -0.3] : [x * 0.22, -z * 0.22, 0]]));
  const base = blenderScript(scene, options).replace("S.render.filepath = out; bpy.ops.render.render(write_still=True)\n", "");
  const variant = mode === "wireframe" ? [
    "for part in obj.values():",
    "    wire = part.modifiers.new('Presentation wireframe', 'WIREFRAME')",
    "    wire.thickness = 0.025",
  ] : mode === "exploded" ? [
    "depsgraph = bpy.context.evaluated_depsgraph_get()",
    `for key, offset in ${JSON.stringify(offsets)}.items():`,
    "    part = obj[key]",
    "    part.data = bpy.data.meshes.new_from_object(part.evaluated_get(depsgraph))",
    "    part.modifiers.clear()",
    "    part.location += Vector(offset)",
  ] : [];
  return base + [
    "import os",
    "os.makedirs(out, exist_ok=True)",
    "c.data.shift_y = 0; c.data.lens = 28",
    ...variant,
    `poses = ${JSON.stringify(poses)}`,
    "for index, (cam, look) in enumerate(poses, 1):",
    "    c.location = cam",
    "    c.rotation_euler = (Vector(look) - Vector(cam)).to_track_quat('-Z', 'Y').to_euler()",
    "    S.render.image_settings.file_format = 'PNG'",
    "    S.render.filepath = os.path.join(out, 'f%03d.png' % index)",
    "    if not os.path.exists(S.render.filepath) or os.path.getsize(S.render.filepath) == 0:",
    "        bpy.ops.render.render(write_still=True)",
  ].join("\n") + "\n";
}
