// STUDIO bilingual dub, server side (pure parts and the why: dub-pure.ts). One dub at a time, in the background; each dub is a new
// version of the approved Short, so it waits in the normal review queue and nothing is ever posted by this file.
// His voice: <studio>/dub/my-voice.wav + voice.json (consent statement + time), set in Settings → More → Your voice for dubbing.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { askClaude, MODEL } from "../claude";
import { encodeWav, serviceUrl, NOT_RUNNING } from "../local-ai-pure";
import { localHealth } from "../local-ai";
import { stopAllOn } from "../stop-all";
import { createPool } from "../asr-pool";
import { buildAss, nextVersionId, type Analysis } from "./pure";
import { rootClipId } from "./format";
import { DOWNLOAD_STALL_MS, sherpaFiles } from "./parakeet-pure";
import { clipsDir, ffmpegPath, getJob, isJobBusy, loadAnalysis, readState, renderDubBase, runFfmpeg, saveJob, saveState, studioRoot, withJobLock } from "./factory";
import type { Clip } from "./types";
import {
  CONSENT_TEXT, DUB_SYSTEM, burnArgs, dubBlocked, dubCaptionWords, dubPrompt, dubSegments, lineArgs, missingLines, mixArgs, otherLang, parseDub, sourceLang,
  speedFor, tempoFor, wavSeconds, type ClipDub, type DubLang, type DubSeg, type DubStage, type DubText, type VoiceState,
} from "./dub-pure";

// ---- his voice (consent + sample) ----
const dubDir = () => path.join(studioRoot(), "dub");
const sampleFile = () => path.join(dubDir(), "my-voice.wav");
export type VoiceRecord = { consent: string; consentAt: string; sampleSha: string; sampleBytes: number; enVoice?: string; etVoice?: string };
const isRecord = (x: unknown): x is VoiceRecord => !!x && typeof x === "object" && (x as VoiceRecord).consent === CONSENT_TEXT
  && typeof (x as VoiceRecord).consentAt === "string" && typeof (x as VoiceRecord).sampleSha === "string";

export async function readVoice(): Promise<VoiceRecord | null> {
  const r = await readState<unknown>(dubDir(), "voice", (x) => (isRecord(x) ? "" : "not a voice record")).catch(() => null);
  return isRecord(r) ? r : null;
}
/** Consent is only real with the sample it was given for: a sample changed outside ORBIT doesn't count. */
export async function voiceState(): Promise<VoiceState & { consentAt?: string; seconds?: number }> {
  const r = await readVoice();
  const data = await readFile(sampleFile()).catch(() => null);
  const ok = !!r && !!data && createHash("sha256").update(data).digest("hex") === r.sampleSha;
  return { consent: ok, sample: ok, ...(ok && { consentAt: r!.consentAt, seconds: Math.round(wavSeconds(data!)) }) };
}
/** Saves his sample with his consent statement. The sample must be a 10-60 s WAV. */
export async function saveVoice(sample: Uint8Array, consent: unknown): Promise<string> {
  if (consent !== CONSENT_TEXT) return "Tick the box: the sample must be your own voice.";
  const sec = wavSeconds(sample);
  if (!sec) return "The sample must be a WAV file (record it here, or upload a .wav).";
  if (sec < 10 || sec > 60) return "Record 10-60 seconds of you talking normally, in a quiet room.";
  await mkdir(dubDir(), { recursive: true });
  await writeFile(sampleFile() + ".tmp", sample);
  await rename(sampleFile() + ".tmp", sampleFile());
  const rec: VoiceRecord = { consent: CONSENT_TEXT, consentAt: new Date().toISOString(), sampleSha: createHash("sha256").update(sample).digest("hex"), sampleBytes: sample.length };
  await saveState("voice", path.join(dubDir(), "voice.json"), rec);
  return "";
}
/** Removes his sample and his consent. Dubs already made stay (he decides on each in the review queue). */
export async function deleteVoice() {
  await Promise.all([rm(sampleFile(), { force: true }), rm(path.join(dubDir(), "voice.json"), { force: true })]);
}

// ---- voice / background separation (Spleeter 2-stems, sherpa-onnx, own child process) ----
const SPLEETER = {
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/sherpa-onnx-spleeter-2stems-fp16.tar.bz2",
  sha256: "d54561979bd2e08a51e7dbd99ac36bb47564e089eefd403636dbca93e811bba2", bytes: 35_271_738, dir: "sherpa-onnx-spleeter-2stems-fp16",
  files: ["vocals.fp16.onnx", "accompaniment.fp16.onnx"],
};
const G = globalThis as unknown as { __orbitSepDl?: Promise<string> | null; __orbitSepPool?: ReturnType<typeof createPool>; __orbitDubChain?: Promise<void>;
  __orbitDub?: { key: string; ctrl: AbortController } };
