// Natural voice, in the browser: Kokoro-82M (ONNX, ~90 MB q8, cached by the browser after the first load). No API cost.
// Runs in a worker so the galaxy never stalls while it speaks. Messages: {id, text, voice, speed} → {id, audio, rate} | {id, error}.
import { KokoroTTS } from "kokoro-js";

let tts: Promise<KokoroTTS> | null = null;
const load = () => (tts ??= (async () => {
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  return KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", gpu ? { dtype: "fp32", device: "webgpu" } : { dtype: "q8", device: "wasm" });
})());

self.onmessage = async (e: MessageEvent<{ id: number; text?: string; voice?: string; speed?: number; warm?: boolean }>) => {
  const { id, text, voice = "af_heart", speed = 1, warm } = e.data;
  try {
    const t = await load();
    if (warm || !text) return self.postMessage({ id, ready: true });
    const out = await t.generate(text, { voice: voice as Parameters<KokoroTTS["generate"]>[1] extends { voice?: infer V } ? V : never, speed });
    const audio = out.audio as Float32Array;
    self.postMessage({ id, audio, rate: out.sampling_rate }, { transfer: [audio.buffer] });
  } catch (err) {
    tts = null; // let a later call retry the load
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
