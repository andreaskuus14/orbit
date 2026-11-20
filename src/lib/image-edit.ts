// Local picture editing, server side: FLUX.2 klein 4B (NVFP4) in the picture ComfyUI on 127.0.0.1:8188 (tools/comfyui, setup.ps1 -Model flux2-klein-edit).
// VAULT picture → upload → /prompt → poll /history → fetch the PNG from /view → new VAULT file → /free. The original is never changed.
// Local only: nothing is uploaded or paid, so no approval. One heavy GPU job at a time via the shared lease (gpu-lock.ts, kind "image").
// UNTESTED on the GPU: speed and the 8 GB fit are estimates (see tools/comfyui/README.md).
import { readStream, saveUpload } from "./vault";
import { assetName } from "./local-ai-pure";
import { stopAllOn } from "./stop-all";
import { abortError, acquireGpu, freeComfyVram, pause } from "./gpu-lock";
import { trellisUrl } from "./trellis-pure";
import { comfyBase, comfyPost, comfyReady } from "./comfy";
import { comfyNotRunning, viewPath } from "./comfy-pure";
import { checkEdit, editNotInstalled, editSeed, editWorkflow, missingEditFiles, parseEditHistory, parseEditQueued, type EditRequest } from "./image-edit-pure";

export const EDIT_TIMEOUT_MS = 10 * 60_000; // the first edit also loads about 6 GB of model files from disk

const info = (u: string, node: string) => fetch(`${u}/object_info/${node}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null), () => null);

/** One edited picture as PNG bytes. */
export async function editImage(r: EditRequest, picture: Blob, o: { onWait?: (text: string) => void; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Uint8Array> {
  const u = comfyBase();
  if (!u) throw new Error("ORBIT_COMFY_URL must point at this PC (http://127.0.0.1:<port>).");
  if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on)");
  if (!(await comfyReady())) throw new Error(comfyNotRunning("sdxl-lightning"));
  const [unet, clip, vae] = await Promise.all([info(u, "UNETLoader"), info(u, "CLIPLoader"), info(u, "VAELoader")]);
  if (missingEditFiles({ unet, clip, vae }).length) throw new Error(editNotInstalled());
  const timeoutMs = o.timeoutMs ?? EDIT_TIMEOUT_MS;
  const lease = await acquireGpu("image", { maxWaitMs: 30 * 60_000, ttlMs: 3 * 60_000 /* heartbeat: every poll */, onWait: o.onWait, signal: o.signal });
  try {
    await freeComfyVram(trellisUrl(process.env.ORBIT_TRELLIS_URL));
    if (o.signal?.aborted) throw abortError(o.signal);
    const up = new FormData();
    up.append("image", new File([picture], `orbit-edit-${Date.now().toString(36)}.png`, { type: picture.type || "image/png" }));
    up.append("overwrite", "true");
    const ur = await fetch(`${u}/upload/image`, { method: "POST", body: up, signal: AbortSignal.timeout(60_000) });
    const uj = (await ur.json().catch(() => null)) as { name?: unknown } | null;
    if (!ur.ok || typeof uj?.name !== "string") throw new Error(`ComfyUI didn't accept the picture (${ur.status}).`);
    const q = parseEditQueued(await (await comfyPost(u, "/prompt", { prompt: editWorkflow({ instruction: r.instruction, image: uj.name, seed: editSeed(r) }), client_id: "orbit" })).json().catch(() => null));
    if ("error" in q) throw new Error(q.error);
    const until = Date.now() + timeoutMs;
    try {
      for (;;) {
        if (stopAllOn()) { await comfyPost(u, "/interrupt", {}).catch(() => {}); throw new Error("Stopped: Stop-all is on"); }
        if (Date.now() > until) { await comfyPost(u, "/interrupt", {}).catch(() => {}); throw new Error(`ComfyUI took longer than ${Math.round(timeoutMs / 60_000)} min and was stopped.`); }
        if (o.signal?.aborted) { await comfyPost(u, "/interrupt", {}).catch(() => {}); throw abortError(o.signal); }
        await pause(1500, o.signal);
        if (o.signal?.aborted) continue;
        lease.beat();
        const h = parseEditHistory(await fetch(`${u}/history/${encodeURIComponent(q.id)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((x) => x.json(), () => null), q.id);
        if (h.state === "error") throw new Error(h.error);
        if (h.state === "done") {
          const v = await fetch(`${u}${viewPath(h.image)}`, { signal: AbortSignal.timeout(30_000) });
          if (!v.ok) throw new Error(`ComfyUI made the picture but sending it failed (${v.status}).`);
          return new Uint8Array(await v.arrayBuffer());
        }
      }
    } finally { void comfyPost(u, "/free", { unload_models: true, free_memory: true }).catch(() => {}); } // the other local tools share the 8 GB
  } finally { lease.release(); }
}

/** CORE's local_image_edit. Errors come back as "Error: ..." text (core.ts's convention). */
export async function runImageEditTool(i: Record<string, unknown>): Promise<string> {
  try {
    const r = checkEdit(i);
    if ("error" in r) throw new Error(r.error);
    const { stream } = await readStream(r.image, null); // a VAULT file; traversal/missing names are refused there
    if (!stream) throw new Error("Couldn't read that picture from VAULT.");
    const bytes = await editImage(r, await new Response(stream).blob());
    const saved = await saveUpload(new File([bytes as BlobPart], assetName(r.name || `${r.image.replace(/\.[^.]+$/, "")} edit`, "png", "picture"), { type: "image/png" }));
    return `Saved the edited picture as "${saved}" in VAULT (edited "${r.image}", which is unchanged; made on his PC with FLUX.2 klein 4B in ComfyUI; free, nothing uploaded). Show it with vault_read or tell him where it is.`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
}
