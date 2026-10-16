import { createLimiter } from "./pure";
import { DOCX } from "./attach-pure";

export { DOCX };
export const TEXT = ["text/plain", "text/markdown", "text/csv"];

// PDF/Word parsing is CPU- and memory-heavy: at most 2 documents at once, the rest wait.
const g = globalThis as unknown as { __orbitParseLimit?: ReturnType<typeof createLimiter> };
const parseSlot = (g.__orbitParseLimit ??= createLimiter(2));

async function parse(buf: Buffer, type: string): Promise<string> {
  if (type === "application/pdf") {
    const { extractText: pdf } = await import("unpdf");
    const { text } = await pdf(new Uint8Array(buf), { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (type === DOCX) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  if (TEXT.includes(type)) return buf.toString("utf8");
  return "";
}

/** Pull readable text out of a PDF, Word or text document (used by memory uploads and CORE attachments). */
export async function extractText(buf: Buffer, type: string): Promise<string> {
  return (await parseSlot(() => parse(buf, type))).replace(/\u0000/g, "").trim();
}
