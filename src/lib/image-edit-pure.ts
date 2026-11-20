// Local picture EDITING: FLUX.2 [klein] 4B (Black Forest Labs, Apache-2.0) in the picture ComfyUI (tools/comfyui, setup.ps1 -Model flux2-klein-edit).
// NitroFusion2 / SDXL-Lightning stay the text-to-picture models (comfy-pure.ts); this only edits a VAULT picture from a plain instruction.
// Pure parts: the edit API graph, input checks, reply parsing. Server glue: image-edit.ts. Tests: tests/image-edit.test.ts.
// Speed on the 8 GB laptop GPU is UNTESTED (the graph is built from ComfyUI's own FLUX.2 klein edit template, never run here).
import { isPictureName } from "./video-pure.ts";
import { parseHistory, seedOf, type ImageRef } from "./comfy-pure.ts";

export const EDIT_SETUP = "powershell -ExecutionPolicy Bypass -File tools\\comfyui\\setup.ps1 -Model flux2-klein-edit";
export const editNotInstalled = () => `Local picture editing isn't installed (or ComfyUI is missing its FLUX.2 klein files): run ${EDIT_SETUP} once, then try again.`;

/** Files setup.ps1 installs (all Apache-2.0). Names are what the graph refers to; the sha256 pins live in setup.ps1. */
export const EDIT_FILES = {
  unet: "flux-2-klein-4b-nvfp4.safetensors", // BFL's own NVFP4 quant (2.46 GB; Blackwell tensor cores, e.g. the RTX 5060)
  clip: "qwen_3_4b_fp4_flux2.safetensors", // Qwen3-4B text encoder, FP4 (3.85 GB instead of 8 GB)
  vae: "flux2-vae.safetensors",
} as const;

export const EDIT_STEPS = 4; // klein 4B is step-distilled: 4 steps, cfg 1 (ComfyUI's template)
export const EDIT_MEGAPIXELS = 1; // the picture is scaled to about this size before editing: bigger than 1 MP risks the 8 GB
export const MAX_INSTRUCTION = 600;

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export type EditIn = { instruction: string; image: string; seed: number; steps?: number };

/**
 * ComfyUI API graph of the official "FLUX.2 Klein 4B Distilled image edit" template (Comfy-Org/workflow_templates), one reference picture.
 * `image` is the name ComfyUI's /upload/image returned. The picture is scaled to ~1 MP (multiples of 16), VAE-encoded and set as the
 * reference latent on both the positive and the (zeroed) negative conditioning; the output has the scaled picture's size.
 */
export function editWorkflow(e: EditIn): Graph {
  return {
    "70": { class_type: "UNETLoader", inputs: { unet_name: EDIT_FILES.unet, weight_dtype: "default" } },
    "71": { class_type: "CLIPLoader", inputs: { clip_name: EDIT_FILES.clip, type: "flux2", device: "default" } },
    "72": { class_type: "VAELoader", inputs: { vae_name: EDIT_FILES.vae } },
    "81": { class_type: "LoadImage", inputs: { image: e.image } },
    "80": { class_type: "ImageScaleToTotalPixels", inputs: { image: ["81", 0], upscale_method: "lanczos", megapixels: EDIT_MEGAPIXELS, resolution_steps: 16 } },
    "99": { class_type: "GetImageSize", inputs: { image: ["80", 0] } },
    "74": { class_type: "CLIPTextEncode", inputs: { text: e.instruction, clip: ["71", 0] } },
    "82": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["74", 0] } },
    "122": { class_type: "VAEEncode", inputs: { pixels: ["80", 0], vae: ["72", 0] } },
    "123": { class_type: "ReferenceLatent", inputs: { conditioning: ["74", 0], latent: ["122", 0] } },
    "121": { class_type: "ReferenceLatent", inputs: { conditioning: ["82", 0], latent: ["122", 0] } },
    "66": { class_type: "EmptyFlux2LatentImage", inputs: { width: ["99", 0], height: ["99", 1], batch_size: 1 } },
    "62": { class_type: "Flux2Scheduler", inputs: { steps: e.steps ?? EDIT_STEPS, width: ["99", 0], height: ["99", 1] } },
    "61": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "73": { class_type: "RandomNoise", inputs: { noise_seed: e.seed } },
    "63": { class_type: "CFGGuider", inputs: { model: ["70", 0], positive: ["123", 0], negative: ["121", 0], cfg: 1 } },
    "64": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["73", 0], guider: ["63", 0], sampler: ["61", 0], sigmas: ["62", 0], latent_image: ["66", 0] } },
    "65": { class_type: "VAEDecode", inputs: { samples: ["64", 0], vae: ["72", 0] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "orbit/edit", images: ["65", 0] } },
  };
}

