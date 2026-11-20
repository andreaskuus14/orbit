// VAULT reading for scans: vault_read on a scanned PDF or a photo of a receipt gets its text by OCR on this PC (ocr.ts), cached as
// <vault>/.ocr/<file id>.json (keyed by size + mtime, so an edited file is read again). Nothing leaves this PC; the original is only read.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMeta, readStream, vaultDir } from "./vault.ts";
import { byName } from "./vault-meta-pure.ts";
import { needsOcr } from "./vault-intake-pure.ts";
import { isOcrImage, joinPages, skippedNote } from "./ocr-pure.ts";

type Cached = { v: 1; size: number; mtime: number; text: string };
const cacheFile = (id: string) => path.join(vaultDir(), ".ocr", `${id.replace(/[^\w-]/g, "")}.json`);

/** Text of a scanned PDF / picture in VAULT by OCR, or null: not a scan, OCR off or not set up, or it failed (never throws: vault_read falls back to "no text"). */
export async function ocrVaultText(name: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const isPdf = /\.pdf$/i.test(name);
    if (!isPdf && !isOcrImage(name)) return null;
    const { ocrReady, ocrDocument } = await import("./ocr.ts");
    if (!(await ocrReady())) return null;
    const meta = byName(await readMeta(), name);
    const st = await stat(path.join(vaultDir(), name));
    if (meta) {
      const c: Cached | null = await readFile(cacheFile(meta.id), "utf8").then((t) => JSON.parse(t), () => null);
      if (c?.v === 1 && c.size === st.size && c.mtime === st.mtimeMs && typeof c.text === "string") return c.text || null;
    }
    const bytes = Buffer.from(await new Response((await readStream(name, null)).stream).arrayBuffer());
    let pages: string[] = [], scanned: boolean[] | undefined, text = "";
    if (isPdf) {
      const { extractPages } = await import("./extract.ts");
      pages = await extractPages(bytes, "application/pdf");
      scanned = pages.map(needsOcr);
      if (!scanned.some(Boolean)) text = ""; // has a text layer everywhere: the normal reader already gives it
    }
    if (!isPdf || scanned?.some(Boolean)) {
      const r = await ocrDocument(bytes, name, { scanned, signal });
      const merged = isPdf ? pages.map((p, i) => (scanned![i] ? r.pages[i] ?? "" : p)) : r.pages;
      text = joinPages(merged, skippedNote(r.skipped, r.cap));
    }
    if (meta) {
      await mkdir(path.dirname(cacheFile(meta.id)), { recursive: true });
      await writeFile(cacheFile(meta.id) + ".tmp", JSON.stringify({ v: 1, size: st.size, mtime: st.mtimeMs, text } satisfies Cached));
      await rename(cacheFile(meta.id) + ".tmp", cacheFile(meta.id));
    }
    return text || null;
  } catch { return null; }
}
