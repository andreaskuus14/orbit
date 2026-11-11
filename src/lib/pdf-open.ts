import { getDocumentProxy } from "unpdf";

/** Page count of a PDF via pdf.js (unpdf). Server-only: injected into checkPdf so client bundles never reach unpdf. */
export async function pdfPages(bytes: Uint8Array): Promise<number> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const n = doc.numPages; void doc.cleanup?.();
  return n;
}
