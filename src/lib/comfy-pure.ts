// Local image generation through ComfyUI. Pure workflow graphs, image sizes, and response parsing.
// Server glue: comfy.ts. Tests: tests/comfy.test.ts (also pins tools/comfyui/workflow-txt2img.json to workflow()).
import { serviceUrl } from "./local-ai-pure.ts";

export const COMFY_URL = "http://127.0.0.1:8188";
export const COMFY_SETUP = "powershell -ExecutionPolicy Bypass -File tools\\comfyui\\setup.ps1";
export type ComfyModel = "sdxl-lightning" | "nitrofusion2";
export const comfyModel = (raw: string | undefined): ComfyModel => raw?.trim().toLowerCase() === "nitrofusion2" ? "nitrofusion2" : "sdxl-lightning";
export const comfyModelName = (model: ComfyModel) => model === "nitrofusion2" ? "NitroFusion2" : "SDXL-Lightning";
export const comfySetup = (model: ComfyModel) => model === "nitrofusion2" ? `${COMFY_SETUP} -Model nitrofusion2` : COMFY_SETUP;
export const comfyNotRunning = (model: ComfyModel) => `Local image generation isn't installed or couldn't start: run ${comfySetup(model)} once (ORBIT then starts ComfyUI by itself; log: tools/comfyui/service.log).`;
/** ORBIT_COMFY_URL → origin, or null unless it is plain http on this PC (prompts never leave the PC). */
export const comfyUrl = (raw: string | undefined) => serviceUrl(raw, COMFY_URL);

// SDXL-Lightning 4-step full checkpoint (ByteDance, CreativeML Open RAIL++-M: commercial use OK, with its use restrictions).
export const MODEL = { file: "sdxl_lightning_4step.safetensors", repo: "ByteDance/SDXL-Lightning", rev: "c9a24f48e1c025556787b0c58dd67a091ece2e44",
  sha256: "e0d996ee0013e79d9d3561f50fcafb9a17e3ff07b780358e3b66d67932c4d490", license: "CreativeML Open RAIL++-M (commercial use OK; no harmful uses)" } as const;
export const STEPS = 4; // the checkpoint is distilled for exactly this; cfg 1, euler + sgm_uniform (model card)

/** SDXL's native buckets (about 1 megapixel) for the aspects ORBIT uses; anything else → 16:9. */
export const SIZES: Record<string, [number, number]> = {
  "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [1024, 1024], "4:3": [1152, 896], "3:4": [896, 1152], "4:5": [896, 1088],
};
export const sizeFor = (aspect: unknown): [number, number] => SIZES[String(aspect)] ?? SIZES["16:9"];

export const NEGATIVE = "text, letters, watermark, logo, signature, blurry, lowres, deformed, extra fingers, cartoon, drawing";
export const PHOTO = "realistic photograph, natural light, sharp focus, high detail";

export type WorkflowIn = { prompt: string; width: number; height: number; seed: number; steps?: number; negative?: string };
/** The fixed ComfyUI API-format txt2img graph (only built-in nodes). tools/comfyui/workflow-txt2img.json is this with the defaults. */
export function workflow(w: WorkflowIn): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: MODEL.file } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: w.width, height: w.height, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: w.prompt, clip: ["4", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: w.negative ?? NEGATIVE, clip: ["4", 1] } },
    "3": { class_type: "KSampler", inputs: { seed: w.seed, steps: w.steps ?? STEPS, cfg: 1, sampler_name: "euler", scheduler: "sgm_uniform", denoise: 1,
      model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "orbit", images: ["8", 0] } },
  };
}

// Upstream NitroFusion2 one-step graph, using the W4A8 GPTQ conversion with stock ComfyUI loaders.
// https://github.com/ChenDarYen/NitroFusion2/blob/6e9d4d604c9a77aeac3005e30c7b448eff03c16d/workflows/nitrofusion2_1step.json
export function nitroWorkflow({ prompt, width, height, seed }: WorkflowIn): ReturnType<typeof workflow> {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "nitrofusion2_w4a8_gptq.safetensors", weight_dtype: "default" } },
    "3": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "5": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["5", 0] } },
    "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["6", 0] } },
    "8": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "9": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    "10": { class_type: "KSampler", inputs: { seed, steps: 1, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1,
      model: ["3", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["9", 0] } },
    "12": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["8", 0] } },
    "60": { class_type: "SaveImage", inputs: { filename_prefix: "orbit", images: ["12", 0] } },
  };
}

export function imageWorkflow(model: ComfyModel, input: WorkflowIn): ReturnType<typeof workflow> {
  return model === "nitrofusion2" ? nitroWorkflow(input) : workflow({ ...input, prompt: `${input.prompt}. ${PHOTO}` });
}

