import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { askClaude } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHardHold } from "./usage-meter";
import { ffmpegPath, readState, runFfmpeg, runYtdlp, saveState, studioRoot, transcribe, ytdlpPath } from "./clips/factory";
import { SAMPLE_RATE, audioArgs, ytdlpError } from "./clips/pure";
import { RADAR_SYSTEM, board, filterFresh, parseIdeas, radarPrompt, sourceDate, videoIdFrom, vttText, type Idea } from "./ideas-pure";

// IDEA RADAR store: <studio>/ideas.json (local, like the other STUDIO state). Logic: ideas-pure.ts.
type Store = { ideas: Idea[] };
const FILE = () => path.join(studioRoot(), "ideas.json");
const problem = (x: unknown) => (x && typeof x === "object" && Array.isArray((x as Store).ideas) ? "" : "no ideas list");
const S = globalThis as unknown as { __orbitRadar?: string | null; __orbitRadarPhase?: string };

export async function listIdeas() {
  const st = (await readState<Store>(studioRoot(), "ideas", problem)) ?? { ideas: [] };
  return { ...board(st.ideas, Date.now()), busy: S.__orbitRadar ?? null, phase: S.__orbitRadar ? S.__orbitRadarPhase ?? "captions" : null };
}

const LISTEN_SEC = 30 * 60; // the audio fallback hears at most the first 30 minutes (Whisper on the PC, a few minutes)

/** Captions only (no video download): seconds. Returns null when YouTube refuses (429) or has none: then we listen instead. */
async function captions(yt: string, id: string, dir: string, signal: AbortSignal): Promise<{ title: string; text: string | null; out: string }> {
  let title = "";
  // Only the original English track: asking for every "en.*" variant makes many requests and trips YouTube's 429 sooner.
  const out = await runYtdlp(yt, ["--skip-download", "--no-simulate", "--no-playlist", "--write-subs", "--write-auto-subs", "--sub-langs", "en-orig,en", "--sub-format", "vtt",
    "-o", "cap.%(ext)s", "--print", "TITLE:%(title)s", `https://www.youtube.com/watch?v=${id}`], signal, (line, stdout) => {
    if (stdout && line.startsWith("TITLE:")) title = line.slice(6).trim();
  }, dir).catch((e) => { if (signal.aborted) throw e; return String(e instanceof Error ? e.message : e); });
  const file = (await readdir(dir)).find((n) => n.endsWith(".vtt"));
  const text = file ? vttText(await readFile(path.join(dir, file), "utf8")) : "";
  return { title, text: text.length >= 200 ? text : null, out };
}

/** No usable captions: download only the audio of the first 30 minutes and transcribe it with Whisper (same as STUDIO). */
async function listen(yt: string, id: string, dir: string, signal: AbortSignal): Promise<string> {
  const ff = await ffmpegPath();
  if (!ff) throw new Error("ffmpeg not found: run npm install (ffmpeg-static) or set ORBIT_FFMPEG");
  let printed = "";
  const out = await runYtdlp(yt, ["-f", "bestaudio/best", "--no-playlist", "--download-sections", `*0-${LISTEN_SEC}`, "--ffmpeg-location", path.dirname(ff),
    "-o", "audio.%(ext)s", "--print", "after_move:FILE:%(filepath)s", `https://www.youtube.com/watch?v=${id}`], signal, (line, stdout) => {
    if (stdout && line.startsWith("FILE:")) printed = line.slice(5).trim();
  }, dir);
  const name = (await readdir(dir)).find((n) => n.startsWith("audio.") && !n.endsWith(".part"));
  if (!printed || !name) throw new Error(ytdlpError(out));
  await runFfmpeg(ff, audioArgs(name, "audio.f32"), { cwd: dir, signal, timeoutMs: 10 * 60_000 }); // already cut to LISTEN_SEC by --download-sections
  const sec = (await stat(path.join(dir, "audio.f32"))).size / 4 / SAMPLE_RATE;
  const words = await transcribe(path.join(dir, "audio.f32"), [{ start: 0, end: Math.min(sec, LISTEN_SEC) }], "auto", signal, () => {}, async () => {});
  const text = words.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
  if (text.length < 200) throw new Error("Couldn't hear enough speech in this video to find ideas");
  return text.slice(0, 60_000);
}

