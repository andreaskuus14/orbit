// Picture → Roblox-ready 3D model with Microsoft TRELLIS.2 (MIT) through ComfyUI's native nodes, in its own ComfyUI on this PC (tools/trellis).
// Pure parts: the API-format graph, Roblox limits, reply parsing. Server glue: trellis.ts. Tests: tests/trellis.test.ts.
// Own ComfyUI so its pinned version and --lowvram start don't depend on tools/comfyui's portable build.
import { serviceUrl } from "./local-ai-pure.ts";

export const TRELLIS_URL = "http://127.0.0.1:8189";
export const TRELLIS_SETUP = "powershell -ExecutionPolicy Bypass -File tools\\trellis\\setup.ps1";
export const trellisNotRunning = () => `TRELLIS.2 isn't installed or couldn't start: run ${TRELLIS_SETUP} once (ORBIT then starts it by itself; log: tools/trellis/service.log). Until then use quality "fast" (TripoSR).`;
/** ORBIT_TRELLIS_URL → origin, or null unless it is plain http on this PC (pictures never leave the PC). */
export const trellisUrl = (raw: string | undefined) => serviceUrl(raw, TRELLIS_URL);

/** Roblox import limits: 20,000 triangles per MeshPart and 1024 px textures (bigger ones are refused or downscaled). */
export const ROBLOX = { maxFaces: 20_000, texture: 1024 } as const;
/** What we ask the simplifier for: it overshoots a little (20,017 for a 20,000 target on the flower-pot run), so keep a 5% margin. */
export const TARGET_FACES = 19_000;
/** ComfyUI's native TRELLIS.2 (core nodes since v0.34.0; pure PyTorch/SciPy, no nvdiffrast) with Comfy-Org's int8 weights.
 * Not yet measured on the RTX 5060 Laptop: the old GGUF pack took ~7.5 min per model. */
export const MODEL = { name: "TRELLIS.2-4B", format: "int8 (Comfy-Org)", license: "MIT (TRELLIS.2) + DINOv3 License (image encoder; commercial use allowed)" } as const;
/** Model files setup.ps1 downloads into tools/trellis/ComfyUI/models (pinned + SHA-256 checked there). */
export const FILES = {
  unet: "trellis_2_int8_convrot.safetensors", shapeVae: "trellis_2_shape_vae_bf16.safetensors", textureVae: "trellis_2_texture_vae_bf16.safetensors",
  dino: "dino_v3_vit_l.safetensors", bgModel: "birefnet.safetensors",
} as const;
/** Remesh grid before decimating: 384³ (~250k faces) instead of the template's 768 so the field fits next to an 8 GB card. */
export const REMESH_RESOLUTION = 384;

export type Quality = "fast" | "best";
/** local_3d's quality: "best" = TRELLIS.2 (textured, ~2 min), anything else = TripoSR (seconds, rough). */
export const qualityOf = (raw: unknown): Quality => (String(raw ?? "").trim().toLowerCase() === "best" ? "best" : "fast");

/** Output prefix ComfyUI saves under (output/orbit3d/<job>_00001_.glb). Job ids are ORBIT-made, so plain characters only. */
export const jobPrefix = (job: string) => `orbit3d/${job.replace(/[^\w-]/g, "").slice(0, 40) || "job"}`;
export const outputRef = (job: string) => ({ filename: `${jobPrefix(job).split("/")[1]}_00001_.glb`, subfolder: "orbit3d", type: "output" });

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type WorkflowIn = { image: string; seed: number; job: string };
/** The fixed API graph, following ComfyUI's own template 3d_pixal3d_trellis2_image_to_model (TRELLIS.2 branch) with Roblox
 * limits: background cut (BiRefNet) → DINOv3 conditioning → structure → shape 512 → shape 1024 → texture → remesh →
 * decimate to TARGET_FACES → UV unwrap → bake the colour into a 1024 px texture → .glb under orbit3d/. */
