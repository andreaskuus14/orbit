// KAGGLE BURST, pure part (IO: kaggle.ts; route: /api/kaggle; tests: tests/kaggle.test.ts; doc: docs/KAGGLE-BURST.md).
// A GPU job that won't fit on the 8 GB laptop GPU, or would take too long there, can run on the owner's free Kaggle account instead:
// ORBIT writes one Python script (the job's own settings inside, pinned model + library versions), he clicks Send to Kaggle, ORBIT pushes it
// as a private Kaggle script with the official Kaggle CLI (Apache-2.0), polls it, downloads the output and saves it like a local job.
// Kaggle's own docs (checked 2026-11-21): free GPUs are one P100 or two T4s (16 GB each), "a quota limit per week of GPU ... 30 hours or
// sometimes higher depending on demand", 12 h max per run, 20 GB of /kaggle/working output. The real numbers come from `kaggle quota`.
import type { GpuKind } from "./gpu-lock-pure.ts";

/** ORBIT_KAGGLE=0 turns the whole feature off (default on; it still does nothing without the CLI, a token and his click). */
export const kaggleOn = (raw: string | undefined) => raw?.trim() !== "0";

export const CLI_VERSION = "2.2.5"; // tools/kaggle/setup.ps1 installs exactly this (pip "kaggle", Apache-2.0)
export const ACCELERATOR = "NvidiaTeslaT4"; // Kaggle's default free GPU (T4 x2); the script uses one of them
export const REMOTE_VRAM_GB = 16;
export const MAX_RUN_H = 12; // Kaggle's limit per run
export const DEFAULT_WEEKLY_H = 30; // only when `kaggle quota` can't be read
export const SLUG_PREFIX = "orbit-burst-";

const num = (raw: string | undefined, def: number, lo: number, hi: number) => {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};
export type BurstConfig = { on: boolean; localVramGb: number; maxLocalMin: number; reserveH: number; weeklyH: number };
/** Settings: ORBIT_KAGGLE, ORBIT_KAGGLE_LOCAL_MAX_MIN (offer Kaggle when a local job would take longer, default 30), ORBIT_KAGGLE_RESERVE_HOURS
 *  (refuse when fewer hours would be left, default 2), ORBIT_KAGGLE_WEEKLY_HOURS (fallback weekly quota, default 30), ORBIT_LOCAL_VRAM_GB (default 8). */
export function burstConfig(env: Record<string, string | undefined>): BurstConfig {
  return {
    on: kaggleOn(env.ORBIT_KAGGLE),
    localVramGb: num(env.ORBIT_LOCAL_VRAM_GB, 8, 1, 96),
    maxLocalMin: num(env.ORBIT_KAGGLE_LOCAL_MAX_MIN, 30, 1, 24 * 60),
    reserveH: num(env.ORBIT_KAGGLE_RESERVE_HOURS, 2, 0, 30),
    weeklyH: num(env.ORBIT_KAGGLE_WEEKLY_HOURS, DEFAULT_WEEKLY_H, 1, 100),
  };
}

// ---------- the decision: local first ----------

export type BurstNeed = {
  kind: GpuKind;
  vramGb: number; // what the job needs on the GPU
  localMin: number | null; // estimated minutes on his PC; null = the PC can't do it at all (e.g. longer than a local clip)
  remoteMin: number; // estimated minutes on Kaggle, setup included
  remoteReady: boolean; // ORBIT has a remote script for this kind of job
  remoteBlock?: string; // why this particular job can't go (e.g. it starts from a VAULT picture)
};
export type BurstEnv = { cfg: BurstConfig; setupOk: boolean; setupHint: string; remoteBusy: boolean; hoursLeft: number };
export type Decision =
  | { run: "local"; note: string }
  | { run: "offer"; why: string; hours: number }
  | { run: "refuse"; why: string };

const hrs = (min: number) => Math.round((min / 60) * 10) / 10;
export const hoursText = (h: number) => `${Math.round(h * 10) / 10} h`;

