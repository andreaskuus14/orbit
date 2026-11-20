// Parakeet (sherpa-onnx-node) in a child process, forked by parakeet.ts through asr-pool's createPool. Why not in the server:
// sherpa-onnx ships its own onnxruntime library; loaded into the Next server it clashed with onnxruntime-node there (Windows:
// "The operating system cannot run %1" for Whisper, local embeddings and kokoro-js), and a native crash would take the server
// down. Here it is alone: a crash kills only this child and the pool starts a new one. Plain ESM loaded by path, never bundled.
// The model is downloaded by the parent (parakeet.ts) before the first request; this file only loads and decodes.
// In:  {id, config, audio?}  (config = parakeetConfig(...); no audio = just load the model)
// Out: {id, result: {text, tokens, timestamps, durations} | null} | {id, error, load?} | {id, phase: "loading"}; {ready: true} once on start.
const send = (m) => process.send?.(m);
const recs = new Map(); // encoder path → Promise<OfflineRecognizer>, loaded once per child

function load(id, config) {
  const key = config?.modelConfig?.transducer?.encoder ?? "";
  let p = recs.get(key);
  if (!p) {
    send({ id, phase: "loading" });
    // Import failure = the native addon won't load on this machine: tagged so the pool gives up on Parakeet (callers use Whisper).
    p = import("sherpa-onnx-node").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); })
      .then((m) => (m.default ?? m).OfflineRecognizer.createAsync(config));
    recs.set(key, p);
    p.catch(() => recs.delete(key)); // let the next request retry
  }
  return p;
}

process.on("message", async ({ id, config, audio }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let rec;
  try { rec = await load(id, config); } catch (e) { return send({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  if (!audio) return send({ id, result: null });
  try {
    const stream = rec.createStream();
    stream.acceptWaveform({ samples: audio, sampleRate: 16000 });
    const r = await rec.decodeAsync(stream);
    send({ id, result: { text: r.text ?? "", tokens: r.tokens ?? [], timestamps: r.timestamps ?? [], durations: r.durations ?? [] } });
  } catch (e) {
    send({ id, error: msg(e) });
  }
});
process.on("disconnect", () => process.exit(0)); // the server went away: don't linger holding the model in RAM
send({ ready: true });
