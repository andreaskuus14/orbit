// Kokoro-82M (kokoro-js) in its own child process (host: clips/kokoro.ts, fork + IPC). Plain JS, loaded by path, never bundled.
// Why a separate process:
//  - kokoro-js loads phonemizer, whose Emscripten code installs process handlers that re-throw every uncaught error and unhandled
//    rejection. Here they only see this process, which can die and be restarted; the server's own error policy (crash-log.ts) stays
//    in charge.
//  - onnxruntime-node can't run in a second thread of the server's process while the server uses it too (local embeddings): V8 aborts
//    the whole process ("Entering the V8 API without proper locking", seen 2026-11-06). A process has its own copy.
//  - synthesis is CPU-heavy and no longer blocks the server's event loop.
const send = (m) => process.send?.(m);
process.on("disconnect", () => process.exit(0)); // ORBIT stopped or restarted: don't linger
const { KokoroTTS } = await import("kokoro-js");
send({ loaded: true }); // phonemizer is evaluated now
let tts;
try { tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" }); }
catch (e) { send({ fatal: String(e?.message ?? e).slice(0, 300) }); process.exit(1); }
process.on("message", async ({ id, text, voice, speed }) => {
  try {
    const out = await tts.generate(text, { voice, ...(speed ? { speed } : {}) });
    send({ id, audio: out.audio, rate: out.sampling_rate });
  } catch (e) { send({ id, error: String(e?.message ?? e).slice(0, 300) }); }
});
send({ ready: true });
