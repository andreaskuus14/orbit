// AI Story engine: approved Higgsfield items → downloaded scenes + narration → one 1080x1920 Short with captions.
// Everything outside (ffmpeg, TTS, Whisper, the effects layer, saving) is injected, so a dry run can drive it from a script.
import { writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildAss, type Word } from "./pure.ts";
import { assembleArgs, dialogueAss, dramaArgs, hfErrorKind, lineTimes, payable, rankTitles, submittable, thumbAss, thumbShots, sceneSecs, scriptWords, unpaid, DRAMA, type DramaShot, type HfErrorKind, type StoryJob } from "./story-pure.ts";
import type { HiggsfieldAdapter } from "./higgsfield.ts";
import { parseStats, reviewArgs, sampleTimes, verdict, type SceneReview } from "./frame-review-pure.ts";

export class StoryError extends Error {
  kind: HfErrorKind;
  constructor(kind: HfErrorKind, message: string) { super(message); this.kind = kind; }
}

export type RenderDeps = {
  hf: HiggsfieldAdapter;
  ffmpeg(args: string[], cwd: string, signal: AbortSignal): Promise<string>;
  duration(file: string, signal: AbortSignal): Promise<number>;
  tts?(text: string, voice: string, file: string): Promise<void>; // local Kokoro narration
  words?(file: string, signal: AbortSignal): Promise<Word[]>; // Whisper word timings of one narration file (or a drama clip's audio)
  hasAudio?(file: string, signal: AbortSignal): Promise<boolean>; // does a downloaded clip carry an audio stream
  effects?(input: { hook: string; words: Word[]; duration: number }, signal: AbortSignal): Promise<{ layer?: string; warning?: string; apply?: (video: string) => Promise<string | null> }>;
  music?: string | null;
  save(step: string): Promise<void>;
  pollMs?: number;
};

const exists = (f: string) => stat(f).then(() => true, () => false);

/** The paid part (also CORE's Higgsfield drafts): submit once, poll, download into dir. Resumable like makeStory. */
export async function generate(job: StoryJob, dir: string, d: Pick<RenderDeps, "hf" | "save" | "pollMs">, signal: AbortSignal): Promise<void> {
  // Only what the owner approved: the items payable at the click (a drama's shots become payable once its character images
  // are made, but that is a second quote and a second click, so they are never sent in this run).
  const approved = new Set(payable(job.items).map((i) => i.key));
  const deadline = Date.now() + 40 * 60_000;
  for (;;) {
    await poll(job, d, signal, deadline); // first: a resume may find jobs still pending
    // 1. Submit approved, unpaid items in rounds (a voice reference goes before the shots that reuse it). Job ids are saved before anything else can fail.
    const waiting = unpaid(job.items).filter((i) => approved.has(i.key));
    if (!waiting.length) break;
    const todo = submittable(waiting, job.items);
    if (!todo.length) throw new StoryError("other", `${waiting.map((i) => i.key).join(", ")} wait for references that weren't made`);
    await d.save(`Submitting ${todo.length} generations to Higgsfield`);
    const r = await d.hf.submit(todo, signal);
    for (const it of todo) if (r.jobs[it.index]) Object.assign(it, { jobId: r.jobs[it.index], status: "pending", error: undefined });
    await d.save("Submitted");
    const missing = todo.filter((i) => !i.jobId);
    // A rejected voice reference must not block the shot forever: the next approval sends it without one.
    for (const it of missing) if (it.after) it.after = undefined;
    if (r.error || missing.length) throw new StoryError(r.error?.kind ?? "other", `${r.error?.message ?? "Higgsfield returned no job id"} (${missing.length} of ${todo.length} not submitted; the ones that were are kept). Check your Higgsfield history before approving again.`);
  }
  // 3. Download into the clip workspace.
  for (const it of job.items) {
    if (it.file && (await exists(it.file))) continue;
    await d.save(`Downloading ${it.key}`);
    it.file = await d.hf.download(it, path.join(dir, it.key), signal);
  }
}

