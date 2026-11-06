// Kokoro-82M (kokoro-js) in its own worker thread (host: clips/kokoro.ts). Plain JS, loaded by path, never bundled.
// Why a thread: kokoro-js loads phonemizer, whose Emscripten code installs process handlers that re-throw every uncaught error and
// unhandled rejection. Here they only see this thread, which can die and be restarted; the server's own error policy (crash-log.ts)
// stays in charge. Synthesis is CPU-heavy too, and no longer blocks the server's event loop.
import { parentPort } from "node:worker_threads";

const { KokoroTTS } = await import("kokoro-js");
parentPort.postMessage({ loaded: true }); // phonemizer is evaluated now (tests check the server thread got no handlers)
let tts;
try { tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" }); }
catch (e) { parentPort.postMessage({ fatal: String(e?.message ?? e).slice(0, 300) }); process.exit(1); }
parentPort.on("message", async ({ id, text, voice, speed }) => {
  try {
    const out = await tts.generate(text, { voice, ...(speed ? { speed } : {}) });
    parentPort.postMessage({ id, audio: out.audio, rate: out.sampling_rate }, [out.audio.buffer]);
  } catch (e) { parentPort.postMessage({ id, error: String(e?.message ?? e).slice(0, 300) }); }
});
parentPort.postMessage({ ready: true });
