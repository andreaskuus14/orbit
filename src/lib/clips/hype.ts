import { createReadStream } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { inboxDir, runYtdlp, ytdlpPath } from "./factory";
import { parseTwitchChat, parseYouTubeChat, type ChatMsg } from "./hype-pure";

// Chat replay for the hype timeline (parsing: hype-pure.ts). Never throws: no chat just means an audio-only hype curve.
// Sources, in order: a chat file next to the video in the inbox, then (YouTube VODs) yt-dlp's live_chat replay. Read-only, anonymous.
//  - <video>.live_chat.json: yt-dlp `--write-subs --sub-langs live_chat` output (JSON lines).
//  - <video>.chat.json: Twitch chat in the "comments" shape (TwitchDownloader's chat export, or an old rechat/v5 dump).
// Twitch: current yt-dlp has no VOD chat extractor (the v5 "rechat" API is gone), and ORBIT doesn't borrow Twitch's web client id: export the chat.
// Kick: no anonymous VOD chat endpoint ORBIT uses; audio only.

export type ChatLoad = { msgs: ChatMsg[]; from?: string; hint?: string };
const MAX_JSON = 100 * 1024 ** 2; // a single-document Twitch export is parsed whole (JSON.parse needs several× its size in memory)
const MAX_LINES_FILE = 1024 ** 3, MAX_LINE = 64 * 1024, MAX_MSGS = 2_000_000; // keep a giant replay from exhausting server memory

const TWITCH_HINT = "Twitch chat replay: yt-dlp can't fetch it. For chat-aware hype, export the VOD chat with TwitchDownloader as “<video name>.chat.json” into the inbox";
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
    const url = await readFile(path.join(inboxDir(), `${source}.source.json`), "utf8").then((t) => String((JSON.parse(t) as { url?: unknown }).url ?? ""), () => "");
    if (!url) return { msgs: [] };
    const host = (() => { try { return new URL(url).hostname.replace(/^www\.|^m\./, ""); } catch { return ""; } })();
    if (/(^|\.)twitch\.tv$/.test(host)) return { msgs: [], hint: TWITCH_HINT };
    if (/(^|\.)kick\.com$/.test(host)) return { msgs: [], hint: KICK_HINT };
    if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return { msgs: [] };
    const yt = await ytdlpPath();
    if (!yt) return { msgs: [], hint: "yt-dlp missing: no YouTube chat replay" };
    // Verified against yt-dlp: a finished live stream exposes subtitles "live_chat" (protocol youtube_live_chat_replay, ext json).
    const stop = AbortSignal.any([signal, AbortSignal.timeout(12 * 60_000)]); // a long, busy stream's replay is many requests
    await runYtdlp(yt, ["--ignore-config", "--encoding", "utf-8", "--no-playlist", "--skip-download", "--write-subs", "--sub-langs", "live_chat",
      "-o", "chat.%(ext)s", "--", url], stop, () => {}, dir).catch((e) => { if (signal.aborted) throw e; });
    const file = path.join(dir, "chat.live_chat.json");
    await rm(`${file}.part`, { force: true }); // cut off by the time limit
    if (!(await exists(file))) return { msgs: [], hint: "This YouTube video has no chat replay: hype uses audio only" };
    try { return { msgs: await jsonLines(file), from: "YouTube chat replay" }; } finally { await rm(file, { force: true }); }
  } catch (e) {
    if (signal.aborted) throw e;
    return { msgs: [], hint: `Chat replay unavailable (${e instanceof Error ? e.message.slice(0, 120) : e}): hype uses audio only` };
  }
}
