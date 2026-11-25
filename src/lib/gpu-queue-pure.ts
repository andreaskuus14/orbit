// Durable GPU job queue, pure part (docs/gpu-queue.md; table: supabase/migrations/0029_gpu_jobs.sql; runtime: gpu-queue.ts).
// Flag, kinds, payload validation (journal/LIFE never goes in), claim/lease rules (mirrors claim_gpu_job), retry backoff,
// cancel, and the shared Progress card. Tests: tests/gpu-queue.test.ts.
import { isPrivate, isPrivateKind } from "./private-pure.ts";
import { fromStages, type Progress } from "./progress-pure.ts";
import type { Lang } from "./i18n-core-pure.ts";

export const GPU_JOB_KINDS = ["image", "image_edit", "video", "music", "3d", "voice", "upscale", "blender_render"] as const;
export type GpuJobKind = (typeof GPU_JOB_KINDS)[number];
export type GpuJobStatus = "queued" | "claimed" | "running" | "done" | "failed" | "cancelled";
export type GpuJob = {
  id: string; user_id: string; kind: GpuJobKind; payload: Record<string, unknown>; status: GpuJobStatus; worker: string | null;
  progress: number; progress_text: string | null; result: { text: string } | null; error: string | null;
  attempts: number; max_attempts: number; run_after: string; lease_until: string | null;
  created_at: string; claimed_at: string | null; started_at: string | null; finished_at: string | null; updated_at: string;
};

/** ORBIT_GPU_QUEUE=1 routes GPU work through the queue. Off (anything else) = the old direct calls, nothing changes. */
/** On with ORBIT_GPU_QUEUE=1, and always on the cloud server (ORBIT_ROLE=cloud): it has no GPU, so jobs must queue. */
export const queueOn = (env: Record<string, string | undefined>) => (env.ORBIT_GPU_QUEUE ?? "").trim() === "1" || (env.ORBIT_ROLE ?? "").trim().toLowerCase() === "cloud";
/** This server also works jobs, unless ORBIT_GPU_WORKER=0 (a future cloud "brain" that only enqueues). */
export const workerOn = (env: Record<string, string | undefined>) => queueOn(env) && (env.ORBIT_GPU_WORKER ?? "").trim() !== "0" && (env.ORBIT_ROLE ?? "").trim().toLowerCase() !== "cloud";

/** CORE's LOCALAI tools that go through the queue → job kind. local_transcribe stays direct (quick, needs its own file). */
export const TOOL_KIND: Record<string, GpuJobKind> = {
  local_image: "image", local_image_edit: "image_edit", local_video: "video", local_music: "music", local_3d: "3d", local_tts: "voice",
};
export const kindOfTool = (tool: string): GpuJobKind | null => TOOL_KIND[tool] ?? null;

export const MAX_PAYLOAD_BYTES = 16_000, MAX_TEXT = 4_000, MAX_DEPTH = 4;
const PRIVATE_KEY = /^(journal|life|diary|mood|health|journal_?text|life_?text)$/i;
const PRIVATE_TEXT = /\b(journal|diary)\s+entry\b|\[LIFE\]|orbit\.life\./i;

/** A job payload → itself (cleaned) or why it is refused. Refuses journal/LIFE content in any shape: private keys, a private
 *  kind/tags marker (private-pure), journal-looking text, overlong text, deep nesting, non-JSON values, too big. */
export function validatePayload(kind: unknown, payload: unknown): { ok: true; kind: GpuJobKind; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof kind !== "string" || !(GPU_JOB_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `Unknown GPU job kind: ${String(kind)}` };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "The job needs an object payload" };
  const bad = scan(payload, 0);
  if (bad) return { ok: false, error: bad };
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).length > MAX_PAYLOAD_BYTES) return { ok: false, error: "The job payload is too big" };
  return { ok: true, kind: kind as GpuJobKind, payload: JSON.parse(json) as Record<string, unknown> };
}
function scan(v: unknown, depth: number): string {
  if (depth > MAX_DEPTH) return "The job payload is nested too deep";
  if (v === null || typeof v === "boolean") return "";
  if (typeof v === "number") return Number.isFinite(v) ? "" : "The job payload has a bad number";
  if (typeof v === "string") return v.length > MAX_TEXT ? "A text in the job is too long" : PRIVATE_TEXT.test(v) ? "Journal / LIFE text can't go into a GPU job" : "";
  if (Array.isArray(v)) { for (const x of v) { const b = scan(x, depth + 1); if (b) return b; } return ""; }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (("kind" in o && isPrivateKind(o.kind)) || ("tags" in o && Array.isArray(o.tags) && isPrivate({ tags: o.tags }))) return "Journal / LIFE data can't go into a GPU job";
    for (const [k, x] of Object.entries(o)) { if (PRIVATE_KEY.test(k)) return "Journal / LIFE data can't go into a GPU job"; const b = scan(x, depth + 1); if (b) return b; }
    return "";
  }
  return "The job payload has a value that isn't plain data";
}

const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
export const leaseExpired = (j: Pick<GpuJob, "status" | "lease_until">, now: number) =>
  (j.status === "claimed" || j.status === "running") && ms(j.lease_until) < now;

/** Same rule as claim_gpu_job: queued and due, or a lost lease with attempts left. */
export function claimable(j: GpuJob, kinds: readonly string[], now: number): boolean {
  if (!kinds.includes(j.kind)) return false;
  if (j.status === "queued") return ms(j.run_after) <= now;
  return leaseExpired(j, now) && j.attempts < j.max_attempts;
}

