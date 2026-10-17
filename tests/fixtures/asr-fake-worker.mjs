// Stands in for src/lib/asr-worker.mjs in tests: same protocol, no model. options: {ms, crash, hang, fail}.
// Also flags any overlap: a second request arriving while one is in flight answers "overlap".
let busy = false;
const send = (m) => process.send(m);
process.on("message", ({ id, model, audio, options = {} }) => {
  if (busy) return send({ id, error: "overlap" });
  if (model === "broken") return send({ id, error: "onnxruntime failed to load", load: true });
  if (model === "offline") return send({ id, error: "could not download model" });
  if (!audio) {
    if (model === "fresh") { send({ id, phase: "downloading" }); send({ id, phase: "downloading", f: 0.5 }); send({ id, phase: "loading" }); }
    return send({ id, result: null });
  }
  if (options.crash) process.exit(3);
  if (options.hang) return;
  if (options.fail) return send({ id, error: "no alignment heads" });
  busy = true;
  setTimeout(() => { busy = false; send({ id, result: { text: `${model}:${audio.length}`, pid: process.pid, chunks: [{ text: " hi", timestamp: [0, 0.5] }] } }); }, options.ms ?? 0);
});
process.on("disconnect", () => process.exit(0));
send({ ready: true });
