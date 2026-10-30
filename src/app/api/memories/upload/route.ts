import { requireUser } from "@/lib/supabase/server";
import { captureMemory, fileHash, type Kind } from "@/lib/memory";
import { cleanTags, str } from "@/lib/pure";
import { extractText, DOCX, TEXT } from "@/lib/extract";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // MEMORY's own cap (the bucket allows 50 MB once 0009 runs, for VAULT cloud copies)
const IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Upload a PDF, Word, text or image file: stored privately in the vault, text extracted into a memory. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Files can be at most 4 MB" }, { status: 413 });

  // Browsers send .md as an empty type, and on Windows .csv often as application/vnd.ms-excel (Excel's registry entry): trust the extension for text files.
  const byExt = /\.(md|markdown)$/i.test(file.name) ? "text/markdown" : /\.txt$/i.test(file.name) ? "text/plain" : /\.csv$/i.test(file.name) ? "text/csv" : "";
  const type = byExt && !TEXT.includes(file.type) ? byExt : file.type;
  const isImage = IMAGES.includes(type);
  if (!isImage && type !== "application/pdf" && type !== DOCX && !TEXT.includes(type)) {
    return Response.json({ error: "Supported: PDF, Word (.docx), text, Markdown, CSV, PNG, JPEG, WebP, GIF" }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let text = "";
  try {
    text = await extractText(buf, type);
  } catch (e) {
    return Response.json({ error: `Couldn't read that file: ${e instanceof Error ? e.message : "unknown error"}` }, { status: 422 });
  }

  const note = str(form?.get("note"), 20_000) ?? "";
  const kind: Kind = isImage ? "image" : "document";
  const choice = ["keep", "merge", "update"].find((c) => c === form?.get("onDuplicate")) as "keep" | "merge" | "update" | undefined;
  const input = {
    kind, title: (str(form?.get("title"), 300) || file.name).slice(0, 300),
    content: [note, text].filter(Boolean).join("\n\n---\n").slice(0, 200_000) || `${isImage ? "Image" : "File"}: ${file.name}`,
    source: "upload", tags: cleanTags(form?.get("tags")),
  };
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-120) || "file";
  let path = "";
  // MEM04: bytes are stored only when a memory is actually created; a repeat, merge or update never re-uploads.
  const attach = async () => {
    const p = `${user.id}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await sb.storage.from("vault").upload(p, buf, { contentType: type, upsert: false });
    if (error) throw new Error(`Storage failed: ${error.message}`);
    return (path = p);
  };
  try {
    const out = await captureMemory(sb, user.id, input, { fileHash: fileHash(buf), onDuplicate: choice ?? null, attach });
    return Response.json({ ...out, extractedChars: text.length }, { status: "preview" in out ? 409 : 201 });
  } catch (e) {
    if (path) await sb.storage.from("vault").remove([path]); // don't leave an orphaned file
    return Response.json({ error: e instanceof Error ? e.message : "Could not save" }, { status: 500 });
  }
}
