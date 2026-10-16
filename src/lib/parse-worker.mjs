// Parses one PDF or Word document off the main thread (see extract.ts): a hostile file can only exhaust this worker.
import { parentPort, workerData } from "node:worker_threads";

const { data, type } = workerData;
try {
  let text = "";
  if (type === "application/pdf") {
    const { extractText } = await import("unpdf");
    const r = await extractText(new Uint8Array(data), { mergePages: true });
    text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
  } else {
    const m = await import("mammoth");
    text = (await (m.default ?? m).extractRawText({ buffer: Buffer.from(data) })).value;
  }
  parentPort.postMessage({ text });
} catch (e) {
  parentPort.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
