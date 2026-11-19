// Parakeet runner (pure parts: parakeet-pure.ts). The model downloads once into <studio>/models on first use (hash-checked,
// unpacked with the system tar, which handles .bz2 on Windows 10+ too). Decoding runs on sherpa-onnx's own threads, so
// the server stays responsive. Loaded once and cached.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { availableParallelism } from "node:os";
import path from "node:path";
import { PARAKEET, tokensToWords, type ParakeetResult } from "./parakeet-pure";
import type { Word } from "./pure";
import type { AsrPhase } from "../asr-pool";

type Recognizer = { createStream(): { acceptWaveform(o: { samples: Float32Array; sampleRate: number }): void }; decodeAsync(s: unknown): Promise<ParakeetResult> };
const S = globalThis as unknown as { __orbitParakeet?: Promise<Recognizer> | null };

const installed = async (dir: string) => (await Promise.all(PARAKEET.files.map((f) => stat(path.join(dir, f)).then((s) => s.size > 0, () => false)))).every(Boolean);

async function download(modelsDir: string, onPhase?: (p: AsrPhase) => void) {
  await mkdir(modelsDir, { recursive: true });
  const part = path.join(modelsDir, `${PARAKEET.dir}.tar.bz2.part`), tmp = path.join(modelsDir, `${PARAKEET.dir}.unpack`);
  const res = await fetch(PARAKEET.url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Parakeet download failed: HTTP ${res.status}`);
  const hash = createHash("sha256"), out = createWriteStream(part);
  let got = 0, shown = -1;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk); got += chunk.length;
    if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    const f = Math.min(1, got / PARAKEET.bytes);
    if (Math.floor(f * 100) !== shown) { shown = Math.floor(f * 100); onPhase?.({ phase: "downloading", f }); }
  }
  await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())));
  if (hash.digest("hex") !== PARAKEET.sha256) { await rm(part, { force: true }); throw new Error("Parakeet download was damaged (hash mismatch); it will retry next time"); }
  await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
  await new Promise<void>((ok, bad) => execFile("tar", ["-xjf", part, "-C", tmp], { timeout: 10 * 60_000 }, (e) => (e ? bad(e) : ok())));
  await rm(path.join(modelsDir, PARAKEET.dir), { recursive: true, force: true });
  await rename(path.join(tmp, PARAKEET.archiveDir), path.join(modelsDir, PARAKEET.dir));
  await Promise.all([rm(tmp, { recursive: true, force: true }), rm(part, { force: true })]);
}

/** sherpa-onnx's native addon; rejects when it isn't installed or can't load on this machine. */
export async function parakeetRuntime() {
  // @ts-expect-error sherpa-onnx-node ships no types; the shape we use is typed right here
  const mod = (await import("sherpa-onnx-node")) as { default?: unknown };
  return (mod.default ?? mod) as { OfflineRecognizer: { createAsync(c: unknown): Promise<Recognizer> } }; // CommonJS package: its exports sit on default under ESM
}

/** The cached recognizer; downloads the model on first use. Rejects when sherpa-onnx-node isn't installed (caller falls back to Whisper). */
export function loadParakeet(modelsDir: string, onPhase?: (p: AsrPhase) => void): Promise<Recognizer> {
  if (S.__orbitParakeet) return S.__orbitParakeet;
  const p = (async () => {
    const sherpa = await parakeetRuntime();
    const dir = path.join(modelsDir, PARAKEET.dir);
    if (!(await installed(dir))) await download(modelsDir, onPhase);
    onPhase?.({ phase: "loading" });
    const f = (n: string) => path.join(dir, n);
    return sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { transducer: { encoder: f("encoder.int8.onnx"), decoder: f("decoder.int8.onnx"), joiner: f("joiner.int8.onnx") }, tokens: f("tokens.txt"),
        numThreads: Math.max(1, Math.min(8, availableParallelism() - 1)), provider: "cpu", modelType: "nemo_transducer", debug: 0 },
      decodingMethod: "greedy_search",
    });
  })();
  S.__orbitParakeet = p;
  p.catch(() => { if (S.__orbitParakeet === p) S.__orbitParakeet = null; }); // let the next job retry
  return p;
}

/** 16 kHz mono samples → words on the video's clock (`offset` = where these samples start). */
export async function parakeetWords(rec: Recognizer, samples: Float32Array, offset: number): Promise<Word[]> {
  const stream = rec.createStream();
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  return tokensToWords(await rec.decodeAsync(stream), offset);
}