/** Local when it fits and is quick enough. Otherwise offer Kaggle, if it is on, set up, free and has hours; else local when the PC can
 *  still do it (slowly), else refuse with the reason. An offer is only an offer: nothing leaves the PC before his click. */
export function decideBurst(n: BurstNeed, e: BurstEnv): Decision {
  const fitsVram = n.vramGb <= e.cfg.localVramGb;
  const localOk = fitsVram && n.localMin !== null;
  if (localOk && n.localMin! <= e.cfg.maxLocalMin) return { run: "local", note: "" };
  const why = !fitsVram ? `it needs about ${n.vramGb} GB of GPU memory and this PC has ${e.cfg.localVramGb} GB`
    : n.localMin === null ? "this PC can't make it in one go" : `it would take about ${Math.round(n.localMin!)} min on this PC`;
  const h = hrs(n.remoteMin);
  const no = (reason: string): Decision => (localOk ? { run: "local", note: `Ran on this PC (${why}); Kaggle wasn't used: ${reason}.` } : { run: "refuse", why: `Too big for this PC (${why}), and Kaggle can't take it: ${reason}.` });
  if (!e.cfg.on) return no("Kaggle burst is off (ORBIT_KAGGLE=0)");
  if (!n.remoteReady || n.remoteBlock) return no(n.remoteBlock || `ORBIT has no Kaggle recipe for ${n.kind} jobs yet`);
  if (n.vramGb > REMOTE_VRAM_GB) return no(`it needs more than Kaggle's ${REMOTE_VRAM_GB} GB GPU`);
  if (n.remoteMin > MAX_RUN_H * 60) return no(`it would run longer than Kaggle's ${MAX_RUN_H} h limit`);
  if (!e.setupOk) return no(`Kaggle isn't set up yet (${e.setupHint})`);
  if (e.remoteBusy) return no("one Kaggle job is already running (one at a time)");
  if (e.hoursLeft - h < e.cfg.reserveH) return no(`only ${hoursText(Math.max(0, e.hoursLeft))} of Kaggle GPU time left this week and it needs about ${hoursText(h)} (keeping ${hoursText(e.cfg.reserveH)} spare)`);
  return { run: "offer", why: `${why[0].toUpperCase()}${why.slice(1)}. On Kaggle: about ${hoursText(h)} of your ${hoursText(e.hoursLeft)} left this week.`, hours: h };
}

// ---------- weekly hours ----------

export type UsageRow = { at: number; hours: number; job: string };
const WEEK = 7 * 86_400_000;
/** ORBIT's own count over the last 7 days (a rolling week never under-counts Kaggle's reset). */
export const usedThisWeek = (rows: UsageRow[], now: number) => rows.filter((r) => r.at > now - WEEK).reduce((s, r) => s + r.hours, 0);
export const pruneUsage = (rows: UsageRow[], now: number) => rows.filter((r) => r.at > now - 2 * WEEK);

export type Quota = { usedH: number; totalH: number; refreshAt: string; source: "kaggle" | "orbit" };
/** `kaggle quota -v` → GPU row ("resource,used,remaining,total,refreshAt" / "GPU,3.50h,26.50h,30.00h,2026-11-22T00:00:00+00:00"). */
export function parseQuotaCsv(out: string): Quota | null {
  for (const line of out.split(/\r?\n/)) {
    const c = line.split(",").map((x) => x.trim());
    if (c[0]?.toUpperCase() !== "GPU" || c.length < 4) continue;
    const used = parseFloat(c[1]), total = parseFloat(c[3]);
    if (Number.isFinite(used) && Number.isFinite(total) && total > 0) return { usedH: used, totalH: total, refreshAt: c[4] ?? "", source: "kaggle" };
  }
  return null;
}
/** Hours left: Kaggle's own numbers when readable, minus what ORBIT ran since (Kaggle's count lags); else ORBIT's rolling count. */
export function hoursLeft(q: Quota | null, rows: UsageRow[], now: number, weeklyH: number, quotaAt = 0): number {
  if (q?.source === "kaggle") return Math.max(0, q.totalH - q.usedH - rows.filter((r) => r.at > quotaAt).reduce((s, r) => s + r.hours, 0));
  return Math.max(0, weeklyH - usedThisWeek(rows, now));
}

