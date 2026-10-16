import { Worker } from "node:worker_threads";
import path from "node:path";
import { createLimiter } from "./pure";
import { DOCX, zipUncompressed } from "./attach-pure";

export { DOCX };
export const TEXT = ["text/plain", "text/markdown", "text/csv"];

const PARSE_MS = 30_000;
const MAX_UNZIPPED = 50 * 1024 * 1024;
const HEAP_MB = 512;

// PDF/Word parsing is CPU- and memory-heavy: at most 2 documents at once, the rest wait. Each runs in a worker that is
// killed after PARSE_MS or when it runs out of its heap, so a slow or hostile file can't hold a slot or the server.
const g = globalThis as unknown as { __orbitParseLimit?: ReturnType<typeof createLimiter> };
const parseSlot = (g.__orbitParseLimit ??= createLimiter(2));

function inWorker(buf: Buffer, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(process.cwd(), "src/lib/parse-worker.mjs"), { workerData: { data: buf, type }, resourceLimits: { maxOldGenerationSizeMb: HEAP_MB } });
    const end = (fn: () => void) => { clearTimeout(timer); clearInterval(watch); void w.terminate(); fn(); }; // later settles are no-ops
    // A global --max-old-space-size (e.g. in NODE_OPTIONS) overrides resourceLimits, so also watch the heap (Node >= 22.16).
    const heap = (w as unknown as { getHeapStatistics?: () => Promise<{ used_heap_size: number }> }).getHeapStatistics?.bind(w);
    const watch = setInterval(() => heap?.().then((h) => { if (h.used_heap_size > HEAP_MB * 1024 * 1024) end(() => reject(new Error("it is too large to read"))); }, () => {}), 250);
    const timer = setTimeout(() => end(() => reject(new Error("it took too long to read (over 30 s)"))), PARSE_MS);
    w.once("message", (m: { text?: string; error?: string }) => end(() => (m.error !== undefined ? reject(new Error(m.error)) : resolve(m.text ?? ""))));
    w.once("error", (e: Error & { code?: string }) => end(() => reject(new Error(e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "it is too large to read" : e.message))));
    w.once("exit", (code) => end(() => reject(new Error(`the document reader stopped (exit ${code})`))));
  });
}

async function parse(buf: Buffer, type: string): Promise<string> {
  if (TEXT.includes(type)) return buf.toString("utf8");
  if (type !== "application/pdf" && type !== DOCX) return "";
  // Zip bombs inflate into Buffers outside the worker's heap limit: refuse by the declared sizes first.
  if (type === DOCX && !(zipUncompressed(buf) <= MAX_UNZIPPED)) throw new Error("it unpacks to more than 50 MB");
  return parseSlot(() => inWorker(buf, type));
}

/** Pull readable text out of a PDF, Word or text document (used by memory uploads and CORE attachments). */
export async function extractText(buf: Buffer, type: string): Promise<string> {
  return (await parse(buf, type)).replace(/\u0000/g, "").trim();
}
