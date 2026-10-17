import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Whisper runs in child processes (src/lib/asr-worker.mjs), not worker threads: onnxruntime-node isn't safe to load/run in
// several worker threads of one process (two concurrent loads hit "HandleScope ... without proper locking" and the native
// abort killed the whole server). A child process is its own V8 + onnxruntime, so a native crash only kills that child; the
// pool fails its one request and starts a fresh child. Each child takes one request at a time (load or run), so onnxruntime
// work is serialized per process. Two lanes, each its own children: "voice" (1) never waits behind clip pieces; "clip" has
// asrWorkers() (default 1). Each child loads its own model copy. If children can't start (3 tries with backoff, or the
// runtime won't import there), voice falls back to the in-process path (serialized); clip throws (the job goes on without captions).

export type Lane = "voice" | "clip";
export type Asr = (audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>;
type Pipe = (model: string, opts: Record<string, unknown>, cacheDir: string) => Promise<Asr>;

const LOAD_MS = 30 * 60_000; // first load may download the model
const RUN_MS: Record<Lane, number> = { voice: 2 * 60_000, clip: 20 * 60_000 };
const START_TRIES = 3, CRASHES = 3, COOL_MS = 60_000;

/** Clip-lane child process count: ORBIT_ASR_WORKERS, else 1 (more = another model copy in RAM and pieces fighting for cores). */
export const asrWorkers = () => Math.max(1, Number(process.env.ORBIT_ASR_WORKERS) || 1);
/** Model load progress: downloading (f = 0..1 when known) the first time, else loading from the cache. */
export type AsrPhase = { phase: "downloading" | "loading"; f?: number };

export class NoWorkerError extends Error {}

type Job = { msg: Record<string, unknown>; ms: number; resolve: (v: unknown) => void; reject: (e: Error) => void; onPhase?: (p: AsrPhase) => void };
type Slot = { w: ChildProcess; ready: boolean; gone?: boolean; job?: Job & { id: number }; timer?: ReturnType<typeof setTimeout> };

const ref = (w: ChildProcess, on: boolean) => { if (on) { w.ref(); w.channel?.ref(); } else { w.unref(); w.channel?.unref(); } };

/** FIFO queue over up to `size` child processes running `script`, one request each at a time. Children start on demand; a crashed one fails its request and is replaced. */
export function createPool(script: string, size: number, startMs = 30_000) {
  const queue: Job[] = [];
  const slots: Slot[] = [];
  let seq = 0, dead = false, startFails = 0, crashes = 0, coolUntil = 0, nextStart = 0;
  const cooling = () => Date.now() < coolUntil;
  const coolErr = () => new Error(`Whisper crashed ${CRASHES} times in a row; paused for a minute (see the server log)`);

  const finish = (s: Slot) => { clearTimeout(s.timer); const j = s.job; s.job = undefined; ref(s.w, false); return j; };

  function fail(e: unknown) { // the worker can't start or can't load the model: give up on workers for good
    if (dead) return;
    dead = true;
    console.error("[orbit] ASR worker unusable (voice goes in-process, clips skip captions):", e instanceof Error ? e.message : e);
    const err = new NoWorkerError(`no ASR worker: ${e instanceof Error ? e.message : e}`);
    for (const s of slots.splice(0)) { s.gone = true; finish(s)?.reject(err); s.w.kill(); }
    for (const j of queue.splice(0)) j.reject(err);
  }

  function gone(s: Slot, e: Error) {
    if (s.gone) return; // "error" is followed by "exit"
    s.gone = true;
    slots.splice(slots.indexOf(s), 1);
    clearTimeout(s.timer);
    if (!s.ready) { // couldn't start: retry with backoff, give up for good after START_TRIES
      if (++startFails >= START_TRIES) return fail(e);
      console.error(`[orbit] ASR worker didn't start (${e.message}), retrying`);
      const wait = 1000 * 2 ** (startFails - 1);
      nextStart = Date.now() + wait;
      setTimeout(pump, wait);
      return;
    }
    finish(s)?.reject(e);
    if (++crashes >= CRASHES) { // crashing on every request (e.g. a broken model): stop feeding it for a while
      crashes = 0;
      coolUntil = Date.now() + COOL_MS;
      console.error("[orbit] ASR worker keeps crashing, pausing transcription for a minute");
      for (const j of queue.splice(0)) j.reject(coolErr());
    }
    pump(); // a replacement starts if work is waiting
  }

  function spawn() {
    if (!existsSync(script)) return fail(new Error(`ASR worker script missing: ${script}`)); // a broken install: no point retrying
    let w: ChildProcess;
    // advanced: structured clone, so Float32Array audio and results cross as-is. execArgv []: don't inherit --inspect etc.
    try { w = fork(script, [], { serialization: "advanced", execArgv: [], windowsHide: true }); } catch (e) { return fail(e); }
    const s: Slot = { w, ready: false };
    slots.push(s);
    s.timer = setTimeout(() => { gone(s, new Error("ASR worker didn't start in time")); w.kill(); }, startMs);
    w.on("message", (m: { id?: number; ready?: boolean; result?: unknown; error?: string; load?: boolean; phase?: AsrPhase["phase"]; f?: number }) => {
      if (m?.ready) { clearTimeout(s.timer); s.ready = true; startFails = 0; pump(); if (!s.job) ref(w, false); return; } // idle children don't keep the process alive; ref'd while starting or busy
      if (!s.job || m?.id !== s.job.id) return;
      if (m.phase) return s.job.onPhase?.({ phase: m.phase, ...(m.f !== undefined ? { f: m.f } : {}) });
      crashes = 0; // it answered
      if (m.load) return fail(new Error(m.error)); // runtime won't load in a child: rejects all with NoWorkerError (voice retries in-process)
      const j = finish(s)!;
      if (m.error !== undefined) j.reject(new Error(m.error)); else j.resolve(m.result);
      pump();
    });
    w.on("error", (e) => gone(s, e));
    w.on("exit", (code, sig) => gone(s, new Error(`ASR worker exited (code ${code ?? sig})`)));
  }

  function pump() {
    if (dead || cooling()) return;
    for (const s of slots) {
      if (!s.ready || s.job || !queue.length) continue;
      const j = queue.shift()!;
      const id = ++seq;
      s.job = { ...j, id };
      ref(s.w, true);
      s.timer = setTimeout(() => { // inference can't be cancelled: drop the child so nothing else lands on it
        gone(s, new Error("ASR worker timed out"));
        s.w.kill();
      }, j.ms);
      // Can't serialize (or the channel just closed): fail this request and free the slot; a dying child is handled by "exit".
      const bad = (e: Error | null) => { if (e && s.job?.id === id) { finish(s)!.reject(e); queueMicrotask(pump); } };
      try { s.w.send({ id, ...j.msg }, bad); } catch (e) { bad(e instanceof Error ? e : new Error(String(e))); }
    }
    const starting = slots.filter((s) => !s.ready).length;
    for (let i = starting; i < queue.length && slots.length < size && !dead && Date.now() >= nextStart; i++) spawn();
  }

  return {
    get dead() { return dead; },
    run(msg: Record<string, unknown>, ms: number, onPhase?: (p: AsrPhase) => void): Promise<unknown> {
      if (dead) return Promise.reject(new NoWorkerError("no ASR worker"));
      if (cooling()) return Promise.reject(coolErr());
      return new Promise((resolve, reject) => { queue.push({ msg, ms, resolve, reject, onPhase }); pump(); });
    },
    close() { for (const s of slots.splice(0)) { s.gone = true; finish(s)?.reject(new Error("ASR pool closed")); s.w.kill(); } },
  };
}

const inProcess: Pipe = async (model, opts, cacheDir) => {
  const tf = await import("@huggingface/transformers");
  tf.env.cacheDir = cacheDir;
  return (await tf.pipeline("automatic-speech-recognition", model, opts)) as unknown as Asr;
};

/** Both lanes over one worker script. `local` is the voice lane's in-process fallback (swappable for tests). */
export function createAsrLanes(script: string, sizes: Record<Lane, number>, local: Pipe = inProcess) {
  if (!existsSync(script)) console.error(`[orbit] ASR worker script not found at ${script}: Clip Factory captions are off, voice transcribes in-process`);
  const pools = { voice: createPool(script, sizes.voice), clip: createPool(script, sizes.clip) };
  // In-process fallback (voice only): one onnxruntime call at a time, across models (same crash otherwise, nothing to isolate it).
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  return {
    pools,
    /** Resolves once the model is loaded (one child loads/downloads it; others load it from the cache on their first request). */
    async pipeline(lane: Lane, model: string, opts: Record<string, unknown>, cacheDir: string, onPhase?: (p: AsrPhase) => void): Promise<Asr> {
      const pool = pools[lane], base = { model, opts, cacheDir };
      let fallback: Promise<Asr> | undefined;
      // Clip: no in-process fallback (a native crash there takes the server down with a long job); the job continues without captions.
      const viaLocal = () => {
        if (lane === "clip") throw new Error("Whisper can't run in its own process here (see the server log)");
        return (fallback ??= serial(() => local(model, opts, cacheDir)));
      };
      try { await pool.run(base, LOAD_MS, onPhase); } catch (e) { if (!(e instanceof NoWorkerError)) throw e; await viaLocal(); }
      return async (audio, options) => {
        // Not transferred: callers may retry with the same buffer (factory's word → chunk timestamp fallback).
        if (!pool.dead) {
          try { return await pool.run({ ...base, audio, options }, RUN_MS[lane]); } catch (e) { if (!(e instanceof NoWorkerError)) throw e; }
        }
        const asr = await viaLocal();
        return serial(() => asr(audio, options));
      };
    },
    close() { pools.voice.close(); pools.clip.close(); },
  };
}

// On globalThis so dev hot reloads keep one set of children. Path from cwd: the worker file isn't bundled into .next.
const g = globalThis as unknown as { __orbitAsr2?: ReturnType<typeof createAsrLanes> };
export const asrPipeline = (lane: Lane, model: string, opts: Record<string, unknown>, cacheDir: string, onPhase?: (p: AsrPhase) => void) =>
  (g.__orbitAsr2 ??= createAsrLanes(path.join(process.cwd(), "src/lib/asr-worker.mjs"), { voice: 1, clip: asrWorkers() })).pipeline(lane, model, opts, cacheDir, onPhase);
