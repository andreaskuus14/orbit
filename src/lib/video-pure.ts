// Local AI video (Wan 2.2 TI2V-5B, GGUF) through the same ComfyUI as pictures (tools/comfyui, setup.ps1 -Model wan22-video).
// Pure parts: the text→video / image→video API graphs, size and length rules, input checks, reply parsing.
// Server glue: video.ts. Tests: tests/video.test.ts. Speed on the 8 GB laptop GPU is UNTESTED (estimates only, see tools/comfyui/README.md).
import { parseHistory, viewPath, type ImageRef } from "./comfy-pure.ts";

export const VIDEO_SETUP = "powershell -ExecutionPolicy Bypass -File tools\\comfyui\\setup.ps1 -Model wan22-video";
export const videoNotInstalled = () => `Local video isn't installed (or ComfyUI is missing its Wan 2.2 files or the GGUF node): run ${VIDEO_SETUP} once, then try again.`;

/** Files setup.ps1 installs (all Apache-2.0). Names are what the graph refers to; the sha256 pins live in setup.ps1. */
export const VIDEO_FILES = {
  unet: "Wan2.2-TI2V-5B-Q6_K.gguf",
  clip: "umt5-xxl-encoder-Q5_K_M.gguf",
  vae: "wan2.2_vae.safetensors",
  lora: "Wan2_2_5B_FastWanFullAttn_lora_rank_128_bf16.safetensors",
} as const;

export const FPS = 24;
export const MAX_FRAMES = 121; // 5 s at 24 fps; Wan22ImageToVideoLatent wants 4n+1 frames
export const MIN_SECONDS = 2;
export const MAX_SECONDS = 5;
export const NEGATIVE = "blurry, static, overexposed, subtitles, worst quality, low quality, deformed, extra fingers, watermark, text";

export type VideoQuality = "fast" | "best";
/** "best" = 20 steps without the speed LoRA; anything else = fast (FastWan LoRA, 4 steps). */
export const videoQualityOf = (raw: unknown): VideoQuality => (String(raw ?? "").trim().toLowerCase() === "best" ? "best" : "fast");

export type VideoAspect = "16:9" | "9:16";
/** Width and height must be multiples of 32. 832x480 is the default; 1280x704 is the opt-in HD size (ORBIT_VIDEO_HD=1, quality "best" only). */
export function videoSize(aspect: VideoAspect, hd = false): [number, number] {
  const [w, h] = hd ? [1280, 704] : [832, 480];
  return aspect === "9:16" ? [h, w] : [w, h];
}
export const videoHd = (raw: string | undefined) => raw?.trim() === "1";

/** Seconds → a legal frame count: 4n+1, at most 121. */
export function framesFor(seconds: number): number {
  const s = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Number.isFinite(seconds) ? seconds : MAX_SECONDS));
  return Math.min(MAX_FRAMES, Math.round((s * FPS) / 4) * 4 + 1);
}

export type VideoIn = { prompt: string; width: number; height: number; length: number; seed: number; quality: VideoQuality; image?: string; negative?: string };
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/**
 * The fixed ComfyUI API-format graph. Text→video when `image` is empty, image→video when it is the name ComfyUI's /upload/image returned.
 * fast: FastWan LoRA 1.0, 4 steps, cfg 1, euler/simple. best: no LoRA, 20 steps, cfg 5, uni_pc/simple. Decode is tiled so 8 GB doesn't run out.
 * SaveVideo's format is a dynamic combo, so its API keys are dotted ("format", "format.codec").
 */
