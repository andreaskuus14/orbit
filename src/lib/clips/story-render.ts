// AI Story engine: approved Higgsfield items → downloaded scenes + narration → one 1080x1920 Short with captions.
// Everything outside (ffmpeg, TTS, Whisper, the effects layer, saving) is injected, so a dry run can drive it from a script.
import { writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { buildAss, type Word } from "./pure.ts";
import { assembleArgs, hfErrorKind, sceneSecs, scriptWords, unpaid, type HfErrorKind, type StoryJob } from "./story-pure.ts";
import type { HiggsfieldAdapter } from "./higgsfield.ts";

export class StoryError extends Error {
  kind: HfErrorKind;
  constructor(kind: HfErrorKind, message: string) { super(message); this.kind = kind; }
}

export type RenderDeps = {
  hf: HiggsfieldAdapter;
  ffmpeg(args: string[], cwd: string, signal: AbortSignal): Promise<string>;
  duration(file: string, signal: AbortSignal): Promise<number>;
  tts?(text: string, voice: string, file: string): Promise<void>; // local Kokoro narration
  words?(file: string, signal: AbortSignal): Promise<Word[]>; // Whisper word timings of one narration file
  effects?(input: { hook: string; words: Word[]; duration: number }, signal: AbortSignal): Promise<{ layer?: string; warning?: string; apply?: (video: string) => Promise<string | null> }>;
  music?: string | null;
  save(step: string): Promise<void>;
  pollMs?: number;
};

const exists = (f: string) => stat(f).then(() => true, () => false);

/** Runs the paid part (submit once, poll, download) then assembles. Resumable: submitted jobs and downloaded files are reused. */
export async function makeStory(job: StoryJob, dir: string, d: RenderDeps, signal: AbortSignal): Promise<{ video: string; thumb?: string; duration: number }> {
  const scenes = job.story.scenes;
  // 1. Submit what isn't paid for yet (the owner approved exactly these). Job ids are saved before anything else can fail.
  const todo = unpaid(job.items);
  if (todo.length) {
    await d.save(`Submitting ${todo.length} generations to Higgsfield`);
    const r = await d.hf.submit(todo, signal);
    for (const it of todo) if (r.jobs[it.index]) Object.assign(it, { jobId: r.jobs[it.index], status: "pending", error: undefined });
    await d.save("Submitted");
    const missing = todo.filter((i) => !i.jobId);
    if (r.error || missing.length) throw new StoryError(r.error?.kind ?? "other", `${r.error?.message ?? "Higgsfield returned no job id"} (${missing.length} of ${todo.length} not submitted; the ones that were are kept). Check your Higgsfield history before approving again.`);
  }
  // 2. Poll (never submits). Failed generations lose their job id, so approving again re-quotes and re-pays only those.
  const deadline = Date.now() + 40 * 60_000;
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
  // 3. Download into the clip workspace.
  for (const it of job.items) {
    if (it.file && (await exists(it.file))) continue;
    await d.save(`Downloading ${it.key}`);
    it.file = await d.hf.download(it, path.join(dir, it.key), signal);
  }
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
  let thumb: string | undefined = "clip-1.jpg";
  await d.ffmpeg(["-y", "-hide_banner", "-ss", String(Math.min(1.5, total / 2)), "-i", video, "-frames:v", "1", "-q:v", "3", thumb], dir, signal).catch((e) => {
    if (signal.aborted) throw e;
    job.warnings.push(`No thumbnail: ${e instanceof Error ? e.message : e}`);
    thumb = undefined;
  });
  return { video, thumb, duration: total };
}
