// ARCH scene → glTF 2.0 binary (.glb), pure and tested in tests/arch-gltf.test.ts (read back with three.js's GLTFLoader).
// Opens in Blender, Windows 3D Viewer, three.js editors and game engines. Every part is a flat-shaded box (a gable roof a
// triangular prism, ridge along x as in the 3D view); walls are cut into pieces around their windows and doors so the openings
// are real holes, with a glass pane or a door leaf in them. Units metres, y up, ARCH axes (x east, −z north) kept as they are.
// Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
import { isOpening, type Part, type Scene, type Kind } from "./arch-pure.ts";
import { wallPieces } from "./arch-ifc-pure.ts";

type Box = { x: number; y: number; z: number; w: number; d: number; h: number }; // centre of footprint, y = bottom
type Geo = { pos: number[]; nor: number[]; idx: number[] };
export const GLTF_MATS = {
  wall: { rgb: [0.93, 0.91, 0.87], rough: 0.85 }, slab: { rgb: [0.72, 0.7, 0.67], rough: 0.8 }, foundation: { rgb: [0.55, 0.54, 0.52], rough: 0.9 },
  roof: { rgb: [0.45, 0.25, 0.2], rough: 0.7 }, stair: { rgb: [0.6, 0.45, 0.3], rough: 0.6 }, door: { rgb: [0.42, 0.31, 0.23], rough: 0.6 },
  glass: { rgb: [0.55, 0.72, 0.85], rough: 0.05, alpha: 0.35 },
} as const;
type Mat = keyof typeof GLTF_MATS;
const MAT_OF: Partial<Record<Kind, Mat>> = { wall: "wall", slab: "slab", foundation: "foundation", roof: "roof", stair: "stair", door: "door", window: "glass" };

