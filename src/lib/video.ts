// Local AI video, server side: Wan 2.2 TI2V-5B (GGUF) in the picture ComfyUI on 127.0.0.1:8188 (tools/comfyui, setup.ps1 -Model wan22-video).
// Optional VAULT picture → upload → /prompt → poll /history → fetch the .mp4 from /view → VAULT → /free. Local only: nothing is uploaded or paid.
import { readStream, saveUpload } from "./vault";
import { assetName } from "./local-ai-pure";
import { stopAllOn } from "./stop-all";
import { comfyBase, comfyPost, comfyReady } from "./comfy";
import { comfyNotRunning, seedOf } from "./comfy-pure";
import { checkVideo, framesFor, isMp4, parseVideoHistory, parseVideoQueued, videoHd, videoNotInstalled, videoSize, videoViewPath, videoWorkflow, type VideoRequest } from "./video-pure";

export const VIDEO_TIMEOUT_MS = 30 * 60_000;

/** One clip as MP4 bytes. Frees the models from the GPU right after (video is heavy; pictures and 3D share the 8 GB). */
/** One clip; waits its turn for the shared GPU (gpu-lock.ts). The lease covers the whole timeout, so no heartbeat is needed. */
export async function generateVideo(r: VideoRequest, picture: Blob | null, timeoutMs = VIDEO_TIMEOUT_MS): Promise<Uint8Array> {
  const { acquireGpu, freeComfyVram } = await import("./gpu-lock");
  const lease = await acquireGpu("video", { maxWaitMs: 60 * 60_000, ttlMs: timeoutMs + 2 * 60_000 });
  try {
    await freeComfyVram((await import("./trellis-pure")).trellisUrl(process.env.ORBIT_TRELLIS_URL));
    return await generateVideoNow(r, picture, timeoutMs);
  } finally { lease.release(); }
}

async function generateVideoNow(r: VideoRequest, picture: Blob | null, timeoutMs: number): Promise<Uint8Array> {
  const u = comfyBase();
  if (!u) throw new Error("ORBIT_COMFY_URL must point at this PC (http://127.0.0.1:<port>).");
  if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on)");
  if (!(await comfyReady())) throw new Error(comfyNotRunning("sdxl-lightning"));
  // the GGUF node pack must be loaded, or the graph can't run: say so before queueing
  const info = await fetch(`${u}/object_info/UnetLoaderGGUF`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((x) => x.ok, () => false);
  if (!info) throw new Error(videoNotInstalled());
  let uploaded: string | undefined;
  if (picture) {
    const up = new FormData();
    up.append("image", new File([picture], `orbit-video-${Date.now().toString(36)}.png`, { type: picture.type || "image/png" }));
    up.append("overwrite", "true");
    const ur = await fetch(`${u}/upload/image`, { method: "POST", body: up, signal: AbortSignal.timeout(60_000) });
    const j = (await ur.json().catch(() => null)) as { name?: unknown } | null;
    if (!ur.ok || typeof j?.name !== "string") throw new Error(`ComfyUI didn't accept the picture (${ur.status}).`);
    uploaded = j.name;
  }
  const [width, height] = videoSize(r.aspect, r.quality === "best" && videoHd(process.env.ORBIT_VIDEO_HD));
  const graph = videoWorkflow({ prompt: r.prompt, width, height, length: framesFor(r.seconds), seed: seedOf(r.prompt + r.image), quality: r.quality, image: uploaded });
  const q = parseVideoQueued(await (await comfyPost(u, "/prompt", { prompt: graph, client_id: "orbit" })).json().catch(() => null));
  if ("error" in q) throw new Error(q.error);
  const until = Date.now() + timeoutMs; // the first clip also loads about 10 GB of model files from disk
  try {
    for (;;) {
      if (stopAllOn()) { await comfyPost(u, "/interrupt", {}).catch(() => {}); throw new Error("Stopped: Stop-all is on"); }
      if (Date.now() > until) { await comfyPost(u, "/interrupt", {}).catch(() => {}); throw new Error(`ComfyUI took longer than ${Math.round(timeoutMs / 60_000)} min and was stopped.`); }
      await new Promise((res) => setTimeout(res, 3000));
      const h = parseVideoHistory(await fetch(`${u}/history/${encodeURIComponent(q.id)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((x) => x.json(), () => null), q.id);
      if (h.state === "error") throw new Error(h.error);
      if (h.state === "done") {
        const v = await fetch(`${u}${videoViewPath(h.video)}`, { signal: AbortSignal.timeout(120_000) });
        const bytes = new Uint8Array(await v.arrayBuffer());
        if (!v.ok || !isMp4(bytes)) throw new Error(`ComfyUI made the video but it couldn't be read (${v.status}); see tools/comfyui/service.log.`);
        return bytes;
      }
    }
  } finally { // back-to-back clips keep Wan loaded (gpu-lock keepWarm); anything else frees the GPU now
    void import("./gpu-lock").then((g) => g.unloadUnlessNext("video", () => comfyPost(u, "/free", { unload_models: true, free_memory: true })));
  }
}

/** CORE's local_video. Errors come back as "Error: ..." text (core.ts's convention). */
export async function runVideoTool(i: Record<string, unknown>): Promise<string> {
  try {
    const r = checkVideo(i);
    if ("error" in r) throw new Error(r.error);
    let picture: Blob | null = null;
    if (r.image) {
      const { stream } = await readStream(r.image, null); // a VAULT file; traversal/missing names are refused there
      if (!stream) throw new Error("Couldn't read that picture from VAULT.");
      picture = await new Response(stream).blob();
    }
    const bytes = await generateVideo(r, picture);
    const saved = await saveUpload(new File([bytes as BlobPart], assetName(r.name || r.prompt.slice(0, 40), "mp4", "video"), { type: "video/mp4" }));
    return `Saved the video as "${saved}" in VAULT (${r.image ? "image to video" : "text to video"}, about ${r.seconds} s, made on his PC with Wan 2.2 in ComfyUI; free, nothing uploaded; silent, no sound). Show it with vault_read or tell him where it is.`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
}
