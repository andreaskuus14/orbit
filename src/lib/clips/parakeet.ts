// Parakeet runner (pure parts: parakeet-pure.ts). The model downloads once into <studio>/models (hash-checked, unpacked with
// the system tar, which handles .bz2 on Windows 10+ too); that happens here, in the server, and needs no native code.
// Decoding runs in child processes (parakeet-worker.mjs over asr-pool's createPool), never in the server: sherpa-onnx ships its
// own onnxruntime library, which broke onnxruntime-node in the server process on Windows, and a native crash would take the
// server down. Two lanes like Whisper's: "voice" never waits behind clip pieces. Each child loads the model once.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { availableParallelism } from "node:os";
import path from "node:path";
import { DOWNLOAD_STALL_MS, PARAKEET, parakeetConfig, sherpaFiles, type ParakeetResult } from "./parakeet-pure";
import { createPool, type AsrPhase, type Lane } from "../asr-pool";

const LOAD_MS = 5 * 60_000; // loading ~670 MB of model files from disk
const RUN_MS: Record<Lane, number> = { voice: 2 * 60_000, clip: 10 * 60_000 }; // clip pieces are ≤ 60 s of audio

type Pool = ReturnType<typeof createPool>;
// On globalThis so dev hot reloads keep one download and one set of children.
const S = globalThis as unknown as { __orbitParakeetDl?: Promise<string> | null; __orbitParakeetPhase?: Set<(p: AsrPhase) => void>; __orbitParakeetPools?: Partial<Record<Lane, Pool>> };

export const parakeetDir = (modelsDir: string) => path.join(modelsDir, PARAKEET.dir);
/** Every model file is there (size > 0). */
export const parakeetInstalled = async (modelsDir: string) =>
  (await Promise.all(PARAKEET.files.map((f) => stat(path.join(parakeetDir(modelsDir), f)).then((s) => s.size > 0, () => false)))).every(Boolean);

/** sherpa-onnx-node and its native addon are installed and the worker hasn't given up. File checks only, no import (status polls call this). */
export function parakeetAvailable(): boolean {
  if (Object.values(S.__orbitParakeetPools ?? {}).some((p) => p?.dead)) return false; // the addon wouldn't load in a child
  return sherpaFiles(process.cwd(), process.platform, process.arch, path.join).every((f) => existsSync(f));
}

async function download(modelsDir: string, onPhase: (p: AsrPhase) => void) {
  await mkdir(modelsDir, { recursive: true });
  const part = path.join(modelsDir, `${PARAKEET.dir}.tar.bz2.part`), tmp = path.join(modelsDir, `${PARAKEET.dir}.unpack`);
  // Stall guard: no bytes for DOWNLOAD_STALL_MS (also while waiting for the response) aborts the fetch.
  const ac = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const alive = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error(`Parakeet download stalled (no data for ${DOWNLOAD_STALL_MS / 1000} s); it will retry next time`)), DOWNLOAD_STALL_MS); };
  let out: ReturnType<typeof createWriteStream> | undefined;
  try {
    alive();
    const res = await fetch(PARAKEET.url, { redirect: "follow", signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`Parakeet download failed: HTTP ${res.status}`);
    const hash = createHash("sha256"), file = (out = createWriteStream(part));
    const failed = new Promise<never>((_, bad) => file.once("error", bad)); // disk full etc.
    failed.catch(() => {});
    let got = 0, shown = -1;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      alive();
      hash.update(chunk); got += chunk.length;
      if (!file.write(chunk)) await Promise.race([new Promise<void>((r) => file.once("drain", () => r())), failed]);
      const f = Math.min(1, got / PARAKEET.bytes);
      if (Math.floor(f * 100) !== shown) { shown = Math.floor(f * 100); onPhase({ phase: "downloading", f }); }
    }
    clearTimeout(stall);
    await Promise.race([new Promise<void>((ok, bad) => file.end((e?: Error | null) => (e ? bad(e) : ok()))), failed]);
    out = undefined;
    if (hash.digest("hex") !== PARAKEET.sha256) throw new Error("Parakeet download was damaged (hash mismatch); it will retry next time");
    await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
    await new Promise<void>((ok, bad) => execFile("tar", ["-xjf", part, "-C", tmp], { timeout: 10 * 60_000 }, (e) => (e ? bad(e) : ok())));
    await rm(parakeetDir(modelsDir), { recursive: true, force: true });
    await rename(path.join(tmp, PARAKEET.archiveDir), parakeetDir(modelsDir));
  } catch (e) {
    throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : e;
  } finally { // success or failure: no stall timer, no open file, no leftovers (a half .part never gets reused)
    clearTimeout(stall);
    out?.destroy();
    await Promise.all([rm(tmp, { recursive: true, force: true }), rm(part, { force: true })]).catch(() => {});
  }
}

/** The model folder; downloads it once (shared by every caller, each gets the progress) when it's missing. */
export function ensureParakeetModel(modelsDir: string, onPhase?: (p: AsrPhase) => void): Promise<string> {
  const listeners = (S.__orbitParakeetPhase ??= new Set());
  if (onPhase) listeners.add(onPhase);
  const p = S.__orbitParakeetDl ??= (async () => {
    if (!(await parakeetInstalled(modelsDir))) await download(modelsDir, (ph) => { for (const l of listeners) try { l(ph); } catch { /* progress text only */ } });
    return parakeetDir(modelsDir);
  })();
  p.catch(() => { if (S.__orbitParakeetDl === p) S.__orbitParakeetDl = null; }); // let the next use retry
  if (onPhase) p.finally(() => listeners.delete(onPhase)).catch(() => {});
  return p;
}

const pool = (lane: Lane): Pool =>
  ((S.__orbitParakeetPools ??= {})[lane] ??= createPool(path.join(process.cwd(), "src/lib/clips/parakeet-worker.mjs"), 1, 30_000, "Parakeet"));

export type ParakeetDecode = (audio: Float32Array) => Promise<ParakeetResult>;

/** Downloads the model if needed (here, in the server), loads it in this lane's child, then decodes 16 kHz mono pieces there.
 *  Rejects when the child can't start or the addon won't load (NoWorkerError) or the download fails: callers use Whisper. */
export async function parakeetDecoder(lane: Lane, modelsDir: string, onPhase?: (p: AsrPhase) => void): Promise<ParakeetDecode> {
  const dir = await ensureParakeetModel(modelsDir, onPhase);
  const config = parakeetConfig(dir, availableParallelism() - 1, path.join), p = pool(lane);
  onPhase?.({ phase: "loading" });
  await p.run({ config }, LOAD_MS);
  // Not transferred: the caller keeps its buffer.
  return async (audio) => (await p.run({ config, audio }, RUN_MS[lane])) as ParakeetResult;
}
