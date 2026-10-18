import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildComposition, burnAssArgs, hfRenderArgs, overlayArgs, type FxIn } from "./hyperframes-pure";
import { runFfmpeg } from "./factory";

// Optional Hyperframes effects layer for Shorts (pure part + composition: hyperframes-pure.ts). Not installed / failed / timed out →
// renderClip keeps today's burned ASS captions and the job gets a "Hyperframes effects skipped: …" warning.

const WIN = process.platform === "win32";
const timeoutFor = (sec: number) => Math.min(15, 3 + Math.ceil(Math.max(0, sec) / 15)) * 60_000; // 3 min + 1 per 15 s of clip, max 15
const exists = (p: string) => access(p).then(() => true, () => false);
/** rename replaces an existing file on Windows too, but fails with EPERM/EBUSY while e.g. an antivirus scans the fresh mp4: retry briefly. */
async function move(from: string, to: string) {
  for (let i = 0; ; i++) {
    try { return await rename(from, to); } catch (e) {
      if (!WIN || i >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/** The CLI's bin script (run with this Node, no shell: .cmd shims need one on Windows), or null when hyperframes isn't installed. */
export async function hyperframesCli(): Promise<string | null> {
  const nm = path.join(process.cwd(), "node_modules");
  if (!(await exists(path.join(nm, ".bin", WIN ? "hyperframes.cmd" : "hyperframes")))) return null;
  try {
    const pkg = JSON.parse(await readFile(path.join(nm, "hyperframes", "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.hyperframes;
    const file = typeof bin === "string" ? path.resolve(nm, "hyperframes", bin) : "";
    return file.startsWith(path.join(nm, "hyperframes") + path.sep) && (await exists(file)) ? file : null;
  } catch { return null; }
}

/** Chrome runs under the CLI: on Windows kill the whole tree, not just node. */
function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }) {
  if (WIN && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill("SIGKILL"));
  else child.kill("SIGKILL");
}

function runCli(bin: string, args: string[], cwd: string, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(process.execPath, [bin, ...args], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" } });
    let out = "";
    const keep = (d: Buffer) => { out = (out + d.toString("utf8")).slice(-4000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    let timedOut = false;
    const kill = () => killTree(child);
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    signal.addEventListener("abort", kill, { once: true });
    child.on("error", (e) => { clearTimeout(timer); signal.removeEventListener("abort", kill); reject(new Error(`could not start it: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer); signal.removeEventListener("abort", kill);
      if (signal.aborted) return reject(signal.reason);
      if (timedOut) return reject(new Error(`render timed out after ${timeoutMs / 60_000} min`));
      if (code === 0) return resolve();
      const last = out.replace(/\x1b\[[0-9;]*m/g, "").trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ").slice(0, 300);
      reject(new Error(`render failed (exit ${code})${last ? `: ${last}` : ""}`));
    });
  });
}

/** Renders the effects layer to <dir>/<id>.fx.mov. layer: use it (and skip the ASS captions); warning: why not. Throws only on cancel. */
export async function renderEffects(dir: string, id: string, o: Omit<FxIn, "playbook">, signal: AbortSignal): Promise<{ layer?: string; warning?: string }> {
  const skip = (why: string) => ({ warning: `Hyperframes effects skipped: ${why}` });
  const bin = await hyperframesCli();
  if (!bin) return {}; // optional engine: not installed = today's path, no per-job warning (the doctor shows how to install)
  const playbook = await import("./study").then((m) => m.playbook(), () => null);
  const html = buildComposition({ ...o, playbook });
  if (!html) return {};
  const proj = path.join(dir, `${id}.fx`), layer = path.join(dir, `${id}.fx.mov`);
  try {
    await mkdir(proj, { recursive: true });
    await writeFile(path.join(proj, "index.html"), html, "utf8");
    await runCli(bin, hfRenderArgs(proj, layer), proj, signal, timeoutFor(o.duration)); // cwd = the throwaway project: stray CLI files go with it
    if (!(await exists(layer))) return skip("the render made no file");
    return { layer };
  } catch (e) {
    // also on cancel: a partial ProRes 4444 layer can be GBs; retries because Windows may hold it briefly after the tree kill
    await rm(layer, { force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    if (signal.aborted) throw e;
    return skip(e instanceof Error ? e.message : String(e));
  } finally {
    rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}); // Windows may hold it briefly after a kill
  }
}

/** Overlays the layer onto <dir>/<video> in place. If that fails, burns the ASS captions instead (same look as without hyperframes)
 *  and returns a warning. The layer file is always removed. */
export async function applyEffects(ff: string, dir: string, video: string, layer: string, ass: string, signal: AbortSignal): Promise<string | null> {
  const tmp = `${video}.fx.mp4`;
  try {
    try {
      await runFfmpeg(ff, overlayArgs(video, path.basename(layer), tmp), { cwd: dir, signal, timeoutMs: 15 * 60_000 });
      await move(path.join(dir, tmp), path.join(dir, video));
      return null;
    } catch (e) {
      if (signal.aborted) throw e;
      await runFfmpeg(ff, burnAssArgs(video, ass, tmp), { cwd: dir, signal, timeoutMs: 15 * 60_000 });
      await move(path.join(dir, tmp), path.join(dir, video));
      return `Hyperframes effects skipped: overlay failed (${(e instanceof Error ? e.message : String(e)).slice(0, 200)})`;
    }
  } finally {
    await Promise.all([rm(path.join(dir, tmp), { force: true }), rm(layer, { force: true })]);
  }
}
