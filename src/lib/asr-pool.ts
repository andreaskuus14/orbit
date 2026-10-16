import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import path from "node:path";

// Whisper runs in worker threads (src/lib/asr-worker.mjs) so a clip job's transcription doesn't stall the server.
// Two lanes, each its own workers: "voice" (1 worker) never waits behind clip pieces; "clip" has asrWorkers() workers.
// Each worker loads its own model copy, so keep the clip lane small. If a worker can't start, everything falls back
// to the old in-process path.

export type Lane = "voice" | "clip";
export type Asr = (audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>;
type Pipe = (model: string, opts: Record<string, unknown>, cacheDir: string) => Promise<Asr>;

const LOAD_MS = 30 * 60_000; // first load may download the model
const RUN_MS: Record<Lane, number> = { voice: 2 * 60_000, clip: 20 * 60_000 };

/** Clip-lane worker count: ORBIT_ASR_WORKERS, else 2 on 8+ cores, else 1. */
export const asrWorkers = () => Math.max(1, Number(process.env.ORBIT_ASR_WORKERS) || (cpus().length >= 8 ? 2 : 1));

export class NoWorkerError extends Error {}

type Job = { msg: Record<string, unknown>; ms: number; resolve: (v: unknown) => void; reject: (e: Error) => void };
type Slot = { w: Worker; ready: boolean; gone?: boolean; job?: Job & { id: number }; timer?: ReturnType<typeof setTimeout> };

/** FIFO queue over up to `size` workers running `script`. Workers start on demand; a crashed one fails its request and is replaced. */
export function createPool(script: string, size: number) {
  const queue: Job[] = [];
  const slots: Slot[] = [];
  let seq = 0, dead = false;

  const finish = (s: Slot) => { clearTimeout(s.timer); const j = s.job; s.job = undefined; s.w.unref(); return j; };

  function fail(e: unknown) { // the worker can't start or can't load the model: give up on workers for good
    if (dead) return;
    dead = true;
    console.error("[orbit] ASR worker unusable, transcribing in-process:", e instanceof Error ? e.message : e);
    const err = new NoWorkerError("no ASR worker");
    for (const s of slots.splice(0)) { s.gone = true; finish(s)?.reject(err); void s.w.terminate(); }
    for (const j of queue.splice(0)) j.reject(err);
  }

  function gone(s: Slot, e: Error) {
    if (s.gone) return; // "error" is followed by "exit"
    s.gone = true;
    slots.splice(slots.indexOf(s), 1);
    if (!s.ready) return fail(e);
    finish(s)?.reject(e);
    pump(); // a replacement starts if work is waiting
  }

  function spawn() {
    let w: Worker;
    try { w = new Worker(script); } catch (e) { return fail(e); }
    const s: Slot = { w, ready: false };
    slots.push(s);
    w.unref(); // idle workers don't keep the process alive; ref'd while busy
    w.on("message", (m: { id?: number; ready?: boolean; result?: unknown; error?: string; load?: boolean }) => {
      if (m?.ready) { s.ready = true; return pump(); }
      if (!s.job || m?.id !== s.job.id) return;
      if (m.load) return fail(new Error(m.error)); // model/runtime won't load in a worker: rejects all with NoWorkerError → retried in-process
      const j = finish(s)!;
      if (m.error !== undefined) j.reject(new Error(m.error)); else j.resolve(m.result);
      pump();
    });
    w.on("error", (e) => gone(s, e));
    w.on("exit", (code) => gone(s, new Error(`ASR worker exited (code ${code})`)));
  }

  function pump() {
    if (dead) return;
    for (const s of slots) {
      if (!s.ready || s.job || !queue.length) continue;
      const j = queue.shift()!;
      const id = ++seq;
      s.job = { ...j, id };
      s.w.ref();
      s.timer = setTimeout(() => { // inference can't be cancelled: drop the worker so nothing else lands on it
        gone(s, new Error("ASR worker timed out"));
        void s.w.terminate();
      }, j.ms);
      s.w.postMessage({ id, ...j.msg });
    }
    const starting = slots.filter((s) => !s.ready).length;
    for (let i = starting; i < queue.length && slots.length < size && !dead; i++) spawn();
  }

  return {
    get dead() { return dead; },
    run(msg: Record<string, unknown>, ms: number): Promise<unknown> {
      if (dead) return Promise.reject(new NoWorkerError("no ASR worker"));
      return new Promise((resolve, reject) => { queue.push({ msg, ms, resolve, reject }); pump(); });
    },
    close() { for (const s of slots.splice(0)) { s.gone = true; finish(s)?.reject(new Error("ASR pool closed")); void s.w.terminate(); } },
  };
}

const inProcess: Pipe = async (model, opts, cacheDir) => {
  const tf = await import("@huggingface/transformers");
  tf.env.cacheDir = cacheDir;
  return (await tf.pipeline("automatic-speech-recognition", model, opts)) as unknown as Asr;
};

/** Both lanes over one worker script. `local` is the in-process fallback (swappable for tests). */
export function createAsrLanes(script: string, sizes: Record<Lane, number>, local: Pipe = inProcess) {
  const pools = { voice: createPool(script, sizes.voice), clip: createPool(script, sizes.clip) };
  return {
    pools,
    /** Resolves once the model is loaded (a worker loads it; others load it on their first request). */
    async pipeline(lane: Lane, model: string, opts: Record<string, unknown>, cacheDir: string): Promise<Asr> {
      const pool = pools[lane], base = { model, opts, cacheDir };
      let fallback: Promise<Asr> | undefined;
      const viaLocal = () => (fallback ??= local(model, opts, cacheDir));
      try { await pool.run(base, LOAD_MS); } catch (e) { if (!(e instanceof NoWorkerError)) throw e; await viaLocal(); }
      return async (audio, options) => {
        // Not transferred: callers may retry with the same buffer (factory's word → chunk timestamp fallback).
        if (!pool.dead) {
          try { return await pool.run({ ...base, audio, options }, RUN_MS[lane]); } catch (e) { if (!(e instanceof NoWorkerError)) throw e; }
        }
        return (await viaLocal())(audio, options);
      };
    },
    close() { pools.voice.close(); pools.clip.close(); },
  };
}

// On globalThis so dev hot reloads keep one set of workers. Path from cwd: the worker file isn't bundled into .next.
const g = globalThis as unknown as { __orbitAsr?: ReturnType<typeof createAsrLanes> };
export const asrPipeline = (lane: Lane, model: string, opts: Record<string, unknown>, cacheDir: string) =>
  (g.__orbitAsr ??= createAsrLanes(path.join(process.cwd(), "src/lib/asr-worker.mjs"), { voice: 1, clip: asrWorkers() })).pipeline(lane, model, opts, cacheDir);
