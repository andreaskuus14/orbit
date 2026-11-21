// Voice / background separation (sherpa-onnx-node OfflineSourceSeparation, Spleeter 2-stems) in a child process, forked by dub.ts through
// asr-pool's createPool: sherpa's own onnxruntime never loads in the Next server and a native crash kills only this child. Plain ESM, never bundled.
// In:  {id, config, audio?: Float32Array (mono), rate?}  (no audio = just load)
// Out: {id, result: {voice: Float32Array, background: Float32Array, rate}} | {id, error, load?} | {id, phase: "loading"}; {ready: true} once.
const send = (m) => process.send?.(m);
let sep = null; // Promise<OfflineSourceSeparation>, loaded once per child

function load(id, config) {
  if (!sep) {
    send({ id, phase: "loading" });
    sep = import("sherpa-onnx-node").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); })
      .then((m) => new (m.default ?? m).OfflineSourceSeparation(config));
    sep.catch(() => { sep = null; });
  }
  return sep;
}
const mono = (chs) => {
  if (chs.length === 1) return Float32Array.from(chs[0]);
  const out = new Float32Array(chs[0].length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (chs[0][i] + chs[1][i]);
  return out;
};

process.on("message", async ({ id, config, audio, rate }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let s;
  try { s = await load(id, config); } catch (e) { return send({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  if (!audio) return send({ id, result: null });
  try {
    const r = s.process({ samples: [audio], sampleRate: rate }); // Spleeter: stem 0 = vocals, stem 1 = accompaniment
    send({ id, result: { voice: mono(r.stems[0]), background: mono(r.stems[1]), rate: r.sampleRate } });
  } catch (e) {
    send({ id, error: msg(e) });
  }
});
process.on("disconnect", () => process.exit(0));
send({ ready: true });