/** The video's words: its captions, or (when YouTube refuses them with 429 or has none) its audio through Whisper. */
async function transcriptOf(id: string, signal: AbortSignal, onPhase: (p: string) => void): Promise<{ title: string; text: string; sourceAt: string }> {
  const yt = await ytdlpPath();
  if (!yt) throw new Error("yt-dlp not found: run `winget install yt-dlp.yt-dlp`, then restart ORBIT");
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-radar-"));
  try {
    // Get the source's real date before spending time on captions/audio, and before any transcript can reach CORE.
    let title = id, sourceAt: string | undefined;
    await runYtdlp(yt, ["--simulate", "--no-playlist", "--print", "TITLE:%(title)s", "--print", "SOURCE:%(upload_date)s",
      `https://www.youtube.com/watch?v=${id}`], signal, (line, stdout) => {
      if (!stdout) return;
      if (line.startsWith("TITLE:")) title = line.slice(6).trim() || id;
      if (line.startsWith("SOURCE:")) sourceAt = sourceDate(line.slice(7).trim());
    }, dir);
    if (!sourceAt) throw new Error("Couldn't verify the source date; skipped before CORE. Choose a dated video.");
    if (!filterFresh([{ sourceAt }], Date.now()).length) throw new Error("Source is outside the last 30 days; skipped before CORE. Choose a newer video.");
    onPhase("captions");
    const c = await captions(yt, id, dir, signal);
    if (c.text) return { title: c.title || title, text: c.text, sourceAt };
    if (/Private video|Video unavailable|members-only|Sign in to confirm your age/i.test(c.out)) throw new Error(ytdlpError(c.out));
    onPhase("listening");
    return { title: c.title || title, text: await listen(yt, id, dir, signal), sourceAt };
  } finally { void rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export async function radar(url: string, signal: AbortSignal): Promise<Idea[]> {
  const id = videoIdFrom(url);
  if (!id) throw new Error("Paste a YouTube video link");
  const held = stopAllOn() ? PAUSED_MSG : usageHardHold();
  if (held) throw new Error(held);
  if (S.__orbitRadar) throw new Error("Already reading another video: wait for it to finish");
  S.__orbitRadar = id; S.__orbitRadarPhase = "metadata";
  try {
    const { title, text, sourceAt } = await transcriptOf(id, signal, (p) => { S.__orbitRadarPhase = p; });
    // Recheck after a long audio transcription too: a candidate may cross the cutoff while we listen.
    if (!filterFresh([{ sourceAt }], Date.now()).length) throw new Error("Source is over 30 days old; skipped before CORE. Choose a newer video.");
    const r = await askClaude(radarPrompt(title, text), RADAR_SYSTEM, { lane: "foreground", purpose: "ideas.radar", timeoutMs: 180_000, signal });
    const found = parseIdeas(r.text, id, title, new Date().toISOString(), randomUUID, sourceAt);
    if (!found.length) throw new Error("CORE found no usable ideas in this video");
    const st = (await readState<Store>(studioRoot(), "ideas", problem)) ?? { ideas: [] };
    await saveState("ideas", FILE(), { ideas: [...found, ...st.ideas.filter((i) => i.video !== id)].slice(0, 500) }); // re-reading a video replaces its ideas
    return found;
  } finally { S.__orbitRadar = null; }
}

export async function dismissIdea(ideaId: string) {
  const st = (await readState<Store>(studioRoot(), "ideas", problem)) ?? { ideas: [] };
  const hit = st.ideas.find((i) => i.id === ideaId);
  if (!hit) return false;
  hit.dismissed = true;
  await saveState("ideas", FILE(), st);
  return true;
}

/** Read-modify-write for background writers (comment-ideas.ts); a locked/unreadable ideas.json is never reset to empty. */
export async function updateIdeas(fn: (ideas: Idea[]) => Idea[]) {
  const st = await readState<Store>(studioRoot(), "ideas", problem);
  if (!st && await access(FILE()).then(() => true, () => false)) throw new Error("ideas.json is unreadable (locked?), try later");
  await saveState("ideas", FILE(), { ideas: fn(st?.ideas ?? []).slice(0, 500) });
}
