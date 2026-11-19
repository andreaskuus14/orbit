// GPU lease, in-process (pure part and rules: gpu-lock-pure.ts). On globalThis so a dev hot reload keeps one queue.
// Callers: comfy.ts generate (pictures), trellis.ts trellisModel (3D), clips/factory.ts renderClip (only when encoding with NVENC).
// Quick health checks never take it. Stop-all rejects everyone still waiting; holders stop by themselves and release.
import { stopAllOn } from "./stop-all.ts";
import { beat, drop, emptyGpu, enqueue, gpuSlots, gpuStatus, holds, tick, waitText, type GpuKind, type GpuState, type GpuStatus } from "./gpu-lock-pure.ts";

type Pending = { resolve: () => void; reject: (e: Error) => void; onWait?: (text: string) => void; shown: string; kind: GpuKind };
type G = { state: GpuState; pending: Map<string, Pending>; timer?: NodeJS.Timeout; n: number };
const g = globalThis as unknown as { __orbitGpu?: G };
const G = (): G => (g.__orbitGpu ??= { state: emptyGpu(gpuSlots(process.env.ORBIT_GPU_SLOTS)), pending: new Map(), n: 0 });

export type GpuLease = { id: string; kind: GpuKind; /** heartbeat: call while working (poll loops, ffmpeg progress) */ beat(): void; release(): void };
export type AcquireOpts = { signal?: AbortSignal; /** give up waiting after this (default 30 min) */ maxWaitMs?: number;
  /** lease lifetime from the last heartbeat (default 10 min) */ ttlMs?: number; onWait?: (text: string) => void };

export class GpuWaitError extends Error {
  reason: "stop" | "timeout";
  constructor(msg: string, reason: "stop" | "timeout") { super(msg); this.reason = reason; }
}

function run() {
  const s = G(), now = Date.now();
  if (stopAllOn()) for (const w of s.state.queue) { s.state = drop(s.state, w.id); s.pending.get(w.id)?.reject(new GpuWaitError("Stopped: Stop-all is on", "stop")); s.pending.delete(w.id); }
  const t = tick(s.state, now);
  s.state = t.state;
  for (const h of t.expired) console.error(`[orbit] GPU lease expired (${h.kind}, no heartbeat for ${Math.round(h.ttl / 60_000)} min); handing the GPU on`);
  for (const id of t.timedOut) { s.pending.get(id)?.reject(new GpuWaitError(`The GPU stayed busy too long (${gpuStatus(s.state, now).text})`, "timeout")); s.pending.delete(id); }
  for (const id of t.granted) { s.pending.get(id)?.resolve(); s.pending.delete(id); }
  for (const [id, p] of s.pending) {
    const text = waitText(s.state, id);
    if (text && text !== p.shown) { p.shown = text; try { p.onWait?.(text); } catch { /* status text only */ } }
  }
  // Tick once a second only while something is held or queued (expiry, wait timeouts, Stop-all).
  if (s.state.holders.length || s.state.queue.length) { if (!s.timer) { s.timer = setInterval(run, 1000); } }
  else if (s.timer) { clearInterval(s.timer); s.timer = undefined; }
}

/** Wait (FIFO) for the GPU. Resolves with a lease; release it in finally. Rejects on abort, Stop-all or maxWaitMs. */
export async function acquireGpu(kind: GpuKind, o: AcquireOpts = {}): Promise<GpuLease> {
  o.signal?.throwIfAborted();
  if (stopAllOn()) throw new GpuWaitError("Stopped: Stop-all is on", "stop");
  const s = G(), now = Date.now(), id = `${kind}-${now.toString(36)}-${++s.n}`;
  const ttl = o.ttlMs ?? 10 * 60_000;
  s.state = enqueue(s.state, { id, kind, since: now, deadline: now + (o.maxWaitMs ?? 30 * 60_000), ttl });
  const lease: GpuLease = {
    id, kind,
    beat: () => { s.state = beat(s.state, id, Date.now()); },
    release: () => { if (holds(s.state, id)) { s.state = drop(s.state, id); run(); } },
  };
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { s.state = drop(s.state, id); s.pending.delete(id); reject(o.signal!.reason instanceof Error ? o.signal!.reason : new Error("Cancelled")); run(); };
    o.signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => o.signal?.removeEventListener("abort", onAbort);
    s.pending.set(id, { kind, onWait: o.onWait, shown: "", resolve: () => { done(); resolve(); }, reject: (e) => { done(); reject(e); } });
    run();
  });
  return lease;
}

/** Run `fn` holding the GPU; the lease is released however it ends. */
export async function withGpu<T>(kind: GpuKind, o: AcquireOpts, fn: (lease: GpuLease) => Promise<T>): Promise<T> {
  const lease = await acquireGpu(kind, o);
  try { return await fn(lease); } finally { lease.release(); }
}

/** For the doctor and status: "GPU free" / "GPU busy: 3D model, 4 min". */
export const gpuNow = (): GpuStatus => gpuStatus(G().state, Date.now());

/** Ask another ComfyUI server (pictures on 8188, TRELLIS on 8189) to unload its models before a big job. Not running: nothing. */
export async function freeComfyVram(url: string | null): Promise<void> {
  if (!url) return;
  await fetch(`${url}/free`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }),
    signal: AbortSignal.timeout(3000) }).catch(() => {});
}
