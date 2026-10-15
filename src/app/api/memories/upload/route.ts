import { requireUser } from "@/lib/supabase/server";
import { createMemory, type Kind } from "@/lib/memory";
import { cleanTags, createLimiter, str } from "@/lib/pure";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // matches the vault bucket's file_size_limit
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TEXT = ["text/plain", "text/markdown", "text/csv"];

// PDF/Word parsing is CPU- and memory-heavy: at most 2 documents at once, the rest wait.
const g = globalThis as unknown as { __orbitParseLimit?: ReturnType<typeof createLimiter> };
const parseSlot = (g.__orbitParseLimit ??= createLimiter(2));

/** Pull readable text out of a document so CORE can search and cite it. */
async function extractText(buf: Buffer, type: string): Promise<string> {
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

/** Upload a PDF, Word, text or image file: stored privately in the vault, text extracted into a memory. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Files can be at most 4 MB" }, { status: 413 });

  // Browsers sometimes send .md as empty type; fall back on the extension.
  const type = file.type || (/\.(md|markdown)$/i.test(file.name) ? "text/markdown" : /\.txt$/i.test(file.name) ? "text/plain" : "");
  const isImage = IMAGES.includes(type);
  if (!isImage && type !== "application/pdf" && type !== DOCX && !TEXT.includes(type)) {
    return Response.json({ error: "Supported: PDF, Word (.docx), text, Markdown, CSV, PNG, JPEG, WebP, GIF" }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = (await parseSlot(() => extractText(buf, type))).replace(/\u0000/g, "").trim();
  } catch (e) {
    return Response.json({ error: `Couldn't read that file: ${e instanceof Error ? e.message : "unknown error"}` }, { status: 422 });
  }

  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-120) || "file";
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await sb.storage.from("vault").upload(path, buf, { contentType: type, upsert: false });
  if (upErr) return Response.json({ error: `Storage failed: ${upErr.message}` }, { status: 500 });

  const note = str(form?.get("note"), 20_000) ?? "";
  const kind: Kind = isImage ? "image" : "document";
  try {
    const out = await createMemory(sb, user.id, {
      kind,
      title: (str(form?.get("title"), 300) || file.name).slice(0, 300),
      content: [note, text].filter(Boolean).join("\n\n---\n").slice(0, 200_000) || `${isImage ? "Image" : "File"}: ${file.name}`,
      source: "upload",
      storage_path: path,
      tags: cleanTags(form?.get("tags")),
    });
    return Response.json({ ...out, extractedChars: text.length }, { status: 201 });
  } catch (e) {
    await sb.storage.from("vault").remove([path]); // don't leave an orphaned file
    return Response.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
