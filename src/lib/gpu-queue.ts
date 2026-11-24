// Durable GPU job queue, runtime (rules: gpu-queue-pure.ts; table: 0029_gpu_jobs.sql; design: docs/gpu-queue.md).
// enqueue → a gpu_jobs row; the worker loop (this server, unless ORBIT_GPU_WORKER=0) claims with a lease through the
// claim_gpu_job RPC, runs the job with the existing local runners (comfy / trellis / video / music / voice), heartbeats the
// lease and progress, retries with backoff, and stops claiming while Stop-all is on. Only active with ORBIT_GPU_QUEUE=1.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hostname } from "node:os";
import { adminClient } from "./supabase/admin.ts";
import { stopAllOn } from "./stop-all.ts";
import { isCloud } from "./role-pure.ts";
import {
  afterFailure, canCancel, kindOfTool, LEASE_BEAT_MS, LEASE_MS, queueOn, runnerError, validatePayload, WAIT_MS, workerOn,
  type GpuJob, type GpuJobKind,
} from "./gpu-queue-pure.ts";

/** What every worker backend implements (this laptop today; Kaggle / pay-per-second later, docs/gpu-queue.md). */
export type JobContext = { signal: AbortSignal; progress(frac: number, line?: string): void };
export interface GpuWorker {
  id: string;
  kinds: GpuJobKind[];
  run(job: GpuJob, ctx: JobContext): Promise<{ text: string }>;
}

const TABLE = "gpu_jobs";

/** The laptop: the same CORE LOCALAI runners as before. Kinds without a runner (upscale, blender_render) are never claimed here. */
export const localWorker: GpuWorker = {
  id: `laptop:${hostname()}`,
  kinds: ["image", "image_edit", "video", "music", "3d", "voice"],
  async run(job, ctx) {
    const tool = String(job.payload.tool ?? ""), input = (job.payload.input ?? {}) as Record<string, unknown>;
    if (kindOfTool(tool) !== job.kind) return { text: `Error: job ${job.kind} can't run tool ${tool}` };
    ctx.progress(0.1, "Making it");
    const text = await runDirect(tool, input);
    ctx.progress(0.95, "Saving");
    return { text };
  },
};

/** The old direct path (exactly what core-modules ran before the queue). */
export async function runDirect(t: string, i: Record<string, unknown>): Promise<string> {
  return t === "local_image_edit" ? (await import("./image-edit")).runImageEditTool(i)
    : t === "local_image" ? (await import("./comfy")).runComfyTool(i)
    : t === "local_video" ? (await import("./video")).runVideoTool(i)
    : t === "local_music" ? (await import("./music-gen")).runMusicTool(i)
    : t === "local_3d" ? (await import("./local-ai")).run3dTool(i)
    : (await import("./local-ai")).runLocalTool(t, i);
}

export async function enqueue(sb: SupabaseClient, userId: string, kind: unknown, payload: unknown): Promise<GpuJob> {
  const v = validatePayload(kind, payload);
  if (!v.ok) throw new Error(v.error);
  const { data, error } = await sb.from(TABLE).insert({ user_id: userId, kind: v.kind, payload: v.payload }).select("*").single();
  if (error) throw new Error(error.message);
  kick();
  return data as GpuJob;
}

export async function cancelJob(sb: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await sb.from(TABLE).select("status").eq("id", id).maybeSingle();
  if (!data || !canCancel(data.status)) return false;
  const { error } = await sb.from(TABLE).update({ status: "cancelled", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), lease_until: null })
    .eq("id", id).in("status", ["queued", "claimed", "running"]);
  if (!error && G().current?.id === id) G().current?.abort.abort(new Error("Cancelled"));
  return !error;
}

export async function listJobs(sb: SupabaseClient, limit = 20): Promise<GpuJob[]> {
  const { data } = await sb.from(TABLE).select("*").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []) as GpuJob[];
}

/** CORE's LOCALAI run. Flag off, a tool that isn't queued, or no database/table: the old direct call. Flag on: enqueue and
 *  wait a while; if it's still waiting (worker offline, GPU busy) say so: the job stays queued and runs later. */
