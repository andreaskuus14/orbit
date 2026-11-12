// Parses one PDF or Word document off the main thread (see extract.ts): a hostile file can only exhaust this worker.
import { parentPort, workerData } from "node:worker_threads";

const { data, type, pages } = workerData;
try {
  if (type === "application/pdf") {
    const { extractText } = await import("unpdf");
    const r = await extractText(new Uint8Array(data), { mergePages: !pages });
    // pages: one string per page (VAULT intake); otherwise one text
    parentPort.postMessage(pages ? { pages: [r.text].flat() } : { text: Array.isArray(r.text) ? r.text.join("\n") : r.text });
  } else {
    const m = await import("mammoth");
    parentPort.postMessage({ text: (await (m.default ?? m).extractRawText({ buffer: Buffer.from(data) })).value });
  }
} catch (e) {
  parentPort.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
