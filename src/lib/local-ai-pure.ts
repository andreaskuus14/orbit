// Local AI tools: free models on the owner's PC (tools/local-ai/server.py). Pure parts, tested in tests/local-ai.test.ts.
// Server glue: local-ai.ts; API: /api/local-ai; UI: components/LocalAi.tsx. The service URL must be this PC: nothing leaves it.

export const DEFAULT_URL = "http://127.0.0.1:7861";
export const SETUP_CMD = "powershell -ExecutionPolicy Bypass -File tools\\local-ai\\setup.ps1";
export const START_CMD = "powershell -ExecutionPolicy Bypass -File tools\\local-ai\\start.ps1";
export const NOT_RUNNING = "Not installed / not running — run tools/local-ai/start.ps1 (first time: tools/local-ai/setup.ps1).";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** ORBIT_LOCAL_AI_URL → its origin, or null when it isn't plain http on this PC (refused: the tools must never reach the network). */
export function serviceUrl(raw: string | undefined): string | null {
  let u: URL;
  try { u = new URL((raw ?? "").trim() || DEFAULT_URL); } catch { return null; }
  return u.protocol === "http:" && LOOPBACK.has(u.hostname) && !u.username && !u.password ? u.origin : null;
}

export type ToolId = "image3d" | "removebg" | "tts" | "clone";
export type CatalogEntry = { id: ToolId | "text3d" | "motion"; name: string; what: string; model: string; vram: string; vramGb: number; license: string; where: string; setup: string };
/** Every local creative tool, in plain words. OPERATIONS → Local AI shows this list; vramGb 0 = runs on the CPU. */
export const CATALOG: CatalogEntry[] = [
  { id: "image3d", name: "Picture to 3D", what: "Turns one picture of an object into a 3D model (.glb) you can import into Roblox Studio or Unreal.",
    model: "TripoSR", vram: "about 6 GB (ORBIT halves the chunk size for headroom); falls back to the CPU, slowly", vramGb: 6, license: "MIT (free, commercial use OK)", where: "GAME DEV → Assets → Picture to 3D", setup: SETUP_CMD },
  { id: "removebg", name: "Background cut-out", what: "Cuts the subject out of a picture (transparent PNG) for thumbnails, or before making a 3D model.",
    model: "rembg u2net", vram: "none (CPU)", vramGb: 0, license: "MIT", where: "GAME DEV → Assets → Picture to 3D", setup: SETUP_CMD },
  { id: "tts", name: "Voiceover", what: "Reads your script aloud in a preset English voice and saves a .wav for your video.",
    model: "Kokoro 82M", vram: "none (CPU)", vramGb: 0, license: "Apache-2.0", where: "STUDIO → Produce → Voiceover", setup: SETUP_CMD },
  { id: "clone", name: "Your own voice", what: "Reads your script in your own voice, learned from a short recording of you. Only for your own voice.",
    model: "Audio8 TTS Realistic 0.6B", vram: "about 3 GB (fits 6 GB)", vramGb: 3, license: "Apache-2.0", where: "STUDIO → Produce → Voiceover", setup: `${SETUP_CMD}  (skip it with -SkipClone)` },
  { id: "text3d", name: "Text to 3D (Roblox)", what: "Describe an object and Roblox Studio generates a textured mesh in your place (Roblox's own Cube 3D model).",
    model: "Roblox Studio generate_mesh", vram: "none (runs on Roblox's servers)", vramGb: 0, license: "Roblox terms", where: "GAME DEV → Assets → Text to 3D", setup: "Roblox Studio → Assistant → Manage MCP Servers → Enable Studio as MCP server" },
  { id: "motion", name: "Character motion (later)", what: "NVIDIA MotionBricks makes character movement, but it is an early preview on a robot skeleton with an Unreal demo, not Roblox R15 animations. Not installed.",
    model: "NVIDIA MotionBricks", vram: "unknown", vramGb: 0, license: "NVIDIA open model agreement", where: "not in ORBIT yet", setup: "none yet" },
];