// ---------- what may be uploaded ----------

export type UploadFile = { name: string; path: string; bytes: number };
const BLOCKED = /(journal|diary|life|vault|memor|secret|password|token|kaggle\.json|access_token|\.env|credential|\.pem|\.key$|stop-all)/i;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const sep = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
/** Files a job may send: only from its own staging folder (`allowedDir`), never anything private by name or place, small, at most 4.
 *  Returns "" or why not. Video jobs send no files at all today (only the script); this guards every future kind. */
export function checkUpload(files: UploadFile[], allowedDir: string, privateDirs: string[]): string {
  if (files.length > 4) return "A Kaggle job may send at most 4 files.";
  let total = 0;
  for (const f of files) {
    const p = sep(f.path), dir = sep(allowedDir);
    if (!p.startsWith(dir + "/") || p.slice(dir.length + 1).includes("/") || p.includes("/../")) return `${f.name}: only the job's own files can go to Kaggle.`;
    if (privateDirs.some((d) => d && (p + "/").toLowerCase().startsWith(sep(d).toLowerCase() + "/"))) return `${f.name}: VAULT, LIFE and journal files never go to Kaggle.`;
    if (BLOCKED.test(f.name) || BLOCKED.test(p.slice(dir.length))) return `${f.name}: private-looking files never go to Kaggle.`;
    total += f.bytes;
  }
  return total > MAX_UPLOAD_BYTES ? "The files are too big for a Kaggle job (4 MB max)." : "";
}

// ---------- the Kaggle script ----------

export const slugOf = (jobId: string) => `${SLUG_PREFIX}${jobId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40)}`;
export const isOrbitSlug = (s: string) => new RegExp(`^[a-z0-9-]+/${SLUG_PREFIX}[a-z0-9-]+$`).test(s);
/** kernel-metadata.json: always private, GPU on, internet on (it downloads the pinned model), no data sources. */
export function kernelMetadata(user: string, jobId: string) {
  const slug = slugOf(jobId);
  return { id: `${user}/${slug}`, title: slug, code_file: "orbit_job.py", language: "python", kernel_type: "script", is_private: "true",
    enable_gpu: "true", enable_internet: "true", machine_shape: ACCELERATOR, dataset_sources: [], competition_sources: [], kernel_sources: [], model_sources: [] };
}
export const validUser = (u: unknown): u is string => typeof u === "string" && /^[a-z0-9][a-z0-9-]{0,49}$/i.test(u);

// Wan 2.2 TI2V-5B (Apache-2.0), the same model as local video, in its diffusers format, pinned to one revision. Libraries pinned too.
export const WAN = { repo: "Wan-AI/Wan2.2-TI2V-5B-Diffusers", revision: "b8fff7315c768468a5333511427288870b2e9635", license: "Apache-2.0" } as const;
export const PIP_PINS = ["diffusers==0.43.0", "transformers==5.23.0", "accelerate==1.16.0", "ftfy==6.3.1", "sentencepiece==0.2.3", "imageio==2.38.2", "imageio-ffmpeg==0.8.1"];
export const OUT_FILE = "orbit-out.mp4";

