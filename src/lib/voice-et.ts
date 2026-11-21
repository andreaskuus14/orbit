// Estonian voice on this PC (pure parts and model choice: voice-et-pure.ts). The models download once into <studio>/models (each file
// pinned by revision and sha256, ~230 MB together), here in the server; nothing native loads here. Listening runs in
// voice-et-asr-worker.mjs (sherpa-onnx), speaking in voice-et-tts-worker.mjs (onnxruntime-node + espeak-ng WebAssembly), each its own
// child process over asr-pool's createPool: a native crash kills only that child, and the server's own onnxruntime is never touched.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { createPool, type AsrPhase } from "./asr-pool";
import { studioRoot } from "./clips/factory";
import { DOWNLOAD_STALL_MS } from "./clips/parakeet-pure";
import { clauses, etSpeaker, ET_ASR, ET_TTS, hfUrl, lengthScale, zipformerConfig } from "./voice-et-pure";

const LOAD_MS = 5 * 60_000, RUN_MS = 2 * 60_000, TTS_MS = 60_000;
type Pool = ReturnType<typeof createPool>;
type Part = "asr" | "tts";
const S = globalThis as unknown as { __orbitEt?: { dl: Partial<Record<Part, Promise<string> | null>>; pools: Partial<Record<Part, Pool>>; installed: Partial<Record<Part, boolean>>; failed: Partial<Record<Part, string>> } };
const st = () => (S.__orbitEt ??= { dl: {}, pools: {}, installed: {}, failed: {} });

export const etModelsDir = () => path.join(studioRoot(), "models");
const spec = (p: Part) => (p === "asr" ? { dir: ET_ASR.dir, files: ET_ASR.files, url: (f: string) => hfUrl(ET_ASR.repo, ET_ASR.rev, f) }
  : { dir: ET_TTS.dir, files: ET_TTS.files, url: (f: string) => hfUrl(ET_TTS.repo, ET_TTS.rev, ET_TTS.base + f) });
const dirOf = (p: Part) => path.join(etModelsDir(), spec(p).dir);

/** Every file is there with the pinned size. Cached once true. */
export async function etInstalled(p: Part): Promise<boolean> {
  if (st().installed[p]) return true;
  const ok = (await Promise.all(spec(p).files.map((f) => stat(path.join(dirOf(p), f.name)).then((s) => s.size === f.bytes, () => false)))).every(Boolean);
  if (ok) st().installed[p] = true;
  return ok;
}

/** Status for Settings / the speak route: on disk, downloading, or the last failure. */
export const etStatus = async () => ({
  asr: (await etInstalled("asr")) ? "ready" : st().dl.asr ? "downloading" : st().failed.asr ? "failed" : "missing",
  tts: (await etInstalled("tts")) ? "ready" : st().dl.tts ? "downloading" : st().failed.tts ? "failed" : "missing",
});

async function fetchPinned(url: string, dest: string, sha256: string, onBytes: (n: number) => void) {
  const part = `${dest}.part`, ac = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const alive = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error(`Estonian voice download stalled (no data for ${DOWNLOAD_STALL_MS / 1000} s); it will retry next time`)), DOWNLOAD_STALL_MS); };
  let out: ReturnType<typeof createWriteStream> | undefined;
  try {
    alive();
    const res = await fetch(url, { redirect: "follow", signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`Estonian voice download failed: HTTP ${res.status}`);
    const hash = createHash("sha256"), file = (out = createWriteStream(part));
    const failed = new Promise<never>((_, bad) => file.once("error", bad));
    failed.catch(() => {});
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      alive();
      hash.update(chunk); onBytes(chunk.length);
      if (!file.write(chunk)) await Promise.race([new Promise<void>((r) => file.once("drain", () => r())), failed]);
    }
    clearTimeout(stall);
    await Promise.race([new Promise<void>((ok, bad) => file.end((e?: Error | null) => (e ? bad(e) : ok()))), failed]);
    out = undefined;
    if (hash.digest("hex") !== sha256) throw new Error("Estonian voice download was damaged (hash mismatch); it will retry next time");
    await rename(part, dest);
  } catch (e) {
    throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : e;
  } finally {
    clearTimeout(stall);
    out?.destroy();
    await rm(part, { force: true }).catch(() => {});
  }
}

