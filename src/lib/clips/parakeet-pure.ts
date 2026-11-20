// Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) through sherpa-onnx: the clip transcriber. Faster and more accurate than
// Whisper base on CPU, punctuated, word timings, 25 European languages (English, Estonian, German...). parakeet.ts downloads it and
// runs it in child processes (parakeet-worker.mjs).
import type { Word } from "./pure.ts";

export const PARAKEET = {
  dir: "parakeet-tdt-0.6b-v3-int8",
  // sherpa-onnx's int8 export, pinned by hash (487 MB archive, ~670 MB unpacked).
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
  sha256: "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9",
  bytes: 487_211_443,
  archiveDir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
  files: ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"],
  license: "CC-BY-4.0",
} as const;

/** ORBIT_ASR=whisper keeps the old transcriber; anything else uses Parakeet when it loads. */
export const wantParakeet = (env: string | undefined) => (env ?? "").trim().toLowerCase() !== "whisper";

export type ParakeetResult = { text?: string; tokens?: string[]; timestamps?: number[]; durations?: number[] };

/** sherpa-onnx tokens → words: a token starting with a space starts a new word; punctuation sticks to the word before.
 *  `offset` moves the piece's clock onto the full video's. */
export function tokensToWords(r: ParakeetResult, offset = 0): Word[] {
  const toks = r.tokens ?? [], ts = r.timestamps ?? [], du = r.durations ?? [];
  const words: Word[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i], start = (ts[i] ?? 0) + offset, end = start + (du[i] ?? 0.08);
    const last = words.at(-1);
    if (!last || (tok.startsWith(" ") && /[\p{L}\p{N}]/u.test(tok))) words.push({ start, end, text: tok.trim() });
    else { last.text += tok.trim(); last.end = Math.max(last.end, end); }
  }
  return words.filter((w) => w.text);
}

/** No bytes for this long during the model download: abort it (the .part is deleted, the next use retries). */
export const DOWNLOAD_STALL_MS = 60_000;

/** sherpa-onnx's files under node_modules (`root` = the app folder): the JS package and this platform's native addon.
 *  Existence only, no import: STUDIO's status poll checks it every few seconds. sherpa names Windows "win", not "win32". */
export function sherpaFiles(root: string, platform: string, arch: string, join: (...p: string[]) => string): string[] {
  const pa = `${platform === "win32" ? "win" : platform}-${arch}`;
  return [join(root, "node_modules", "sherpa-onnx-node", "package.json"), join(root, "node_modules", `sherpa-onnx-${pa}`, "sherpa-onnx.node")];
}

/** Recognizer config for the worker (parakeet-worker.mjs). `dir` = the unpacked model folder. */
export function parakeetConfig(dir: string, threads: number, join: (...p: string[]) => string) {
  const f = (n: string) => join(dir, n);
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder: f("encoder.int8.onnx"), decoder: f("decoder.int8.onnx"), joiner: f("joiner.int8.onnx") }, tokens: f("tokens.txt"),
      numThreads: Math.max(1, Math.min(8, threads)), provider: "cpu", modelType: "nemo_transducer", debug: 0 },
    decodingMethod: "greedy_search",
  };
}
