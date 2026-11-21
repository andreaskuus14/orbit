// Estonian speaking (Piper et_EE "news" voice, onnxruntime-node; phonemes from espeak-ng compiled to WebAssembly) in a child process,
// forked by voice-et.ts through asr-pool's createPool. Like kokoro-worker.mjs: synthesis is CPU-heavy, and onnxruntime must not run in
// a second thread of the server. Plain ESM loaded by path, never bundled. Text → ids logic is in voice-et-pure.ts (passed in as data).
// In:  {id, dir, model, json, clauses?: {text, punct}[], speaker, length}  (no clauses = just load)
// Out: {id, result: {audio: Float32Array, rate} | null} | {id, error, load?} | {id, phase: "loading"}; {ready: true} once on start.
import { readFile } from "node:fs/promises";
import path from "node:path";
const send = (m) => process.send?.(m);
let voice; // Promise<{ session, cfg, ort, espeak }>

function load(id, dir, model, json) {
  if (voice) return voice;
  send({ id, phase: "loading" });
  voice = (async () => {
    let ort, init;
    try { ort = await import("onnxruntime-node"); init = (await import("@echogarden/espeak-ng-emscripten")).default; }
    catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); }
    const cfg = JSON.parse(await readFile(path.join(dir, json), "utf8"));
    const session = await (ort.default ?? ort).InferenceSession.create(path.join(dir, model), { intraOpNumThreads: 4 });
    const m = await init(), w = new m.eSpeakNGWorker();
    w.set_voice(cfg.espeak?.voice ?? "et", "", 0, 0, 0);
    const ipa = (t) => { const p = w.text_to_phonemes(t, true).ptr, u = m.HEAPU8; let e = p; while (u[e]) e++; return Buffer.from(u.subarray(p, e)).toString("utf8"); };
    return { session, cfg, ort: ort.default ?? ort, ipa };
  })();
  voice.catch(() => { voice = undefined; });
  return voice;
}

process.on("message", async ({ id, dir, model, json, clauses, speaker, length }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let v;
  try { v = await load(id, dir, model, json); } catch (e) { return send({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  if (!clauses) return send({ id, result: null });
  try {
    const ph = clauses.map((c) => ({ ipa: v.ipa(c.text).replace(/_/g, "").replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim(), punct: c.punct }));
    const ids = pipeIds(ph, v.cfg.phoneme_id_map);
    const { ort, session } = v, inf = v.cfg.inference ?? {};
    const feeds = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from([inf.noise_scale ?? 0.5, (inf.length_scale ?? 1) * (length || 1), inf.noise_w ?? 0.333]), [3]),
    };
    if (session.inputNames.includes("sid")) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(speaker ?? 0)]), [1]);
    const out = await session.run(feeds);
    const audio = Float32Array.from(out[session.outputNames[0]].data);
    // Piper's own player normalizes each sentence to full scale; the raw output peaks at ~0.1-0.3, much quieter than Kokoro.
    let peak = 0;
    for (const x of audio) peak = Math.max(peak, Math.abs(x));
    const gain = Math.min(10, 0.9 / Math.max(peak, 0.01));
    for (let i = 0; i < audio.length; i++) audio[i] *= gain;
    send({ id, result: { audio, rate: v.cfg.audio?.sample_rate ?? 22050 } });
  } catch (e) {
    send({ id, error: msg(e) });
  }
});

// Same as piperIds in voice-et-pure.ts (tested there; kept in step by tests/voice-et.test.ts): ^ _ p _ p _ … $.
function pipeIds(phonemes, map) {
  const id = (c) => map[c]?.[0];
  const pad = id("_") ?? 0, ids = [id("^") ?? 1, pad];
  const text = phonemes.map((p) => p.ipa + p.punct).filter(Boolean).join(" ");
  for (const c of Array.from(text.normalize("NFD"))) { const i = id(c); if (i !== undefined) ids.push(i, pad); }
  ids.push(id("$") ?? 2);
  return ids;
}
process.on("disconnect", () => process.exit(0));
send({ ready: true });