/** The model folder; downloads the missing files once (shared by every caller). */
export function ensureEt(p: Part, onPhase?: (ph: AsrPhase) => void): Promise<string> {
  const s = st();
  const run = s.dl[p] ??= (async () => {
    if (!(await etInstalled(p))) {
      const { files, url } = spec(p), dir = dirOf(p), total = files.reduce((n, f) => n + f.bytes, 0);
      await mkdir(dir, { recursive: true });
      let got = 0, shown = -1;
      for (const f of files) {
        const dest = path.join(dir, f.name);
        if ((await stat(dest).then((x) => x.size, () => -1)) === f.bytes) { got += f.bytes; continue; }
        await fetchPinned(url(f.name), dest, f.sha256, (n) => { got += n; const pc = Math.floor((100 * got) / total); if (pc !== shown) { shown = pc; onPhase?.({ phase: "downloading", f: got / total }); } });
      }
      s.installed[p] = true;
      console.log(`[orbit] Estonian ${p === "asr" ? "listening" : "voice"} model downloaded`);
    }
    s.failed[p] = undefined;
    return dirOf(p);
  })();
  run.catch((e) => { s.failed[p] = e instanceof Error ? e.message : String(e); if (s.dl[p] === run) s.dl[p] = null; });
  run.then(() => { if (s.dl[p] === run) s.dl[p] = null; }, () => {});
  return run;
}

const pool = (p: Part): Pool => (st().pools[p] ??= createPool(path.join(process.cwd(), `src/lib/voice-et-${p}-worker.mjs`), 1, 30_000, p === "asr" ? "Estonian ASR" : "Estonian voice"));
/** The worker gave up for good (addon or runtime won't load here). */
export const etDead = (p: Part) => !!st().pools[p]?.dead;
const threads = () => availableParallelism() - 1;

/** 16 kHz mono → Estonian text (punctuated). Rejects when the model is missing or its child can't run: callers fall back. */
export async function transcribeEt(audio: Float32Array): Promise<string> {
  const config = zipformerConfig(await ensureEt("asr"), threads(), path.join), p = pool("asr");
  await p.run({ config }, LOAD_MS);
  const r = (await p.run({ config, audio }, RUN_MS)) as { text?: string } | null;
  return (r?.text ?? "").replace(/\s+/g, " ").trim();
}

/** Loads the listening model in its child (and downloads it the first time). */
export async function warmEtAsr(): Promise<void> {
  await pool("asr").run({ config: zipformerConfig(await ensureEt("asr"), threads(), path.join) }, LOAD_MS);
}

export type EtVoice = { voice?: string | null; rate?: number };
/** Estonian text → audio (22.05 kHz mono). Speakers: Mari (default), Vesta, Albert, Kalev. */
export async function speakEt(text: string, o: EtVoice = {}): Promise<{ audio: Float32Array; rate: number }> {
  const dir = await ensureEt("tts"), base = { dir, model: ET_TTS.model, json: `${ET_TTS.model}.json` }, p = pool("tts");
  await p.run(base, LOAD_MS);
  const cl = clauses(text);
  if (!cl.length) return { audio: new Float32Array(0), rate: 22050 };
  return (await p.run({ ...base, clauses: cl, speaker: etSpeaker(o.voice), length: lengthScale(o.rate) }, TTS_MS)) as { audio: Float32Array; rate: number };
}

/** Starts both downloads in the background (Settings picked Eesti / auto). Never throws. */
export function prefetchEt(): void {
  for (const p of ["asr", "tts"] as const) ensureEt(p).catch((e) => console.error(`[orbit] Estonian ${p} download failed:`, e instanceof Error ? e.message : e));
}
