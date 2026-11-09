// ARCH → Blender (free, local): turns an ARCH scene into a Blender Python script that builds the model and renders it with Cycles.
// What an architectural visualiser does by default: a real sun from the site and date (sun-pure), a level camera with lens shift so
// verticals stay straight (two-point perspective), small edge bevels so corners catch light, physically based materials, AgX view
// transform, denoised "detail" renders. Scene: metres, y up, north = −Z; Blender: z up, north = +Y. Pure; tests/arch-blender.test.ts.
// Run: blender -b -P scene.py -- out.png  (the script reads its output path after "--").
import type { Part, Scene } from "./arch-pure.ts";
import { sunPosition } from "./sun-pure.ts";

export type Quality = "preview" | "detail";
export type Opts = { site: { lat: number; lon: number }; date: Date; quality: Quality; size?: [number, number] };
type V3 = [number, number, number];

/** Base colour (linear-ish sRGB), roughness and an optional transmission per part kind / ground. */
const MAT: Record<string, { rgb: V3; rough: number; glass?: true }> = {
  foundation: { rgb: [0.42, 0.41, 0.39], rough: 0.85 }, slab: { rgb: [0.62, 0.46, 0.3], rough: 0.42 }, wall: { rgb: [0.86, 0.84, 0.8], rough: 0.75 }, // slab: light oak floor
  roof: { rgb: [0.16, 0.16, 0.17], rough: 0.5 }, window: { rgb: [0.9, 0.95, 1], rough: 0.02, glass: true }, door: { rgb: [0.36, 0.24, 0.15], rough: 0.55 },
  stair: { rgb: [0.5, 0.49, 0.47], rough: 0.8 }, prop: { rgb: [0.45, 0.32, 0.2], rough: 0.6 }, tree: { rgb: [0.07, 0.16, 0.06], rough: 0.9 }, trunk: { rgb: [0.25, 0.17, 0.11], rough: 0.9 },
  grass: { rgb: [0.11, 0.2, 0.06], rough: 0.95 }, gravel: { rgb: [0.45, 0.43, 0.4], rough: 1 }, forest: { rgb: [0.1, 0.18, 0.07], rough: 1 }, sand: { rgb: [0.7, 0.62, 0.45], rough: 1 },
};
/** Props get believable, varied finishes picked from their name (stable per name). */
const PROP_FINISH: { re: RegExp; rgb: V3; rough: number }[] = [
  { re: /sofa|chair|armchair|bed/i, rgb: [0.58, 0.55, 0.5], rough: 0.95 },  // linen / boucle
  { re: /table|desk|shelf|bench/i, rgb: [0.3, 0.19, 0.12], rough: 0.5 },    // walnut
  { re: /kitchen|counter|island/i, rgb: [0.9, 0.89, 0.86], rough: 0.25 },   // matte lacquer
  { re: /rug|carpet/i, rgb: [0.72, 0.66, 0.56], rough: 1 },                 // wool
];
export const propFinish = (name: string) => PROP_FINISH.find((f) => f.re.test(name)) ?? { rgb: MAT.prop.rgb, rough: MAT.prop.rough };

export const QUALITY: Record<Quality, { samples: number; bevel: number; denoise: boolean; bounces: number }> = {
  preview: { samples: 32, bevel: 0, denoise: false, bounces: 4 },
  detail: { samples: 1024, bevel: 0.01, denoise: true, bounces: 12 },
};

