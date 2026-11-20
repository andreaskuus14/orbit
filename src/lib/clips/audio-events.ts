// Audio-event tagger runner (pure parts: audio-events-pure.ts). Same shape as parakeet.ts: the model downloads once into <studio>/models
// (hash-checked, stall timeout, unpacked with the system tar), here in the server and needing no native code; tagging runs in a child
// process (audio-events-worker.mjs over asr-pool's createPool), never in the server.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { availableParallelism } from "node:os";
import path from "node:path";
import { AUDIO_EVENTS, BUDGET_MS, HOP_SEC, MIN_PROB, WIN_SEC, audioEventsConfig, eventCurve, eventPieces, parseLabelMap, parseWins, wantAudioEvents, type EventCurve, type EventWin } from "./audio-events-pure";
import { DOWNLOAD_STALL_MS, sherpaFiles } from "./parakeet-pure";
import { createPool, type AsrPhase } from "../asr-pool";
import type { Span } from "./pure";

const LOAD_MS = 2 * 60_000, RUN_MS = 3 * 60_000; // 27 MB model; a 60 s piece is ~60 windows (a few seconds of CPU)

type Pool = ReturnType<typeof createPool>;
// On globalThis so dev hot reloads keep one download and one child.
const S = globalThis as unknown as { __orbitAevDl?: Promise<string> | null; __orbitAevPool?: Pool };

export const audioEventsDir = (modelsDir: string) => path.join(modelsDir, AUDIO_EVENTS.dir);
export const audioEventsInstalled = async (modelsDir: string) =>
  (await Promise.all(AUDIO_EVENTS.files.map((f) => stat(path.join(audioEventsDir(modelsDir), f)).then((s) => s.size > 0, () => false)))).every(Boolean);

/** sherpa-onnx-node is installed (it's the same addon as Parakeet's), the worker hasn't given up and ORBIT_AUDIO_EVENTS isn't 0. File checks only. */
export const audioEventsAvailable = () =>
  wantAudioEvents(process.env.ORBIT_AUDIO_EVENTS) && !S.__orbitAevPool?.dead && sherpaFiles(process.cwd(), process.platform, process.arch, path.join).every((f) => existsSync(f));

async function download(modelsDir: string, onPhase: (p: AsrPhase) => void) {
  await mkdir(modelsDir, { recursive: true });
  const part = path.join(modelsDir, `${AUDIO_EVENTS.dir}.tar.bz2.part`), tmp = path.join(modelsDir, `${AUDIO_EVENTS.dir}.unpack`);
  const ac = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const alive = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(new Error(`Audio-event model download stalled (no data for ${DOWNLOAD_STALL_MS / 1000} s); it will retry next time`)), DOWNLOAD_STALL_MS); };
  let out: ReturnType<typeof createWriteStream> | undefined;
  try {
    alive();
    const res = await fetch(AUDIO_EVENTS.url, { redirect: "follow", signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`Audio-event model download failed: HTTP ${res.status}`);
    const hash = createHash("sha256"), file = (out = createWriteStream(part));
    const failed = new Promise<never>((_, bad) => file.once("error", bad));
    failed.catch(() => {});
    let got = 0, shown = -1;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      alive();
      hash.update(chunk); got += chunk.length;
      if (!file.write(chunk)) await Promise.race([new Promise<void>((r) => file.once("drain", () => r())), failed]);
      const f = Math.min(1, got / AUDIO_EVENTS.bytes);
      if (Math.floor(f * 100) !== shown) { shown = Math.floor(f * 100); onPhase({ phase: "downloading", f }); }
    }
    clearTimeout(stall);
    await Promise.race([new Promise<void>((ok, bad) => file.end((e?: Error | null) => (e ? bad(e) : ok()))), failed]);
    out = undefined;
    if (hash.digest("hex") !== AUDIO_EVENTS.sha256) throw new Error("Audio-event model download was damaged (hash mismatch); it will retry next time");
    await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
    // Only the int8 model + labels (27 MB) of the 111 MB archive.
    await new Promise<void>((ok, bad) => execFile("tar", ["-xjf", part, "-C", tmp, ...AUDIO_EVENTS.files.map((f) => `${AUDIO_EVENTS.archiveDir}/${f}`)], { timeout: 5 * 60_000 }, (e) => (e ? bad(e) : ok())));
    await rm(audioEventsDir(modelsDir), { recursive: true, force: true });
    await rename(path.join(tmp, AUDIO_EVENTS.archiveDir), audioEventsDir(modelsDir));
  } catch (e) {
    throw ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : e;
  } finally {
    clearTimeout(stall);
    out?.destroy();
    await Promise.all([rm(tmp, { recursive: true, force: true }), rm(part, { force: true })]).catch(() => {});
  }
}

/** The model folder; downloads it once (shared by every caller) when it's missing. */
export function ensureAudioEventsModel(modelsDir: string, onPhase: (p: AsrPhase) => void = () => {}): Promise<string> {
  const p = S.__orbitAevDl ??= (async () => {
    if (!(await audioEventsInstalled(modelsDir))) await download(modelsDir, onPhase);
    return audioEventsDir(modelsDir);
  })();
  p.catch(() => { if (S.__orbitAevDl === p) S.__orbitAevDl = null; }); // let the next use retry
  return p;
}

const pool = (): Pool => (S.__orbitAevPool ??= createPool(path.join(process.cwd(), "src/lib/clips/audio-events-worker.mjs"), 1, 30_000, "AudioEvents"));

export type EventTagger = (audio: Float32Array, offsetSec: number) => Promise<EventWin[]>;

/** Downloads the model if needed, loads it in the child, then tags 16 kHz mono pieces (windows of WIN_SEC every HOP_SEC).
 *  Rejects when the child can't start, the addon won't load (NoWorkerError) or the download fails: callers go on without events. */
export async function eventTagger(modelsDir: string, onPhase?: (p: AsrPhase) => void): Promise<EventTagger> {
  const dir = await ensureAudioEventsModel(modelsDir, onPhase);
  const labels = parseLabelMap(await readFile(path.join(dir, "class_labels_indices.csv"), "utf8"));
  if (!labels.size) throw new Error("Audio-event labels file has none of the expected classes");
  const config = audioEventsConfig(dir, Math.min(2, availableParallelism() - 1), path.join), want = [...labels.keys()], p = pool();
  onPhase?.({ phase: "loading" });
  await p.run({ config }, LOAD_MS);
  return async (audio, offsetSec) => parseWins(await p.run({ config, want, audio, winSec: WIN_SEC, hopSec: HOP_SEC, minProb: MIN_PROB }, RUN_MS), labels, offsetSec);
}

/** Tags the given spans of the video (time-boxed: stops at BUDGET_MS, what's left stays unknown) and returns the per-second event curve,
 *  or null when nothing was tagged. `read` gives the 16 kHz PCM of [from, to). */
export async function tagSpans(spans: Span[], secs: number, read: (from: number, to: number) => Promise<Float32Array>, signal: AbortSignal,
  modelsDir: string, onPhase?: (p: AsrPhase) => void, budgetMs = BUDGET_MS): Promise<EventCurve | null> {
  const tag = await eventTagger(modelsDir, onPhase), t0 = Date.now(), wins: EventWin[] = [];
  for (const piece of eventPieces(spans)) {
    signal.throwIfAborted();
    if (Date.now() - t0 > budgetMs) break;
    const audio = await read(piece.from, piece.to);
    if (audio.length >= WIN_SEC * 16000) wins.push(...(await tag(audio, piece.from)));
  }
  return eventCurve(wins, secs);
}
