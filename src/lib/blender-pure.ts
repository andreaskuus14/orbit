// GAME DEV "Make in Blender" and ARCH "Open in Blender/Bonsai": the CORE requests behind those buttons (BlenderEntry.tsx).
// They only start a CORE turn: every Blender call still goes through decide() and the plugin's trust settings (plugins-pure.ts),
// and execute_blender_code waits for his Run click unless he set it to auto. Tested in tests/plugins.test.ts.

/** File-safe model name: letters, digits, - and _ (Blender object name and export file name). */
export const modelName = (s: string) => s.normalize("NFKD").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "model";

/** Windows/Unix path as a Python raw-string literal body: no quotes or newlines (and no trailing backslash, which ends r"" badly). */
export const safePath = (p: string) => (/^[^"\r\n\0]{1,260}$/.test(p.trim()) ? p.trim().replace(/[\\/]+$/, "") : "");

export function makeInBlenderPrompt(description: string, name: string, vault: string): string {
  const n = modelName(name), dir = safePath(vault);
  return [
    `Make in Blender: ${description.trim().slice(0, 1500)}`,
    `Use the blender plugin. First plugin__blender__get_scene_info. Then write ONE complete Python script for plugin__blender__execute_blender_code that:`,
    `- builds the model with bpy/bmesh (primitives, modifiers, simple Principled materials with base colours), game-ready and low-poly (under ~10k triangles), real-world scale in metres (1 Roblox stud = 0.28 m), resting on the ground at the origin;`,
    `- applies all modifiers, joins it into one object named "${n}" and selects only that;`,
    dir ? `- exports the selection to r"${dir}\\${n}.fbx" (bpy.ops.export_scene.fbx, use_selection=True, apply_scale_options='FBX_SCALE_UNITS') and r"${dir}\\${n}.glb" (bpy.ops.export_scene.gltf, export_format='GLB', use_selection=True), and prints both paths.` : `- does not export (no folder known); tell me to export from File → Export.`,
    `The code call is queued for my Run click in Profile → Plugins: say so plainly. After I say it ran, check it with plugin__blender__get_viewport_screenshot and get_object_info, and fix anything wrong with one more script.`,
    `End with how to bring it into Roblox: Studio → Home → Import 3D → pick ${n}.fbx (or .glb) from VAULT → check scale and anchoring in the preview → Import; it lands in Workspace as a MeshPart/Model.`,
  ].join("\n");
}

export type IfcAction = "inspect" | "glb";
export function openIfcPrompt(file: string, action: IfcAction, vault: string): string {
  const f = safePath(file), dir = safePath(vault);
  if (!f || !/\.ifc$/i.test(f)) return "";
  const stem = modelName(f.split(/[\\/]/).pop()!.replace(/\.ifc$/i, ""));
  return [
    `Open the IFC model r"${f}" in Blender with Bonsai (BIM add-on) through the blender plugin.`,
    `Use plugin__blender__execute_blender_code with one script: bpy.ops.bim.load_project(filepath=r"${f}"), then with ifcopenshell (bonsai.tool.Ifc.get()) print the schema, storeys with elevations, element counts by IFC class, spaces with names and areas where known, and materials.`,
    action === "glb" && dir ? `Then in the same script select all objects with geometry and export them to r"${dir}\\${stem}.glb" (bpy.ops.export_scene.gltf, export_format='GLB', use_selection=True) and print the path.` : `Don't change or save the IFC file.`,
    `The code call is queued for my Run click in Profile → Plugins: say so, and that the printed summary shows there under Last result. If I paste it back, or once the code tool is on auto and you see the output yourself, explain it for an architecture student: what the model contains and anything that looks wrong (missing names, spaces without areas, empty storeys).`,
  ].join("\n");
}