/** 2. Polls (never submits). Failed generations lose their job id, so approving again re-quotes and re-pays only those. */
async function poll(job: StoryJob, d: Pick<RenderDeps, "hf" | "save" | "pollMs">, signal: AbortSignal, deadline: number) {
  let hiccups = 0;
  for (;;) {
    const pending = job.items.filter((i) => i.jobId && i.status === "pending");
    if (!pending.length) break;
    if (Date.now() > deadline) throw new StoryError("other", "Higgsfield took over 40 minutes; approve again later to keep waiting (no new credits for jobs already submitted)");
    await d.save(`Waiting for Higgsfield: ${job.items.filter((i) => i.status === "done").length} of ${job.items.length} done`);
    for (let k = 0; k < pending.length; k += 12) {
      const r = await d.hf.wait(pending.slice(k, k + 12), signal);
      if ("error" in r) {
        if (r.error.kind === "not_connected" || ++hiccups > 3) throw new StoryError(r.error.kind, r.error.message);
        continue;
      }
      for (const s of r.ok) {
        const it = job.items.find((i) => i.index === s.index && i.jobId);
        if (it && s.status !== "pending") Object.assign(it, { status: s.status, url: s.url, error: s.error });
      }
    }
    signal.throwIfAborted();
    if (job.items.some((i) => i.jobId && i.status === "pending")) await new Promise((r) => setTimeout(r, d.pollMs ?? 10_000));
  }
  const failed = job.items.filter((i) => i.status === "failed");
  if (failed.length) {
    const why = failed.map((i) => `${i.key}: ${i.error ?? "failed"}`).join("; ");
    failed.forEach((i) => Object.assign(i, { jobId: undefined, status: undefined, url: undefined }));
    throw new StoryError(hfErrorKind(why), `Higgsfield couldn't make ${why}`);
  }
}

/** Looks at 3–5 key frames of every scene before the render (frame-review-pure.ts). A blank scene stops here, before any
 *  assembly time is spent; weak frames become warnings on the clip. A frame ffmpeg can't measure is skipped, never judged. */
export async function reviewFrames(job: StoryJob, dir: string, d: Pick<RenderDeps, "ffmpeg" | "duration" | "save">, signal: AbortSignal): Promise<void> {
  await d.save("Checking key frames");
  const scenes: SceneReview[] = [];
  for (const [i, s] of job.story.scenes.entries()) {
    const file = job.items.find((it) => it.kind !== "audio" && it.scene === i)?.file;
    if (!file) continue;
    const video = /\.(mp4|mov|webm)$/i.test(file), sec = video ? await d.duration(file, signal).catch(() => s.sec) : 0;
    const frames = [];
    for (const t of sampleTimes(sec || s.sec, video)) frames.push(parseStats(await d.ffmpeg(reviewArgs(file, t), dir, signal).catch((e) => { if (signal.aborted) throw e; return ""; })));
    scenes.push({ scene: i, frames });
  }
  const v = verdict(scenes);
  job.warnings.push(...v.warn);
  if (v.stop.length) throw new StoryError("other", `${v.stop.join("; ")}: regenerate ${v.stop.length > 1 ? "those scenes" : "that scene"} before rendering (nothing was assembled)`);
}

export type Made = { video: string; thumb?: string; duration: number; thumbs?: string[]; titles?: { text: string; score: number }[] };
/** Runs the paid part (submit once, poll, download) then assembles; null when a later approval is still needed (drama: the
 *  character images are made, the shots are not priced yet). Resumable: submitted jobs and downloaded files are reused. */
export async function makeStory(job: StoryJob, dir: string, d: RenderDeps, signal: AbortSignal): Promise<Made | null> {
  const scenes = job.story.scenes;
  await generate(job, dir, d, signal);
  if (unpaid(job.items).length) return null;
  await reviewFrames(job, dir, d, signal);
  if (job.opts.format === "drama") return makeDrama(job, dir, d, signal);
  // 4. Narration: Higgsfield audio, local Kokoro, or none (then the captions still tell the story).
  const voice = job.opts.voice, narr: (string | undefined)[] = [];
  for (const [i, s] of scenes.entries()) {
    const hf = job.items.find((it) => it.kind === "audio" && it.scene === i);
    if (hf) { narr.push(hf.file); continue; }
    if (!voice.startsWith("kokoro:") || !d.tts) { narr.push(undefined); continue; }
    const f = path.join(dir, `narration-${i}.wav`);
    if (!(await exists(f))) { await d.save(`Voicing scene ${i + 1}`); await d.tts(s.narration, voice.slice(7), f); }
    narr.push(f);
  }
  await d.save("Assembling the Short");
  const spoken = await Promise.all(narr.map((f) => (f ? d.duration(f, signal) : Promise.resolve(null))));
  const secs = sceneSecs(scenes.map((s) => s.sec), spoken);
  const starts = secs.map((_, i) => secs.slice(0, i).reduce((a, b) => a + b, 0));
  const total = Math.round(secs.reduce((a, b) => a + b, 0) * 10) / 10;
  if (total > 61) job.warnings.push(`The narration made the Short ${total} s long (asked for ${job.opts.length} s)`);
  // 5. Captions: Whisper timings of the real narration, else the script spread over each line.
  let words: Word[] = [];
  for (const [i, f] of narr.entries()) {
    const w = f && d.words ? await d.words(f, signal).catch((e) => { if (signal.aborted) throw e; return []; }) : [];
    words.push(...(w.length ? w.map((x) => ({ ...x, start: x.start + starts[i], end: x.end + starts[i] })) : scriptWords([scenes[i].narration], [starts[i]], [Math.max(0.5, (spoken[i] ?? secs[i] - 0.4))])));
  }
  words = words.filter((w) => w.start < total);
  await writeFile(path.join(dir, "captions.ass"), buildAss({ hook: job.story.hook, words, duration: total }), "utf8");
  const fx = d.effects ? await d.effects({ hook: job.story.hook, words, duration: total }, signal) : {};
  if (fx.warning) job.warnings.push(fx.warning);
  // 6. Render. Paths are relative to dir (ffmpeg runs there); music may be anywhere.
  const rel = (f: string) => path.relative(dir, f).replace(/\\/g, "/");
  const parts = scenes.map((s, i) => {
    const vis = job.items.find((it) => it.kind !== "audio" && it.scene === i)?.file;
    if (!vis) throw new StoryError("other", `scene ${i + 1} has no picture`);
    return { file: rel(vis), video: /\.(mp4|mov|webm)$/i.test(vis), sec: secs[i], camera: s.camera, narration: narr[i] && rel(narr[i]!) };
  });
  const video = "clip-1.mp4";
  await d.ffmpeg(assembleArgs({ scenes: parts, music: d.music ?? undefined, ass: fx.layer ? undefined : "captions.ass", out: video }), dir, signal);
  if (fx.layer && fx.apply) { const w = await fx.apply(video); if (w) job.warnings.push(w); }
  return { video, thumb: await thumbnail(job, dir, d, video, total, signal), duration: total };
}