function quad(g: Geo, a: number[], b: number[], c: number[], d: number[], n: number[]) {
  const i = g.pos.length / 3;
  g.pos.push(...a, ...b, ...c, ...d); for (let k = 0; k < 4; k++) g.nor.push(...n);
  g.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
}
function tri(g: Geo, a: number[], b: number[], c: number[], n: number[]) {
  const i = g.pos.length / 3;
  g.pos.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) g.nor.push(...n);
  g.idx.push(i, i + 1, i + 2);
}
/** Box faces wound counter-clockwise seen from outside (glTF front faces). */
export function boxGeo(g: Geo, b: Box) {
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y, y1 = b.y + b.h, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  quad(g, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  quad(g, [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]);
  quad(g, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
  quad(g, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]);
  quad(g, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad(g, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
}
/** Gable prism: triangle across z (eaves at z0 and z1, ridge at the top centre), extruded along x. */
export function gableGeo(g: Geo, b: Box) {
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y, y1 = b.y + b.h, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, zm = b.z;
  const s = Math.hypot(b.d / 2, b.h) || 1, ny = (b.d / 2) / s, nz = b.h / s;
  tri(g, [x1, y0, z0], [x1, y1, zm], [x1, y0, z1], [1, 0, 0]);
  tri(g, [x0, y0, z1], [x0, y1, zm], [x0, y0, z0], [-1, 0, 0]);
  quad(g, [x1, y0, z0], [x0, y0, z0], [x0, y1, zm], [x1, y1, zm], [0, ny, -nz]);
  quad(g, [x0, y0, z1], [x1, y0, z1], [x1, y1, zm], [x0, y1, zm], [0, ny, nz]);
  quad(g, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]);
}

/** A wall box minus its openings (all on this box): full-height pieces between them, a sill piece under and a lintel piece over. */
export function cutWall(b: Box, ops: Part[]): Box[] {
  const alongX = b.w >= b.d, lo = alongX ? b.x - b.w / 2 : b.z - b.d / 2, hi = alongX ? b.x + b.w / 2 : b.z + b.d / 2, top = b.y + b.h;
  const seg = (a: number, c: number, y0: number, y1: number): Box | null => (c - a > 1e-4 && y1 - y0 > 1e-4
    ? (alongX ? { x: (a + c) / 2, z: b.z, w: c - a, d: b.d, y: y0, h: y1 - y0 } : { x: b.x, z: (a + c) / 2, w: b.w, d: c - a, y: y0, h: y1 - y0 }) : null);
  const out: (Box | null)[] = [], list = ops.map((o) => ({ a: Math.max(lo, (alongX ? o.x : o.z) - o.w / 2), c: Math.min(hi, (alongX ? o.x : o.z) + o.w / 2), y0: Math.max(b.y, o.y), y1: Math.min(top, o.y + o.h) }))
    .filter((o) => o.c > o.a).sort((p, q) => p.a - q.a);
  let cur = lo;
  for (const o of list) {
    out.push(seg(cur, o.a, b.y, top), seg(Math.max(cur, o.a), o.c, b.y, o.y0), seg(Math.max(cur, o.a), o.c, o.y1, top));
    cur = Math.max(cur, o.c);
  }
  out.push(seg(cur, hi, b.y, top));
  return out.filter((x): x is Box => !!x);
}

export type GltfMesh = { name: string; mat: Mat; geo: Geo };
/** The scene as named meshes (one per part; props are left out, as in IFC). */
export function sceneMeshes(scene: Scene): GltfMesh[] {
  const out: GltfMesh[] = [], byId = new Map(scene.parts.map((p) => [p.id, p]));
  for (const p of scene.parts) {
    const mat = MAT_OF[p.kind];
    if (!mat || isOpening(p.kind)) continue;
    const geo: Geo = { pos: [], nor: [], idx: [] };
    if (p.kind === "wall") {
      const ops = scene.parts.filter((o) => isOpening(o.kind) && o.host === p.id);
      for (const piece of wallPieces(p)) cutWall(piece.box, ops.filter((o) => !piece.face || o.face === piece.face)).forEach((b) => boxGeo(geo, b));
    } else if (p.kind === "roof" && p.h >= 0.5) gableGeo(geo, p);
    else boxGeo(geo, p);
    out.push({ name: p.name || p.id, mat, geo });
  }
  for (const o of scene.parts) {
    if (!isOpening(o.kind)) continue;
    const host = o.host ? byId.get(o.host) : undefined;
    if (!host) continue;
    const ns = o.face === "n" || o.face === "s", straight = Math.min(host.w, host.d) <= 0.6;
    // the pane / leaf sits in the middle of the wall's thickness (a shell's face strip is 0.3 m thick at its outer edge)
    const t = o.kind === "window" ? 0.03 : 0.05, inset = straight ? 0 : 0.15 * (o.face === "s" || o.face === "e" ? -1 : 1);
    const geo: Geo = { pos: [], nor: [], idx: [] };
    boxGeo(geo, ns ? { x: o.x, y: o.y, z: (straight ? host.z : o.z) + inset, w: o.w, d: t, h: o.h } : { x: (straight ? host.x : o.x) + inset, y: o.y, z: o.z, w: t, d: o.w, h: o.h });
    out.push({ name: o.name || o.id, mat: o.kind === "window" ? "glass" : "door", geo });
  }
  return out;
}

const pad4 = (n: number) => (4 - (n % 4)) % 4;
/** Scene → .glb bytes. */
export function toGlb(scene: Scene, name = "ARCH model"): Uint8Array {
  const meshes = sceneMeshes(scene), mats = (Object.keys(GLTF_MATS) as Mat[]).filter((k) => meshes.some((m) => m.mat === k)); // only the used ones
  const chunks: Uint8Array[] = [], views: object[] = [], accessors: object[] = [];
  let off = 0;
  const pushView = (bytes: Uint8Array, target: number) => {
    views.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength, target });
    chunks.push(bytes); off += bytes.byteLength;
    const p = pad4(bytes.byteLength); if (p) { chunks.push(new Uint8Array(p)); off += p; }
    return views.length - 1;
  };
  const gMeshes = meshes.map((m) => {
    const n = m.geo.pos.length / 3, pos = new Float32Array(m.geo.pos), nor = new Float32Array(m.geo.nor);
    const big = n > 65535, idx = big ? new Uint32Array(m.geo.idx) : new Uint16Array(m.geo.idx);
    const min = [0, 1, 2].map((k) => Math.min(...m.geo.pos.filter((_, i) => i % 3 === k))), max = [0, 1, 2].map((k) => Math.max(...m.geo.pos.filter((_, i) => i % 3 === k)));
    const pv = pushView(new Uint8Array(pos.buffer), 34962), nv = pushView(new Uint8Array(nor.buffer), 34962), iv = pushView(new Uint8Array(idx.buffer), 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: n, type: "VEC3", min: min.map((v) => Math.fround(v)), max: max.map((v) => Math.fround(v)) },
      { bufferView: nv, componentType: 5126, count: n, type: "VEC3" }, { bufferView: iv, componentType: big ? 5125 : 5123, count: idx.length, type: "SCALAR" });
    const a = accessors.length;
    return { name: m.name, primitives: [{ attributes: { POSITION: a - 3, NORMAL: a - 2 }, indices: a - 1, material: mats.indexOf(m.mat), mode: 4 }] };
  });
  const json = {
    asset: { version: "2.0", generator: "ORBIT ARCH", extras: { units: "metres", axes: "x east, y up, -z north" } },
    scene: 0, scenes: [{ name, nodes: gMeshes.map((_, i) => i) }],
    nodes: gMeshes.map((m, i) => ({ name: m.name, mesh: i })), meshes: gMeshes,
    materials: mats.map((k) => { const m = GLTF_MATS[k] as { rgb: readonly number[]; rough: number; alpha?: number };
      return { name: k, pbrMetallicRoughness: { baseColorFactor: [...m.rgb, m.alpha ?? 1], metallicFactor: 0, roughnessFactor: m.rough }, ...(m.alpha ? { alphaMode: "BLEND", doubleSided: true } : {}) }; }),
    accessors, bufferViews: views, buffers: [{ byteLength: off }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json)), jp = pad4(jsonBytes.byteLength);
  const total = 12 + 8 + jsonBytes.byteLength + jp + 8 + off, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength + jp, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonBytes.byteLength + jp);
  let p = 20 + jsonBytes.byteLength + jp;
  dv.setUint32(p, off, true); dv.setUint32(p + 4, 0x004e4942, true); p += 8;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}
