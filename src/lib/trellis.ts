// TRELLIS.2 picture → 3D, server side: its own ComfyUI on 127.0.0.1:8189 (tools/trellis, installed by setup.ps1).
// Upload → queue → poll → fetch the .glb → VAULT. Local only: the picture never leaves the PC, nothing is paid, so no approval.
import { readStream, saveUpload } from "./vault";
import { assetName } from "./local-ai-pure";
import { stopAllOn } from "./stop-all";
import { MODEL, isGlb, outputRef, robloxMaterials, parseQueued, parseRun, trellisNotRunning, trellisUrl, workflow } from "./trellis-pure";

const base = () => trellisUrl(process.env.ORBIT_TRELLIS_URL);
const G = globalThis as unknown as { __orbitTrellis?: Promise<boolean> | null; __orbitTrellisFree?: NodeJS.Timeout };
const stats = (u: string, ms = 4000) => fetch(`${u}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : null), () => null);

async function paths() {
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "tools", "trellis");
  return { dir: path.join(dir, "ComfyUI"), py: path.join(dir, "env", "Scripts", "python.exe"), log: path.join(dir, "service.log") };
}

/** Starts by itself (hidden) when needed, if setup.ps1 installed it; ORBIT_TRELLIS_AUTOSTART=0 turns that off. */
function autostart(u: string): Promise<boolean> {
  if (process.env.ORBIT_TRELLIS_AUTOSTART?.trim() === "0") return Promise.resolve(false);
  return (G.__orbitTrellis ??= (async () => {
    const [{ spawn }, { closeSync, existsSync, openSync }, p] = await Promise.all([import("node:child_process"), import("node:fs"), paths()]);
    if (!existsSync(p.py)) return false;
    const log = openSync(p.log, "a");
    // --listen 127.0.0.1: never reachable from the network. --lowvram: the 8 GB laptop GPU is shared with other local AI.
    const child = spawn(p.py, ["-s", "main.py", "--listen", "127.0.0.1", "--port", new URL(u).port || "8189", "--disable-auto-launch", "--lowvram"],
      { cwd: p.dir, windowsHide: true, stdio: ["ignore", log, log] });
    closeSync(log);
    child.on("error", () => { G.__orbitTrellis = null; });
    child.on("exit", () => { G.__orbitTrellis = null; });
    const deadline = Date.now() + 180_000; // the node pack checks its CUDA wheels on first start
    while (Date.now() < deadline && child.exitCode === null && child.pid) {
      await new Promise((r) => setTimeout(r, 1500));
      if (await stats(u, 2000)) return true;
    }
    return false;
  })().finally(() => { setTimeout(() => { if (G.__orbitTrellis) G.__orbitTrellis = null; }, 60_000); }));
}

const ready = async (u: string) => !!(await stats(u, 2000)) || autostart(u);
const post = (u: string, path: string, body: unknown) => fetch(`${u}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });

/** One picture → .glb bytes, capped for Roblox (20k triangles, 1024 px texture). First run downloads ~10 GB of model files. */
export async function trellisModel(picture: Blob, job: string, timeoutMs = 25 * 60_000): Promise<Uint8Array> {
  const u = base();
  if (!u) throw new Error("ORBIT_TRELLIS_URL must point at this PC (http://127.0.0.1:<port>).");
  if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on)");
  if (!(await ready(u))) throw new Error(trellisNotRunning());
  const up = new FormData();
  up.append("image", new File([picture], `${job}.png`, { type: picture.type || "image/png" }));
  up.append("overwrite", "true");
  const ur = await fetch(`${u}/upload/image`, { method: "POST", body: up, signal: AbortSignal.timeout(60_000) });
  const uploaded = (await ur.json().catch(() => null)) as { name?: unknown } | null;
  if (!ur.ok || typeof uploaded?.name !== "string") throw new Error(`TRELLIS.2 didn't accept the picture (${ur.status}).`);
  const q = parseQueued(await (await post(u, "/prompt", { prompt: workflow({ image: uploaded.name, seed: 42, job }), client_id: "orbit" })).json().catch(() => null));
  if ("error" in q) throw new Error(q.error);
  const until = Date.now() + timeoutMs;
  try {
    for (;;) {
      if (stopAllOn()) { await post(u, "/interrupt", {}).catch(() => {}); throw new Error("Stopped: Stop-all is on"); }
      if (Date.now() > until) { await post(u, "/interrupt", {}).catch(() => {}); throw new Error(`TRELLIS.2 took longer than ${Math.round(timeoutMs / 60_000)} min and was stopped.`); }
      await new Promise((r) => setTimeout(r, 2000));
      const h = parseRun(await fetch(`${u}/history/${encodeURIComponent(q.id)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json(), () => null), q.id);
      if (h.state === "error") throw new Error(h.error);
      if (h.state === "done") {
        const r = await fetch(`${u}/view?${new URLSearchParams(outputRef(job))}`, { signal: AbortSignal.timeout(60_000) });
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!r.ok || !isGlb(bytes)) throw new Error(`TRELLIS.2 finished but the .glb couldn't be read (${r.status}); see tools/trellis/service.log.`);
        return robloxMaterials(bytes);
      }
    }
  } finally {
    // give the GPU back quickly: pictures, voice and TripoSR share the same 8 GB
    if (G.__orbitTrellisFree) clearTimeout(G.__orbitTrellisFree);
    G.__orbitTrellisFree = setTimeout(() => { void post(u, "/free", { unload_models: true, free_memory: true }).catch(() => {}); }, 30_000);
  }
}

/** CORE's local_3d with quality "best". Errors come back as "Error: ..." text (core.ts's convention). */
export async function runTrellisTool(i: Record<string, unknown>): Promise<string> {
  try {
    const { stream } = await readStream(i.image, null); // a VAULT file; traversal/missing names are refused there
    const picture = await new Response(stream).blob();
    const job = `j${Date.now().toString(36)}`;
    const bytes = await trellisModel(picture, job);
    const saved = await saveUpload(new File([bytes as BlobPart], assetName(i.name ?? i.image, "glb", "model-3d"), { type: "model/gltf-binary" }));
    return `Saved the 3D model as "${saved}" in VAULT (${MODEL.name} on his PC, textured, max 20,000 triangles and a 1024 px texture so Roblox accepts it; takes about 7-8 min). In Roblox Studio use Import 3D and pick that file (ORBIT can't import into Studio by itself).`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
}