/** Talking drama: the shots as they came (hard cuts, their own dialogue audio), a ducked music bed and spoken-line subtitles. */
async function makeDrama(job: StoryJob, dir: string, d: RenderDeps, signal: AbortSignal): Promise<Made> {
  await d.save("Assembling the Short");
  const rel = (f: string) => path.relative(dir, f).replace(/\\/g, "/");
  const shots: DramaShot[] = [], lines: { text: string; start: number; end: number }[] = [];
  let at = 0;
  for (const [i, s] of job.story.scenes.entries()) {
    const file = job.items.find((it) => it.kind === "video" && it.scene === i)?.file;
    if (!file) throw new StoryError("other", `shot ${i + 1} has no clip`);
    const video = /\.(mp4|mov|webm)$/i.test(file);
    const dur = video ? await d.duration(file, signal) : 0;
    const sec = dur > 1 ? Math.round(dur * 10) / 10 : s.sec; // the clip as the model made it
    const audio = video && !!(await d.hasAudio?.(file, signal));
    if (video && !audio) job.warnings.push(`Shot ${i + 1} came back without sound: its line is only in the subtitles`);
    // shortcut: Whisper only times the line; the subtitle shows the script's words, so a model that ad-libs won't match them
    const heard = audio && d.words ? await d.words(file, signal).catch((e) => { if (signal.aborted) throw e; return []; }) : [];
    lines.push({ text: s.narration, ...lineTimes(at, sec, heard) });
    shots.push({ file: rel(file), sec, audio });
    at += sec;
  }
  await writeFile(path.join(dir, "captions.ass"), dialogueAss(lines, job.story.hook), "utf8");
  const video = "clip-1.mp4";
  await d.ffmpeg(dramaArgs({ shots, music: d.music ?? undefined, ass: "captions.ass", out: video }), dir, signal);
  // Packaging: thumbnails from the most emotional shots (with the hook text), titles ranked by the packaging model.
  await writeFile(path.join(dir, "thumb.ass"), thumbAss(job.story.hook), "utf8");
  const thumbs: string[] = [];
  for (const [k, i] of thumbShots(job.story.scenes).entries()) {
    const t = `thumb-${k + 1}.jpg`, seek = /\.(mp4|mov|webm)$/i.test(shots[i].file) ? ["-ss", String(Math.round(shots[i].sec * 6) / 10)] : [];
    await d.ffmpeg(["-y", "-hide_banner", ...seek, "-i", shots[i].file, "-frames:v", "1",
      "-vf", `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,ass=thumb.ass`, "-q:v", "3", t], dir, signal)
      .then(() => thumbs.push(t), (e) => { if (signal.aborted) throw e; job.warnings.push(`No thumbnail from shot ${i + 1}: ${e instanceof Error ? e.message.slice(-200) : e}`); });
  }
  return { video, thumb: thumbs[0], thumbs, duration: Math.round((at + DRAMA.hold) * 10) / 10, titles: rankTitles(job.story.titles?.length ? job.story.titles : [job.story.title]) };
}

async function thumbnail(job: StoryJob, dir: string, d: RenderDeps, video: string, total: number, signal: AbortSignal): Promise<string | undefined> {
  let thumb: string | undefined = "clip-1.jpg";
  await d.ffmpeg(["-y", "-hide_banner", "-ss", String(Math.min(1.5, total / 2)), "-i", video, "-frames:v", "1", "-q:v", "3", thumb], dir, signal).catch((e) => {
    if (signal.aborted) throw e;
    job.warnings.push(`No thumbnail: ${e instanceof Error ? e.message : e}`);
    thumb = undefined;
  });
  return thumb;
}
