// Local AI tools, server side: talks to tools/local-ai/server.py on this PC and saves results in VAULT (local only, no cloud copy).
import { readStream, saveUpload } from "./vault";
import { NOT_RUNNING, assetName, cleanTranscript, cloneBlocked, docMarkdown, docMdName, isCaptionLang, isDocName, isMediaName, parseHealth, parseIfcSummary, parseTranscript,
  serviceError, serviceUrl, toSrt, toVtt, ttsRequest, type Health, type IfcSummary } from "./local-ai-pure";

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

const save = (bytes: Uint8Array | string, name: string, type: string) => saveUpload(new File([bytes as BlobPart], name, { type }));
const callJson = async (path: string, body: FormData, ms: number): Promise<unknown> => JSON.parse(new TextDecoder().decode(await call(path, body, ms)));
/** A VAULT file as a named File for the service (VAULT files are at most 40 MB; traversal/missing names are refused in readStream). */
const vaultFile = async (name: string) => new File([await new Response((await readStream(name, null)).stream).blob()], name);
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

/** Captions for a VAULT clip (saved next to it) or an uploaded one: .srt, .vtt and a clean transcript .txt, all in VAULT on this PC. */
export async function makeCaptions(src: { file: unknown } | { media: Blob; name: string }, language: unknown): Promise<{ saved: string[]; language: string; device: string }> {
  const lang = language === undefined || language === "" ? "auto" : language;
  if (!isCaptionLang(lang)) throw new Error("Language must be auto, en or et.");
  const name = "file" in src ? String(src.file ?? "") : src.name;
  if (!isMediaName(name)) throw new Error("Pick a video or audio file (mp4, mov, mkv, webm, m4a, mp3, wav, ogg or flac).");
  const media = "file" in src ? await vaultFile(name) : new File([src.media], name);
  const t = parseTranscript(await callJson("/transcribe", form({ file: media, language: lang }), 30 * MINUTE));
  if (!t) throw new Error("Local AI sent back something that isn't a transcript.");
  if (!t.segments.some((s) => s.text)) throw new Error("No speech found in that file.");
  const saved = [
    await save(toSrt(t.segments), assetName(name, "srt", "captions"), "text/plain"),
    await save(toVtt(t.segments), assetName(name, "vtt", "captions"), "text/vtt"),
    await save(cleanTranscript(t.segments), assetName(`${name.replace(/\.[^.]+$/, "")}-transcript`, "txt", "transcript"), "text/plain"),
  ];
  return { saved, language: t.language, device: t.device };
}

/** IFC model → summary, issues and spaces (nothing saved; the panel offers the CSV). CPU only. */
export async function ifcSummary(file: Blob, name: string): Promise<IfcSummary> {
  if (!/\.ifc$/i.test(name)) throw new Error("Pick an .ifc file.");
  const s = parseIfcSummary(await callJson("/ifc-summary", form({ file: new File([file], name) }), 10 * MINUTE));
  if (!s) throw new Error("Local AI sent back something that isn't an IFC summary.");
  return s;
}

/** VAULT PDF/DOCX/PPTX/scan → Markdown saved beside it (CORE's vault_search/vault_read can then use it). Private: stays on this PC. */
export async function readDocument(file: unknown): Promise<string> {
  const name = String(file ?? "");
  if (!isDocName(name)) throw new Error("ORBIT reads PDF, Word (.docx), PowerPoint (.pptx) and scanned pages (.png/.jpg).");
  const j = (await callJson("/doc-to-md", form({ file: await vaultFile(name) }), 20 * MINUTE)) as { markdown?: unknown; pages?: unknown };
  if (typeof j?.markdown !== "string" || !j.markdown.trim()) throw new Error("No text found in that document.");
  return save(docMarkdown(name, j.markdown, Number(j.pages) || 0), docMdName(name), "text/markdown");
}

/** CORE tools local_3d / local_tts / local_transcribe. Errors come back as "Error: ..." text (core.ts's convention). */
export async function runLocalTool(tool: string, i: Record<string, unknown>): Promise<string> {
  try {
    if (tool === "local_3d") {
      const { stream } = await readStream(i.image, null); // a VAULT file; traversal/missing names are refused there
      const picture = await new Response(stream).blob();
      const saved = await makeModel(picture, i.name ?? i.image);
      return `Saved the 3D model as "${saved}" in VAULT. Preview it in GAME DEV → Assets → Picture to 3D; in Roblox Studio use Import 3D and pick that file (ORBIT can't import into Studio by itself).`;
    }
    if (tool === "local_transcribe") {
      const r = await makeCaptions({ file: i.file }, i.language);
      return `Saved captions and a transcript in VAULT: ${r.saved.map((n) => `"${n}"`).join(", ")} (language ${r.language || "?"}, ran on ${r.device}). Read the transcript with vault_read; upload the .srt to YouTube yourself in Studio → Subtitles.`;
    }
    const saved = await makeVoice(i.text, i.voice, i.name);
    return `Saved the voiceover as "${saved}" in VAULT (play it there or in STUDIO → Produce → Voiceover).`;
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
