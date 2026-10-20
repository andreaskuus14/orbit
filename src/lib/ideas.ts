import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { askClaude } from "./claude";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHold } from "./usage-meter";
import { readState, runYtdlp, saveState, studioRoot, ytdlpPath } from "./clips/factory";
import { ytdlpError } from "./clips/pure";
import { RADAR_SYSTEM, board, parseIdeas, radarPrompt, videoIdFrom, vttText, type Idea } from "./ideas-pure";

// IDEA RADAR store: <studio>/ideas.json (local, like the other STUDIO state). Logic: ideas-pure.ts.
type Store = { ideas: Idea[] };
const FILE = () => path.join(studioRoot(), "ideas.json");
const problem = (x: unknown) => (x && typeof x === "object" && Array.isArray((x as Store).ideas) ? "" : "no ideas list");
const S = globalThis as unknown as { __orbitRadar?: string | null };

export async function listIdeas() {
  const st = (await readState<Store>(studioRoot(), "ideas", problem)) ?? { ideas: [] };
  return { ...board(st.ideas), busy: S.__orbitRadar ?? null };
}

/** Captions only (no video download): seconds, not minutes. English first, then any language YouTube offers. */
async function captions(id: string, signal: AbortSignal): Promise<{ title: string; text: string }> {
  const yt = await ytdlpPath();
  if (!yt) throw new Error("yt-dlp not found: run `winget install yt-dlp.yt-dlp`, then restart ORBIT");
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-radar-"));
  try {
    let title = "";
    const out = await runYtdlp(yt, ["--skip-download", "--no-simulate", "--no-playlist", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,en", "--sub-format", "vtt",
      "-o", "cap.%(ext)s", "--print", "TITLE:%(title)s", `https://www.youtube.com/watch?v=${id}`], signal, (line, stdout) => {
      if (stdout && line.startsWith("TITLE:")) title = line.slice(6).trim();
    }, dir);
    const file = (await readdir(dir)).find((n) => n.endsWith(".vtt"));
    if (!file) throw new Error(title ? "This video has no English captions to read" : ytdlpError(out));
    const text = vttText(await readFile(path.join(dir, file), "utf8"));
    if (text.length < 200) throw new Error("The captions are too short to find ideas in");
    return { title: title || id, text };
  } finally { void rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export async function radar(url: string, signal: AbortSignal): Promise<Idea[]> {
  const id = videoIdFrom(url);
  if (!id) throw new Error("Paste a YouTube video link");
  const held = stopAllOn() ? PAUSED_MSG : usageHold();
  if (held) throw new Error(held);
  if (S.__orbitRadar) throw new Error("Already reading another video: wait for it to finish");
  S.__orbitRadar = id;
  try {
    const { title, text } = await captions(id, signal);
    const r = await askClaude(radarPrompt(title, text), RADAR_SYSTEM, { lane: "foreground", purpose: "ideas.radar", timeoutMs: 180_000, signal });
    const found = parseIdeas(r.text, id, title, new Date().toISOString(), randomUUID);
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
