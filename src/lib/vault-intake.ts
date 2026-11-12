// VAULT intake IO: incoming invoice / purchase order → fields with page + quote, saved as a sidecar <vault>/.intake/<file id>.json.
// Private documents: text per page (extract.ts worker), OCR for scanned pages (Local AI / Docling on this PC), one call to the
// local model (Ollama on this PC). Never Claude or any cloud API: this file must not import claude.ts (tests/vault-intake.test.ts).
// Read-only: the original file is only read; nothing is paid, sent or created from the result.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { VaultError, readMeta, readStream, vaultDir } from "./vault.ts";
import { mimeOf } from "./vault-pure.ts";
import { byName } from "./vault-meta-pure.ts";
import { OLLAMA_URL } from "./local-model-pure.ts";
import { serviceUrl } from "./local-ai-pure.ts";
import { SYSTEM, assertLocal, correct, intakePrompt, markUncertain, needsOcr, parseFields, parseSidecar, type Sidecar } from "./vault-intake-pure.ts";

export const INTAKE_TYPES = /\.(pdf|png|jpe?g)$/i;
const dir = () => path.join(vaultDir(), ".intake");
const sidecarPath = (id: string) => path.join(dir(), `${id.replace(/[^\w-]/g, "")}.json`);

async function fileInfo(name: unknown) {
  const { stream } = await readStream(name, null); // traversal / missing names refused there
  const bytes = Buffer.from(await new Response(stream).arrayBuffer());
  const meta = byName(await readMeta(), String(name));
  if (!meta) throw new VaultError("This file has no VAULT ID yet: reopen VAULT and try again.", 409);
  return { bytes, meta };
}

export async function readIntake(name: unknown): Promise<Sidecar | null> {
  const meta = byName(await readMeta(), String(name));
  if (!meta) return null;
  try { return parseSidecar(JSON.parse(await readFile(sidecarPath(meta.id), "utf8"))); } catch { return null; }
}
async function save(s: Sidecar) {
  await mkdir(dir(), { recursive: true });
  const p = sidecarPath(s.fileId);
  await writeFile(p + ".tmp", JSON.stringify(s));
  await rename(p + ".tmp", p);
  return s;
}

/** Extract fields from one VAULT PDF/scan and save the sidecar. The original file is only read. */
export async function runIntake(name: unknown, signal?: AbortSignal): Promise<Sidecar> {
  const n = String(name ?? "");
  if (!INTAKE_TYPES.test(n)) throw new VaultError("Intake reads PDFs and scanned pages (.png/.jpg).");
  // Both endpoints must be this PC before any byte of the document leaves this function.
  const llm = assertLocal(OLLAMA_URL, "the local model URL");
  const ocrUrl = serviceUrl(process.env.ORBIT_LOCAL_AI_URL);
  const { LOCAL_MODEL, chatLocal } = await import("./local-llm.ts");
  if (!LOCAL_MODEL) throw new VaultError("The local model is off: run tools\\ollama\\setup.ps1 (intake never uses a cloud model).", 409);
  const { bytes, meta } = await fileInfo(n);
  const type = mimeOf(n);
  const { extractPages } = await import("./extract.ts");
  const pages = type === "application/pdf" ? await extractPages(bytes, type) : [""];
  const scanned = pages.map(needsOcr);
  if (scanned.some(Boolean)) {
    assertLocal(ocrUrl, "Local AI (OCR)");
    const { ocrPages } = await import("./local-ai.ts");
    const ocr = await ocrPages(bytes, n).catch((e: unknown) => { throw new VaultError(`OCR on this PC failed: ${e instanceof Error ? e.message : e}`, 502); });
    pages.forEach((_, i) => { if (scanned[i]) pages[i] = ocr[i] ?? ""; });
  }
  assertLocal(llm, "the local model URL");
  const r = await chatLocal(intakePrompt(pages), SYSTEM, { signal, timeoutMs: 300_000, numCtx: 16_384 })
    .catch((e: unknown) => { throw new VaultError(`The local model didn't answer (${e instanceof Error ? e.message : e}). Is Ollama running?`, 502); });
  const fields = markUncertain(parseFields(r.text, pages.length), pages);
  return save({ v: 1, fileId: meta.id, file: n, hash: meta.hash, model: LOCAL_MODEL, at: Date.now(), pages: pages.map((text, i) => ({ text, ocr: scanned[i] })), fields });
}

/** The owner corrects one field (by its index); only the sidecar changes. */
export async function correctIntake(name: unknown, index: unknown, value: unknown): Promise<Sidecar> {
  const s = await readIntake(name);
  if (!s) throw new VaultError("Run intake on this file first.", 404);
  const next = correct(s, index, value, Date.now());
  if (!next) throw new VaultError("Unknown field or empty value.");
  return save(next);
}
