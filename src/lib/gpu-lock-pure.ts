// GPU lease, pure part (IO: gpu-lock.ts; tests/gpu-lock.test.ts). The laptop has one 8 GB GPU shared by pictures (ComfyUI),
// TRELLIS.2 3D, NVENC clip renders and later video/music. Heavy jobs take a lease first: strict FIFO, `slots` at a time (default 1).
// A lease lasts `ttl` from its last heartbeat, so a job that hangs or forgot to release can't hold the GPU forever.

export type GpuKind = "image" | "3d" | "render" | "video" | "music" | "transcribe" | "ocr" | "scan";
export type GpuHolder = { id: string; kind: GpuKind; since: number; until: number; ttl: number };
export type GpuWaiter = { id: string; kind: GpuKind; since: number; deadline: number; ttl: number };
export type GpuState = { slots: number; holders: GpuHolder[]; queue: GpuWaiter[] };
export type GpuTick = { state: GpuState; granted: string[]; expired: GpuHolder[]; timedOut: string[] };

const LABEL: Record<GpuKind, string> = { image: "picture", "3d": "3D model", render: "clip render", video: "video", music: "music", transcribe: "transcription", ocr: "document OCR", scan: "photo scan" };
export const kindLabel = (k: GpuKind) => LABEL[k];

/** ORBIT_GPU_SLOTS: heavy GPU jobs at once (1-4, default 1). */
export function gpuSlots(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(4, n) : 1;
}

export const emptyGpu = (slots = 1): GpuState => ({ slots, holders: [], queue: [] });

export const enqueue = (s: GpuState, w: GpuWaiter): GpuState => ({ ...s, queue: [...s.queue, w] });

/** Drop expired leases and timed-out waiters, then hand free slots to the head of the queue (strict FIFO). */
export function tick(s: GpuState, now: number): GpuTick {
  const expired = s.holders.filter((h) => h.until <= now);
  const timedOut = s.queue.filter((w) => w.deadline <= now).map((w) => w.id);
  const holders = s.holders.filter((h) => h.until > now);
  const queue = s.queue.filter((w) => w.deadline > now);
  const granted: string[] = [];
  while (queue.length && holders.length < s.slots) {
    const w = queue.shift()!;
    holders.push({ id: w.id, kind: w.kind, since: now, until: now + w.ttl, ttl: w.ttl });
    granted.push(w.id);
  }
  return { state: { ...s, holders, queue }, granted, expired, timedOut };
}

/** Heartbeat: the lease runs `ttl` from now. Unknown id (already expired/released): unchanged. */
export const beat = (s: GpuState, id: string, now: number): GpuState =>
  ({ ...s, holders: s.holders.map((h) => (h.id === id ? { ...h, until: now + h.ttl } : h)) });

/** Release a lease or leave the queue; unknown ids are a no-op (an expired lease released late). */
export const drop = (s: GpuState, id: string): GpuState =>
  ({ ...s, holders: s.holders.filter((h) => h.id !== id), queue: s.queue.filter((w) => w.id !== id) });

export const holds = (s: GpuState, id: string) => s.holders.some((h) => h.id === id);

const mins = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))} min`;

/** What a waiting job shows: "Waiting for the GPU (3D model running)", plus how many are ahead of it. */
export function waitText(s: GpuState, id: string): string {
  const pos = s.queue.findIndex((w) => w.id === id);
  if (pos < 0) return "";
  const running = [...new Set(s.holders.map((h) => kindLabel(h.kind)))].join(", ");
  const ahead = pos ? `; ${pos} ahead in line` : "";
  return `Waiting for the GPU (${running ? `${running} running` : "starting"}${ahead})`;
}

export type GpuStatus = { busy: boolean; text: string; holders: { kind: GpuKind; label: string; ms: number }[]; waiting: number };

/** Doctor/status line: "GPU free" or "GPU busy: 3D model, 4 min (1 waiting)". */
export function gpuStatus(s: GpuState, now: number): GpuStatus {
  const holders = s.holders.map((h) => ({ kind: h.kind, label: kindLabel(h.kind), ms: Math.max(0, now - h.since) }));
  const waiting = s.queue.length;
  const text = holders.length
    ? `GPU busy: ${holders.map((h) => `${h.label}, ${mins(h.ms)}`).join("; ")}${waiting ? ` (${waiting} waiting)` : ""}`
    : "GPU free";
  return { busy: holders.length > 0, text, holders, waiting };
}

/** Keep a heavy model loaded after a job: only when the very next waiter is the same kind (a batch of beds or clips), so the
 *  next job skips a ~10 GB reload. Any other next job, or none, still gets the GPU freed first. on=false (ORBIT_GPU_KEEP_WARM=0): never. */
export const keepWarm = (s: GpuState, kind: GpuKind, on = true): boolean => on && s.queue[0]?.kind === kind;

/** True while a job of this kind holds or waits for the GPU (a delayed unload then leaves the models to that job's own end). */
export const busyWith = (s: GpuState, kind: GpuKind): boolean => s.holders.some((h) => h.kind === kind) || s.queue.some((w) => w.kind === kind);