export function workflow({ image, seed, job }: WorkflowIn): Graph {
  const ks = (model: string, cond: string, latent: [string, number], steps: number, cfg: number, scheduler = "normal") => ({
    class_type: "KSampler", inputs: { model: [model, 0], positive: [cond, 0], negative: [cond, 1], latent_image: latent, seed, steps, cfg, sampler_name: "euler", scheduler, denoise: 1 } });
  return {
    // picture + background cut
    "1": { class_type: "LoadImage", inputs: { image } },
    "2": { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: FILES.bgModel } },
    "3": { class_type: "RemoveBackground", inputs: { bg_removal_model: ["2", 0], image: ["1", 0] } },
    "4": { class_type: "ImageCropToMask", inputs: { images: ["1", 0], masks: ["3", 0], width: 1024, height: 1024, pad_factor: 1.0, grow_mask: 0, background: "#000000" } },
    "5": { class_type: "CLIPVisionLoader", inputs: { clip_name: FILES.dino } },
    "6": { class_type: "Trellis2Conditioning", inputs: { clip_vision_model: ["5", 0], image: ["4", 0] } },
    // models; the CFG patches match the original TRELLIS.2 pipeline (as in ComfyUI's template)
    "10": { class_type: "UNETLoader", inputs: { unet_name: FILES.unet, weight_dtype: "default" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: FILES.shapeVae } },
    "12": { class_type: "VAELoader", inputs: { vae_name: FILES.textureVae } },
    "13": { class_type: "CFGOverride", inputs: { model: ["10", 0], cfg: 1, start_percent: 0.667, end_percent: 1 } },
    "14": { class_type: "RescaleCFG", inputs: { model: ["13", 0], multiplier: 0.7 } },
    "15": { class_type: "ModelSamplingSD3", inputs: { model: ["14", 0], shift: 5 } },
    "16": { class_type: "CFGOverride", inputs: { model: ["10", 0], cfg: 1, start_percent: 0.769, end_percent: 1 } },
    "17": { class_type: "RescaleCFG", inputs: { model: ["16", 0], multiplier: 0.5 } },
    // sparse structure
    "20": { class_type: "EmptyTrellis2LatentStructure", inputs: { batch_size: 1 } },
    "21": ks("15", "6", ["20", 0], 12, 7.5),
    "22": { class_type: "VaeDecodeStructureTrellis2", inputs: { samples: ["21", 0], vae: ["11", 0], resolution: "32" } },
    // shape 512 → 1024 (the minimum; the template's 1536 needs more VRAM)
    "23": { class_type: "Trellis2ShapeStage", inputs: { positive: ["6", 0], negative: ["6", 1], voxel: ["22", 0] } },
    "24": ks("17", "23", ["23", 2], 20, 7.5),
    "25": { class_type: "Trellis2UpsampleStage", inputs: { positive: ["23", 0], negative: ["23", 1], shape_latent: ["24", 0], vae: ["11", 0], target_resolution: 1024 } },
    "26": ks("17", "25", ["25", 2], 12, 7.5, "simple"),
    "27": { class_type: "VaeDecodeShapeTrellis", inputs: { samples: ["26", 0], vae: ["11", 0] } },
    // texture
    "28": { class_type: "Trellis2TextureStage", inputs: { positive: ["25", 0], negative: ["25", 1], shape_latent: ["26", 0] } },
    "29": ks("10", "28", ["28", 2], 12, 1),
    "30": { class_type: "VaeDecodeTextureTrellis", inputs: { samples: ["29", 0], vae: ["12", 0], shape_subdivides: ["27", 1] } },
    // Roblox-sized mesh: watertight remesh, decimate under the triangle cap, unwrap, bake colour, export
    "40": { class_type: "RemeshMesh", inputs: { mesh: ["27", 0], resolution: REMESH_RESOLUTION, sign_mode: "solid", "sign_mode.fill": 20, "sign_mode.qef": false,
      band: 1, project_back: 0, fix_poles: false, smooth_iters: 20, drop_small_components: 0.01, precluster_max_verts: 20_000_000 } },
    "41": { class_type: "DecimateMesh", inputs: { mesh: ["40", 0], target_face_count: TARGET_FACES, placement_mode: "midpoint" } },
    "42": { class_type: "UnwrapMesh", inputs: { mesh: ["41", 0], segmenter: "pec", resolution: ROBLOX.texture, padding: 2, weld_distance: 0.0002 } },
    "43": { class_type: "BakeTextureFromVoxel", inputs: { mesh: ["42", 0], voxel_colors: ["30", 0], texture_size: ROBLOX.texture, reference_mesh: ["27", 0] } },
    "44": { class_type: "ApplyTextureToMesh", inputs: { mesh: ["42", 0], base_color: ["43", 0] } },
    "45": { class_type: "MeshSmoothNormals", inputs: { mesh: ["44", 0], crease_angle: 180 } },
    "46": { class_type: "SaveGLB", inputs: { mesh: ["45", 0], filename_prefix: jobPrefix(job) } },
  };
}

/** POST /prompt reply → prompt id, or ComfyUI's error (missing node pack = setup not finished). */
export function parseQueued(j: unknown): { id: string } | { error: string } {
  const o = (j ?? {}) as { prompt_id?: unknown; error?: { message?: unknown; details?: unknown } | string; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
  if (typeof o.prompt_id === "string" && o.prompt_id && !Object.keys(o.node_errors ?? {}).length) return { id: o.prompt_id };
  const node = Object.values(o.node_errors ?? {}).flatMap((n) => n.errors ?? []).map((e) => [e.message, e.details].filter(Boolean).join(": "))[0];
  const top = typeof o.error === "string" ? o.error : [o.error?.message, o.error?.details].filter((x) => typeof x === "string" && x).join(": ");
  const msg = (node || top || "ComfyUI refused the job").slice(0, 300);
  return { error: /class_type|does not exist|not found|Trellis2|safetensors/i.test(msg) ? `TRELLIS.2 isn't fully set up (${msg}). Run ${TRELLIS_SETUP} again.` : msg };
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

/** Roblox look: the old pipeline baked PBR with metallic ~0.8 / roughness ~0.07 (seen on the RTX 5060 run), which renders like
 * chrome reflecting the sky; the native graph bakes colour only, and glTF's default factors are metallic 1 / roughness 1. Rewrite every material to non-metal, fully rough, keep the colour texture. Only the JSON chunk changes. */
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