export async function runLocalAiTool(t: string, i: Record<string, unknown>, userId: string): Promise<string> {
  const kind = kindOfTool(t), sb = adminClient();
  const cloud = isCloud(process.env);
  // The cloud server has no GPU: never run a runner there; without the queue it can only say so.
  if (cloud && (!kind || !sb || !userId)) return "Error: This needs the laptop's GPU, and the job queue isn't reachable (SUPABASE_SECRET_KEY / migration 0029).";
  if (!queueOn(process.env) || !kind || !sb || !userId) return runDirect(t, i);
  let job: GpuJob;
  try { job = await enqueue(sb, userId, kind, { tool: t, input: i }); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/can't go into|too (big|long)|nested|plain data|bad number/.test(msg)) return `Error: ${msg}`;
    if (cloud) return `Error: Couldn't queue the GPU job for the laptop (${msg}).`;
    console.error(`[orbit] GPU queue unavailable (${msg}); running directly`);
    return runDirect(t, i);
  }
  const until = Date.now() + WAIT_MS[kind];
  while (Date.now() < until) {
    await sleep(2000);
    const { data } = await sb.from(TABLE).select("status, result, error").eq("id", job.id).maybeSingle();
    if (!data) break;
    if (data.status === "done") return (data.result as { text?: string } | null)?.text ?? "Done.";
    if (data.status === "failed") return `Error: ${data.error ?? "Didn't work"}`;
    if (data.status === "cancelled") return "Error: The job was cancelled";
  }
  return `Queued as GPU job ${job.id.slice(0, 8)}: it waits for the GPU and runs as soon as it's free (also after a restart). He can see it in OPERATIONS → Local AI.`;
}

// ---- worker loop ----
type Current = { id: string; abort: AbortController };
type W = { timer?: NodeJS.Timeout; busy: boolean; current?: Current; worker: GpuWorker };
const g = globalThis as unknown as { __orbitGpuQueue?: W };
const G = (): W => (g.__orbitGpuQueue ??= { busy: false, worker: localWorker });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Start the loop (instrumentation.ts). Quietly nothing unless ORBIT_GPU_QUEUE=1 and a service key is set. */
export function startGpuWorker(worker: GpuWorker = localWorker) {
  if (!workerOn(process.env) || !adminClient()) return;
  const s = G();
  s.worker = worker;
  if (s.timer) return;
  s.timer = setInterval(kick, 5000);
  s.timer.unref?.();
  kick();
}

/** Stop-all: abort the running job (it goes back to the queue, not failed) and claim nothing until it's off. */
export function abortGpuWorker() { G().current?.abort.abort(new Error("Stopped: Stop-all is on")); }

function kick() {
  const s = G();
  if (s.busy || !workerOn(process.env) || stopAllOn()) return;
  const sb = adminClient();
  if (!sb) return;
  s.busy = true;
  void loop(sb, s).catch((e) => console.error("[orbit] GPU worker:", e instanceof Error ? e.message : e)).finally(() => { s.busy = false; });
}

async function loop(sb: SupabaseClient, s: W) {
  while (!stopAllOn()) {
    const { data, error } = await sb.rpc("claim_gpu_job", { p_worker: s.worker.id, p_kinds: s.worker.kinds, p_lease_seconds: Math.round(LEASE_MS / 1000) });
    if (error) { if (!/does not exist|PGRST202|42883|42P01/.test(`${error.code} ${error.message}`)) console.error("[orbit] GPU claim failed:", error.message); return; }
    const job = (Array.isArray(data) ? data[0] : data) as GpuJob | undefined;
    if (!job) return;
    await work(sb, s, job);
  }
}

async function work(sb: SupabaseClient, s: W, job: GpuJob) {
  const abort = new AbortController();
  s.current = { id: job.id, abort };
  const patch = (p: Record<string, unknown>) => sb.from(TABLE).update({ ...p, updated_at: new Date().toISOString() })
    .eq("id", job.id).eq("worker", s.worker.id).in("status", ["claimed", "running"]).select("id");
  let prog = 0, line: string | null = null;
  await patch({ status: "running", started_at: new Date().toISOString(), lease_until: new Date(Date.now() + LEASE_MS).toISOString() });
  const beat = setInterval(() => {
    void patch({ progress: prog, progress_text: line, lease_until: new Date(Date.now() + LEASE_MS).toISOString() }).then(({ data }) => {
      if (!data?.length) abort.abort(new Error("Cancelled")); // cancelled, or another worker took it over
    }, () => {});
  }, LEASE_BEAT_MS);
  try {
    let text: string, err: string | null;
    try {
      const r = await s.worker.run(job, { signal: abort.signal, progress: (f, l) => { prog = Math.min(1, Math.max(0, f)); line = l ?? line; } });
      text = r.text; err = runnerError(text);
    } catch (e) { text = ""; err = e instanceof Error ? e.message : String(e); }
    const now = Date.now();
    // Stop-all mid-job: the runners can't be interrupted yet, so a finished result is still kept; a failure goes back to the queue.
    if (abort.signal.aborted && stopAllOn() && err) { await patch({ status: "queued", worker: null, lease_until: null, attempts: Math.max(0, job.attempts - 1), progress: 0 }); return; }
    if (abort.signal.aborted && !stopAllOn()) return; // cancelled / taken over: leave the row as it is
    if (!err) await patch({ status: "done", result: { text }, error: null, progress: 1, finished_at: new Date(now).toISOString(), lease_until: null });
    else {
      const next = afterFailure(job, err, now);
      await patch(next.status === "queued" ? { ...next, worker: null, lease_until: null, progress: 0 } : { ...next, finished_at: new Date(now).toISOString(), lease_until: null });
    }
  } finally { clearInterval(beat); s.current = undefined; }
}
