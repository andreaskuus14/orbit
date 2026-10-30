import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SMART_MODEL, askClaude, type PromptImage } from "../claude";
import { stopAllOn } from "../stop-all";
import { PAUSED_MSG } from "../stop-all-pure";
import { usageHardHold } from "../usage-meter";
import { shortsUrl } from "../yt-viral-pure";
import { audioArgs, parseDuration, probeArgs, YTDLP_FILE_MARK, ytdlpError, type Word } from "./pure";
import { ffmpegPath, readState, runFfmpeg, runYtdlp, saveState, studioRoot, transcribe, ytdlpPath } from "./factory";
import {
  PLAYBOOK_MIN, STUDY_MAX_SEC, STUDY_SYSTEM, STUDY_V, addStudy, buildPlaybook, framePlan, parseLesson, playbookEdit, playbookText, sceneArgs, sceneTimes, studyFacts, studyFrameArgs,
  studyProblem, studyPrompt, studyTranscript, studyYtdlpArgs, type EditTune, type Lesson, type Playbook, type StudyState,
} from "./study-pure";
import { postmortemView } from "./postmortem";
import { rulesText } from "./postmortem-pure";

// Viral study: one Short → downloaded to a temp dir, transcribed, scene-cut counted, 6-8 frames → Claude (SMART_MODEL, with images)
// says why it works → a text lesson in <studio>/viral-lessons.json. The video and frames are deleted right after. Pure: study-pure.ts.

const file = () => path.join(studioRoot(), "viral-lessons.json");
const g = globalThis as unknown as { __orbitStudy?: { busy?: string; write: Promise<unknown>; pb?: Playbook } };
const S = (g.__orbitStudy ??= { write: Promise.resolve() });

const load = async (): Promise<Lesson[]> => (await readState<StudyState>(studioRoot(), "viral-lessons", studyProblem))?.studies ?? [];

/** The playbook merged from every saved study (cached until the next study). */
export async function playbook(): Promise<Playbook> { return (S.pb ??= buildPlaybook(await load())); }
/** Edit tuning for renderClip ({} until PLAYBOOK_MIN studies). */
export const editTune = (): Promise<EditTune> => playbook().then(playbookEdit, () => ({}));
/** Prompt line for clip picking ("" without studies). */
export const playbookNotes = (): Promise<string> => Promise.all([playbook().then(playbookText, () => ""), postmortemView().then(rulesText, () => "")])
  .then((xs) => xs.filter(Boolean).join(" ")); // + rules he accepted from retention post-mortems (postmortem.ts)
export const studyBusy = () => S.busy ?? null;

export async function studyView() {
  const [studies, pm] = await Promise.all([load(), postmortemView().catch(() => null)]);
  return { playbook: S.pb = buildPlaybook(studies), recent: studies.slice(0, 5), busy: S.busy ?? null, min: PLAYBOOK_MIN, rules: pm?.rules.map((r) => r.text) ?? [] };
}