export type Health = { running: boolean; gpu: { name: string; vramGb: number } | null; busy: boolean; tools: Record<ToolId, boolean> };
const NONE: Record<ToolId, boolean> = { image3d: false, removebg: false, tts: false, clone: false };
/** server.py's /health JSON (null = unreachable) → what the UI shows. Anything odd counts as not running. */
export function parseHealth(j: unknown): Health {
  const o = (j ?? {}) as { ok?: unknown; service?: unknown; gpu?: { name?: unknown; vramGb?: unknown } | null; busy?: unknown; tools?: Record<string, unknown> };
  if (o.ok !== true || o.service !== "orbit-local-ai") return { running: false, gpu: null, busy: false, tools: { ...NONE } };
  const g = o.gpu && typeof o.gpu.name === "string" && typeof o.gpu.vramGb === "number" ? { name: o.gpu.name.slice(0, 80), vramGb: o.gpu.vramGb } : null;
  const tools = { ...NONE };
  for (const k of Object.keys(NONE) as ToolId[]) tools[k] = o.tools?.[k] === true;
  return { running: true, gpu: g, busy: o.busy === true, tools };
}

/** One line per tool for the UI: ready, not installed, or the not-running hint. */
export function toolState(h: Health | null, id: ToolId): { ok: boolean; text: string } {
  if (!h?.running) return { ok: false, text: NOT_RUNNING };
  if (!h.tools[id]) return { ok: false, text: `Not installed — run ${SETUP_CMD}` };
  return { ok: true, text: h.busy ? "Ready (busy with another job right now)" : "Ready" };
}

export const VOICES = [
  { id: "af_heart", label: "Heart (US, female)" }, { id: "af_bella", label: "Bella (US, female)" }, { id: "af_sarah", label: "Sarah (US, female)" },
  { id: "am_michael", label: "Michael (US, male)" }, { id: "am_fenrir", label: "Fenrir (US, male)" },
  { id: "bf_emma", label: "Emma (UK, female)" }, { id: "bm_george", label: "George (UK, male)" },
] as const;
export const MAX_TTS_CHARS = 5000;
export const MAX_CLONE_CHARS = 600; // server.py MAX_CLONE_CHARS

/** /tts body, or an error to show. Mirrors server.py's checks so the UI and CORE get the same answer without a round trip. */
export function ttsRequest(text: unknown, voice: unknown): { text: string; voice: string } | { error: string } {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return { error: "Write the script first." };
  if (t.length > MAX_TTS_CHARS) return { error: `Scripts can be at most ${MAX_TTS_CHARS} characters; split it into parts.` };
  const v = voice === undefined || voice === "" ? VOICES[0].id : String(voice);
  return VOICES.some((x) => x.id === v) ? { text: t, voice: v } : { error: `Unknown voice "${v.slice(0, 30)}". Pick one of: ${VOICES.map((x) => x.id).join(", ")}` };
}

/** Own-voice cloning rule: his own recording, his confirmation, the transcript of the sample, a short take. "" = allowed. */
export function cloneBlocked(o: { consent: boolean; sampleBytes: number; sampleText: string; text: string }): string {
  if (!o.consent) return "Tick the box to confirm the recording is your own voice. ORBIT only clones your own voice.";
  if (!o.sampleBytes) return "Record or upload a sample of your own voice first (10-20 seconds, quiet room).";
  if (!o.sampleText.trim()) return "Type exactly what you said in the sample.";
  if (!o.text.trim()) return "Write the script first.";
  if (o.text.trim().length > MAX_CLONE_CHARS) return `Own-voice takes can be at most ${MAX_CLONE_CHARS} characters; split the script into parts.`;
  return "";
}

/** A VAULT file name for a made asset: the owner's words, safe characters only, with the right extension. */
export function assetName(raw: unknown, ext: "glb" | "wav" | "png", fallback: string): string {
  const base = String(raw ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").normalize("NFKD").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || fallback;
  return `${base}.${ext}`;
}

/** The service's error JSON ({error}) → text; status 409/503/507 keep server.py's own plain message. */
export function serviceError(status: number, j: unknown): string {
  const e = (j as { error?: unknown; detail?: unknown } | null)?.error ?? (j as { detail?: unknown } | null)?.detail;
  return typeof e === "string" && e ? e.slice(0, 300) : `Local AI failed (error ${status}).`;
}

/** Mono 16-bit PCM WAV from Web Audio samples (the browser records webm; the cloning model reads WAV). */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2), v = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 0x7fff), true);
  return out;
}
