// THEATER: "show me Jynxzi's latest videos" → the creator's 3 newest uploads, a spoken choice, then the official embed player.
// Pure (no DOM, no server imports): tested in tests/watch.test.ts.
import { isShort, parseIsoDuration } from "./youtube-pure.ts";

export type WatchCommand = { creator: string; shorts: boolean };
export type WatchVideo = { id: string; title: string; publishedAt: string; views: number; durationSec: number; thumb: string };
export type WatchControl = "pause" | "play" | "next" | "close" | "fullscreen" | "exitFullscreen";

const PREFIX = /^(?:(?:(?:hey|hi|ok|okay) )?(?:orbit|core)|please|can you|could you|would you|will you|hey|ok|okay|now|just|um|uh|so) /i;
const SUFFIX = / (?:please|now|for me|orbit|on youtube|in the theater|in the theatre)$/i;
/** Lower-noise text: curly quotes straightened, end punctuation and commas gone, polite prefixes/suffixes stripped. */
function clean(text: string): string {
  let s = text.replace(/[’`]/g, "'").replace(/[,;:!?"]+/g, " ").replace(/\.+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(PREFIX, "").replace(SUFFIX, "").trim(); }
  return s;
}

const VERB = "(?:open(?: up)?|show(?: me| us)?|play(?: me)?|find(?: me)?|pull up|bring up|put on)";
const REC = "(?:latest|newest|new|most recent|recent|last)";
const NUM = "(?:(?:\\d|one|two|three|five|a few|few|a couple of|couple of) )?";
const KIND = "(?:youtube )?(?:videos?|vids?|uploads?|shorts?)";
const FORMS = [
  new RegExp(`^${VERB} (?:the |some )?${REC} ${NUM}${KIND} (?:from|by|of) (.+)$`, "i"), // show me the latest videos from X
  new RegExp(`^${VERB} (?:the |some )?${NUM}${KIND} (?:from|by) (.+)$`, "i"), //             show me videos by X
  new RegExp(`^${VERB} (.+?)(?:'s|s'|') (?:${REC} )?${NUM}${KIND}$`, "i"), //                open X's latest videos
  new RegExp(`^${VERB} (?:the )?${REC} (?:from|by) (.+)$`, "i"), //                         show me the latest from X
  new RegExp(`^${VERB} (?:the )?${REC} (.+?) ${KIND}$`, "i"), //                            show me the newest X video
  new RegExp(`^${VERB} (.+?) ${REC} ${KIND}$`, "i"), //                                     play X newest video (speech dropped the 's)
  /^what (?:did|has|have) (.+?) (?:just )?(?:upload(?:ed)?|post(?:ed)?)(?: (?:recently|lately|today|yesterday|this week))?$/i,
];
const NOT_CREATOR = /^(?:my|our|your|his|her|their|its|the|this|that|these|those|me|us|him|them|it|he|she|they|you|i|we|some|any|all|someone|somebody|anyone|everyone|people|youtube|trending|popular|funny|cat|cats|dog|dogs|music|today|yesterday|good|best|top|new|cool|random|more|other)$/i;

/** The whole message must be a "find this creator's videos" command; ordinary questions → null. */
export function parseWatchCommand(text: string): WatchCommand | null {
  const s = clean(text);
  for (const re of FORMS) {
    const m = re.exec(s);
    if (!m) continue;
    const creator = m[1].trim().replace(/^@/, "").replace(/(?:'s|s'|')$/, "");
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,39}$/u.test(creator) || creator.split(" ").length > 4) return null;
    if (NOT_CREATOR.test(creator) || /^(?:my|our|your|the|some) /i.test(creator) || new RegExp(`\\b${KIND}\\b`, "i").test(creator)) return null;
    return { creator, shorts: /\bshorts?\b/i.test(s) };
  }
  return null;
}

const ORD: Record<string, number> = { first: 0, one: 0, "1st": 0, "1": 0, second: 1, two: 1, "2nd": 1, "2": 1, third: 2, three: 2, "3rd": 2, "3": 2,
  fourth: 3, four: 3, "4th": 3, "4": 3, fifth: 4, five: 4, "5th": 4, "5": 4 };
const CHOICE = /^(?:(?:open|play|watch|show me|show|pick|choose|select|start|go with|take|i want|ill take|i'll take|let's watch|lets watch|i'd like) )?(?:the )?(?:(?:number|no|video|option) )?(first|second|third|fourth|fifth|last|one|two|three|four|five|1st|2nd|3rd|4th|5th|[1-5])(?: (?:one|video|please))*$/i;

/** Reply to "Which one should I open?": an index into the n videos, "cancel", or null (not an answer: goes on to CORE).
 *  listing = the list is waiting for an answer (then "yes" = the first and "no" cancels; while playing they mean nothing). */
export function parseWatchChoice(text: string, n: number, listing = true): number | "cancel" | null {
  const s = clean(text).toLowerCase();
  if (listing && /^(?:no|nope|nah|no thanks|no thank you|cancel|never ?mind|forget it|none|neither|none of them|close|close it|stop)$/.test(s)) return "cancel";
  if (listing && /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|open it|play it|yes please)$/.test(s)) return n > 0 ? 0 : null;
  const m = CHOICE.exec(s);
  if (!m) return null;
  const i = m[1] === "last" ? n - 1 : ORD[m[1]];
  return i >= 0 && i < n ? i : null;
}

/** Voice controls while a video plays. */
export function parseWatchControl(text: string): WatchControl | null {
  const s = clean(text).toLowerCase().replace(/ (?:the )?(?:video|player)$/, "").replace(/ it$/, "");
  if (/^(?:exit|leave|close|stop|end) (?:the )?full ?screen$|^(?:un ?full ?screen|small(?:er)? screen)$/.test(s)) return "exitFullscreen";
  if (/^(?:(?:go |make (?:it )?|switch to )?full ?screen|maximi[sz]e)$/.test(s)) return "fullscreen";
  if (/^(?:pause|hold on|wait)$/.test(s)) return "pause";
  if (/^(?:play|resume|continue|unpause|keep playing)$/.test(s)) return "play";
  if (/^(?:next|next one|skip|skip this(?: one)?|play the next one|(?:play |show )?(?:the )?next video)$/.test(s)) return "next";
  if (/^(?:close|stop|exit|cancel)$/.test(s)) return "close";
  return null;
}

/** Only YouTube's 11-character ids go into the embed URL. */
export const isVideoId = (s: unknown): s is string => typeof s === "string" && /^[\w-]{11}$/.test(s);
export const embedUrl = (id: string, origin: string) => isVideoId(id)
  ? `https://www.youtube-nocookie.com/embed/${id}?${new URLSearchParams({ autoplay: "1", rel: "0", enablejsapi: "1", origin })}` : "";

/** YouTube units for one lookup: channel (skipped when its id is cached) + uploads playlist + video stats, 1 each. A string = can't. */
export function planWatch(channelCached: boolean, unitsLeft: number): number | string {
  const units = channelCached ? 2 : 3;
  return unitsLeft >= units ? units : "Today's YouTube budget is used up; it resets at midnight Pacific time";
}

type Thumbs = Record<string, { url?: unknown } | undefined> | undefined;
type Item = { id?: unknown; snippet?: { title?: unknown; publishedAt?: unknown; liveBroadcastContent?: unknown; thumbnails?: Thumbs };
  contentDetails?: { duration?: unknown }; statistics?: { viewCount?: unknown } };
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** videos.list items → the newest `n` uploads (long-form, or only Shorts when asked); upcoming premieres and malformed items dropped. */
export function pickLatest(items: unknown, shorts: boolean, n = 3): WatchVideo[] {
  const vs = (Array.isArray(items) ? (items as Item[]) : []).flatMap((v) => {
    const sn = v?.snippet;
    if (!isVideoId(v?.id) || !sn || !str(sn.publishedAt) || sn.liveBroadcastContent === "upcoming") return [];
    const t = sn.thumbnails;
    return [{ id: v.id, title: str(sn.title).slice(0, 200), publishedAt: str(sn.publishedAt), views: Number(v.statistics?.viewCount) || 0,
      durationSec: parseIsoDuration(str(v.contentDetails?.duration)), thumb: str(t?.medium?.url) || str(t?.high?.url) || str(t?.default?.url) }];
  });
  return vs.filter((v) => isShort(v) === shorts).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, n);
}

/** "Found 3 new Jynxzi videos: 1. …, 2. …, 3. … Which one should I open?" */
export function watchReply(channel: string, videos: WatchVideo[], shorts = false): string {
  const kind = shorts ? "Short" : "video";
  if (!videos.length) return `I couldn't find any recent ${shorts ? "Shorts" : "long videos"} from ${channel}.`;
  const list = videos.map((v, i) => `${i + 1}. ${v.title}`).join(", ");
  return videos.length === 1
    ? `Found 1 new ${channel} ${kind}: ${list}. Should I open it?`
    : `Found ${videos.length} new ${channel} ${kind}s: ${list}. Which one should I open?`;
}

/** "3 days ago" */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  const [k, u] = s < 3600 ? [s / 60, "minute"] : s < 86400 ? [s / 3600, "hour"] : s < 30 * 86400 ? [s / 86400, "day"] : s < 365 * 86400 ? [s / (30 * 86400), "month"] : [s / (365 * 86400), "year"];
  const v = Math.max(1, Math.floor(k));
  return `${v} ${u}${v > 1 ? "s" : ""} ago`;
}
/** 3723 → "1:02:03", 65 → "1:05" */
export function length(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), p = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