export const REMOTE_MAX_SECONDS = 30;
export type RemoteVideo = { prompt: string; negative: string; seconds: number; quality: "fast" | "best"; aspect: "16:9" | "9:16"; seed: number };
/** 5 s per segment; each next segment starts from the last frame of the one before (image to video), joined into one clip. */
export const segmentsFor = (seconds: number) => Math.max(1, Math.ceil(Math.min(REMOTE_MAX_SECONDS, Math.max(2, seconds)) / 5));
export function remoteVideoSettings(v: RemoteVideo) {
  const hd = v.quality === "best";
  const [w, h] = hd ? [1280, 704] : [832, 480];
  return { width: v.aspect === "9:16" ? h : w, height: v.aspect === "9:16" ? w : h, steps: hd ? 50 : 30, guidance: 5, frames: 121, fps: 24, segments: segmentsFor(v.seconds) };
}
/** UNTESTED on a real T4: estimates only. Setup (pip + about 20 GB of weights) plus per 5 s segment. */
export const remoteVideoMinutes = (v: Pick<RemoteVideo, "seconds" | "quality">) => 20 + segmentsFor(v.seconds) * (v.quality === "best" ? 60 : 20);
/** Local estimate (tools/comfyui/README.md, also untested): 4 min per fast clip, 12 for best; null above one local clip (5 s). */
export const localVideoMinutes = (v: Pick<RemoteVideo, "seconds" | "quality">) => (v.seconds > 5 ? null : v.quality === "best" ? 12 : 4);
export const videoNeed = (v: Pick<RemoteVideo, "seconds" | "quality">): BurstNeed =>
  ({ kind: "video", vramGb: 7, localMin: localVideoMinutes(v), remoteMin: remoteVideoMinutes(v), remoteReady: true });

/** The whole job as one Python script. Settings travel as one JSON string literal (JSON escapes are valid Python escapes), so he can read
 *  the prompt in the script he approves and no prompt text can break out into code. */
export function videoScript(v: RemoteVideo): string {
  const s = remoteVideoSettings(v);
  const params = { model: WAN.repo, revision: WAN.revision, prompt: v.prompt, negative: v.negative, seed: v.seed, out: OUT_FILE, ...s };
  return `# ORBIT Kaggle burst: Wan 2.2 TI2V-5B (${WAN.license}) text to video, ${s.segments} x 5 s segment(s). Written by ORBIT; runs once, private.
import json, subprocess, sys
P = json.loads(${JSON.stringify(JSON.stringify(params))})
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", ${PIP_PINS.map((p) => JSON.stringify(p)).join(", ")}])
import numpy as np, torch
from PIL import Image
from diffusers import AutoencoderKLWan, WanImageToVideoPipeline, WanPipeline
from diffusers.utils import export_to_video
dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
vae = AutoencoderKLWan.from_pretrained(P["model"], subfolder="vae", revision=P["revision"], torch_dtype=torch.float32)
t2v = WanPipeline.from_pretrained(P["model"], vae=vae, revision=P["revision"], torch_dtype=dtype)
t2v.enable_model_cpu_offload()
def run(pipe, i, **extra):
    g = torch.Generator("cpu").manual_seed(P["seed"] + i)
    return pipe(prompt=P["prompt"], negative_prompt=P["negative"], height=P["height"], width=P["width"], num_frames=P["frames"],
                guidance_scale=P["guidance"], num_inference_steps=P["steps"], generator=g, **extra).frames[0]
frames = list(run(t2v, 0))
print(json.dumps({"orbit": "segment", "done": 1, "of": P["segments"]}), flush=True)
if P["segments"] > 1:
    t2v.remove_all_hooks()
    i2v = WanImageToVideoPipeline(tokenizer=t2v.tokenizer, text_encoder=t2v.text_encoder, vae=t2v.vae, scheduler=t2v.scheduler,
                                  transformer=t2v.transformer, expand_timesteps=True)
    i2v.enable_model_cpu_offload()
    for i in range(1, P["segments"]):
        start = Image.fromarray((np.clip(frames[-1], 0, 1) * 255).astype("uint8"))
        frames.extend(list(run(i2v, i, image=start))[1:])
        print(json.dumps({"orbit": "segment", "done": i + 1, "of": P["segments"]}), flush=True)
export_to_video(frames, "/kaggle/working/" + P["out"], fps=P["fps"])
print(json.dumps({"orbit": "done", "file": P["out"]}), flush=True)
`;
}

