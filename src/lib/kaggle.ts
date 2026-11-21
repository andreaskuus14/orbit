// KAGGLE BURST, server side (rules and decision: kaggle-pure.ts; route: /api/kaggle; doc: docs/KAGGLE-BURST.md).
// Offer (local record) → his Send to Kaggle click (approval-pure "kaggle.upload", hash of the exact script + files) → private
// `kaggle kernels push` → poll `kaggle kernels status` → `kaggle kernels output` → saved in VAULT like a local job → the private
// ORBIT script is deleted from Kaggle. One remote job at a time. Stop-all or Cancel deletes ORBIT's own running script (the CLI has no
// cancel; deleting stops it). The token stays where the Kaggle CLI keeps it (%USERPROFILE%\.kaggle): ORBIT only checks that it exists
// and reads the username field of kaggle.json for the script's address; the key is never read, stored, logged or sent anywhere else.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { stopAllOn } from "./stop-all.ts";
import {
  burstConfig, checkUpload, cliError, decideBurst, freshOffers, hoursLeft, isLive, isOrbitSlug, kernelMetadata, OUT_FILE, parsePush, parseQuotaCsv,
  parseStatus, pruneUsage, runTimeoutSec, slugOf, validUser, type BurstNeed, type Decision, type Job, type Offer, type OfferResult, type Quota, type UsageRow,
} from "./kaggle-pure.ts";
import type { GpuKind } from "./gpu-lock-pure.ts";

type State = { offers: Offer[]; job: Job | null; usage: UsageRow[] };
type G = { state?: State; quota?: { q: Quota | null; at: number }; poller?: Promise<void>; save: Promise<unknown> };
const g = globalThis as unknown as { __orbitKaggle?: G };
const G = (): G => (g.__orbitKaggle ??= { save: Promise.resolve() });

const dir = () => path.join(orbitDataDir(), "kaggle");
const stateFile = () => path.join(dir(), "state.json");
const jobDir = (id: string) => path.join(dir(), "jobs", id.replace(/[^\w-]/g, ""));
const POLL_MS = () => Math.max(50, Number(process.env.ORBIT_KAGGLE_POLL_MS) || 60_000);

function load(): State {
  const s = G();
  if (s.state) return s.state;
  try {
    const j = JSON.parse(readFileSync(stateFile(), "utf8")) as Partial<State>;
    s.state = { offers: Array.isArray(j.offers) ? j.offers : [], job: j.job ?? null, usage: Array.isArray(j.usage) ? j.usage : [] };
  } catch { s.state = { offers: [], job: null, usage: [] }; }
  return s.state;
}
function save(): Promise<unknown> {
  const s = G();
  s.save = s.save.catch(() => {}).then(async () => {
    await mkdir(dir(), { recursive: true });
    await writeFile(stateFile() + ".tmp", JSON.stringify(load()));
    await rename(stateFile() + ".tmp", stateFile());
  });
  return s.save;
}

// ---------- the CLI and the token ----------

const cliBin = () => process.env.ORBIT_KAGGLE_CLI?.trim() || "kaggle";
/** Runs the official Kaggle CLI (no shell). Never throws: ok + combined output. */
export function kaggleCli(args: string[], ms = 120_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    try {
      execFile(cliBin(), args, { timeout: ms, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
        (e, out, err) => resolve({ ok: !e, out: `${out ?? ""}${err ?? ""}${e && !out && !err ? String((e as NodeJS.ErrnoException).code ?? e.message) : ""}`.trim() }));
    } catch (e) { resolve({ ok: false, out: e instanceof Error ? e.message : String(e) }); }
  });
}

