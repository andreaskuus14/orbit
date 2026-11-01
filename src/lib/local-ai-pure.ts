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

export type ToolId = "image3d" | "removebg" | "tts" | "clone" | "captions" | "ifc" | "docs";
/** et: Estonian name and sentence (the optional modules have them; the UI falls back to English). */
export type CatalogEntry = { id: ToolId | "text3d" | "motion"; name: string; what: string; model: string; vram: string; vramGb: number; license: string; where: string; setup: string; et?: { name: string; what: string } };
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
  { id: "captions", name: "Captions", what: "Writes down what is said in a video or recording (English or Estonian) and saves subtitles (.srt/.vtt) and a clean transcript.",
    model: "Whisper large-v3-turbo (faster-whisper)", vram: "about 2-3 GB (float16); falls back to the CPU, slowly", vramGb: 3, license: "MIT", where: "STUDIO → Produce → Captions", setup: `${SETUP_CMD} -Captions`,
    et: { name: "Subtiitrid", what: "Kirjutab üles, mida videos või salvestuses räägitakse (inglise või eesti keeles), ja salvestab subtiitrid (.srt/.vtt) ning puhta teksti." } },
  { id: "ifc", name: "IFC models", what: "Opens an .ifc building model and lists its floors, rooms with areas, element counts and materials, with simple checks and a room table (CSV).",
    model: "IfcOpenShell", vram: "none (CPU)", vramGb: 0, license: "LGPL-3.0", where: "ARCH → Open IFC model", setup: `${SETUP_CMD} -Ifc`,
    et: { name: "IFC-mudelid", what: "Avab .ifc hoonemudeli ja näitab korruseid, ruume pindaladega, elementide arve ja materjale, lihtsaid kontrolle ning ruumide tabelit (CSV)." } },
  { id: "docs", name: "Document reading", what: "Turns a PDF, Word file or scanned page into clean Markdown text with its tables, saved next to the original so CORE can read it.",
    model: "Docling (layout, TableFormer, RapidOCR)", vram: "about 2 GB; falls back to the CPU", vramGb: 2, license: "MIT", where: "VAULT → open a file → Read document", setup: `${SETUP_CMD} -Docs`,
    et: { name: "Dokumendi lugemine", what: "Teeb PDF-ist, Wordi failist või skannitud lehest puhta Markdown-teksti koos tabelitega ja salvestab selle originaali kõrvale, et CORE saaks seda lugeda." } },
  { id: "text3d", name: "Text to 3D (Roblox)", what: "Describe an object and Roblox Studio generates a textured mesh in your place (Roblox's own Cube 3D model).",
    model: "Roblox Studio generate_mesh", vram: "none (runs on Roblox's servers)", vramGb: 0, license: "Roblox terms", where: "GAME DEV → Assets → Text to 3D", setup: "Roblox Studio → Assistant → Manage MCP Servers → Enable Studio as MCP server" },
  { id: "motion", name: "Character motion (later)", what: "NVIDIA MotionBricks makes character movement, but it is an early preview on a robot skeleton with an Unreal demo, not Roblox R15 animations. Not installed.",
    model: "NVIDIA MotionBricks", vram: "unknown", vramGb: 0, license: "NVIDIA open model agreement", where: "not in ORBIT yet", setup: "none yet" },
];

/** Optional modules: installed later with their own setup switch. */
export const MODULES: ToolId[] = ["captions", "ifc", "docs"];

