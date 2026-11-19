// Picture → Roblox-ready 3D model with Microsoft TRELLIS.2 (MIT) in its own ComfyUI on this PC (tools/trellis).
// Pure parts: the API-format graph, Roblox limits, reply parsing. Server glue: trellis.ts. Tests: tests/trellis.test.ts.
// TRELLIS.2's CUDA helpers only ship Windows wheels for Python 3.11/3.12, so it can't share tools/comfyui (Python 3.13).
import { serviceUrl } from "./local-ai-pure.ts";

export const TRELLIS_URL = "http://127.0.0.1:8189";
export const TRELLIS_SETUP = "powershell -ExecutionPolicy Bypass -File tools\\trellis\\setup.ps1";
export const trellisNotRunning = () => `TRELLIS.2 isn't installed or couldn't start: run ${TRELLIS_SETUP} once (ORBIT then starts it by itself; log: tools/trellis/service.log). Until then use quality "fast" (TripoSR).`;
/** ORBIT_TRELLIS_URL → origin, or null unless it is plain http on this PC (pictures never leave the PC). */
export const trellisUrl = (raw: string | undefined) => serviceUrl(raw, TRELLIS_URL);

/** Roblox import limits: 20,000 triangles per MeshPart and 1024 px textures (bigger ones are refused or downscaled). */
export const ROBLOX = { maxFaces: 20_000, texture: 1024 } as const;
/** GGUF Q5_K_M + low-VRAM mode for 8 GB cards: measured ~7.5 min per model on the RTX 5060 Laptop (2026-11-19). */
export const MODEL = { name: "TRELLIS.2-4B", format: "GGUF Q5_K_M", license: "MIT (TRELLIS.2) + DINOv3 License (image encoder; commercial use allowed)" } as const;

export type Quality = "fast" | "best";
/** local_3d's quality: "best" = TRELLIS.2 (textured, ~2 min), anything else = TripoSR (seconds, rough). */
export const qualityOf = (raw: unknown): Quality => (String(raw ?? "").trim().toLowerCase() === "best" ? "best" : "fast");

/** Output prefix ComfyUI saves under (output/orbit3d/<job>_00001_.glb). Job ids are ORBIT-made, so plain characters only. */
export const jobPrefix = (job: string) => `orbit3d/${job.replace(/[^\w-]/g, "").slice(0, 40) || "job"}`;
export const outputRef = (job: string) => ({ filename: `${jobPrefix(job).split("/")[1]}_00001_.glb`, subfolder: "orbit3d", type: "output" });

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type WorkflowIn = { image: string; seed: number; job: string };
/** The fixed graph (node pack Aero-Ex/ComfyUI-Trellis2-GGUF, pinned in setup.ps1). Background is cut first; mesh capped for Roblox. */
export function workflow({ image, seed, job }: WorkflowIn): Graph {
  return {
    "1": { class_type: "Trellis2LoadImageWithTransparency_GGUF", inputs: { image } },
    "2": { class_type: "Trellis2PreProcessImage_GGUF", inputs: { image: ["1", 0], padding: 0, remove_background: true } },
    "3": { class_type: "Trellis2LoadModel_GGUF", inputs: { modelname: MODEL.name, model_format: MODEL.format, backend: "sdpa", device: "cuda", low_vram: true, keep_models_loaded: false } },
    "4": { class_type: "Trellis2MeshWithVoxelGenerator_GGUF", inputs: { pipeline: ["3", 0], image: ["2", 0], seed, pipeline_type: "1024_cascade",
      sparse_structure_steps: 12, shape_steps: 12, texture_steps: 12, max_num_tokens: 49152, sparse_structure_resolution: 32, max_views: 4,
      generate_texture_slat: true, use_tiled_decoder: true } },
    "5": { class_type: "Trellis2PostProcessAndUnWrapAndRasterizer_GGUF", inputs: { mesh: ["4", 0], bvh: ["4", 1],
      mesh_cluster_threshold_cone_half_angle_rad: 60, mesh_cluster_refine_iterations: 0, mesh_cluster_global_iterations: 1, mesh_cluster_smooth_strength: 1,
      texture_size: ROBLOX.texture, remesh: true, remesh_band: 1, remesh_project: 0, target_face_num: ROBLOX.maxFaces, simplify_method: "Cumesh",
      fill_holes: true, texture_alpha_mode: "OPAQUE", dual_contouring_resolution: "1024", double_side_material: false, remove_floaters: true,
      bake_on_vertices: false, use_custom_normals: false, uv_unwrap_method: "Xatlas", remove_inner_faces: true } },
    "6": { class_type: "Trellis2ExportMesh_GGUF", inputs: { trimesh: ["5", 0], filename_prefix: jobPrefix(job), file_format: "glb" } },
  };
}