/** In-memory claim (tests; and the contract every worker backend must keep). Returns the new list and the claimed job. */
export function claimNext(jobs: GpuJob[], worker: string, kinds: readonly string[], leaseMs: number, now: number): { jobs: GpuJob[]; job: GpuJob | null } {
  const at = new Date(now).toISOString();
  let out = jobs.map((j) => (leaseExpired(j, now) && j.attempts >= j.max_attempts
    ? { ...j, status: "failed" as const, error: j.error ?? "The worker stopped answering too many times", finished_at: at, lease_until: null } : j));
  const pick = out.filter((j) => claimable(j, kinds, now)).sort((a, b) => ms(a.run_after) - ms(b.run_after) || ms(a.created_at) - ms(b.created_at))[0];
  if (!pick) return { jobs: out, job: null };
  const job: GpuJob = { ...pick, status: "claimed", worker, attempts: pick.attempts + 1, claimed_at: at, updated_at: at, lease_until: new Date(now + leaseMs).toISOString() };
  out = out.map((j) => (j.id === job.id ? job : j));
  return { jobs: out, job };
}

/** Retry wait after attempt n (1-based): 30 s, 2 min, 8 min … capped at 30 min. */
export const backoffMs = (attempt: number) => Math.min(30 * 60_000, 30_000 * 4 ** Math.max(0, attempt - 1));

/** Errors that a retry can't fix (not installed, refused, bad input): fail at once. */
const PERMANENT = /isn't installed|not installed|(is|was|were) refused|can't go into|unknown|invalid|not found|no such|missing|too (big|long)|Stop-all/i;
export const retryable = (error: string) => !PERMANENT.test(error);

/** What a failed attempt becomes: back in the queue after the backoff, or failed for good. */
export function afterFailure(j: Pick<GpuJob, "attempts" | "max_attempts">, error: string, now: number):
  { status: "queued"; run_after: string; error: string } | { status: "failed"; error: string } {
  if (retryable(error) && j.attempts < j.max_attempts) return { status: "queued", run_after: new Date(now + backoffMs(j.attempts)).toISOString(), error };
  return { status: "failed", error };
}

/** A runner's "Error: …" text (core.ts convention) → the error, or null when it worked. */
export const runnerError = (text: string) => (/^Error:/.test(text) ? text.replace(/^Error:\s*/, "") || "Didn't work" : null);

export const isFinal = (s: GpuJobStatus) => s === "done" || s === "failed" || s === "cancelled";
/** Cancel: only an unfinished job; a running one is told at its next heartbeat. */
export const canCancel = (s: GpuJobStatus) => !isFinal(s);

/** How long a CORE turn waits for its job before saying it's queued (the job still runs later). */
export const WAIT_MS: Record<GpuJobKind, number> = {
  image: 6 * 60_000, image_edit: 8 * 60_000, music: 10 * 60_000, voice: 5 * 60_000, upscale: 10 * 60_000, "3d": 30 * 60_000, video: 35 * 60_000, blender_render: 40 * 60_000,
};
/** Lease per heartbeat window. Heartbeats come every LEASE_BEAT_MS, so a live job never loses its lease. */
export const LEASE_MS = 3 * 60_000, LEASE_BEAT_MS = 30_000;

const LABEL: Record<GpuJobKind, { en: string; et: string }> = {
  image: { en: "Picture", et: "Pilt" }, image_edit: { en: "Picture edit", et: "Pildi muutmine" }, video: { en: "Video clip", et: "Videoklipp" },
  music: { en: "Music", et: "Muusika" }, "3d": { en: "3D model", et: "3D mudel" }, voice: { en: "Voiceover", et: "Häälestus" },
  upscale: { en: "Upscale", et: "Suurendamine" }, blender_render: { en: "Blender render", et: "Blenderi renderdus" },
};
const STAGES = { en: ["Waiting for the GPU", "Making it", "Saving"], et: ["Ootan GPU-d", "Teen", "Salvestan"] } as const;

/** A job → the shared "Working on it" card. Queued = waiting (also while the PC is off); cancelled shows as failed. */
export function jobProgress(j: GpuJob, lang: Lang, nowMs: number): Progress {
  const title = LABEL[j.kind]?.[lang] ?? j.kind;
  const stages = [...STAGES[lang]];
  const cur = j.status === "done" ? 3 : j.status === "running" ? (j.progress >= 0.95 ? 2 : 1) : j.status === "claimed" ? 0 : -1;
  const failed = j.status === "failed" || j.status === "cancelled";
  const p = fromStages({
    id: `gpu:${j.id}`, title, stages, current: failed ? Math.max(0, cur) : cur, failed,
    error: j.status === "cancelled" ? (lang === "et" ? "Tühistatud" : "Cancelled") : j.error ?? undefined,
    now: j.status === "running" ? j.progress_text ?? null : null, startedAt: j.started_at, typicalMs: null,
    result: j.status === "done" && j.result?.text ? { text: j.result.text.slice(0, 200) } : null,
    at: j.finished_at ?? j.updated_at ?? j.created_at,
  }, lang, nowMs);
  if (j.status === "queued" && j.attempts > 0) p.now = lang === "et" ? `Proovin uuesti (${j.attempts + 1}/${j.max_attempts})` : `Trying again (${j.attempts + 1}/${j.max_attempts})`;
  if (failed) p.action = null; // retry = ask again; no one-tap rerun
  return p;
}
