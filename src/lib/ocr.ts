// Document OCR, IO: page pictures → GLM-OCR in the Ollama on this PC (rules: ocr-pure.ts). Holds the shared GPU lease (kind "ocr"),
// stops on Stop-all or abort, one timeout per page. Private documents: only OLLAMA_URL (loopback) and Local AI (loopback) are called.
import { OLLAMA_URL } from "./local-model-pure.ts";
import { assertLocal } from "./vault-intake-pure.ts";
import { stopAllOn } from "./stop-all.ts";
import { withGpu } from "./gpu-lock.ts";
import { HEIC_NOTE, OCR_MAX_SIDE, OCR_PAGE_TIMEOUT_MS, hasModel, isHeic, isOcrImage, ocrConfig, ocrRequest, ocrText, planPages } from "./ocr-pure.ts";

export const ocrSettings = () => ocrConfig(process.env);

const tags = () => fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null), () => null);

/** Is OCR switched on and the model pulled? (A quick tags call; never takes the GPU.) */
export async function ocrReady(): Promise<boolean> {
  const c = ocrSettings();
  return c.on && hasModel(await tags(), c.model);
}
/** For the doctor: Ollama's tag list, or null when Ollama isn't answering. */
export const ocrTags = tags;

/** A picture file → JPEG bytes the model can take: upright (EXIF), at most OCR_MAX_SIDE on the long side. */
export async function normalizeImage(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  if (isHeic(name)) throw new Error(HEIC_NOTE);
  if (!isOcrImage(name)) throw new Error("OCR reads PDFs and pictures (png, jpg, webp, gif).");
  const sharp = (await import("sharp")).default;
  try {
    return new Uint8Array(await sharp(Buffer.from(bytes), { limitInputPixels: 120_000_000 }).rotate().resize(OCR_MAX_SIDE, OCR_MAX_SIDE, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer());
  } catch { throw new Error("That picture couldn't be opened. Is it damaged?"); }
}

/** OCR page pictures (base64 JPEG/PNG) one by one. Stop-all, abort or a failing page ends the whole call. onPage(done, total) after each page. */
export async function ocrImages(images: string[], o: { signal?: AbortSignal; onPage?: (done: number, total: number) => void } = {}): Promise<string[]> {
  const c = ocrSettings();
  if (!c.on) throw new Error("Document OCR is off (ORBIT_OCR=0).");
  assertLocal(OLLAMA_URL, "the local model URL"); // a private scan never goes anywhere but this PC
  return withGpu("ocr", { signal: o.signal, ttlMs: OCR_PAGE_TIMEOUT_MS * 2, maxWaitMs: 10 * 60_000 }, async (lease) => {
    const out: string[] = [];
    for (const img of images) {
      if (stopAllOn()) throw new Error("Stopped: Stop-all is on");
      o.signal?.throwIfAborted();
      lease.beat();
      const t = AbortSignal.timeout(OCR_PAGE_TIMEOUT_MS);
      const res = await fetch(`${OLLAMA_URL}/api/chat`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ocrRequest(c.model, img)), signal: o.signal ? AbortSignal.any([o.signal, t]) : t })
        .catch((e: unknown) => { throw new Error(t.aborted ? `The OCR model took longer than ${OCR_PAGE_TIMEOUT_MS / 1000} s on one page and was stopped.` : `The OCR model (Ollama) didn't answer: ${e instanceof Error ? e.message : e}`); });
      if (res.status === 404) throw new Error(`The OCR model "${c.model}" isn't pulled: run tools\\ollama\\setup.ps1 -Ocr`);
      if (!res.ok) throw new Error(`The OCR model (Ollama) answered ${res.status}`);
      const text = ocrText(await res.json());
      if (text === null) throw new Error("The OCR model sent back something that isn't text.");
      out.push(text);
      o.onPage?.(out.length, images.length);
    }
    return out;
  });
}

export type OcrResult = { pages: string[]; total: number; skipped: number; cap: number };

/** OCR a PDF or picture. `scanned` (PDFs): which pages have no text layer (all of them when omitted). Returns text per page of the document
 *  ("" for pages not OCR'd) so the caller can merge it with the text layer. */
export async function ocrDocument(bytes: Uint8Array, name: string, o: { scanned?: boolean[]; signal?: AbortSignal } = {}): Promise<OcrResult> {
  const cap = ocrSettings().maxPages;
  if (/\.pdf$/i.test(name)) {
    const { renderPdfPages } = await import("./local-ai.ts");
    const want = o.scanned ?? [];
    const plan = o.scanned ? planPages(want, cap) : { pick: Array.from({ length: cap }, (_, i) => i), skipped: 0 };
    const r = await renderPdfPages(bytes, name, plan.pick.map((i) => i + 1));
    const total = Math.max(r.total, want.length);
    const text = await ocrImages(r.pages.map((p) => p.image), o);
    const pages = Array.from({ length: total }, () => "");
    r.pages.forEach((p, i) => { pages[p.page - 1] = text[i] ?? ""; });
    return { pages, total, skipped: o.scanned ? plan.skipped : Math.max(0, r.total - cap), cap };
  }
  const img = Buffer.from(await normalizeImage(bytes, name)).toString("base64");
  return { pages: await ocrImages([img], o), total: 1, skipped: 0, cap };
}
