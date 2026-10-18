import { createHash, randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evidencePage, object, parseReaEvidence, REA_LIMITS, validJob, validTarget, type ReaView } from "./rea-pure.ts";
import { runReaCommand } from "./rea-process.ts";
import { snapshotSources, type SourceManifest } from "./rea-snapshot.ts";

export type ReaJob = { id: string; target: string; state: "snapshotting" | "analyzing" | "done" | "failed" | "cancelled" | "interrupted"; created_at: string; updated_at: string; progress: string; error?: string; evidence_id?: string; source?: Pick<SourceManifest, "bytes" | "omitted_entries" | "policy"> & { files: number }; evidence_sha256?: string };
type Running = { user: string; job: ReaJob; controller: AbortController; finished: Promise<void> };
const g = globalThis as unknown as { __orbitReaRunning?: Map<string, Running>; __orbitReaStarting?: boolean };
const running = () => (g.__orbitReaRunning ??= new Map());
const dataDir = () => path.resolve(process.env.ORBIT_DATA_DIR?.trim() || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit")));
export const reaRoot = () => path.join(dataDir(), "rea");
const userRoot = (uid: string) => {
  if (!uid || uid.length > 200) throw new Error("A signed-in user is required.");
  return path.join(reaRoot(), "jobs", createHash("sha256").update(uid).digest("hex"));
};
const jobRoot = (uid: string, id: string) => { if (!validJob(id)) throw new Error("Invalid REA job ID."); return path.join(userRoot(uid), id); };
function enabled() {
  if (process.env.ORBIT_REA_ENABLED !== "true") throw new Error("REA is disabled. Run npm run rea:setup, enable ORBIT_REA_ENABLED=true and restart ORBIT.");
  const emails = (process.env.ORBIT_ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (!emails.length || emails.some((e) => !e.includes("@") || /example\.com$/i.test(e))) throw new Error("Set ORBIT_ALLOWED_EMAILS to your own account email before enabling local REA access.");
}
function targets(): Record<string, string> {
  const configured = process.env.ORBIT_REA_TARGETS_JSON ? object(JSON.parse(process.env.ORBIT_REA_TARGETS_JSON)) : {};
  if (!configured) throw new Error("ORBIT_REA_TARGETS_JSON must be an object of names to absolute source directories.");
  const result: Record<string, string> = { orbit: process.cwd() };
  for (const [name, value] of Object.entries(configured)) {
    if (!validTarget(name) || typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error("REA targets must have simple names and absolute directory paths.");
    result[name] = value;
  }
  return result;
}
async function entrypoint(): Promise<string> {
  const selected = process.env.ORBIT_REA_ENTRYPOINT?.trim() || path.join(process.cwd(), "vendor", "rea", "scripts", "rea.mjs");
  if (!path.isAbsolute(selected) || !/\.(?:mjs|js)$/.test(selected)) throw new Error("ORBIT_REA_ENTRYPOINT must be an absolute JavaScript entrypoint.");
  const p = await realpath(selected).catch(() => { throw new Error("REA is not installed. Run npm run rea:setup in ORBIT's folder."); });
  if (!(await stat(p)).isFile()) throw new Error("REA entrypoint is not a file.");
  if (!process.env.ORBIT_REA_ENTRYPOINT?.trim()) {
    for (const file of ["cli.js", "cliOutput.js", "cliResultOutput.js"]) {
      await access(path.join(process.cwd(), "vendor", "rea", "dist", "cli-runtime", file)).catch(() => { throw new Error("Bundled REA is not built. Run npm run rea:setup in ORBIT's folder."); });
    }
  }
  return p;
}
async function save(uid: string, job: ReaJob) {
  const dir = jobRoot(uid, job.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${randomUUID()}.tmp`);
  try { await writeFile(tmp, JSON.stringify(job), { flag: "wx", mode: 0o600 }); await rename(tmp, path.join(dir, "job.json")); }
  finally { await rm(tmp, { force: true }); }
}
async function boundedText(file: string): Promise<string> {
  const st = await lstat(file);
  if (!st.isFile() || st.size > REA_LIMITS.outputBytes) throw new Error("Saved REA file is unavailable or too large.");
  const b = await readFile(file);
  if (b.length > REA_LIMITS.outputBytes) throw new Error("Saved REA file exceeds its budget.");
  return b.toString("utf8");
}
export async function listReaJobs(uid: string): Promise<ReaJob[]> {
  enabled();
  let entries;
  try { entries = await readdir(userRoot(uid), { withFileTypes: true }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  const jobs: ReaJob[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validJob(entry.name)) continue;
    const file = await readReaJob(uid, entry.name);
    jobs.push(file);
  }
  return jobs.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function readReaJob(uid: string, id?: string): Promise<ReaJob> {
  enabled();
  if (!id) { const latest = (await listReaJobs(uid))[0]; if (!latest) throw new Error("No REA jobs yet."); return latest; }
  const live = running().get(id);
  if (live?.user === uid) return { ...live.job };
  const saved = JSON.parse(await boundedText(path.join(jobRoot(uid, id), "job.json"))) as ReaJob;
  if (saved.id !== id) throw new Error("Saved job identity does not match.");
  if (saved.state === "snapshotting" || saved.state === "analyzing") return { ...saved, state: "interrupted", progress: "ORBIT restarted before this analysis completed. Start a new analysis." };
  return saved;
}
export async function reaStatus(uid: string) {
  enabled();
  let installed = true; try { await entrypoint(); } catch { installed = false; }
  return { enabled: true, installed, busy: Boolean(g.__orbitReaStarting || running().size), targets: Object.keys(targets()), jobs: await listReaJobs(uid), note: "Static source-only analysis. Complete Evidence stays local; pages supplied to CORE are sent to Claude for reasoning. Use rea_analyze only on the user's request." };
}
export async function startReaJob(uid: string, target = "orbit"): Promise<ReaJob> {
  enabled();
  if (!validTarget(target) || !Object.hasOwn(targets(), target)) throw new Error("Unknown target. Use rea_status for registered target names.");
  // Reserve before any await, including entrypoint validation and history pruning.
  if (g.__orbitReaStarting || running().size) throw new Error("REA is busy. Wait for or cancel the running analysis.");
  g.__orbitReaStarting = true;
  try {
    const script = await entrypoint(), source = await realpath(targets()[target]);
    const old = await listReaJobs(uid);
    for (const job of old.slice(REA_LIMITS.jobs - 1)) await rm(jobRoot(uid, job.id), { recursive: true, force: true });
    const now = new Date().toISOString();
    const job: ReaJob = { id: randomUUID(), target, state: "snapshotting", created_at: now, updated_at: now, progress: "Copying a bounded source-only snapshot." };
    await save(uid, job);
    const controller = new AbortController();
    const live: Running = { user: uid, job, controller, finished: Promise.resolve() };
    running().set(job.id, live);
    live.finished = execute(live, source, script);
    return { ...job };
  } finally { g.__orbitReaStarting = false; }
}
async function execute(live: Running, source: string, script: string) {
  const { user: uid, job, controller } = live, dir = jobRoot(live.user, live.job.id), snapshot = path.join(dir, "source");
  const deadline = setTimeout(() => controller.abort(new Error("REA job exceeded its eight-minute budget.")), REA_LIMITS.timeoutMs);
  try {
    const manifest = await snapshotSources(source, snapshot, controller.signal, [await realpath(reaRoot())]);
    await writeFile(path.join(dir, "source-manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
    job.source = { files: manifest.files.length, bytes: manifest.bytes, omitted_entries: manifest.omitted_entries, policy: manifest.policy };
    job.state = "analyzing"; job.progress = "REA is parsing the selected source snapshot."; job.updated_at = new Date().toISOString();
    await save(uid, job);
    const text = await runReaCommand(script, snapshot, controller.signal, (line) => { void line; job.progress = "REA is analyzing source files…"; job.updated_at = new Date().toISOString(); });
    controller.signal.throwIfAborted();
    const evidence = parseReaEvidence(text);
    const tmp = path.join(dir, "evidence.tmp");
    await writeFile(tmp, text, { flag: "wx", mode: 0o600 });
    await rename(tmp, path.join(dir, "evidence.json"));
    job.evidence_id = String(evidence.evidence_id); job.evidence_sha256 = createHash("sha256").update(text).digest("hex");
    job.state = "done"; job.progress = "Analysis complete. Evidence and source manifest retained locally.";
  } catch (e) {
    job.state = controller.signal.aborted ? "cancelled" : "failed";
    job.error = e instanceof Error ? e.message.slice(0, 500) : "REA analysis failed.";
    job.progress = job.state === "cancelled" ? "Analysis stopped." : "Analysis failed; no successful Evidence is available.";
  } finally {
    clearTimeout(deadline);
    try { await rm(snapshot, { recursive: true, force: true }); await rm(path.join(dir, "evidence.tmp"), { force: true }); }
    catch { job.error = `${job.error ?? ""} Temporary source cleanup failed; remove the job's source directory locally.`.trim(); }
    job.updated_at = new Date().toISOString();
    try { await save(uid, job); } catch (e) { console.error("[rea] could not save final job state", e); }
    // Keep supervision ownership through process close and final cleanup.
    running().delete(job.id);
  }
}
export async function cancelReaJob(uid: string, id?: string) {
  const job = await readReaJob(uid, id), live = running().get(job.id);
  if (!live || live.user !== uid) return { ...job, note: "This job is not running." };
  live.controller.abort();
  // Cancellation remains pending until actual process exit; subsequent starts stay blocked.
  return { ...job, progress: "Cancellation requested; waiting for REA to close." };
}
export async function reaEvidenceText(uid: string, id: string): Promise<string> {
  const job = await readReaJob(uid, id);
  if (job.state !== "done") throw new Error(`REA job is ${job.state}; complete Evidence is not available.`);
  const text = await boundedText(path.join(jobRoot(uid, id), "evidence.json"));
  if (createHash("sha256").update(text).digest("hex") !== job.evidence_sha256) throw new Error("Saved Evidence checksum does not match the completed job.");
  return text;
}
export async function readReaPage(uid: string, id: string | undefined, view: ReaView, offset: number, query: string) {
  const job = await readReaJob(uid, id);
  const ev = parseReaEvidence(await reaEvidenceText(uid, job.id));
  const page = { job: job.id, target: job.target, snapshot: job.source, download: `/api/rea?job=${job.id}&download=1`, ...evidencePage(ev, view, offset, query) };
  // CORE applies an 8,000-character cap to tool results. Budget the encoded envelope,
  // including quote/backslash expansion, rather than silently losing continuation data.
  while (JSON.stringify(page).length > 7000 && page.text.length > 100) {
    page.text = page.text.slice(0, Math.floor(page.text.length * 0.8));
    page.next_offset = offset + page.text.length < page.total_chars ? offset + page.text.length : null;
  }
  return page;
}