/** A stable seed from text (same slot → same picture on a retry), in ComfyUI's accepted range. */
export const seedOf = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };

/** POST /prompt reply → prompt id, or the error ComfyUI gave (bad graph, missing model). */
export function parseQueued(j: unknown, model: ComfyModel = "sdxl-lightning"): { id: string } | { error: string } {
  const o = (j ?? {}) as { prompt_id?: unknown; error?: { message?: unknown; details?: unknown } | string; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
  if (typeof o.prompt_id === "string" && o.prompt_id && !Object.keys(o.node_errors ?? {}).length) return { id: o.prompt_id };
  const node = Object.values(o.node_errors ?? {}).flatMap((n) => n.errors ?? []).map((e) => [e.message, e.details].filter(Boolean).join(": "))[0];
  const top = typeof o.error === "string" ? o.error : [o.error?.message, o.error?.details].filter((x) => typeof x === "string" && x).join(": ");
  const msg = (node || top || "ComfyUI refused the job").slice(0, 300);
  if (model === "nitrofusion2") {
    return { error: /unet_name|clip_name|vae_name|does not exist/i.test(msg) ? `ComfyUI could not load the NitroFusion2 workflow: ${msg}. Check the model files and your ComfyUI version, then run ${comfySetup(model)}.` : msg };
  }
  return { error: /ckpt_name|not in \[|value_not_in_list/i.test(msg) ? `The model file ${MODEL.file} is missing in ComfyUI: run ${COMFY_SETUP} again.` : msg };
}

export type ImageRef = { filename: string; subfolder: string; type: string };
/** GET /history/<id> → still running, failed, or the first saved image. */
export function parseHistory(j: unknown, id: string): { state: "pending" } | { state: "error"; error: string } | { state: "done"; image: ImageRef } {
  const h = ((j ?? {}) as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string }][] }; outputs?: Record<string, { images?: Partial<ImageRef>[] }> }>)[id];
  if (!h) return { state: "pending" };
  if (h.status?.status_str === "error") {
    const ex = h.status.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message;
    return { state: "error", error: `ComfyUI failed: ${(ex || "execution error").trim().slice(0, 240)}${/out of memory|CUDA|allocat/i.test(ex ?? "") ? " (the GPU ran out of memory: close games or other AI tools and try again)" : ""}` };
  }
  const img = Object.values(h.outputs ?? {}).flatMap((o) => o.images ?? []).find((i) => typeof i.filename === "string" && i.type === "output");
  if (img) return { state: "done", image: { filename: img.filename!, subfolder: typeof img.subfolder === "string" ? img.subfolder : "", type: "output" } };
  return h.status?.completed ? { state: "error", error: "ComfyUI finished without saving a picture." } : { state: "pending" };
}

export const viewPath = (i: ImageRef) => `/view?${new URLSearchParams({ filename: i.filename, subfolder: i.subfolder, type: i.type })}`;

export type ComfyHealth = { running: boolean; installed: boolean; gpu: { name: string; vramGb: number } | null; version: string };
/** GET /system_stats → what the UI shows (null = unreachable). */
export function parseStats(j: unknown, installed: boolean): ComfyHealth {
  const o = (j ?? {}) as { system?: { comfyui_version?: unknown }; devices?: { name?: unknown; type?: unknown; vram_total?: unknown }[] };
  if (!o.system || !Array.isArray(o.devices)) return { running: false, installed, gpu: null, version: "" };
  const d = o.devices.find((x) => x.type === "cuda") ?? null;
  const gpu = d && typeof d.name === "string" && typeof d.vram_total === "number" ? { name: d.name.replace(/^cuda:\d+\s*/, "").replace(/\s*:\s*cudaMallocAsync$/, "").slice(0, 80), vramGb: Math.round(d.vram_total / 2 ** 30) } : null;
  return { running: true, installed: true, gpu, version: typeof o.system.comfyui_version === "string" ? o.system.comfyui_version.slice(0, 20) : "" };
}

/** CORE's local_image / the UI's input → a clean request, or why not. */
export function checkImage(i: Record<string, unknown>): { prompt: string; aspect: string; name: string } | { error: string } {
  const prompt = typeof i.prompt === "string" ? i.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 3) return { error: "Describe the picture (prompt)." };
  if (prompt.length > 800) return { error: "Keep the prompt under 800 characters." };
  const aspect = typeof i.aspect === "string" && SIZES[i.aspect] ? i.aspect : "16:9";
  return { prompt, aspect, name: typeof i.name === "string" ? i.name : "" };
}