const configDir = () => process.env.KAGGLE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".kaggle");
export type Setup = { ok: boolean; user: string; hint: string };
/** Token present + a username. The key itself is never read. */
export function kaggleSetup(): Setup {
  const hint = "run tools\\kaggle\\setup.ps1 once and put kaggle.json in your user folder's .kaggle folder";
  const jsonPath = path.join(configDir(), "kaggle.json");
  let user = process.env.ORBIT_KAGGLE_USER?.trim() || process.env.KAGGLE_USERNAME?.trim() || "";
  if (!user && existsSync(jsonPath)) { try { user = String((JSON.parse(readFileSync(jsonPath, "utf8")) as { username?: unknown }).username ?? ""); } catch { /* damaged file */ } }
  const token = existsSync(jsonPath) || existsSync(path.join(configDir(), "access_token")) || !!process.env.KAGGLE_API_TOKEN?.trim() || !!process.env.KAGGLE_KEY?.trim();
  if (!token) return { ok: false, user: "", hint };
  if (!validUser(user)) return { ok: false, user: "", hint: "set ORBIT_KAGGLE_USER to your Kaggle username (the token file has none)" };
  return { ok: true, user, hint: "" };
}

/** Kaggle's own weekly numbers (`kaggle quota -v`), cached 10 min; null when they can't be read. */
export async function kaggleQuota(force = false): Promise<Quota | null> {
  const s = G();
  if (!force && s.quota && Date.now() - s.quota.at < 10 * 60_000) return s.quota.q;
  const r = await kaggleCli(["quota", "-v"], 30_000);
  s.quota = { q: r.ok ? parseQuotaCsv(r.out) : null, at: Date.now() };
  return s.quota.q;
}

async function left(): Promise<number> {
  const st = load(), cfg = burstConfig(process.env);
  const q = kaggleSetup().ok ? await kaggleQuota() : null;
  return hoursLeft(q, st.usage, Date.now(), cfg.weeklyH, G().quota?.at ?? 0);
}

// ---------- decide + offer ----------

/** Local first. "offer" = ORBIT may write an offer; nothing goes out before his click. */
export async function decide(need: BurstNeed): Promise<Decision> {
  const cfg = burstConfig(process.env), su = kaggleSetup();
  return decideBurst(need, { cfg, setupOk: su.ok, setupHint: su.hint, remoteBusy: isLive(load().job), hoursLeft: su.ok ? await left() : 0 });
}

