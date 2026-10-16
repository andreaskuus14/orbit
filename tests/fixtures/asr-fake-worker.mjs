// Stands in for src/lib/asr-worker.mjs in tests: same protocol, no model. options: {ms, crash, hang}.
import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ id, model, audio, options = {} }) => {
  if (model === "broken") return parentPort.postMessage({ id, error: "onnxruntime failed to load", load: true });
  if (model === "offline") return parentPort.postMessage({ id, error: "could not download model" });
  if (!audio) return parentPort.postMessage({ id, result: null });
  if (options.crash) process.exit(3);
  if (options.hang) return;
  if (options.fail) return parentPort.postMessage({ id, error: "no alignment heads" });
  setTimeout(() => parentPort.postMessage({ id, result: { text: `${model}:${audio.length}`, chunks: [{ text: " hi", timestamp: [0, 0.5] }] } }), options.ms ?? 0);
});
parentPort.postMessage({ ready: true });