/** Scene metres (x, y up, z south) → Blender (x, y north, z up). */
export const toBlender = (x: number, y: number, z: number): V3 => [x, -z, y];
/** Box of a part in Blender space: centre and full size. Openings get the host wall's thickness (+2 cm so the cut is clean). */
export function partBox(p: Part, host?: Part): { c: V3; s: V3 } {
  if ((p.kind === "window" || p.kind === "door") && host) {
    const ns = p.face === "n" || p.face === "s", t = (ns ? host.d : host.w) + 0.02;
    const [sx, sz] = ns ? [p.w, t] : [t, p.w];
    // centred on the wall's thickness (p.x/p.z sit on the wall's outer face), so the cut goes all the way through
    return { c: toBlender(ns ? p.x : host.x, p.y + p.h / 2, ns ? host.z : p.z), s: [sx, sz, p.h] };
  }
  return { c: toBlender(p.x, p.y + p.h / 2, p.z), s: [p.w, p.d, p.h] };
}
/** Unit vector toward the sun in Blender space (azimuth clockwise from north). */
export function sunVector(az: number, el: number): V3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}
/** Eye-level camera on the south-east diagonal, looking level at the model; lens shift frames its height (straight verticals). */
export function camera(scene: Scene): { loc: V3; yawDeg: number; lens: number; shiftY: number } {
  const xs = scene.parts.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]), zs = scene.parts.flatMap((p) => [p.z - p.d / 2, p.z + p.d / 2]);
  const top = Math.max(3, ...scene.parts.map((p) => p.y + p.h));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2 || 0, cz = (Math.min(...zs) + Math.max(...zs)) / 2 || 0;
  const span = Math.max(6, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), top);
  const dist = span * 1.9, eye = 1.6, lens = 35, sensor = 36;
  const [bx, by] = toBlender(cx + dist * 0.7071, 0, cz + dist * 0.7071);
  const [tx, ty] = toBlender(cx, 0, cz);
  const yawDeg = (Math.atan2(ty - by, tx - bx) * 180) / Math.PI - 90; // Blender camera looks down its −Z; yaw about world Z
  // shift so the frame's vertical centre sits at half the building height, as a fraction of the sensor width
  const shiftY = Math.max(-0.5, Math.min(0.5, ((top / 2 - eye) / dist) * (lens / sensor)));
  return { loc: [bx, by, eye], yawDeg, lens, shiftY };
}

const f = (n: number) => (Math.round(n * 1e4) / 1e4).toString();
const v = (a: readonly number[]) => `(${a.map(f).join(", ")})`;

