// Local AI music beds for Shorts: ACE-Step 1.5 turbo (2B, MIT) through the picture ComfyUI's built-in nodes. Pure parts: the graph,
// the prompt rules (no artist names), seconds/seed/file names, and the /history audio parsing. Server glue: music-gen.ts. Tests: tests/music-gen.test.ts.
// Model files: HF Comfy-Org/ACE-Step-1.5 at a pinned revision (tools/comfyui/setup.ps1 -Model acestep-music installs them with SHA-256).
import { COMFY_SETUP, seedOf, type ImageRef } from "./comfy-pure.ts";

export const MUSIC_SETUP = `${COMFY_SETUP} -Model acestep-music`;
export const MUSIC_REV = "371bb1680f8c88d8c1083f6ffb6330d3d55bff76";
/** The four files (ComfyUI models subfolder, file name): setup.ps1 holds the same list with bytes and SHA-256. */
export const MUSIC_FILES = [
  ["diffusion_models", "acestep_v1.5_turbo.safetensors"], ["text_encoders", "qwen_0.6b_ace15.safetensors"],
  ["text_encoders", "qwen_1.7b_ace15.safetensors"], ["vae", "ace_1.5_vae.safetensors"],
] as const;
export const MUSIC_MIN = 15, MUSIC_MAX = 120, MUSIC_DEFAULT = 30;
export const MUSIC_MISSING = `The local music models aren't installed: run ${MUSIC_SETUP} once (about 10 GB; ORBIT then starts ComfyUI by itself).`;

/** ORBIT_MUSIC_GEN=off turns the ComfyUI music branch off; anything else (or empty) leaves it on. */
export const musicGenOn = (raw: string | undefined) => raw?.trim().toLowerCase() !== "off";
export const clampSeconds = (n: unknown): number => {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  return Number.isFinite(v) ? Math.max(MUSIC_MIN, Math.min(MUSIC_MAX, Math.round(v))) : MUSIC_DEFAULT;
};

