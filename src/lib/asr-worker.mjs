// Whisper in a child process (forked by asr-pool.ts): onnxruntime-node blocks the thread it runs on and isn't safe across worker
// threads, and a native crash here only kills this process. The pool sends one request at a time, so loads and runs never overlap.
// Plain ESM loaded by path at runtime, so Next never bundles it.
// In:  {id, model, opts, cacheDir, audio?, options?}  (no audio = just load the model)
// Out: {id, result} | {id, error} | {id, phase: "downloading"|"loading", f?}; {ready: true} once on start.
import { existsSync } from "node:fs";
import path from "node:path";

const send = (m) => process.send?.(m);
const pipes = new Map(); // model id → Promise<pipeline>

function load(id, model, opts, cacheDir) {
  let p = pipes.get(model);
  if (!p) {
    // transformers.js' FileCache keeps <cacheDir>/<model>/onnx/*: missing = first run, the model gets downloaded.
    const downloading = !existsSync(path.join(cacheDir, ...model.split("/"), "onnx"));
    send({ id, phase: downloading ? "downloading" : "loading" });
    const files = new Map(); // file → [loaded, total]
    let shown = 0;
    const progress_callback = (e) => {
      if (!downloading) return;
      if (e.status !== "progress" || !e.total || shown < 0) return;
      files.set(e.file, [e.loaded, e.total]);
      let l = 0, t = 0;
      for (const [a, b] of files.values()) { l += a; t += b; }
      // Every .onnx file in: downloaded, the sessions start now (shown < 0: no more download updates).
      if (l >= t && [...files.keys()].some((f) => f.endsWith(".onnx"))) { shown = -1; return send({ id, phase: "loading" }); }
      if (Date.now() - shown < 1000) return;
      shown = Date.now();
      send({ id, phase: "downloading", f: l / t });
    };
    // Import failure = native onnxruntime/sharp won't load here: tagged so the pool goes in-process.
    p = import("@huggingface/transformers").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); }).then((tf) => {
      tf.env.cacheDir = cacheDir;
      return tf.pipeline("automatic-speech-recognition", model, { ...opts, progress_callback });
    });
    pipes.set(model, p);
    p.catch(() => pipes.delete(model)); // let the next request retry a failed download
  }
  return p;
}

// Whisper's own language guess: one decoder step after <|startoftranscript|>, the best-scoring <|xx|> token.
// transformers.js has no detection of its own (with no language it silently assumes English).
// Out: {language: "en" | "zh" | …} or {language: null} for an English-only model (nothing to detect).
async function detectLanguage(asr, audio) {
  const gc = asr.model.generation_config;
  if (!gc?.is_multilingual || !gc.lang_to_id) return { language: null };
  const tf = await import("@huggingface/transformers");
  const { input_features } = await asr.processor(audio);
  const start = new tf.Tensor("int64", BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
  const logits = (await asr.model({ input_features, decoder_input_ids: start })).logits.data;
  let best = null, max = -Infinity;
  for (const [tok, i] of Object.entries(gc.lang_to_id)) if (logits[i] > max) { max = logits[i]; best = tok; }
  return { language: best ? best.replace(/^<\|(.*)\|>$/, "$1") : null };
}

process.on("message", async ({ id, model, opts, cacheDir, audio, options }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let asr;
  // A failed model download stays a plain error: the lane keeps its child and retries next time.
  try { asr = await load(id, model, opts, cacheDir); } catch (e) { return send({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  try {
    send({ id, result: !audio ? null : options?.detectLanguage ? await detectLanguage(asr, audio) : await asr(audio, options) });
  } catch (e) {
    send({ id, error: msg(e) });
  }
});
process.on("disconnect", () => process.exit(0)); // the server went away: don't linger holding a model in RAM
send({ ready: true });