/** POST /prompt reply → prompt id, or ComfyUI's error (missing node pack = setup not finished). */
export function parseQueued(j: unknown): { id: string } | { error: string } {
  const o = (j ?? {}) as { prompt_id?: unknown; error?: { message?: unknown; details?: unknown } | string; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
  if (typeof o.prompt_id === "string" && o.prompt_id && !Object.keys(o.node_errors ?? {}).length) return { id: o.prompt_id };
  const node = Object.values(o.node_errors ?? {}).flatMap((n) => n.errors ?? []).map((e) => [e.message, e.details].filter(Boolean).join(": "))[0];
  const top = typeof o.error === "string" ? o.error : [o.error?.message, o.error?.details].filter((x) => typeof x === "string" && x).join(": ");
  const msg = (node || top || "ComfyUI refused the job").slice(0, 300);
  return { error: /class_type|does not exist|not found|Trellis2/i.test(msg) ? `The TRELLIS.2 nodes aren't loaded (${msg}). Run ${TRELLIS_SETUP} again.` : msg };
}

/** GET /history/<id> → still running, failed or finished (the export node writes the file; it has no image output). */
export function parseRun(j: unknown, id: string): { state: "pending" } | { state: "error"; error: string } | { state: "done" } {
  const h = ((j ?? {}) as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string }][] } }>)[id];
  if (!h) return { state: "pending" };
  if (h.status?.status_str === "error") {
    const ex = h.status.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message ?? "";
    const oom = /out of memory|CUDA|allocat/i.test(ex);
    return { state: "error", error: `TRELLIS.2 failed: ${(ex || "execution error").trim().slice(0, 240)}${oom ? " (the GPU ran out of memory: close games, ComfyUI pictures or other AI tools and try again)" : ""}` };
  }
  return h.status?.completed ? { state: "done" } : { state: "pending" };
}

/** A .glb is a binary glTF: 12-byte header starting with "glTF". Guards against saving an error page into VAULT. */
export const isGlb = (b: Uint8Array) => b.length > 12 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;

/** Roblox look: TRELLIS.2 bakes PBR with metallic ~0.8 / roughness ~0.07 (seen on the RTX 5060 run), which renders like chrome
 * reflecting the sky. Rewrite every material to non-metal, fully rough, keep the colour texture. Only the JSON chunk changes. */
export function robloxMaterials(glb: Uint8Array): Uint8Array {
  if (!isGlb(glb)) return glb;
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) return glb; // first chunk must be JSON
  const j = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as { materials?: { pbrMetallicRoughness?: Record<string, unknown> }[] };
  if (!j.materials?.length) return glb;
  for (const m of j.materials) {
    const p = (m.pbrMetallicRoughness ??= {});
    p.metallicFactor = 0;
    p.roughnessFactor = 1;
    delete p.metallicRoughnessTexture;
  }
  let json = new TextEncoder().encode(JSON.stringify(j));
  const pad = (4 - (json.length % 4)) % 4; // chunks are 4-byte aligned; JSON pads with spaces
  if (pad) { const p = new Uint8Array(json.length + pad).fill(0x20); p.set(json); json = p; }
  const rest = glb.subarray(20 + jsonLen); // BIN chunk (header + data), unchanged
  const out = new Uint8Array(12 + 8 + json.length + rest.length);
  const o = new DataView(out.buffer);
  out.set(glb.subarray(0, 12));
  o.setUint32(8, out.length, true);
  o.setUint32(12, json.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  out.set(rest, 20 + json.length);
  return out;
}

/** Materials of a .glb (for tests and the smoke check). */
export function glbMaterials(glb: Uint8Array): { pbrMetallicRoughness?: Record<string, unknown> }[] {
  const len = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
  return (JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as { materials?: [] }).materials ?? [];
}
