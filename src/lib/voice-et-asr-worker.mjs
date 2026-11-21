// Estonian listening (TalTech Zipformer, sherpa-onnx-node) in a child process, forked by voice-et.ts through asr-pool's createPool.
// Same reasons as parakeet-worker.mjs: sherpa ships its own onnxruntime, which must never load in the Next server, and a native crash
// only kills this child. The parent downloads the model first; this file only loads and decodes. Plain ESM loaded by path, never bundled.
// In:  {id, config, audio?}  (config = zipformerConfig(...); no audio = just load the model)
// Out: {id, result: {text} | null} | {id, error, load?} | {id, phase: "loading"}; {ready: true} once on start.
const send = (m) => process.send?.(m);
const recs = new Map(); // encoder path → Promise<OnlineRecognizer>

function load(id, config) {
  const key = config?.modelConfig?.transducer?.encoder ?? "";
  let p = recs.get(key);
  if (!p) {
    send({ id, phase: "loading" });
    p = import("sherpa-onnx-node").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); })
      .then((m) => { const { kind: _k, ...c } = config; return new (m.default ?? m).OnlineRecognizer(c); });
    recs.set(key, p);
    p.catch(() => recs.delete(key));
  }
  return p;
}

process.on("message", async ({ id, config, audio }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let rec;
  try { rec = await load(id, config); } catch (e) { return send({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  if (!audio) return send({ id, result: null });
  try {
    // A streaming model fed one whole utterance: all audio, 0.6 s of silence so the last word comes out, then decode to the end.
    const st = rec.createStream();
    st.acceptWaveform({ samples: audio, sampleRate: 16000 });
    st.acceptWaveform({ samples: new Float32Array(9600), sampleRate: 16000 });
    st.inputFinished();
    while (rec.isReady(st)) rec.decode(st);
    send({ id, result: { text: rec.getResult(st).text ?? "" } });
  } catch (e) {
    send({ id, error: msg(e) });
  }
});
process.on("disconnect", () => process.exit(0));
send({ ready: true });