export function blenderScript(scene: Scene, o: Opts): string {
  const q = QUALITY[o.quality], [W, H] = o.size ?? (o.quality === "detail" ? [2400, 1600] : [960, 640]);
  const sun = sunPosition(o.site.lat, o.site.lon, o.date), up = sun.elevationDeg > 0;
  const byId = new Map(scene.parts.map((p) => [p.id, p])), cam = camera(scene);
  const solids = scene.parts.filter((p) => p.kind !== "window" && p.kind !== "door");
  const openings = scene.parts.filter((p) => (p.kind === "window" || p.kind === "door") && p.host && byId.get(p.host));
  const L: string[] = [
    "import bpy, sys, math",
    "from mathutils import Vector",
    "out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp/arch.png'",
    "bpy.ops.wm.read_factory_settings(use_empty=True)",
    "S = bpy.context.scene",
    "def mat(name, rgb, rough, glass=False):",
    "    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes = True",
    "    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough",
    "    if glass: b.inputs['Transmission Weight'].default_value = 1.0; b.inputs['IOR'].default_value = 1.45",
    "    return m",
    "def box(name, c, s, m, bevel):",
    "    bpy.ops.mesh.primitive_cube_add(size=1, location=c); o = bpy.context.object; o.name = name; o.scale = s",
    "    bpy.ops.object.transform_apply(scale=True); o.data.materials.append(m)",
    "    if bevel > 0: b = o.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = 2; b.limit_method = 'ANGLE'",
    "    return o",
    `g = box('ground', (0, 0, -0.05), ${v([scene.plot.w * 3, scene.plot.d * 3, 0.1])}, mat('${scene.plot.ground}', ${v(MAT[scene.plot.ground].rgb)}, ${MAT[scene.plot.ground].rough}), 0)`,
    "obj = {}",
  ];
  for (const p of solids) {
    const b = partBox(p), m = p.kind === "prop" ? propFinish(p.name) : MAT[p.kind], key = p.kind === "prop" ? `prop-${m.rgb.join("-")}` : p.kind;
    // props get a soft 2 cm round-over even in previews (furniture reads as boxes otherwise)
    L.push(`obj[${JSON.stringify(p.id)}] = box(${JSON.stringify(p.name)}, ${v(b.c)}, ${v(b.s)}, mat('${key}', ${v(m.rgb)}, ${m.rough}), ${f(p.kind === "prop" ? Math.max(q.bevel, 0.02) : q.bevel)})`);
  }
  // trees: the plot's count, placed on a deterministic ring outside the building (cone crown on a trunk)
  for (let i = 0, k = 0; k < Math.min(scene.plot.trees, 40) && i < 200; i++) {
    const a = i * 2.39996, rr = Math.max(scene.plot.w, scene.plot.d) * (0.45 + ((i * 37) % 17) / 50), h = 5 + ((i * 53) % 7) * 0.6;
    if (Math.cos(a) > -0.2 && Math.sin(a) > -0.2) continue; // keep the south-east open: that's where the camera approaches from
    k++;
    const [tx, ty] = toBlender(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    L.push(`box('trunk-${i}', ${v([tx, ty, 0.9])}, (0.25, 0.25, 1.8), mat('trunk', ${v(MAT.trunk.rgb)}, ${MAT.trunk.rough}), 0)`,
      `bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=${f(h * 0.22)}, depth=${f(h)}, location=${v([tx, ty, 1.2 + h / 2])}); bpy.context.object.data.materials.append(mat('tree', ${v(MAT.tree.rgb)}, ${MAT.tree.rough}))`);
  }
  for (const p of openings) {
    const host = byId.get(p.host!)!, b = partBox(p, host), m = MAT[p.kind];
    // cut the opening out of its wall, then fill it: a thin glass pane for windows, a door leaf for doors (centred in the wall)
    L.push(`cut = box('cut-${p.id}', ${v(b.c)}, ${v(b.s)}, mat('cut', (0,0,0), 1), 0); cut.display_type = 'WIRE'; cut.hide_render = True`);
    L.push(`bo = obj[${JSON.stringify(host.id)}].modifiers.new('cut-${p.id}', 'BOOLEAN'); bo.operation = 'DIFFERENCE'; bo.object = cut`);
    const pane: V3 = [b.s[0], b.s[1], b.s[2]], thin = p.kind === "window" ? 0.02 : 0.05;
    if (p.face === "n" || p.face === "s") pane[1] = thin; else pane[0] = thin;
    L.push(`box(${JSON.stringify(p.name)}, ${v(b.c)}, ${v(pane)}, mat('${p.kind}', ${v(m.rgb)}, ${m.rough}, ${m.glass ? "True" : "False"}), 0)`);
  }
  const d = sunVector(sun.azimuthDeg, Math.max(sun.elevationDeg, 2));
  L.push(
    `sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); S.collection.objects.link(sun)`,
    `sun.data.energy = ${up ? 4 : 0.3}; sun.data.angle = math.radians(0.53)  # the real sun's disc: soft-edged, not razor shadows`,
    `sun.rotation_euler = Vector(${v(d)}).to_track_quat('Z', 'Y').to_euler()`,
    "w = bpy.data.worlds.new('sky'); S.world = w; w.use_nodes = True; nt = w.node_tree",
    "sky = nt.nodes.new('ShaderNodeTexSky')",
    "try: sky.sky_type = 'MULTIPLE_SCATTERING'  # Blender 5 name",
    "except TypeError: sky.sky_type = 'NISHITA'  # Blender 3.x–4.x",
    `sky.sun_elevation = math.radians(${f(sun.elevationDeg)}); sky.sun_rotation = math.radians(${f(sun.azimuthDeg)}); sky.sun_disc = False`,
    "nt.links.new(sky.outputs['Color'], nt.nodes['Background'].inputs['Color']); nt.nodes['Background'].inputs['Strength'].default_value = 0.35",
    `cd = bpy.data.cameras.new('cam'); cd.lens = ${cam.lens}; cd.sensor_width = 36; cd.shift_y = ${f(cam.shiftY)}`,
    `c = bpy.data.objects.new('cam', cd); S.collection.objects.link(c); S.camera = c`,
    `c.location = ${v(cam.loc)}; c.rotation_euler = (math.radians(90), 0, math.radians(${f(cam.yawDeg)}))  # level: verticals stay vertical`,
    "S.render.engine = 'CYCLES'",
    "try:  # use the GPU when there is one (his PC); the cloud has none and renders on the CPU",
    "    cp = bpy.context.preferences.addons['cycles'].preferences; cp.get_devices()",
    "    for t in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):",
    "        try: cp.compute_device_type = t; cp.get_devices()",
    "        except Exception: continue",
    "        gpus = [d for d in cp.devices if d.type != 'CPU']",
    "        if gpus:",
    "            for d in gpus: d.use = True",
    "            S.cycles.device = 'GPU'; break",
    "except Exception: pass",
    `S.cycles.samples = ${q.samples}; S.cycles.use_denoising = ${q.denoise ? "True" : "False"}; S.cycles.max_bounces = ${q.bounces}`,
    `S.render.resolution_x = ${W}; S.render.resolution_y = ${H}; S.render.resolution_percentage = 100`,
    "S.view_settings.view_transform = 'AgX'; S.view_settings.look = 'AgX - Medium High Contrast'; S.view_settings.exposure = -0.8",
    "S.render.filepath = out; bpy.ops.render.render(write_still=True)",
  );
  return L.join("\n") + "\n";
}

// ---- Fly-through: a camera move rendered as a numbered frame sequence, for scroll-scrubbed web pages (W02 "sequence" section).
// Three beats, the way an architectural film is cut: approach the building at eye level → rise over it while the roof lifts away to an
// isometric plan → descend into a room and settle at standing eye height facing the windows.
export type Pose = { cam: V3; look: V3; roof: boolean; lift: number }; // lift: metres the roof has risen (it floats away, then hides)
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** n camera poses (Blender space). `room` = a point inside the model (scene metres) the last beat ends in; defaults to the centre. */
export function flyPath(scene: Scene, n: number, room?: { x: number; z: number }): Pose[] {
  const walls = scene.parts.filter((p) => p.kind === "wall" || p.kind === "slab");
  const xs = walls.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]), zs = walls.flatMap((p) => [p.z - p.d / 2, p.z + p.d / 2]);
  const top = Math.max(3, ...scene.parts.filter((p) => p.kind !== "roof").map((p) => p.y + p.h));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(8, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const c = toBlender(cx, top / 2, cz), r = room ? toBlender(room.x, 1.5, room.z) : toBlender(cx, 1.5, cz);
  const keys: { t: number; cam: V3; look: V3 }[] = [
    { t: 0, cam: toBlender(cx + span * 1.7, 1.6, cz + span * 1.9), look: c },                // far, eye level, south-east
    { t: 0.3, cam: toBlender(cx + span * 0.9, 3.5, cz + span * 1.0), look: c },              // closer, slightly raised
    { t: 0.6, cam: toBlender(cx + span * 0.35, top + span * 1.25, cz + span * 0.45), look: toBlender(cx, 0, cz) }, // over it: isometric plan
    { t: 0.82, cam: toBlender(r[0] + 0.3, 4.5, -r[1] - 2.4), look: toBlender(r[0], 0.8, -r[1] + 3) },             // dropping in from the north side
    { t: 1, cam: [r[0], r[1] + 2.2, 1.55], look: [r[0], r[1] - 4, 1.35] },                   // in the room, standing, facing south glazing
  ];
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1), k = Math.max(1, keys.findIndex((x) => x.t >= t)), a = keys[k - 1], b = keys[k];
    const u = ease((t - a.t) / (b.t - a.t || 1));
    const lift = t < 0.32 ? 0 : t < 0.5 ? ease((t - 0.32) / 0.18) * 14 : 14;
    return { cam: mix(a.cam, b.cam, u), look: mix(a.look, b.look, u), roof: t < 0.5, lift };
  });
}
/** A Blender script that builds the scene (blenderScript) and renders each pose to <out>/f001.png …; roof hidden where !roof. */
export function blenderSequence(scene: Scene, o: Opts, poses: Pose[]): string {
  const base = blenderScript(scene, o).replace("S.render.filepath = out; bpy.ops.render.render(write_still=True)\n", "");
  const roofs = scene.parts.filter((p) => p.kind === "roof").map((p) => JSON.stringify(p.id));
  return base + [
    "import os; os.makedirs(out, exist_ok=True)",
    "c.data.shift_y = 0; c.data.lens = 28",
    `P = ${JSON.stringify(poses.map((p) => [p.cam.map((x) => +x.toFixed(3)), p.look.map((x) => +x.toFixed(3)), p.roof ? 1 : 0, +p.lift.toFixed(3)]))}`, // 1/0: valid Python
    `roofs = [obj[k] for k in [${roofs.join(", ")}] if k in obj]`,
    "base = {r.name: r.location.z for r in roofs}",
    "for i, (cam, look, roof, lift) in enumerate(P):",
    "    c.location = cam",
    "    c.rotation_euler = (Vector(look) - Vector(cam)).to_track_quat('-Z', 'Y').to_euler()",
    "    for r in roofs: r.hide_render = not roof; r.location.z = base[r.name] + lift",
    "    S.render.filepath = os.path.join(out, 'f%03d.png' % (i + 1)); bpy.ops.render.render(write_still=True)",
  ].join("\n") + "\n";
}
