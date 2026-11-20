// Audio tagging (sherpa-onnx-node AudioTagging) in a child process, forked by audio-events.ts through asr-pool's createPool: the same
// isolation as parakeet-worker.mjs (sherpa ships its own onnxruntime, which must never load in the Next server; a native crash kills only
// this child). Plain ESM loaded by path, never bundled. The model is downloaded by the parent before the first request.
// In:  {id, config, want?: number[], audio?: Float32Array, winSec, hopSec, minProb}  (config = audioEventsConfig(...); no audio = just load)
// Out: {id, result: [[startSec, [[classIndex, prob], ...]], ...] | null} | {id, error, load?} | {id, phase: "loading"}; {ready: true} once.
// Each window is tagged on its own (the model takes a whole clip); only the classes in `want` with prob ≥ minProb are sent back.
const send = (m) => process.send?.(m);
const taggers = new Map(); // model path → Promise<AudioTagging>, loaded once per child

function load(id, config) {
  const key = config?.model?.zipformer?.model ?? "";
  let p = taggers.get(key);
  if (!p) {
    send({ id, phase: "loading" });
    // Import failure = the native addon won't load on this machine: tagged so the pool gives up on this worker (callers go on without events).
    p = import("sherpa-onnx-node").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); })
      .then((m) => new (m.default ?? m).AudioTagging(config));
    taggers.set(key, p);
    p.catch(() => taggers.delete(key)); // let the next request retry
  }
  return p;
}

process.on("message", async ({ id, config, want, audio, winSec = 2, hopSec = 1, minProb = 0.03 }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let tagger;
  try { tagger = await load(id, config); } catch (e) { return send({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  if (!audio) return send({ id, result: null });
  try {
    const keep = want ? new Set(want) : null, rate = 16000, win = Math.round(winSec * rate), out = [];
    for (let s = 0; s + win <= audio.length; s += Math.round(hopSec * rate)) {
      const stream = tagger.createStream();
      stream.acceptWaveform({ samples: audio.subarray(s, s + win), sampleRate: rate });
      const hits = [];
      for (const e of tagger.compute(stream, 527)) if (e.prob >= minProb && (!keep || keep.has(e.index))) hits.push([e.index, Math.round(e.prob * 1e4) / 1e4]);
      out.push([s / rate, hits]);
      if (out.length % 20 === 0) await new Promise((r) => setImmediate(r)); // let a "disconnect" message through
    }
    send({ id, result: out });
  } catch (e) {
    send({ id, error: msg(e) });
  }
});
process.on("disconnect", () => process.exit(0)); // the server went away: don't linger
send({ ready: true });
