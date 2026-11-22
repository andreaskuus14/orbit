// ARCH → Render in Blender (IO). Pure rules: arch-render-pure.ts. Reads the saved ARCH model (arch-scene.json, the same store
// /api/arch/scene writes), writes the Blender script into <ORBIT data dir>/arch-render/, runs Blender in the background on this PC
// (Cycles, GPU lease shared with the other GPU jobs) and saves the PNG to VAULT. One render at a time; Stop-all refuses a start.
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { blenderScript, type Quality } from "./arch-blender-pure.ts";
import { blenderArgs, blenderError, cleanScene, findBlender, pruneJobs, renderFileName, renderSite, TIMEOUT_MS, WINGET_BLENDER, type BlenderInfo, type RenderJob, type RenderStage } from "./arch-render-pure.ts";
import { archScopeKey } from "./project-desk-pure.ts";
import { acquireGpu, type GpuLease } from "./gpu-lock";
import { orbitDataDir } from "./data-dir";
import { saveUpload } from "./vault";
import { stopAllOn } from "./stop-all";

type G = { jobs: RenderJob[]; running: string | null };
const g = globalThis as unknown as { __orbitArchRender?: G };
const G = (): G => (g.__orbitArchRender ??= { jobs: [], running: null });

export const renderJobs = (): RenderJob[] => { const s = G(); s.jobs = pruneJobs(s.jobs, Date.now()); return s.jobs.map((j) => ({ ...j })); };
const set = (id: string, patch: Partial<RenderJob>) => { const s = G(); s.jobs = s.jobs.map((j) => (j.id === id ? { ...j, ...patch, at: new Date().toISOString() } : j)); };

/** Installed Blender folders under Program Files (Windows); empty elsewhere. */
function installed(): string[] {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean).map((r) => path.join(r!, "Blender Foundation"));
  return roots.flatMap((r) => { try { return readdirSync(r).map((d) => path.join(r, d, "blender.exe")).filter((f) => existsSync(f)); } catch { return []; } });
}

/** blender(.exe) on PATH, or null. */
function onPath(): string | null {
  const names = process.platform === "win32" ? ["blender.exe"] : ["blender"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) for (const n of names) { const f = path.join(dir, n); if (existsSync(f)) return f; }
  return null;
}
/** Is Blender on this PC, and where (checked on each call: he may have just installed it). */
export const blenderInfo = (): BlenderInfo => findBlender(process.env.BLENDER_PATH, installed(), onPath(), existsSync);

async function savedScene(userId: string, project: string | null): Promise<unknown> {
  try { return JSON.parse(await readFile(path.join(orbitDataDir(), "arch-scene.json"), "utf8"))?.users?.[archScopeKey(userId, project)]?.scene ?? null; }
  catch { return null; }
}

/** Start a render of the saved model. Throws a plain sentence when it can't start. */
export async function startRender(o: { userId: string; project: string | null; quality: Quality; lat?: unknown; lon?: unknown; at?: unknown }): Promise<RenderJob> {
  if (stopAllOn()) throw new Error("Not right now: Stop-all is on.");
  const s = G();
  if (s.running) throw new Error("A render is already running. Wait for it to finish.");
  if (!blenderInfo().found) throw new Error(`Blender isn't installed. Install it free (one command in a terminal): ${WINGET_BLENDER}`);
  const scene = cleanScene(await savedScene(o.userId, o.project));
  if (!scene) throw new Error("Nothing to render yet: build or save a house in ARCH first.");
  const now = new Date(), iso = now.toISOString();
  const job: RenderJob = { id: now.getTime().toString(36), quality: o.quality, stage: "script", startedAt: iso, at: iso };
  s.jobs = pruneJobs([...s.jobs, job], now.getTime());
  s.running = job.id;
  void run(job, scene, renderSite(o, now)).finally(() => { if (G().running === job.id) G().running = null; });
  return job;
}

async function run(job: RenderJob, scene: NonNullable<ReturnType<typeof cleanScene>>, site: ReturnType<typeof renderSite>) {
  let lease: GpuLease | null = null;
  const stage = (st: RenderStage, extra: Partial<RenderJob> = {}) => set(job.id, { stage: st, ...extra });
  try {
    const dir = path.join(orbitDataDir(), "arch-render");
    await mkdir(dir, { recursive: true });
    const py = path.join(dir, `${job.id}.py`), out = path.join(dir, `${job.id}.png`);
    await writeFile(py, blenderScript(scene, { site: { lat: site.lat, lon: site.lon }, date: site.date, quality: job.quality }), "utf8");
    stage("gpu");
    lease = await acquireGpu("render", { maxWaitMs: 30 * 60_000, ttlMs: TIMEOUT_MS[job.quality] + 60_000, onWait: (text) => set(job.id, { wait: text }) });
    stage("render", { wait: undefined });
    const t0 = Date.now(), bin = blenderInfo().bin;
    await new Promise<void>((resolve, reject) => {
      execFile(bin, blenderArgs(py, out), { timeout: TIMEOUT_MS[job.quality], windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => {
        if (!e) return resolve();
        const log = `${stdout}${stderr}`.slice(-2000);
        console.error("[orbit] ARCH Blender render failed", (e as NodeJS.ErrnoException).code ?? e.signal, log);
        reject(new Error(blenderError((e as NodeJS.ErrnoException).code ?? (e.killed ? "ETIMEDOUT" : null), log)));
      });
    });
    lease.release(); lease = null;
    stage("save", { seconds: Math.round((Date.now() - t0) / 1000) });
    const png = await readFile(out).catch(() => null);
    if (!png?.length) throw new Error("Blender finished but no picture came out. The details are in ORBIT's log.");
    const saved = await saveUpload(new File([png as BlobPart], renderFileName(job.quality, new Date().toISOString()), { type: "image/png" }), { made: "Rendered with Blender on this PC" });
    set(job.id, { stage: "done", saved });
  } catch (e) {
    set(job.id, { error: e instanceof Error ? e.message : String(e) });
  } finally {
    lease?.release();
  }
}

export const resetRendersForTests = () => { g.__orbitArchRender = undefined; };