export async function addOffer(o: { kind: GpuKind; title: string; script: string; hours: number; why: string; result: OfferResult }): Promise<Offer> {
  const st = load(), now = Date.now(); // random tail: two offers in the same millisecond (the tests, a fast PC) must not share an id
  const offer: Offer = { id: `${o.kind}-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: o.kind, title: o.title.slice(0, 120), createdAt: now, script: o.script, files: [], hours: o.hours, why: o.why, result: o.result };
  st.offers = [...freshOffers(st.offers, now), offer];
  await save();
  return offer;
}

export async function declineOffer(id: string): Promise<boolean> {
  const st = load(), n = st.offers.length;
  st.offers = st.offers.filter((o) => o.id !== id);
  await save();
  return st.offers.length < n;
}

export type KaggleView = { on: boolean; setup: Setup; quota: Quota | null; hoursLeft: number; job: Job | null; offers: Offer[] };
export async function kaggleView(): Promise<KaggleView> {
  const st = load(), cfg = burstConfig(process.env), setup = kaggleSetup();
  if (isLive(st.job)) ensurePoller();
  const quota = setup.ok ? await kaggleQuota() : null;
  return { on: cfg.on, setup, quota, hoursLeft: setup.ok ? hoursLeft(quota, st.usage, Date.now(), cfg.weeklyH, G().quota?.at ?? 0) : 0, job: st.job, offers: freshOffers(st.offers, Date.now()) };
}

// ---------- run ----------

/** After his click (the route checks the approval hash first). Re-checks everything; throws a plain sentence when it can't start. */
export async function startOffer(id: string): Promise<Job> {
  const st = load(), cfg = burstConfig(process.env), su = kaggleSetup();
  const offer = freshOffers(st.offers, Date.now()).find((o) => o.id === id);
  if (!offer) throw new Error("That Kaggle offer is gone or older than a day: ask again.");
  if (!cfg.on) throw new Error("Kaggle burst is off (ORBIT_KAGGLE=0).");
  if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on).");
  if (!su.ok) throw new Error(`Kaggle isn't set up: ${su.hint}.`);
  if (isLive(st.job)) throw new Error("A Kaggle job is already running: one at a time.");
  const hl = await left();
  if (hl - offer.hours < cfg.reserveH) throw new Error(`Only ${hl.toFixed(1)} h of Kaggle GPU time left this week; this needs about ${offer.hours} h.`);
  const d = jobDir(offer.id), inDir = path.join(d, "push");
  const { vaultDir } = await import("./vault.ts");
  const why = checkUpload(offer.files, inDir, [vaultDir(), path.join(orbitDataDir(), "life.json"), path.join(orbitDataDir(), "vault")]);
  if (why) throw new Error(why);

  await rm(d, { recursive: true, force: true });
  await mkdir(inDir, { recursive: true });
  await writeFile(path.join(inDir, "orbit_job.py"), offer.script);
  await writeFile(path.join(inDir, "kernel-metadata.json"), JSON.stringify(kernelMetadata(su.user, offer.id), null, 2));
  const now = Date.now(), timeout = runTimeoutSec(offer.hours);
  const job: Job = { id: offer.id, kind: offer.kind, title: offer.title, kernel: `${su.user}/${slugOf(offer.id)}`, status: "pushing", pushedAt: now,
    deadline: now + timeout * 1000 + 30 * 60_000, hours: offer.hours, result: offer.result };
  st.job = job;
  st.offers = st.offers.filter((o) => o.id !== offer.id);
  await save();
  const r = await kaggleCli(["kernels", "push", "-p", inDir, "-t", String(timeout)], 5 * 60_000);
  const p = r.ok ? parsePush(r.out) : { error: cliError(r.out) };
  if ("error" in p) { await finish(job, "failed", `Kaggle didn't take the job: ${p.error}`, 0); throw new Error(job.error); }
  job.status = "queued";
  await save();
  log(`Sent to Kaggle: ${job.title}`, `Private script ${job.kernel}; about ${job.hours} h of GPU time`);
  ensurePoller();
  return job;
}

function log(title: string, detail?: string) {
  void import("./activity.ts").then((a) => a.logActivity({ area: "system", title, detail })).catch(() => {});
}

async function finish(job: Job, status: Job["status"], error: string | undefined, hoursUsed: number) {
  const st = load();
  if (job.endedAt) return; // already ended (a Cancel raced the poller): the first end wins
  job.status = status; job.endedAt = Date.now();
  if (error) job.error = error;
  if (hoursUsed > 0) st.usage = pruneUsage([...st.usage, { at: Date.now(), hours: Math.round(hoursUsed * 100) / 100, job: job.id }], Date.now());
  await save();
}
const ranHours = (job: Job) => Math.max(0, (Date.now() - job.pushedAt) / 3_600_000); // queue time included: never under-counts

/** Delete ORBIT's own script from Kaggle (stops a run). Only orbit-burst-* scripts, never anything else of his. */
async function deleteKernel(kernel: string): Promise<boolean> {
  if (!isOrbitSlug(kernel)) return false;
  return (await kaggleCli(["kernels", "delete", kernel, "-y"], 60_000)).ok;
}

/** His Cancel, or Stop-all. */
export async function cancelKaggle(why = "Cancelled"): Promise<boolean> {
  const job = load().job;
  if (!job || !isLive(job)) return false;
  const deleted = await deleteKernel(job.kernel);
  await finish(job, "cancelled", deleted ? why : `${why}; Kaggle didn't confirm, stop it at kaggle.com/code if it still runs`, ranHours(job));
  log(`Kaggle job cancelled: ${job.title}`, job.error);
  return true;
}

function ensurePoller() {
  const s = G();
  s.poller ??= poll().finally(() => { s.poller = undefined; });
}

async function poll(): Promise<void> {
  for (;;) {
    const job = load().job;
    if (!job || !isLive(job)) return;
    if (stopAllOn()) { await cancelKaggle("Stopped: Stop-all is on"); return; }
    if (Date.now() > job.deadline) { await deleteKernel(job.kernel); await finish(job, "failed", "Kaggle took longer than its time limit; the job was stopped.", ranHours(job)); return; }
    if (job.status !== "downloading") {
      const r = await kaggleCli(["kernels", "status", job.kernel], 60_000);
      if (!isLive(job) || load().job !== job) return; // cancelled or replaced while Kaggle answered
      const s = r.ok ? parseStatus(r.out) : { state: "unknown" as const, message: "" };
      if (s.state === "queued" || s.state === "running") { if (job.status !== s.state) { job.status = s.state; await save(); } }
      else if (s.state === "error") { await finish(job, "failed", `The job failed on Kaggle${s.message ? `: ${s.message.slice(0, 300)}` : ""}. Its log is at kaggle.com/code/${job.kernel}/log.`, ranHours(job)); return; }
      else if (s.state === "cancelled") { await finish(job, "cancelled", "Cancelled on Kaggle", ranHours(job)); return; }
      else if (s.state === "complete") { job.status = "downloading"; await save(); }
      else if (!r.ok && /401|unauthori|token|credentials/i.test(r.out)) { await finish(job, "failed", cliError(r.out), ranHours(job)); return; }
    }
    if (job.status === "downloading") { await download(job); return; }
    await new Promise((res) => setTimeout(res, POLL_MS()));
  }
}

/** Output → VAULT (the same place local jobs save to), then delete the private script from Kaggle. */
async function download(job: Job) {
  const out = path.join(jobDir(job.id), "out");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const r = await kaggleCli(["kernels", "output", job.kernel, "-p", out, "-o", "--file-pattern", `^${OUT_FILE.replace(".", "\\.")}$`], 30 * 60_000);
  const hours = ranHours(job);
  if (!isLive(job)) return; // cancelled while downloading
  if (!r.ok) { await finish(job, "failed", `The job finished but its output couldn't be downloaded: ${cliError(r.out)}`, hours); return; }
  try {
    const files = (await readdir(out)).filter((f) => f === OUT_FILE);
    if (!files.length) throw new Error("Kaggle finished but there was no video in its output.");
    const bytes = new Uint8Array(await readFile(path.join(out, files[0])));
    if ((await stat(path.join(out, files[0]))).size < 1000) throw new Error("Kaggle's video file is empty.");
    job.saved = [await importResult(job.result, bytes)];
    await finish(job, "done", undefined, hours);
    await deleteKernel(job.kernel).catch(() => false); // nothing of his stays on Kaggle
    log(`Kaggle job done: ${job.title}`, `Saved ${job.saved.join(", ")} in VAULT; about ${hours.toFixed(1)} h of Kaggle GPU time`);
  } catch (e) { await finish(job, "failed", e instanceof Error ? e.message : String(e), hours); }
  finally { await rm(jobDir(job.id), { recursive: true, force: true }).catch(() => {}); }
}

/** Into ORBIT's normal job output: VAULT (overridable in tests). */
let importer: (r: OfferResult, bytes: Uint8Array) => Promise<string> = async (r, bytes) => {
  const { isMp4 } = await import("./video-pure.ts");
  if (r.type === "video" && !isMp4(bytes)) throw new Error("Kaggle's file isn't an MP4 video.");
  const { saveUpload } = await import("./vault.ts");
  return saveUpload(new File([bytes as BlobPart], r.name, { type: "video/mp4" }));
};
export const setImporterForTests = (f: typeof importer) => { importer = f; };
const importResult = (r: OfferResult, b: Uint8Array) => importer(r, b);

/** Tests: forget the in-memory state. */
export const resetKaggleForTests = () => { g.__orbitKaggle = undefined; };
export const waitPollerForTests = () => G().poller ?? Promise.resolve();