export function videoWorkflow(v: VideoIn): Graph {
  const fast = v.quality === "fast";
  const g: Graph = {
    "37": { class_type: "UnetLoaderGGUF", inputs: { unet_name: VIDEO_FILES.unet } },
    "48": { class_type: "ModelSamplingSD3", inputs: { model: [fast ? "40" : "37", 0], shift: 8 } },
    "38": { class_type: "CLIPLoaderGGUF", inputs: { clip_name: VIDEO_FILES.clip, type: "wan" } },
    "39": { class_type: "VAELoader", inputs: { vae_name: VIDEO_FILES.vae } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["38", 0], text: v.prompt } },
    "7": { class_type: "CLIPTextEncode", inputs: { clip: ["38", 0], text: v.negative ?? NEGATIVE } },
    "55": { class_type: "Wan22ImageToVideoLatent", inputs: { vae: ["39", 0], width: v.width, height: v.height, length: v.length, batch_size: 1 } },
    "3": { class_type: "KSampler", inputs: { model: ["48", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["55", 0], seed: v.seed,
      steps: fast ? 4 : 20, cfg: fast ? 1 : 5, sampler_name: fast ? "euler" : "uni_pc", scheduler: "simple", denoise: 1 } },
    "8": { class_type: "VAEDecodeTiled", inputs: { samples: ["3", 0], vae: ["39", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } },
    "57": { class_type: "CreateVideo", inputs: { images: ["8", 0], fps: FPS } },
    "58": { class_type: "SaveVideo", inputs: { video: ["57", 0], filename_prefix: "orbit/video", format: "mp4", "format.codec": "h264" } },
  };
  if (fast) g["40"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["37", 0], lora_name: VIDEO_FILES.lora, strength_model: 1.0 } };
  if (v.image) {
    g["56"] = { class_type: "LoadImage", inputs: { image: v.image } };
    g["55"].inputs.start_image = ["56", 0];
  }
  return g;
}

export const isPictureName = (n: unknown) => typeof n === "string" && /\.(png|jpe?g|webp)$/i.test(n.trim());

export type VideoRequest = { prompt: string; image: string; seconds: number; quality: VideoQuality; aspect: VideoAspect; name: string };
/** CORE's local_video input → a clean request, or why not. */
export function checkVideo(i: Record<string, unknown>): VideoRequest | { error: string } {
  const prompt = typeof i.prompt === "string" ? i.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 3) return { error: "Describe what happens in the video (prompt)." };
  if (prompt.length > 1000) return { error: "Keep the prompt under 1000 characters." };
  const image = typeof i.image === "string" ? i.image.trim() : "";
  if (image && !isPictureName(image)) return { error: "image must be a picture in VAULT (.png, .jpg or .webp)." };
  const sec = typeof i.seconds === "number" ? i.seconds : typeof i.seconds === "string" && i.seconds.trim() ? Number(i.seconds) : MAX_SECONDS;
  const seconds = Number.isFinite(sec) ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, sec)) : MAX_SECONDS;
  const aspect: VideoAspect = i.aspect === "9:16" ? "9:16" : "16:9";
  return { prompt, image, seconds, quality: videoQualityOf(i.quality), aspect, name: typeof i.name === "string" ? i.name : "" };
}

/** POST /prompt reply → prompt id, or the error ComfyUI gave; missing model files or the GGUF node → the setup hint. */
export function parseVideoQueued(j: unknown): { id: string } | { error: string } {
  const o = (j ?? {}) as { prompt_id?: unknown; error?: { type?: unknown; message?: unknown; details?: unknown } | string; node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }> };
  if (typeof o.prompt_id === "string" && o.prompt_id && !Object.keys(o.node_errors ?? {}).length) return { id: o.prompt_id };
  const node = Object.values(o.node_errors ?? {}).flatMap((n) => n.errors ?? []).map((e) => [e.message, e.details].filter(Boolean).join(": "))[0];
  const top = typeof o.error === "string" ? o.error : [o.error?.type, o.error?.message, o.error?.details].filter((x) => typeof x === "string" && x).join(": ");
  const msg = (node || top || "ComfyUI refused the job").slice(0, 300);
  return { error: /unet_name|clip_name|vae_name|lora_name|not in \[|value_not_in_list|missing_node_type|does not exist|GGUF/i.test(msg) ? `${videoNotInstalled()} (ComfyUI said: ${msg})` : msg };
}

/** GET /history/<id> → pending, failed, or the saved video (SaveVideo lists its .mp4 under "images"). */
export function parseVideoHistory(j: unknown, id: string): { state: "pending" } | { state: "error"; error: string } | { state: "done"; video: ImageRef } {
  const h = parseHistory(j, id);
  if (h.state === "pending") return h;
  if (h.state === "error") return { state: "error", error: h.error.replace("without saving a picture", "without saving a video") };
  if (!/\.(mp4|webm)$/i.test(h.image.filename)) return { state: "error", error: "ComfyUI finished but didn't save an .mp4 video." };
  return { state: "done", video: h.image };
}
export const videoViewPath = viewPath;

/** MP4 files carry "ftyp" at byte 4. */
export const isMp4 = (b: Uint8Array) => b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
