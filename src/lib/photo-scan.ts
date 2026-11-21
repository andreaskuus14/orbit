// ARCH photo scan, server side (rules, words and the card: photo-scan-pure.ts; route: /api/arch/photo-scan).
// One job at a time: photos → (GPU lease, when the service has a GPU) → Local AI /photo-scan → .ply in VAULT (this PC only,
// "Made by the AI on this PC") → MEMORY note with the vault: line, so ARCH's library lists and reopens it.
// The photos stay in memory for the job only; they are not saved anywhere and never leave this PC.
import type { SupabaseClient } from "@supabase/supabase-js";
import { acquireGpu, type GpuLease } from "./gpu-lock";
import { localHealth, photoScanCall } from "./local-ai";
import { saveUpload } from "./vault";
import { createMemory } from "./memory";
import { stopAllOn } from "./stop-all";
import { checkPhotos, parseReport, photoScanNote, pruneJobs, scanFileName, type ScanJob, type ScanStage } from "./photo-scan-pure";

type G = { jobs: ScanJob[]; running: string | null };
const g = globalThis as unknown as { __orbitPhotoScan?: G };
const G = (): G => (g.__orbitPhotoScan ??= { jobs: [], running: null });

export const scanJobs = (): ScanJob[] => { const s = G(); s.jobs = pruneJobs(s.jobs, Date.now()); return s.jobs.map((j) => ({ ...j })); };

function set(id: string, patch: Partial<ScanJob>) {
  const s = G();
  s.jobs = s.jobs.map((j) => (j.id === id ? { ...j, ...patch, at: new Date().toISOString() } : j));
}

/** Start a scan. Returns the job (the card polls GET). Throws a plain sentence when it can't start. */
export function startScan(o: { sb: SupabaseClient; userId: string; title: string; photos: File[] }): ScanJob {
  const no = checkPhotos(o.photos.map((p) => ({ name: p.name, bytes: p.size })));
  if (no) throw new Error(no);
  if (stopAllOn()) throw new Error("Not right now: Stop-all is on.");
  const s = G();
  if (s.running) throw new Error("A scan is already being made. Wait for it to finish.");
  const now = new Date().toISOString();
  const job: ScanJob = { id: Date.now().toString(36), title: o.title.trim().slice(0, 80) || "scan", photos: o.photos.length, stage: "read", startedAt: now, at: now };
  s.jobs = pruneJobs([...s.jobs, job], Date.now());
  s.running = job.id;
  void run(job, o).finally(() => { if (G().running === job.id) G().running = null; });
  return job;
}

async function run(job: ScanJob, o: { sb: SupabaseClient; userId: string; photos: File[] }) {
  let lease: GpuLease | null = null;
  const stage = (st: ScanStage, extra: Partial<ScanJob> = {}) => set(job.id, { stage: st, ...extra });
  try {
    const health = await localHealth();
    if (!health.running) throw new Error("Local AI isn't running. It starts by itself when set up: run the one-time setup in OPERATIONS → Local AI (Photo scan).");
    if (!health.tools.scan) throw new Error("Photo scan isn't installed yet. One-time setup on the PC: powershell -ExecutionPolicy Bypass -File tools\\local-ai\\setup.ps1 -Scan");
    if (health.gpu) { // CPU-only service: nothing to wait for
      stage("gpu");
      lease = await acquireGpu("scan", { maxWaitMs: 30 * 60_000, ttlMs: 20 * 60_000, onWait: (text) => set(job.id, { wait: text }) });
    }
    stage("build", { wait: undefined });
    const out = await photoScanCall(o.photos);
    lease?.release(); lease = null;
    const report = parseReport(out.report);
    if (!report || !out.ply.length) throw new Error("Local AI sent back something that isn't a scan.");
    if (report.points < 1000) throw new Error("Too few sure points to make a scan. Take photos with more overlap (each photo should share about half its view with the next) and good light.");
    stage("save", { report });
    const saved = await saveUpload(new File([out.ply as BlobPart], scanFileName(job.title, new Date().toISOString()), { type: "application/octet-stream" }), { made: "Made by the AI on this PC" });
    let noteId: string | undefined;
    try {
      const m = await createMemory(o.sb, o.userId, { kind: "document", source: "arch.scan", ...photoScanNote({ title: job.title, vault: saved, photos: job.photos, report }) });
      noteId = m.memory?.id;
    } catch (e) { console.error("[orbit] photo scan: MEMORY note failed", e); } // the scan is saved; the library just won't list it
    set(job.id, { stage: "done", saved, noteId });
  } catch (e) {
    set(job.id, { error: e instanceof Error ? e.message : String(e) });
  } finally {
    lease?.release();
  }
}

export const resetScansForTests = () => { g.__orbitPhotoScan = undefined; };
