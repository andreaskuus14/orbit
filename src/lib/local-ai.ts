// Local AI tools, server side: talks to tools/local-ai/server.py on this PC and saves results in VAULT (local only, no cloud copy).
import { readStream, saveUpload } from "./vault";
import { NOT_RUNNING, assetName, cloneBlocked, parseHealth, serviceError, serviceUrl, ttsRequest, type Health } from "./local-ai-pure";

const base = () => serviceUrl(process.env.ORBIT_LOCAL_AI_URL);
const MINUTE = 60_000;

export async function localHealth(): Promise<Health> {
  const u = base();
  if (!u) return parseHealth(null);
  const j = await fetch(`${u}/health`, { cache: "no-store", signal: AbortSignal.timeout(3000) }).then((r) => r.json(), () => null);
  return parseHealth(j);
}

async function call(path: string, body: FormData | object, ms: number): Promise<Uint8Array> {
  const u = base();
  if (!u) throw new Error("ORBIT_LOCAL_AI_URL must point at this PC (http://127.0.0.1:<port>).");
  const json = !(body instanceof FormData);
  const res = await fetch(`${u}${path}`, { method: "POST", body: json ? JSON.stringify(body) : body, headers: json ? { "content-type": "application/json" } : undefined, signal: AbortSignal.timeout(ms) })
    .catch((e: unknown) => { throw new Error(e instanceof Error && e.name === "TimeoutError" ? `Local AI took longer than ${ms / MINUTE} minutes and was stopped waiting.` : NOT_RUNNING); });
  if (!res.ok) throw new Error(serviceError(res.status, await res.json().catch(() => null)));
  return new Uint8Array(await res.arrayBuffer());
}

const save = (bytes: Uint8Array, name: string, type: string) => saveUpload(new File([bytes as BlobPart], name, { type }));
const form = (o: Record<string, Blob | string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

/** Picture → GLB in VAULT. Returns the saved file name. */
export const makeModel = async (image: Blob, name: unknown) =>
  save(await call("/image-to-3d", form({ image }), 15 * MINUTE), assetName(name, "glb", "model-3d"), "model/gltf-binary");
export const cutOut = async (image: Blob, name: unknown) =>
  save(await call("/remove-bg", form({ image }), 3 * MINUTE), assetName(name, "png", "cutout"), "image/png");

export async function makeVoice(text: unknown, voice: unknown, name: unknown): Promise<string> {
  const r = ttsRequest(text, voice);
  if ("error" in r) throw new Error(r.error);
  return save(await call("/tts", r, 5 * MINUTE), assetName(name, "wav", "voiceover"), "audio/wav");
}

/** Own voice only: the same rule is checked here, in the UI and again in server.py. */
export async function cloneVoice(o: { sample: Blob; sampleText: string; text: string; consent: boolean; name: unknown }): Promise<string> {
  const no = cloneBlocked({ consent: o.consent, sampleBytes: o.sample.size, sampleText: o.sampleText, text: o.text });
  if (no) throw new Error(no);
  const bytes = await call("/clone-tts", form({ sample: o.sample, sample_text: o.sampleText.trim(), text: o.text.trim(), consent: "own-voice" }), 10 * MINUTE);
  return save(bytes, assetName(o.name, "wav", "my-voice"), "audio/wav");
}

/** CORE tools local_3d / local_tts. Errors come back as "Error: ..." text (core.ts's convention). */
export async function runLocalTool(tool: string, i: Record<string, unknown>): Promise<string> {
  try {
    if (tool === "local_3d") {
      const { stream } = await readStream(i.image, null); // a VAULT file; traversal/missing names are refused there
      const picture = await new Response(stream).blob();
      const saved = await makeModel(picture, i.name ?? i.image);
      return `Saved the 3D model as "${saved}" in VAULT. Preview it in GAME DEV → Assets → Picture to 3D; in Roblox Studio use Import 3D and pick that file (ORBIT can't import into Studio by itself).`;
    }
    const saved = await makeVoice(i.text, i.voice, i.name);
    return `Saved the voiceover as "${saved}" in VAULT (play it there or in STUDIO → Produce → Voiceover).`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
