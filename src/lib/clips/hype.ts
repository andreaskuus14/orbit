import { createReadStream } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { inboxDir, runYtdlp, ytdlpPath } from "./factory";
import { parseTwitchChat, parseYouTubeChat, type ChatMsg } from "./hype-pure";
import { parseSourceMeta, type SourceMeta } from "./moments-pure";

// Chat replay for the hype timeline (parsing: hype-pure.ts). Never throws: no chat just means an audio-only hype curve.
// Sources, in order: a chat file next to the video in the inbox, then (YouTube VODs) yt-dlp's live_chat replay. Read-only, anonymous.
//  - <video>.live_chat.json: yt-dlp `--write-subs --sub-langs live_chat` output (JSON lines).
//  - <video>.chat.json: Twitch chat in the "comments" shape (TwitchDownloader's chat export, or an old rechat/v5 dump).
// Twitch: current yt-dlp (2026.10) has no VOD chat extractor (the v5 "rechat" API is gone), and ORBIT doesn't borrow Twitch's web client id.
//   A yt-dlp build that still lists a "rechat" subtitle is tried briefly (90 s); otherwise export the chat.
// The YouTube chat fetch also writes yt-dlp's info JSON (same extraction, no extra request): its "Most replayed" heatmap + title/tags
// for older downloads whose <file>.source.json has no `meta` yet.
// Kick: no anonymous VOD chat endpoint ORBIT uses; audio only.

export type ChatLoad = { msgs: ChatMsg[]; from?: string; hint?: string; meta?: SourceMeta };
const MAX_JSON = 100 * 1024 ** 2; // a single-document Twitch export is parsed whole (JSON.parse needs several× its size in memory)
const MAX_LINES_FILE = 1024 ** 3, MAX_LINE = 64 * 1024, MAX_MSGS = 2_000_000; // keep a giant replay from exhausting server memory

const TWITCH_HINT = "Twitch chat replay: yt-dlp didn't offer it. For chat-aware hype, export the VOD chat with TwitchDownloader as “<video name>.chat.json” into the inbox";
const KICK_HINT = "Kick chat replay isn't available without logging in: hype uses audio only";

async function jsonLines(file: string): Promise<ChatMsg[]> {
  const out: ChatMsg[] = [];
  if ((await stat(file)).size > MAX_LINES_FILE) return out;
  // shortcut: readline still buffers one line whole; a >64 KB line is skipped after reading, fine for yt-dlp's per-action lines.
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > MAX_LINE || !line.includes("videoOffsetTimeMsec")) continue;
    out.push(...parseYouTubeChat(line));
    if (out.length >= MAX_MSGS) { rl.close(); break; }
  }
  return out.sort((a, b) => a.t - b.t);
}

const exists = (f: string) => stat(f).then((s) => s.isFile(), () => false);

/** Chat for an inbox video; job dir = where a downloaded replay is written (and removed after parsing). */
export async function loadChat(source: string, dir: string, signal: AbortSignal): Promise<ChatLoad> {
  try {
    const base = path.join(inboxDir(), source.replace(/\.[^.]+$/, ""));
    if (await exists(`${base}.live_chat.json`)) return { msgs: await jsonLines(`${base}.live_chat.json`), from: "chat file (YouTube)" };
    if (await exists(`${base}.chat.json`)) {
      if ((await stat(`${base}.chat.json`)).size > MAX_JSON) return { msgs: [], hint: "The chat file is over 100 MB: skipped" };
      return { msgs: parseTwitchChat(JSON.parse(await readFile(`${base}.chat.json`, "utf8"))), from: "chat file (Twitch)" };
    }
    const { url } = await readSource(source);
    if (!url) return { msgs: [] };
    const host = (() => { try { return new URL(url).hostname.replace(/^www\.|^m\./, ""); } catch { return ""; } })();
    if (/(^|\.)kick\.com$/.test(host)) return { msgs: [], hint: KICK_HINT };
    const twitch = /(^|\.)twitch\.tv$/.test(host);
    if (!twitch && !/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return { msgs: [] };
    const yt = await ytdlpPath();
    if (!yt) return { msgs: [], hint: twitch ? TWITCH_HINT : "yt-dlp missing: no YouTube chat replay" };
    // Verified against yt-dlp: a finished live stream exposes subtitles "live_chat" (protocol youtube_live_chat_replay, ext json).
    const lang = twitch ? "rechat" : "live_chat";
    const stop = AbortSignal.any([signal, AbortSignal.timeout(twitch ? 90_000 : 12 * 60_000)]); // a long, busy stream's replay is many requests
    await runYtdlp(yt, ["--ignore-config", "--encoding", "utf-8", "--no-playlist", "--skip-download", "--write-subs", "--sub-langs", lang,
      ...(twitch ? [] : ["--write-info-json"]), "-o", "chat.%(ext)s", "--", url], stop, () => {}, dir).catch((e) => { if (signal.aborted) throw e; });
    const info = path.join(dir, "chat.info.json");
    const meta = (await exists(info)) && (await stat(info)).size < 64 * 1024 ** 2 ? parseSourceMeta(await readFile(info, "utf8").catch(() => "")) ?? undefined : undefined;
    await rm(info, { force: true });
    const file = path.join(dir, `chat.${lang}.json`);
    await rm(`${file}.part`, { force: true }); // cut off by the time limit
    if (!(await exists(file))) return { msgs: [], meta, hint: twitch ? TWITCH_HINT : "This YouTube video has no chat replay: hype uses audio only" };
    try {
      if (twitch) return (await stat(file)).size > MAX_JSON ? { msgs: [], hint: "The Twitch chat replay is over 100 MB: skipped" }
        : { msgs: parseTwitchChat(JSON.parse(await readFile(file, "utf8"))), from: "Twitch chat replay (yt-dlp)" };
      return { msgs: await jsonLines(file), from: "YouTube chat replay", meta };
    } finally { await rm(file, { force: true }); }
  } catch (e) {
    if (signal.aborted) throw e;
    return { msgs: [], hint: `Chat replay unavailable (${e instanceof Error ? e.message.slice(0, 120) : e}): hype uses audio only` };
  }
}

/** <file>.source.json (written by the download): its link and the yt-dlp meta (heatmap, title, tags), when present. Never throws. */
export async function readSource(source: string): Promise<{ url: string; meta: SourceMeta | null }> {
  const j = await readFile(path.join(inboxDir(), `${source}.source.json`), "utf8").then((t) => JSON.parse(t) as { url?: unknown; meta?: unknown }, () => null);
  return { url: typeof j?.url === "string" ? j.url : "", meta: j?.meta ? parseSourceMeta(j.meta) : null };
}
