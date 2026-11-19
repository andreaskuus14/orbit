// Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) through sherpa-onnx: the clip transcriber. Faster and more accurate than
// Whisper base on CPU, punctuated, word timings, 25 European languages (English, Estonian, German...). parakeet.ts runs it.
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

export type ParakeetResult = { tokens?: string[]; timestamps?: number[]; durations?: number[] };

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
