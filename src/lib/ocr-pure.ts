// Document OCR, rules only (IO: ocr.ts, vault-ocr.ts). Scans and photos of receipts/invoices are read by GLM-OCR (0.9B, MIT) through the
// Ollama already on this PC. Private documents: the only URL used is Ollama's loopback URL (local-model-pure.ts OLLAMA_URL); nothing is uploaded.
import { isCloudModel } from "./local-model-pure.ts";
import { check, type Check } from "./doctor-pure.ts";

/** Ollama tag (ollama.com/library/glm-ocr; the registry lists one tag, `latest`, ~2.65 GB on disk). Upstream license: MIT. */
export const DEFAULT_OCR_MODEL = "glm-ocr";
/** GLM-OCR's task prompts are fixed phrases; "Text Recognition:" returns the page text (tables as markdown-ish rows). */
export const OCR_PROMPT = "Text Recognition:";
/** Ollama's default context (4096) crashes while encoding an image (GGML_ASSERT): 16k is the documented minimum. */
export const OCR_NUM_CTX = 16_384;
export const OCR_PAGE_TIMEOUT_MS = 120_000;
export const OCR_DEFAULT_PAGES = 20;
export const OCR_MAX_PAGES = 50;
/** Longest side of a page picture sent to the model; bigger only costs time. */
export const OCR_MAX_SIDE = 2000;
export const OCR_TEXT_MAX = 60_000;

export const OCR_IMAGE_TYPES = /\.(png|jpe?g|webp|gif)$/i;
export const isOcrImage = (name: string) => OCR_IMAGE_TYPES.test(name);
export const isHeic = (name: string) => /\.(heic|heif)$/i.test(name);
export const HEIC_NOTE = "HEIC photos can't be read here: export the photo as JPG (iPhone: Settings > Camera > Formats > Most Compatible, or share it as JPEG) and add that.";

/** ORBIT_OCR=0 turns document OCR off; ORBIT_OCR_MODEL picks another Ollama model (never a :cloud one: that would leave this PC). */
export function ocrConfig(env: Record<string, string | undefined>): { on: boolean; model: string; maxPages: number } {
  const picked = env.ORBIT_OCR_MODEL?.trim() || DEFAULT_OCR_MODEL;
  const n = Math.floor(Number(env.ORBIT_OCR_MAX_PAGES));
  return { on: env.ORBIT_OCR?.trim() !== "0" && !isCloudModel(picked), model: picked, maxPages: Number.isFinite(n) && n >= 1 ? Math.min(OCR_MAX_PAGES, n) : OCR_DEFAULT_PAGES };
}

/** Is `model` among Ollama's /api/tags names? "glm-ocr" matches "glm-ocr:latest"; an explicit tag must match exactly. */
export function hasModel(tags: unknown, model: string): boolean {
  const list = (tags as { models?: { name?: unknown }[] } | null)?.models;
  if (!Array.isArray(list)) return false;
  const want = model.includes(":") ? model : `${model}:latest`;
  return list.some((m) => typeof m?.name === "string" && m.name.toLowerCase() === want.toLowerCase());
}

/** Ollama /api/chat body for one page picture (base64, no data: prefix). */
export function ocrRequest(model: string, imageB64: string) {
  return { model, stream: false, keep_alive: "30s", options: { num_ctx: OCR_NUM_CTX, temperature: 0 }, messages: [{ role: "user", content: OCR_PROMPT, images: [imageB64] }] };
}

/** Ollama answer → page text: fences the model sometimes adds are dropped, NULs removed, length capped. */
export function ocrText(j: unknown): string | null {
  const c = (j as { message?: { content?: unknown } } | null)?.message?.content;
  if (typeof c !== "string") return null;
  return c.replace(/\u0000/g, "").replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/, "").trim().slice(0, OCR_TEXT_MAX);
}

/** Which pages to OCR: the scanned ones, in order, at most `cap`. `skipped` = scanned pages left unread because of the cap. */
export function planPages(scanned: boolean[], cap: number): { pick: number[]; skipped: number } {
  const all = scanned.flatMap((s, i) => (s ? [i] : []));
  return { pick: all.slice(0, cap), skipped: Math.max(0, all.length - cap) };
}

/** Local AI /render-pdf answer → page pictures (base64 JPEG) with their 1-based page numbers; null when it isn't that shape. */
export function parseRender(j: unknown): { total: number; pages: { page: number; image: string }[] } | null {
  const o = j as { total?: unknown; pages?: unknown } | null;
  if (!o || !Array.isArray(o.pages)) return null;
  const pages = o.pages.flatMap((p: { page?: unknown; image?: unknown }) => (Number.isInteger(p?.page) && typeof p?.image === "string" && p.image ? [{ page: p.page as number, image: p.image }] : []));
  return { total: Number(o.total) || pages.length, pages };
}

/** Pages joined into one text for vault_read; pages with no text are named so the reader knows they were blank or unread. */
export function joinPages(pages: string[], skippedNote = ""): string {
  const body = pages.length === 1 ? pages[0] : pages.map((t, i) => `--- page ${i + 1} ---\n${t || "(no text)"}`).join("\n\n");
  return (skippedNote ? `${body}\n\n${skippedNote}` : body).trim();
}
export const skippedNote = (n: number, cap: number) => (n > 0 ? `(${n} more scanned page${n === 1 ? "" : "s"} not read: OCR reads at most ${cap} pages per file.)` : "");

/** OPERATIONS → Doctor "Document OCR". Optional feature: never "fail". tags = Ollama /api/tags JSON, or null when Ollama didn't answer. */
export function ocrCheck(env: Record<string, string | undefined>, tags: unknown): Check {
  const L = "Document OCR", c = ocrConfig(env);
  if (!c.on) return check("ocr", L, "ok", "Off (ORBIT_OCR=0, or the model is a cloud one): scanned pages fall back to Docling if installed");
  if (tags === null) return check("ocr", L, "warn", "Ollama isn't answering, so scans can't be read by the local OCR model yet", "ORBIT tried to start Ollama by itself: see the Local brain (Ollama) line above for why it could not.");
  if (!hasModel(tags, c.model)) return check("ocr", L, "warn", `${c.model} isn't pulled (optional): scanned PDFs and photos give no text, or go through Docling if that is installed`, "Run: powershell -ExecutionPolicy Bypass -File tools\\ollama\\setup.ps1 -Ocr   (about 2.7 GB, MIT license)");
  return check("ocr", L, "ok", `${c.model} ready (reads scanned PDFs and photos on this PC, up to ${c.maxPages} pages per file)`);
}