export type Health = { running: boolean; gpu: { name: string; vramGb: number } | null; busy: boolean; tools: Record<ToolId, boolean> };
const NONE: Record<ToolId, boolean> = { image3d: false, removebg: false, tts: false, clone: false, captions: false, ifc: false, docs: false };
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
  if (!h.tools[id]) return { ok: false, text: `Not installed — run ${MODULES.includes(id) ? CATALOG.find((c) => c.id === id)!.setup : SETUP_CMD}` };
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
export function assetName(raw: unknown, ext: "glb" | "wav" | "png" | "srt" | "vtt" | "txt" | "md", fallback: string): string {
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

// ---- Captions (server.py /transcribe → segments with word times) ----
export type Word = { start: number; end: number; word: string };
export type Segment = { start: number; end: number; text: string; words: Word[] };
export type Transcript = { language: string; duration: number; device: string; segments: Segment[] };
export const CAPTION_LANGS = [{ id: "auto", label: "Detect" }, { id: "en", label: "English" }, { id: "et", label: "Eesti" }] as const;
export const isCaptionLang = (v: unknown): v is "auto" | "en" | "et" => v === "auto" || v === "en" || v === "et";
/** Audio/video names the captions tool accepts (PyAV reads them; VAULT kinds video/audio plus common phone/camera files). */
export const isMediaName = (n: string) => /\.(mp4|mov|mkv|webm|m4a|mp3|wav|ogg|flac)$/i.test(n);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
/** /transcribe JSON → a checked transcript (bad rows dropped, text capped); null when it isn't one. */
export function parseTranscript(j: unknown): Transcript | null {
  const o = j as { language?: unknown; duration?: unknown; device?: unknown; segments?: unknown } | null;
  if (!o || !Array.isArray(o.segments)) return null;
  const segments: Segment[] = [];
  for (const r of o.segments.slice(0, 20000) as { start?: unknown; end?: unknown; text?: unknown; words?: unknown }[]) {
    const start = num(r?.start), end = num(r?.end);
    if (start === null || end === null || end < start || typeof r.text !== "string") continue;
    const words = (Array.isArray(r.words) ? r.words : []).flatMap((w: { start?: unknown; end?: unknown; word?: unknown }) => {
      const a = num(w?.start), b = num(w?.end);
      return a !== null && b !== null && typeof w.word === "string" ? [{ start: a, end: Math.max(a, b), word: w.word }] : [];
    });
    segments.push({ start, end, text: r.text.trim().slice(0, 2000), words });
  }
  return { language: typeof o.language === "string" ? o.language.slice(0, 8) : "", duration: num(o.duration) ?? 0, device: typeof o.device === "string" ? o.device.slice(0, 40) : "", segments };
}

const stamp = (t: number, sep: "," | ".") => {
  const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const MAX_LINE = 42, MAX_CUE = 7; // YouTube/Netflix-style: two lines of ≤42 characters, at most ~7 s on screen

/** Segments → subtitle cues: long segments split at word times so each cue fits two short lines. */
export function cues(segments: Segment[]): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const s of segments) {
    if (!s.text) continue;
    if (s.text.length <= MAX_LINE * 2 && s.end - s.start <= MAX_CUE || !s.words.length) { out.push({ start: s.start, end: s.end, text: s.text }); continue; }
    let cur: Word[] = [];
    const flush = () => { if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.word).join("").trim() }); cur = []; };
    for (const w of s.words) {
      const len = cur.map((x) => x.word).join("").trim().length + w.word.length;
      if (cur.length && (len > MAX_LINE * 2 || w.end - cur[0].start > MAX_CUE)) flush();
      cur.push(w);
    }
    flush();
  }
  return out.filter((c) => c.text);
}
/** Wrap a cue onto at most two lines near the middle. */
function wrap(t: string): string {
  if (t.length <= MAX_LINE) return t;
  const mid = t.length / 2;
  let best = -1;
  for (let i = t.indexOf(" "); i !== -1; i = t.indexOf(" ", i + 1)) if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
  return best === -1 ? t : `${t.slice(0, best)}\n${t.slice(best + 1)}`;
}
export const toSrt = (segments: Segment[]) =>
  cues(segments).map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${wrap(c.text)}\n`).join("\n");
export const toVtt = (segments: Segment[]) =>
  `WEBVTT\n\n${cues(segments).map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${wrap(c.text).replace(/-->/g, "→")}\n`).join("\n")}`;

/** Readable transcript: fillers and stutters removed, a new paragraph after pauses of 2 s or more. */
export function cleanTranscript(segments: Segment[]): string {
  const FILLER = /(^|\s)(?:u+h+m*|u+m+|e+h+|ö+ö+|mhm+|hmm+)[,.]?(?=\s|$)/gi;
  const paras: string[] = [];
  let cur = "", last = -Infinity;
  for (const s of segments) {
    const t = s.text.replace(FILLER, "$1").replace(/\b(\w+)(?:,?\s+\1\b)+/gi, "$1").replace(/\s{2,}/g, " ").trim();
    if (!t) continue;
    if (cur && s.start - last >= 2) { paras.push(cur); cur = ""; }
    cur = cur ? `${cur} ${t}` : t;
    last = s.end;
  }
  if (cur) paras.push(cur);
  return paras.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("\n\n") + (paras.length ? "\n" : "");
}

// ---- IFC models (server.py /ifc-summary) ----
export type IfcIssue = { kind: string; text: string; count: number; examples: string[] };
export type IfcSummary = {
  schema: string; project: string; storeys: { name: string; elevation: number; elements: number }[];
  spaces: { guid: string; name: string; longName: string; storey: string; area: number | null }[];
  counts: Record<string, number>; materials: { name: string; elements: number }[]; issues: IfcIssue[];
};
const s80 = (v: unknown, n = 120) => (typeof v === "string" ? v.slice(0, n) : "");
const arr = <T>(v: unknown, n: number, f: (x: Record<string, unknown>) => T): T[] => (Array.isArray(v) ? v.slice(0, n).map((x) => f((x ?? {}) as Record<string, unknown>)) : []);
/** /ifc-summary JSON → a checked summary (strings capped; the model file came from outside, so nothing is trusted); null when it isn't one. */
export function parseIfcSummary(j: unknown): IfcSummary | null {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o.schema !== "string" || !Array.isArray(o.spaces)) return null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries((o.counts ?? {}) as Record<string, unknown>).slice(0, 300)) if (/^Ifc\w{1,60}$/.test(k) && num(v) !== null) counts[k] = v as number;
  return {
    schema: s80(o.schema, 20), project: s80(o.project),
    storeys: arr(o.storeys, 200, (x) => ({ name: s80(x.name), elevation: typeof x.elevation === "number" && Number.isFinite(x.elevation) ? x.elevation : 0, elements: num(x.elements) ?? 0 })),
    spaces: arr(o.spaces, 5000, (x) => ({ guid: s80(x.guid, 22), name: s80(x.name), longName: s80(x.longName), storey: s80(x.storey), area: num(x.area) })),
    counts, materials: arr(o.materials, 500, (x) => ({ name: s80(x.name), elements: num(x.elements) ?? 0 })),
    issues: arr(o.issues, 20, (x) => ({ kind: s80(x.kind, 30), text: s80(x.text, 200), count: num(x.count) ?? 0, examples: arr(x.examples, 20, (e) => s80(e as unknown, 120)) })),
  };
}
/** Sum of the spaces' known areas, m². */
export const totalArea = (s: IfcSummary) => Math.round(s.spaces.reduce((a, x) => a + (x.area ?? 0), 0) * 100) / 100;
/** Spaces table for Excel/Sheets. Names come from someone else's file: a leading = + - @ is defused so a cell can't run as a formula. */
export function spacesCsv(s: IfcSummary): string {
  const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v); // RFC 4180, as launch-pure toCsv
  return [["Storey", "Space", "Long name", "Area (m²)", "GlobalId"],
    ...s.spaces.map((x) => [safe(x.storey), safe(x.name), safe(x.longName), x.area === null ? "" : x.area.toFixed(2), x.guid])].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ---- Document reading (server.py /doc-to-md) ----
/** Files Docling reads: PDF, Word, PowerPoint and scanned pages. */
export const isDocName = (n: string) => /\.(pdf|docx|pptx|png|jpe?g)$/i.test(n);
/** The .md saved beside "Report 2026.pdf" is "Report-2026.md" (a pdf→md pair stays next to each other in VAULT). */
export const docMdName = (n: string) => assetName(n, "md", "document");
/** Markdown with a short header saying where it came from (CORE then knows it's a converted copy). */
export const docMarkdown = (source: string, md: string, pages: number) =>
  `<!-- Read from VAULT file "${source.replace(/-->/g, "")}" on this PC by Docling${pages ? ` (${pages} page${pages === 1 ? "" : "s"})` : ""}. -->\n\n${md.trim()}\n`;