/** Studies one Short end to end; throws a user-facing message on failure. One at a time. */
export async function studyShort(meta: { id: string; title: string; channel: string; views?: number; source: "niche" | "own" }): Promise<Lesson> {
  const url = shortsUrl(meta.id);
  if (!url) throw new Error("Not a YouTube video id");
  const held = stopAllOn() ? PAUSED_MSG : usageHardHold();
  if (held) throw new Error(held);
  if (S.busy) throw new Error("Already studying another Short — wait for it to finish");
  S.busy = meta.id;
  const ac = new AbortController(), signal = ac.signal;
  const watch = setInterval(() => { if (stopAllOn()) ac.abort(new Error(PAUSED_MSG)); }, 1000);
  const deadline = setTimeout(() => ac.abort(new Error("Study timed out after 10 minutes")), 10 * 60_000);
  let dir = "";
  try {
    dir = await mkdtemp(path.join(tmpdir(), "orbit-study-")); // inside try: a failure must still clear busy + timers
    const [yt, ff] = await Promise.all([ytdlpPath(), ffmpegPath()]);
    if (!yt) throw new Error("yt-dlp not found: run `winget install yt-dlp.yt-dlp`, then restart ORBIT");
    if (!ff) throw new Error("ffmpeg not found: run npm install (ffmpeg-static) or set ORBIT_FFMPEG");
    let printed = "";
    const out = await runYtdlp(yt, studyYtdlpArgs(url, path.dirname(ff)), signal, (line, stdout) => {
      if (stdout && line.startsWith(YTDLP_FILE_MARK)) printed = line.slice(YTDLP_FILE_MARK.length).trim();
    }, dir);
    // Only a file directly inside our temp dir (never a path yt-dlp printed elsewhere).
    const name = (await readdir(dir)).find((n) => /^short\.(mp4|webm|mkv|mov)$/.test(n));
    if (!printed || !name) throw new Error(/does not pass filter|larger than max-filesize/i.test(out) ? `Not a Short (over ${STUDY_MAX_SEC / 60} min, 200 MB or live)` : ytdlpError(out));
    const video = path.join(dir, name);
    if ((await stat(video)).size > 220 * 1024 ** 2) throw new Error("The video is too big for a Short");

    const probe = await runFfmpeg(ff, probeArgs(video), { signal, timeoutMs: 60_000, okCodes: [1] });
    const duration = parseDuration(probe);
    if (!duration) throw new Error("Couldn't read the video length");
    if (duration > STUDY_MAX_SEC + 1) throw new Error(`Longer than ${STUDY_MAX_SEC / 60} min: not a Short`);

    let words: Word[] = [];
    if (/Stream #\d+:\d+.*: Audio:/.test(probe) && await import("@huggingface/transformers").then(() => true, () => false)) {
      try {
        await runFfmpeg(ff, audioArgs(video, "audio.f32"), { cwd: dir, signal, timeoutMs: 5 * 60_000 });
        words = await transcribe(path.join(dir, "audio.f32"), [{ start: 0, end: duration }], "auto", signal, () => {}, async () => {});
      } catch (e) { if (signal.aborted) throw e; } // no transcript: frames + facts still say a lot
    }
    const scenes = sceneTimes(await runFfmpeg(ff, sceneArgs(video), { signal, timeoutMs: 3 * 60_000 }).catch((e) => { if (signal.aborted) throw e; return ""; }));
    const facts = studyFacts(duration, scenes), times = framePlan(duration, scenes);
    const images: PromptImage[] = [], shot: number[] = [];
    for (const [i, t] of times.entries()) {
      const f = `f${i}.jpg`;
      try {
        await runFfmpeg(ff, studyFrameArgs(video, t, f), { cwd: dir, signal, timeoutMs: 60_000 });
        images.push({ type: "image/jpeg", data: await readFile(path.join(dir, f)) }); shot.push(t);
      } catch (e) { if (signal.aborted) throw e; }
    }
    const r = await askClaude(studyPrompt(meta, facts, studyTranscript(words), shot), STUDY_SYSTEM, { lane: "background", model: SMART_MODEL, images, signal, purpose: "clips.study" });
    const lesson = parseLesson(r.text, meta, facts);
    if (!lesson) throw new Error("Claude's analysis was unusable — try again");
    await save(lesson);
    return lesson;
  } catch (e) {
    throw signal.aborted && signal.reason instanceof Error ? signal.reason : e;
  } finally {
    clearInterval(watch); clearTimeout(deadline); S.busy = undefined;
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}); // video + frames: only the text lesson is kept
  }
}

/** Serialised read-modify-write; a locked/unreadable file is never reset to empty. */
function save(l: Lesson): Promise<void> {
  const p = S.write.then(async () => {
    const read = await readState<StudyState>(studioRoot(), "viral-lessons", studyProblem);
    if (!read && await stat(file()).then(() => true, () => false)) throw new Error("viral-lessons.json is unreadable (locked?), try again later");
    await saveState("viral-lessons", file(), { v: STUDY_V, studies: addStudy(read?.studies ?? [], l) } satisfies StudyState);
    S.pb = undefined;
  });
  S.write = p.catch(() => {});
  return p;
}
