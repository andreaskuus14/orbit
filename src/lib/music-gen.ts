// Local AI music beds, server side: ACE-Step 1.5 turbo on the picture ComfyUI (127.0.0.1:8188, started by comfy.ts's autostart). Queue →
// poll → download → /free. Free, nothing leaves the PC. Pure parts: music-gen-pure.ts. Used by clips/music.ts (pickMusic) and CORE's local_music.
import { existsSync } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { viewPath } from "./comfy-pure";
import { comfyBase, comfyInstalled, comfyModelsDir, comfyPost, comfyReady } from "./comfy";
import { stopAllOn } from "./stop-all";
import { checkMusic, clampSeconds, MUSIC_FILES, MUSIC_MISSING, musicBase, musicGenOn, musicGraph, musicMeta, musicQueueError, musicSeed, parseAudioHistory, type MusicMeta } from "./music-gen-pure";
import { parseQueued } from "./comfy-pure";

/** Are the four ACE-Step files in ComfyUI's models folder (setup.ps1 -Model acestep-music)? */
export async function musicInstalled(): Promise<boolean> {
  if (!(await comfyInstalled())) return false;
  const m = await comfyModelsDir();
  return MUSIC_FILES.every(([dir, f]) => existsSync(path.join(m, dir, f)));
}
/** Should pickMusic try ComfyUI at all (switch on, models installed)? A cheap disk check; ComfyUI itself starts later. */
export const musicGenAvailable = async () => musicGenOn(process.env.ORBIT_MUSIC_GEN) && (await musicInstalled());

/** One bed as FLAC bytes plus the record to keep. The GPU is freed right after (the 8 GB is shared with pictures, voice and captions). */
/** One bed; waits its turn for the shared GPU (gpu-lock.ts). The lease covers the whole timeout, so no heartbeat is needed. */
export async function generateMusic(prompt: string, seconds: number, timeoutMs = 8 * 60_000): Promise<{ bytes: Uint8Array; meta: MusicMeta }> {
  const { acquireGpu, freeComfyVram } = await import("./gpu-lock");
  const lease = await acquireGpu("music", { maxWaitMs: 20 * 60_000, ttlMs: timeoutMs + 2 * 60_000 });
  try {
    await freeComfyVram((await import("./trellis-pure")).trellisUrl(process.env.ORBIT_TRELLIS_URL));
    return await generateMusicNow(prompt, seconds, timeoutMs);
  } finally { lease.release(); }
}

async function generateMusicNow(prompt: string, seconds: number, timeoutMs: number): Promise<{ bytes: Uint8Array; meta: MusicMeta }> {
  const u = comfyBase();
  if (!u) throw new Error("ORBIT_COMFY_URL must point at this PC (http://127.0.0.1:<port>).");
  if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on)");
  if (!(await musicInstalled())) throw new Error(MUSIC_MISSING);
  if (!(await comfyReady())) throw new Error("Local music needs ComfyUI, which couldn't start (log: tools/comfyui/service.log). Run the setup again if it isn't installed.");
  const secs = clampSeconds(seconds), seed = musicSeed(prompt, secs);
  const q = parseQueued(await (await comfyPost(u, "/prompt", { prompt: musicGraph({ prompt, seconds: secs, seed }), client_id: "orbit" })).json().catch(() => null));
  if ("error" in q) throw new Error(musicQueueError(q.error));
  const until = Date.now() + timeoutMs; // the first bed loads about 10 GB of weights from disk
  try {
    for (;;) {
      if (stopAllOn()) { await comfyPost(u, "/interrupt", {}).catch(() => {}); throw new Error("Stopped: Stop-all is on"); }
      if (Date.now() > until) { await comfyPost(u, "/interrupt", {}).catch(() => {}); throw new Error(`Music generation took longer than ${Math.round(timeoutMs / 60_000)} min and was stopped.`); }
      await new Promise((r) => setTimeout(r, 1500));
      const h = parseAudioHistory(await fetch(`${u}/history/${encodeURIComponent(q.id)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json(), () => null), q.id);
      if (h.state === "error") throw new Error(h.error);
      if (h.state === "done") {
        const r = await fetch(`${u}${viewPath(h.audio)}`, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error(`ComfyUI made the music but sending it failed (${r.status}).`);
        return { bytes: new Uint8Array(await r.arrayBuffer()), meta: musicMeta({ prompt, seconds: secs, seed }) };
      }
    }
  } finally { // a batch of beds keeps ACE-Step loaded between beds (gpu-lock keepWarm); anything else frees the GPU now
    await (await import("./gpu-lock")).unloadUnlessNext("music", () => comfyPost(u, "/free", { unload_models: true, free_memory: true }));
  }
}

/** A bed saved into a folder (the studio music folder), with its .json record next to it. Same prompt+length = same file (cached). */
export async function makeBed(o: { prompt: string; seconds: number; dir: string }): Promise<string> {
  const secs = clampSeconds(o.seconds), seed = musicSeed(o.prompt, secs);
  const out = path.join(o.dir, `ai-${musicBase(o.prompt, seed)}.flac`);
  if (await stat(out).then((s) => s.size > 0, () => false)) return out;
  const { bytes, meta } = await generateMusic(o.prompt, secs);
  await mkdir(o.dir, { recursive: true });
  await writeFile(`${out}.part`, bytes);
  await writeFile(out.replace(/\.flac$/, ".json"), JSON.stringify(meta, null, 2));
  await rename(`${out}.part`, out);
  return out;
}

/** CORE tool local_music: a bed saved in VAULT (.flac + .json record). Errors come back as "Error: ..." text (core.ts's convention). */
export async function runMusicTool(i: Record<string, unknown>): Promise<string> {
  try {
    const c = checkMusic(i);
    if ("error" in c) return `Error: ${c.error}`;
    const { saveUpload } = await import("./vault");
    const { bytes, meta } = await generateMusic(c.prompt, c.seconds);
    const base = musicBase(c.prompt, meta.seed, c.name);
    const saved = await saveUpload(new File([bytes as BlobPart], `${base}.flac`, { type: "audio/flac" }));
    await saveUpload(new File([JSON.stringify(meta, null, 2)], saved.replace(/\.flac$/i, "") + ".json", { type: "application/json" })).catch(() => {});
    return `Saved the music as "${saved}" in VAULT (${meta.seconds} s instrumental, made on his PC with ACE-Step in ComfyUI; free, nothing uploaded; the prompt and seed are in the .json next to it). Tell him where it is.`;
  } catch (e) { return `Error: ${e instanceof Error ? e.message : String(e)}`; }
}