export type EditRequest = { image: string; instruction: string; name: string };
/** CORE's local_image_edit input → a clean request, or why not. */
export function checkEdit(i: Record<string, unknown>): EditRequest | { error: string } {
  const image = typeof i.image === "string" ? i.image.trim() : "";
  if (!image) return { error: "Say which VAULT picture to edit (image)." };
  if (!isPictureName(image)) return { error: "image must be a picture in VAULT (.png, .jpg or .webp)." };
  const instruction = typeof i.instruction === "string" ? i.instruction.replace(/\s+/g, " ").trim() : "";
  if (instruction.length < 3) return { error: "Say what to change (instruction), e.g. \"make the sky a sunset\"." };
  if (instruction.length > MAX_INSTRUCTION) return { error: `Keep the instruction under ${MAX_INSTRUCTION} characters.` };
  return { image, instruction, name: typeof i.name === "string" ? i.name : "" };
}

export const editSeed = (r: EditRequest) => seedOf(`${r.image}\n${r.instruction}`);

/** Which of the three model files ComfyUI's loaders don't list (GET /object_info/<Loader> → <Loader>.input.required.<field>[0]). */
export function missingEditFiles(info: { unet?: unknown; clip?: unknown; vae?: unknown }): string[] {
  const has = (j: unknown, node: string, field: string, name: string) => {
    const list = ((j ?? {}) as Record<string, { input?: { required?: Record<string, unknown[]> } }>)[node]?.input?.required?.[field]?.[0];
    return Array.isArray(list) && list.includes(name);
  };
  return [has(info.unet, "UNETLoader", "unet_name", EDIT_FILES.unet) ? "" : EDIT_FILES.unet, has(info.clip, "CLIPLoader", "clip_name", EDIT_FILES.clip) ? "" : EDIT_FILES.clip,
    has(info.vae, "VAELoader", "vae_name", EDIT_FILES.vae) ? "" : EDIT_FILES.vae].filter(Boolean);
}

/** POST /prompt reply → prompt id, or the error ComfyUI gave; missing model files or FLUX.2 nodes → the setup hint. */
export function parseEditQueued(j: unknown): { id: string } | { error: string } {
  const o = (j ?? {}) as { prompt_id?: unknown; error?: { type?: unknown; message?: unknown; details?: unknown } | string; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
  if (typeof o.prompt_id === "string" && o.prompt_id && !Object.keys(o.node_errors ?? {}).length) return { id: o.prompt_id };
  const node = Object.values(o.node_errors ?? {}).flatMap((n) => n.errors ?? []).map((e) => [e.message, e.details].filter(Boolean).join(": "))[0];
  const top = typeof o.error === "string" ? o.error : [o.error?.type, o.error?.message, o.error?.details].filter((x) => typeof x === "string" && x).join(": ");
  const msg = (node || top || "ComfyUI refused the job").slice(0, 300);
  return { error: /unet_name|clip_name|vae_name|not in \[|value_not_in_list|missing_node_type|does not exist|Flux2|ReferenceLatent/i.test(msg) ? `${editNotInstalled()} (ComfyUI said: ${msg})` : msg };
}

export const parseEditHistory = (j: unknown, id: string): { state: "pending" } | { state: "error"; error: string } | { state: "done"; image: ImageRef } => parseHistory(j, id);