// Content-ID hygiene: a prompt never names an artist, band or "sound like" target. Style phrases and a list of well-known names are refused.
const STYLE_OF = /\b(?:in the (?:style|manner|vein) of|style of|sounds? (?:like|similar)|similar to|reminiscent of|inspired by|à la|a la|cover of|remix of|imitat\w*|ft\.?|feat\.?|featuring)\b/i;
const ARTISTS = ["taylor swift", "beyonce", "beyoncé", "billie eilish", "ariana grande", "ed sheeran", "the weeknd", "eminem", "kanye", "kendrick lamar", "rihanna", "adele", "bruno mars", "dua lipa", "post malone", "travis scott", "justin bieber", "lady gaga", "coldplay", "imagine dragons", "linkin park", "metallica", "nirvana", "the beatles", "beatles", "pink floyd", "led zeppelin", "ac/dc", "radiohead", "daft punk", "skrillex", "deadmau5", "avicii", "calvin harris", "marshmello", "martin garrix", "tiesto", "david guetta", "hans zimmer", "john williams", "ludovico einaudi", "joe hisaishi", "ennio morricone", "michael jackson", "madonna", "elvis", "frank sinatra", "mozart", "beethoven", "bach", "chopin", "lofi girl", "nujabes", "bts", "blackpink", "abba", "u2", "rammstein", "arctic monkeys", "gorillaz", "kavinsky", "the chainsmokers", "zedd", "kygo", "lana del rey", "frank ocean", "tyler the creator", "j. cole", "jay-z", "50 cent", "snoop dogg", "dr. dre", "nicki minaj", "cardi b", "olivia rodrigo", "harry styles", "shawn mendes", "maroon 5", "one direction", "red hot chili peppers", "foo fighters", "green day", "the killers", "disney", "pixar", "ghibli", "nintendo", "mario", "zelda", "minecraft", "undertale", "fortnite"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const ARTIST_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ARTISTS.map(esc).join("|")})(?![\\p{L}\\p{N}])`, "iu");

export const NO_ARTISTS = "Describe the music by mood, instruments and tempo, without artist, band, song or game names or 'in the style of' (they invite copyright claims).";
/** CORE's local_music / the UI's input → a clean request, or why not. */
export function checkMusic(i: Record<string, unknown>): { prompt: string; seconds: number; name: string } | { error: string } {
  const prompt = typeof i.prompt === "string" ? i.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 3) return { error: "Describe the music (prompt): mood, instruments, tempo." };
  if (prompt.length > 400) return { error: "Keep the prompt under 400 characters." };
  if (STYLE_OF.test(prompt) || ARTIST_RE.test(prompt)) return { error: NO_ARTISTS };
  return { prompt, seconds: clampSeconds(i.seconds), name: typeof i.name === "string" ? i.name : "" };
}

/** Tempo and key that suit the mood words (ACE responds to explicit bpm/key; they only steer, the tags do the rest). */
export function feelOf(prompt: string): { bpm: number; keyscale: string } {
  if (/horror|creepy|dark|tense|ominous|thriller|drone/i.test(prompt)) return { bpm: 70, keyscale: "D minor" };
  if (/epic|cinematic|battle|war|timpani|orchestr/i.test(prompt)) return { bpm: 90, keyscale: "A minor" };
  if (/playful|funny|quirky|pizzicato|comedy|upbeat|happy/i.test(prompt)) return { bpm: 110, keyscale: "G major" };
  if (/lo-?fi|calm|chill|soft|warm|ambient|relax/i.test(prompt)) return { bpm: 80, keyscale: "C major" };
  return { bpm: 90, keyscale: "C major" };
}
/** The genre/mood tags ACE-Step reads: the owner's words plus the fixed bed qualities (never vocals: they'd fight the narration). */
export const tagsOf = (prompt: string) => `${prompt.replace(/[.\s]+$/, "")}, instrumental, no vocals, background music, steady, loopable`.slice(0, 500);

export type MusicIn = { prompt: string; seconds: number; seed: number; prefix?: string };
export type MusicGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
/** ComfyUI API graph: UNETLoader → ModelSamplingAuraFlow → TextEncodeAceStepAudio1.5 → KSampler → VAEDecodeAudio → SaveAudioAdvanced
 *  (built-in nodes only; 8 steps, cfg 1, euler/simple, shift 3: the turbo model's published defaults). */
export function musicGraph(m: MusicIn): MusicGraph {
  const seconds = clampSeconds(m.seconds), { bpm, keyscale } = feelOf(m.prompt);
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: MUSIC_FILES[0][1], weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: MUSIC_FILES[1][1], clip_name2: MUSIC_FILES[2][1], type: "ace", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: MUSIC_FILES[3][1] } },
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    "5": { class_type: "TextEncodeAceStepAudio1.5", inputs: { clip: ["2", 0], tags: tagsOf(m.prompt), lyrics: "[Instrumental]", seed: m.seed, bpm, duration: seconds,
      timesignature: "4", language: "en", keyscale, generate_audio_codes: true, cfg_scale: 2.0, temperature: 0.85, top_p: 0.9, top_k: 0, min_p: 0.0 } },
    "6": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
    "7": { class_type: "EmptyAceStep1.5LatentAudio", inputs: { seconds, batch_size: 1 } },
    "8": { class_type: "KSampler", inputs: { model: ["4", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0], seed: m.seed, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 } },
    "9": { class_type: "VAEDecodeAudio", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": { class_type: "SaveAudioAdvanced", inputs: { audio: ["9", 0], filename_prefix: m.prefix ?? "orbit/music", format: "flac" } },
  };
}

/** A stable seed per (prompt, length): the same slot gives the same bed on a retry. */
export const musicSeed = (prompt: string, seconds: number) => seedOf(`${prompt}|${clampSeconds(seconds)}`);

/** POST /prompt error → plain text; a missing model file or node points at the setup command. */
export function musicQueueError(msg: string): string {
  return /unet_name|clip_name|vae_name|value_not_in_list|not in \[|does not exist|missing_node_type|TextEncodeAceStepAudio1\.5|SaveAudioAdvanced|EmptyAceStep/i.test(msg)
    ? `ComfyUI could not load the music workflow: ${msg.slice(0, 200)}. Run ${MUSIC_SETUP} (it also checks the model files); update ComfyUI if a node is unknown.` : msg;
}

/** GET /history/<id> → still running, failed, or the first saved audio file. */
export function parseAudioHistory(j: unknown, id: string): { state: "pending" } | { state: "error"; error: string } | { state: "done"; audio: ImageRef } {
  const h = ((j ?? {}) as Record<string, { status?: { status_str?: string; completed?: boolean; messages?: [string, { exception_message?: string }][] }; outputs?: Record<string, { audio?: Partial<ImageRef>[] }> }>)[id];
  if (!h) return { state: "pending" };
  if (h.status?.status_str === "error") {
    const ex = h.status.messages?.find((m) => m[0] === "execution_error")?.[1]?.exception_message;
    return { state: "error", error: `ComfyUI failed: ${(ex || "execution error").trim().slice(0, 240)}${/out of memory|CUDA|allocat/i.test(ex ?? "") ? " (the GPU ran out of memory: close games or other AI tools and try again)" : ""}` };
  }
  const a = Object.values(h.outputs ?? {}).flatMap((o) => o.audio ?? []).find((x) => typeof x.filename === "string" && x.type === "output");
  if (a) return { state: "done", audio: { filename: a.filename!, subfolder: typeof a.subfolder === "string" ? a.subfolder : "", type: "output" } };
  return h.status?.completed ? { state: "error", error: "ComfyUI finished without saving any audio." } : { state: "pending" };
}

/** Readable, safe file base: "calm-lofi-piano-1a2b3c4d" (the seed keeps two beds of one prompt apart). */
export function musicBase(prompt: string, seed: number, name = ""): string {
  const slug = (name || prompt).normalize("NFKD").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 40).replace(/-+$/, "") || "music";
  return `${slug}-${seed.toString(16).padStart(8, "0")}`;
}

export type MusicMeta = { prompt: string; tags: string; seed: number; seconds: number; bpm: number; keyscale: string; model: string; modelRev: string; license: string; createdAt: string; note: string };
/** The record kept next to every bed (same name, .json): prompt + seed + model, as evidence if a Content ID claim is ever disputed. */
export function musicMeta(m: { prompt: string; seconds: number; seed: number }, now = new Date()): MusicMeta {
  const { bpm, keyscale } = feelOf(m.prompt);
  return { prompt: m.prompt, tags: tagsOf(m.prompt), seed: m.seed, seconds: clampSeconds(m.seconds), bpm, keyscale, model: "ACE-Step 1.5 turbo (2B) via ComfyUI, 8 steps, cfg 1, euler/simple",
    modelRev: `Comfy-Org/ACE-Step-1.5@${MUSIC_REV}`, license: "MIT (model card allows commercial use of the output)", createdAt: now.toISOString(),
    note: "Generated locally on this PC from the prompt and seed above; no artist names, samples or reference audio were used." };
}
