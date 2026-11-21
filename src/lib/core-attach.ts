import { attachmentPrompt, type Attachment } from "./attach-pure";
import { extractPages, extractText } from "./extract";
import type { PromptImage } from "./claude";
import { attachmentText } from "./core-context-pure";
import { needsOcr } from "./vault-intake-pure";
import { wantsPhotoText } from "./core-chat-pure";

export type FileStep = (i: number, name: string, phase: "start" | "done", ok?: boolean, note?: string) => void;
const OCR_CHAT_MS = 120_000; // a chat waits at most this long for the GPU + OCR; the text layer (or the picture itself) is used otherwise

/** Scanned pages (no text layer) / a photo of text → text, on this PC only: GLM-OCR in the local Ollama (ocr.ts) first, Docling in
 *  Local AI as the fallback for PDFs (same order as VAULT intake). null when neither is set up; throws when it ran and failed. */
async function ocrLocal(bytes: Uint8Array, name: string, scanned: boolean[] | undefined, signal?: AbortSignal): Promise<string[] | null> {
  const { ocrReady, ocrDocument } = await import("./ocr");
  const sig = AbortSignal.any([AbortSignal.timeout(OCR_CHAT_MS), ...(signal ? [signal] : [])]);
  if (await ocrReady()) return (await ocrDocument(bytes, name, { scanned, signal: sig })).pages;
  if (!/\.pdf$/i.test(name)) return null;
  const { serviceUrl } = await import("./local-ai-pure");
  const { assertLocal } = await import("./vault-intake-pure");
  const url = serviceUrl(process.env.ORBIT_LOCAL_AI_URL);
  if (!url) return null;
  assertLocal(url, "Local AI (OCR)"); // a private scan never leaves this PC
  return (await import("./local-ai")).ocrPages(bytes, name);
}

/** A document's text; a PDF's scanned pages are read by OCR on this PC. */
async function docText(f: Attachment, signal?: AbortSignal): Promise<{ text: string; note?: string }> {
  if (f.type !== "application/pdf") return { text: await extractText(Buffer.from(f.data), f.type) };
  const pages = await extractPages(Buffer.from(f.data), f.type);
  const scanned = pages.map(needsOcr);
  if (!scanned.some(Boolean)) return { text: pages.join("\n\n").trim() };
  try {
    const ocr = await ocrLocal(f.data, f.name, scanned, signal);
    if (!ocr) return { text: pages.join("\n\n").trim(), note: "scanned pages not read: OCR isn't set up on this PC" };
    return { text: pages.map((p, i) => (scanned[i] ? ocr[i] ?? "" : p)).join("\n\n").trim(), note: "scanned pages read on this PC" };
  } catch (e) {
    return { text: pages.join("\n\n").trim(), note: `scanned pages not read: ${e instanceof Error ? e.message : "OCR failed"}` };
  }
}

/** Turn validated attachments into CORE's prompt block (document text) and the images sent with every step.
 *  Everything stays in memory: nothing is written to disk. onFile reports each file as it is read (the chat shows it as a live step).
 *  message: his typed words; a photo is also OCR'd when he asks for its text ("read this receipt"), so dense text isn't left to vision. */
export async function prepareAttachments(files: Attachment[], o: { onFile?: FileStep; signal?: AbortSignal; message?: string } = {}): Promise<{ block: string; images: PromptImage[]; text: string } | undefined> {
  if (!files.length) return undefined;
  const photoText = wantsPhotoText(o.message ?? "");
  const docs = (await Promise.all(files.map(async (f, i) => {
    if (f.kind === "image" && !photoText) return null;
    o.onFile?.(i, f.name, "start");
    try {
      if (f.kind === "image") {
        const pages = await ocrLocal(f.data, f.name, undefined, o.signal).catch(() => null);
        const text = pages?.join("\n\n").trim();
        o.onFile?.(i, f.name, "done", true, text ? "text read on this PC" : undefined);
        return text ? { name: `${f.name} (text read on this PC; the picture is attached too)`, text } : null;
      }
      const r = await docText(f, o.signal);
      o.onFile?.(i, f.name, "done", !r.note?.startsWith("scanned pages not"), r.note);
      return { name: f.name, text: r.text };
    } catch (e) {
      o.onFile?.(i, f.name, "done", false);
      return { name: f.name, text: `(couldn't read this file: ${e instanceof Error ? e.message : "unknown error"})` };
    }
  }))).filter((d): d is { name: string; text: string } => !!d);
  const images = files.filter((f) => f.kind === "image");
  return { block: attachmentPrompt(docs, images.map((f) => f.name)), images: images.map((f) => ({ type: f.type, data: f.data })), text: attachmentText(docs) };
}
