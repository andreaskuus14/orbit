// Whisper off the main thread: onnxruntime-node inference blocks the thread it runs on, so it runs here (see asr-pool.ts).
// Plain ESM loaded by path at runtime, so Next never bundles it.
// In:  {id, model, opts, cacheDir, audio?, options?}  (no audio = just load the model)
// Out: {id, result} | {id, error}; {ready: true} once on start.
import { parentPort } from "node:worker_threads";

const pipes = new Map(); // model id → Promise<pipeline>

function load(model, opts, cacheDir) {
  let p = pipes.get(model);
  if (!p) {
    // Import failure = native onnxruntime/sharp won't load in a worker: tagged so the pool goes in-process.
    p = import("@huggingface/transformers").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); }).then((tf) => {
      tf.env.cacheDir = cacheDir;
      return tf.pipeline("automatic-speech-recognition", model, opts);
    });
    pipes.set(model, p);
    p.catch(() => pipes.delete(model)); // let the next request retry a failed download
  }
  return p;
}

parentPort.on("message", async ({ id, model, opts, cacheDir, audio, options }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let asr;
  // A failed model download stays a plain error: the lane keeps its worker and retries next time.
  try { asr = await load(model, opts, cacheDir); } catch (e) { return parentPort.postMessage({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  try {
    parentPort.postMessage({ id, result: audio ? await asr(audio, options) : null });
  } catch (e) {
    parentPort.postMessage({ id, error: msg(e) });
  }
});
parentPort.postMessage({ ready: true });
