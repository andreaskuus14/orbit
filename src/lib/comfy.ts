// Local image generation, server side: ComfyUI on this PC (tools/comfyui, installed by setup.ps1). Queue → poll → fetch, 127.0.0.1
// only: the prompt never leaves the PC and nothing is paid, so no approval is needed. Pure parts and the workflow: comfy-pure.ts.
import { saveUpload } from "./vault";
import { assetName } from "./local-ai-pure";
import { stopAllOn } from "./stop-all";
import { checkImage, comfyModel, comfyModelName, comfyNotRunning, comfyUrl, imageWorkflow, parseHistory, parseQueued, parseStats, seedOf, sizeFor, viewPath, type ComfyHealth, type ComfyModel } from "./comfy-pure";

const base = () => comfyUrl(process.env.ORBIT_COMFY_URL);
export const configuredComfyModel = () => comfyModel(process.env.ORBIT_COMFY_MODEL);
const G = globalThis as unknown as { __orbitComfy?: Promise<boolean> | null; __orbitComfyFree?: NodeJS.Timeout };
const stats = (u: string, ms = 4000) => fetch(`${u}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : null), () => null);

async function paths() {
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "tools", "comfyui", "ComfyUI_windows_portable");
  return { dir, py: path.join(dir, "python_embeded", "python.exe"), main: path.join(dir, "ComfyUI", "main.py"), log: path.join(process.cwd(), "tools", "comfyui", "service.log") };
}
const installed = async () => (await import("node:fs")).existsSync((await paths()).py);

/** ComfyUI starts by itself (hidden) when ORBIT needs it, if setup.ps1 installed it; ORBIT_COMFY_AUTOSTART=0 turns that off. */
function autostart(u: string): Promise<boolean> {
  if (process.env.ORBIT_COMFY_AUTOSTART?.trim() === "0") return Promise.resolve(false);
  return (G.__orbitComfy ??= (async () => {
    const [{ spawn }, { closeSync, openSync }, p] = await Promise.all([import("node:child_process"), import("node:fs"), paths()]);
    if (!(await installed())) return false;
    const log = openSync(p.log, "a");
    // --listen 127.0.0.1: never reachable from the network; no browser tab opens.
    const child = spawn(p.py, ["-s", p.main, "--listen", "127.0.0.1", "--port", new URL(u).port || "8188", "--disable-auto-launch"],
      { cwd: p.dir, windowsHide: true, stdio: ["ignore", log, log] });
    closeSync(log);
    child.on("error", () => { G.__orbitComfy = null; });
    child.on("exit", () => { G.__orbitComfy = null; });
    // First launch on Windows can exceed the usual 90 seconds while Python initializes.
    const deadline = Date.now() + (configuredComfyModel() === "nitrofusion2" ? 180_000 : 90_000);
    while (Date.now() < deadline && child.exitCode === null && child.pid) {
      await new Promise((r) => setTimeout(r, 1500));
      if (await stats(u, 2000)) return true;
    }
    return false;
  })().finally(() => { setTimeout(() => { if (G.__orbitComfy) G.__orbitComfy = null; }, 60_000); }));
}

export async function comfyHealth(): Promise<ComfyHealth & { model: ComfyModel }> {
  const u = base();
  const model = configuredComfyModel();
  if (!u) return { ...parseStats(null, false), model };
  const j = await stats(u);
  if (!j && (await installed())) void autostart(u); // not running: start it in the background; the next check shows it
  return { ...parseStats(j, await installed()), model };
}

/** Is local generation usable right now (running, or installed and started within the wait)? */
export async function comfyReady(): Promise<boolean> {
  const u = base();
  return !!u && (!!(await stats(u, 2000)) || await autostart(u));
}

const post = (u: string, path: string, body: unknown) => fetch(`${u}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });

/** One picture as PNG bytes. The model leaves the GPU 2 min after the last picture (other local AI tools share the 8 GB). */
export async function generate(prompt: string, aspect: unknown, seedText = prompt, timeoutMs = 4 * 60_000): Promise<Uint8Array> {
  const u = base();
  if (!u) throw new Error("ORBIT_COMFY_URL must point at this PC (http://127.0.0.1:<port>).");
  if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on)");
  const model = configuredComfyModel();
  if (!(await comfyReady())) throw new Error(comfyNotRunning(model));
  const [width, height] = sizeFor(aspect);
  const graph = imageWorkflow(model, { prompt, width, height, seed: seedOf(seedText) });
  const q = parseQueued(await (await post(u, "/prompt", { prompt: graph, client_id: "orbit" })).json().catch(() => null), model);
  if ("error" in q) throw new Error(q.error);
  const until = Date.now() + timeoutMs; // the first picture loads the 6.9 GB model from disk
  try {
    for (;;) {
      if (stopAllOn()) { await post(u, "/interrupt", {}).catch(() => {}); throw new Error("Stopped: Stop-all is on"); }
      if (Date.now() > until) { await post(u, "/interrupt", {}).catch(() => {}); throw new Error(`ComfyUI took longer than ${Math.round(timeoutMs / 60_000)} min and was stopped.`); }
      await new Promise((r) => setTimeout(r, 1000));
      const h = parseHistory(await fetch(`${u}/history/${encodeURIComponent(q.id)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json(), () => null), q.id);
      if (h.state === "error") throw new Error(h.error);
      if (h.state === "done") {
        const r = await fetch(`${u}${viewPath(h.image)}`, { signal: AbortSignal.timeout(30_000) });
        if (!r.ok) throw new Error(`ComfyUI made the picture but sending it failed (${r.status}).`);
        return new Uint8Array(await r.arrayBuffer());
      }
    }
  } finally {
    if (G.__orbitComfyFree) clearTimeout(G.__orbitComfyFree);
    G.__orbitComfyFree = setTimeout(() => { void post(u, "/free", { unload_models: true, free_memory: true }).catch(() => {}); }, 2 * 60_000);
  }
}

/** A picture saved in VAULT (CORE's local_image and OPERATIONS/STUDIO). Returns the file name. */
export async function makeImage(i: Record<string, unknown>): Promise<string> {
  const c = checkImage(i);
  if ("error" in c) throw new Error(c.error);
  const bytes = await generate(c.prompt, c.aspect);
  return saveUpload(new File([bytes as BlobPart], assetName(c.name || c.prompt.slice(0, 40), "png", "picture"), { type: "image/png" }));
}

/** CORE tool local_image. Errors come back as "Error: ..." text (core.ts's convention). */
export async function runComfyTool(i: Record<string, unknown>): Promise<string> {
  try {
    const saved = await makeImage(i);
    return `Saved the picture as "${saved}" in VAULT (made on his PC with ${comfyModelName(configuredComfyModel())} in ComfyUI; free, nothing uploaded). Show it with vault_read or tell him where it is.`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
}