const modelsDir = () => path.join(studioRoot(), "models");

async function spleeterModel(): Promise<string> {
  const dir = path.join(modelsDir(), SPLEETER.dir);
  const have = await Promise.all(SPLEETER.files.map((f) => stat(path.join(dir, f)).then((s) => s.size > 0, () => false)));
  if (have.every(Boolean)) return dir;
  const p = G.__orbitSepDl ??= (async () => {
    await mkdir(modelsDir(), { recursive: true });
    const part = path.join(modelsDir(), `${SPLEETER.dir}.tar.bz2.part`), tmp = path.join(modelsDir(), `${SPLEETER.dir}.unpack`);
    try {
      const res = await fetch(SPLEETER.url, { redirect: "follow", signal: AbortSignal.timeout(Math.max(DOWNLOAD_STALL_MS * 10, 10 * 60_000)) });
      if (!res.ok) throw new Error(`Separation model download failed: HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (createHash("sha256").update(buf).digest("hex") !== SPLEETER.sha256) throw new Error("Separation model download was damaged (hash mismatch); it will retry next time");
      await writeFile(part, buf);
      await rm(tmp, { recursive: true, force: true }); await mkdir(tmp, { recursive: true });
      const { execFile } = await import("node:child_process");
      await new Promise<void>((ok, bad) => execFile("tar", ["-xjf", part, "-C", tmp], { timeout: 5 * 60_000 }, (e) => (e ? bad(e) : ok())));
      await rm(dir, { recursive: true, force: true });
      await rename(path.join(tmp, SPLEETER.dir), dir);
      return dir;
    } finally {
      await Promise.all([rm(tmp, { recursive: true, force: true }), rm(part, { force: true })]).catch(() => {});
    }
  })();
  p.catch(() => { if (G.__orbitSepDl === p) G.__orbitSepDl = null; });
  return p;
}
const sepPool = () => (G.__orbitSepPool ??= createPool(path.join(process.cwd(), "src/lib/clips/separate-worker.mjs"), 1, 30_000, "Separation"));

/** Mono 44.1 kHz audio → his voice and the background, in a child process. */
async function separate(audio: Float32Array, rate: number): Promise<{ voice: Float32Array; background: Float32Array; rate: number }> {
  if (!sherpaFiles(process.cwd(), process.platform, process.arch, path.join).every((f) => existsSync(f))) throw new Error("sherpa-onnx-node is missing: run npm install");
  const dir = await spleeterModel();
  const config = { model: { spleeter: { vocals: path.join(dir, SPLEETER.files[0]), accompaniment: path.join(dir, SPLEETER.files[1]) }, numThreads: Math.max(1, Math.min(4, availableParallelism() - 1)) } };
  const p = sepPool();
  await p.run({ config }, 2 * 60_000);
  const r = (await p.run({ config, audio, rate }, 15 * 60_000)) as { voice?: Float32Array; background?: Float32Array; rate?: number } | null;
  if (!r?.background || !r.voice || !r.rate) throw new Error("Separation returned nothing");
  return { voice: r.voice, background: r.background, rate: r.rate };
}

// ---- one line in his voice (tools/local-ai /dub-line) ----
async function sayLine(sample: Blob, lang: DubLang, text: string, speed: number, voice: string, signal: AbortSignal): Promise<Uint8Array> {
  const u = serviceUrl(process.env.ORBIT_LOCAL_AI_URL);
  if (!u) throw new Error("ORBIT_LOCAL_AI_URL must point at this PC (http://127.0.0.1:<port>).");
  for (let tries = 0; ; tries++) {
    signal.throwIfAborted();
    const f = new FormData();
    f.append("sample", sample, "my-voice.wav"); f.append("consent", "own-voice"); f.append("lang", lang); f.append("text", text);
    f.append("speed", String(speed)); f.append("voice", voice);
    const res = await fetch(`${u}/dub-line`, { method: "POST", body: f, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]) })
      .catch((e: unknown) => { if (signal.aborted) throw e; return null; });
    if (!res) { // not running: start it (localHealth autostarts) and try again a few times
      if (tries >= 6) throw new Error(NOT_RUNNING);
      await localHealth(); await new Promise((r) => setTimeout(r, 5000)); continue;
    }
    if (res.status === 409 && tries < 120) { await new Promise((r) => setTimeout(r, 3000)); continue; } // another local AI job: wait for it
    if (!res.ok) { const j = (await res.json().catch(() => null)) as { error?: string } | null; throw new Error(j?.error ?? `Local AI failed (error ${res.status})`); }
    return new Uint8Array(await res.arrayBuffer());
  }
}

// ---- translation ----
async function translate(base: Clip, segs: DubSeg[], from: DubLang, to: DubLang, signal: AbortSignal): Promise<DubText> {
  const ask = () => askClaude(dubPrompt({ title: base.title, hook: base.hook, segs, to }), DUB_SYSTEM(from, to), { lane: "background", model: MODEL, signal, timeoutMs: 3 * 60_000, purpose: "clips.dub" });
  let d = parseDub((await ask()).text, segs, to);
  if (missingLines(d).length) { // once more; keep what the first answer already had
    const again = parseDub((await ask()).text, segs, to);
    d = { title: d.title || again.title, hook: d.hook || again.hook, lines: d.lines.map((l, i) => l ?? again.lines[i]) };
  }
  const miss = missingLines(d);
  if (miss.length) throw new Error(`The translation missed ${miss.length} of ${segs.length} lines; try again`);
  return d;
}

// ---- the run ----
async function mark(jobId: string, clipId: string, f: (c: Clip, d: ClipDub) => void) {
  await withJobLock(async () => {
    const job = await getJob(jobId), c = job?.clips.find((x) => x.id === clipId);
    if (!job || !c?.dub) return;
    f(c, c.dub);
    c.dub.at = job.updatedAt = new Date().toISOString();
    await saveJob(job);
  });
}

const pcmArgs = (input: string, out: string, rate: number) => ["-hide_banner", "-nostdin", "-y", "-i", input, "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", out];

async function runDub(jobId: string, clipId: string, signal: AbortSignal) {
  let stage: DubStage = "translating";
  const step = (s: DubStage, extra: Partial<ClipDub> = {}) => { stage = s; return mark(jobId, clipId, (_c, d) => Object.assign(d, { stage: s }, extra)); };
  const work = path.join(clipsDir(), jobId, `dub-${clipId}`);
  try {
    if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on)");
    const [job, a, ff, voice] = await Promise.all([getJob(jobId), loadAnalysis(jobId), ffmpegPath(), voiceState()]);
    const clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip?.dub) return;
    if (!a) throw new Error("The saved analysis is missing: make clips from this video again");
    if (!ff) throw new Error("ffmpeg not found");
    if (!voice.consent) throw new Error("Your voice sample or consent is missing (Settings → More → Your voice for dubbing)");
    const base = job.clips.find((c) => c.id === clip.dub!.of);
    if (!base) throw new Error("The original Short is gone");
    const { from, lang: to } = clip.dub;
    await step("translating");
    await mkdir(work, { recursive: true });
    let segs: DubSeg[] = [], text: DubText | null = null, total = 0;
    // Pass 1: the video exactly like the original's cuts, the hook and thumbnails in the new language, no captions, the old audio.
    await renderDubBase(job, clip, a as Analysis, signal, async (p) => {
      total = p.total;
      segs = dubSegments(p.words, p.total);
      if (!segs.length) throw new Error("No speech found in this Short to dub");
      text = await translate(base, segs, from, to, signal);
      clip.title = text.title || base.title; clip.hook = text.hook || base.hook;
      await mark(jobId, clipId, (c, d) => { c.title = clip.title; c.hook = clip.hook; d.stage = stage = "rendering"; d.lines = segs.length; });
    });
    const video = path.join(studioRoot(), clip.video ?? "");
    if (!clip.video || !text) throw new Error("The video wasn't made");
    const lines = (text as DubText).lines as string[];

    await step("separating");
    const pcm = path.join(work, "orig.f32");
    await runFfmpeg(ff, pcmArgs(video, pcm, 44100), { signal, timeoutMs: 5 * 60_000 });
    const raw = await readFile(pcm);
    const audio = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
    const bg = path.join(work, "background.wav");
    if (a.hasAudio && audio.length) { const s = await separate(audio.slice(), 44100); await writeFile(bg, encodeWav(s.background, s.rate)); }
    else await writeFile(bg, encodeWav(new Float32Array(Math.ceil(total * 16000)), 16000));

    await step("voicing", { line: 0 });
    const sample = new Blob([await readFile(sampleFile()) as BlobPart], { type: "audio/wav" });
    const rec = await readVoice();
    const voiceId = to === "en" ? rec?.enVoice ?? "am_michael" : rec?.etVoice ?? "0";
    const placed: { file: string; at: number; text: string; dur: number }[] = [];
    const q = { lines: segs.length, faster: 0, trimmed: 0, maxTempo: 1 };
    for (const [i, s] of segs.entries()) {
      await mark(jobId, clipId, (_c, d) => { d.line = i + 1; });
      const slot = Math.max(0.3, s.slotEnd - s.start);
      let wav = await sayLine(sample, to, lines[i], 1, voiceId, signal), sec = wavSeconds(wav);
      const sp = speedFor(sec, slot);
      if (sp > 1) { wav = await sayLine(sample, to, lines[i], sp, voiceId, signal); sec = wavSeconds(wav); q.faster++; }
      const fit = tempoFor(sec, slot);
      if (fit.trim) q.trimmed++;
      q.maxTempo = Math.max(q.maxTempo, fit.tempo);
      const said = path.join(work, `said-${i}.wav`), out = path.join(work, `line-${i}.wav`);
      await writeFile(said, wav);
      await runFfmpeg(ff, lineArgs(said, out, { ...fit, slot }), { signal, timeoutMs: 60_000 });
      placed.push({ file: out, at: s.start, text: lines[i], dur: Math.min(slot, sec / fit.tempo) });
    }

    await step("mixing");
    const mixed = path.join(work, "dub.wav");
    await runFfmpeg(ff, mixArgs({ background: bg, lines: placed, total, out: mixed }), { signal, timeoutMs: 5 * 60_000 });
    const { readBrandKit } = await import("./brand-kit"), kit = await readBrandKit();
    const style = base.edit?.captions === "classic" ? "classic" : "karaoke";
    await writeFile(path.join(work, "captions.ass"), buildAss({ hook: "", words: dubCaptionWords(placed), duration: total, style, kit }), "utf8");
    const tmp = path.join(work, "final.mp4");
    await runFfmpeg(ff, burnArgs({ video, audio: mixed, ass: "captions.ass", out: "final.mp4", encoder: "x264" }), { cwd: work, signal, timeoutMs: 20 * 60_000 });
    await rename(tmp, video);
    await mark(jobId, clipId, (c, d) => {
      Object.assign(c, { video: clip.video, thumb: clip.thumb, thumbOptions: clip.thumbOptions, brand: clip.brand, error: clip.error });
      d.stage = "done"; d.quality = q; delete d.line;
      if (c.status === "rendering") c.status = "ready";
    });
  } catch (e) {
    if (signal.aborted) return;
    const m = e instanceof Error ? e.message : String(e);
    console.error("[orbit] dub failed:", m);
    await mark(jobId, clipId, (c, d) => { c.status = "failed"; c.error = m; d.stage = "failed"; d.failedAt = stage; d.error = m; }).catch(() => {});
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Starts a dub of an approved Short into the other language. Returns the new version or why not (plain words). */
export async function startDub(jobId: string, clipId: string): Promise<Clip | string> {
  const voice = await voiceState();
  const made = await withJobLock(async (): Promise<Clip | string> => {
    const job = await getJob(jobId), base = job?.clips.find((c) => c.id === clipId);
    if (!job || !base) return "Short not found";
    if (isJobBusy(job)) return "Wait for the job to finish";
    const no = dubBlocked(job, base, voice);
    if (no) return no;
    const a = await loadAnalysis(jobId);
    if (!a) return "The saved analysis is missing: make clips from this video again";
    const from = sourceLang(a.words.filter((w) => w.end > base.start && w.start < base.end));
    const to = otherLang(from);
    if (job.clips.some((c) => c.dub?.of === base.id && c.dub.lang === to && c.status !== "failed" && c.status !== "rejected"))
      return `There is already a ${to === "et" ? "Estonian" : "English"} version of this Short.`;
    const id = nextVersionId(job.clips, base.id);
    if (!id) return "This clip has too many versions";
    const now = new Date().toISOString();
    const clip: Clip = { id, start: base.start, end: base.end, title: base.title, hook: base.hook, reason: base.reason, score: base.score, status: "rendering",
      variantOf: rootClipId(base.id), edit: base.edit, ...(base.original && { original: base.original }),
      dub: { lang: to, from, of: base.id, stage: "queued", startedAt: now, at: now } };
    const root = rootClipId(base.id);
    job.clips.splice(job.clips.findLastIndex((c) => rootClipId(c.id) === root) + 1, 0, clip);
    job.updatedAt = now;
    await saveJob(job);
    return clip;
  });
  if (typeof made === "string") return made;
  const key = `${jobId}/${made.id}`;
  const p = (G.__orbitDubChain ?? Promise.resolve()).then(async () => {
    const ctrl = new AbortController();
    G.__orbitDub = { key, ctrl };
    await runDub(jobId, made.id, ctrl.signal);
  }).finally(() => { if (G.__orbitDub?.key === key) G.__orbitDub = undefined; });
  G.__orbitDubChain = p.catch((e) => console.error("[orbit] dub error:", e?.message ?? e));
  return made;
}

/** Stops the running dub of this clip (when he rejects or deletes it). */
export function cancelDub(jobId: string, clipId: string) {
  if (G.__orbitDub?.key === `${jobId}/${clipId}`) G.__orbitDub.ctrl.abort(new Error("Cancelled"));
}