// ---------- CLI output ----------

export type RemoteState = "queued" | "running" | "complete" | "error" | "cancelled" | "unknown";
/** `kaggle kernels status` → `user/slug has status "KernelWorkerStatus.RUNNING"` (+ `Failure message: "..."`). */
export function parseStatus(out: string): { state: RemoteState; message: string } {
  const m = /has status "(?:KernelWorkerStatus\.)?([A-Z_]+)"/i.exec(out);
  const message = /Failure message: "([^"]*)"/.exec(out)?.[1] ?? "";
  const s = (m?.[1] ?? "").toUpperCase();
  const state: RemoteState = s === "QUEUED" || s === "NEW_SCRIPT" ? "queued" : s === "RUNNING" ? "running" : s === "COMPLETE" ? "complete"
    : s === "ERROR" ? "error" : s.startsWith("CANCEL") ? "cancelled" : "unknown";
  return { state, message };
}
/** `kaggle kernels push` → ok, or the error it printed. */
export function parsePush(out: string): { ok: true } | { error: string } {
  if (/successfully pushed/i.test(out)) return { ok: true };
  const e = /Kernel push error:\s*(.+)/i.exec(out)?.[1]?.trim();
  return { error: e || out.trim().split(/\r?\n/).slice(-1)[0]?.slice(0, 300) || "Kaggle didn't accept the job." };
}
/** Any CLI failure → one plain sentence. */
export function cliError(out: string): string {
  if (/401|unauthori[sz]ed|could not find kaggle\.json|credentials|api token/i.test(out)) return "Kaggle didn't accept the token: put a fresh kaggle.json in your user folder's .kaggle folder (docs/KAGGLE-BURST.md).";
  if (/quota|exceeded|no remaining/i.test(out)) return "Your Kaggle GPU hours for this week are used up.";
  if (/phone|verif/i.test(out)) return "Kaggle needs your phone number verified before scripts may use a GPU or the internet (kaggle.com → Settings).";
  if (/ENOENT|not recognized|command not found|No module named kaggle/i.test(out)) return "The Kaggle CLI isn't installed: run tools\\kaggle\\setup.ps1 once.";
  if (/429|too many requests/i.test(out)) return "Kaggle is rate-limiting: try again in a few minutes.";
  return `Kaggle said: ${out.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 300) || "unknown error"}`;
}

// ---------- offers, jobs, the approval ----------

export type OfferResult = { type: "video"; name: string };
export type Offer = { id: string; kind: GpuKind; title: string; createdAt: number; script: string; files: UploadFile[]; hours: number; why: string; result: OfferResult };
export type JobStatus = "pushing" | "queued" | "running" | "downloading" | "done" | "failed" | "cancelled";
export type Job = { id: string; kind: GpuKind; title: string; kernel: string; status: JobStatus; pushedAt: number; deadline: number; endedAt?: number;
  error?: string; saved?: string[]; hours: number; result: OfferResult };
export const isLive = (j: Job | null | undefined) => !!j && ["pushing", "queued", "running", "downloading"].includes(j.status);
/** Exactly what Send to Kaggle uploads: its contentHash is the approval his click carries (approval-pure approvalGate "kaggle.upload"). */
export const kaggleContent = (o: Pick<Offer, "id" | "script" | "files">) => ({ id: o.id, script: o.script, files: o.files.map((f) => ({ name: f.name, bytes: f.bytes })) });
/** Remote run limit: twice the estimate plus an hour for the queue, at most Kaggle's 12 h. */
export const runTimeoutSec = (hours: number) => Math.round(Math.min(MAX_RUN_H, Math.max(1, hours * 2 + 1)) * 3600);
/** Offers expire after a day (the hours left and the prompt may have changed). */
export const freshOffers = (o: Offer[], now: number) => o.filter((x) => now - x.createdAt < 86_400_000).slice(-5);
