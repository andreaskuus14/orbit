// THEATER: "show me Jynxzi's latest videos" → the creator's 3 newest uploads, a spoken choice, then the official embed player.
// Pure (no DOM, no server imports): tested in tests/watch.test.ts.
import { isShort, parseIsoDuration } from "./youtube-pure.ts";
import { PLANETS } from "./planets.ts";

/** topic: true = "show me cs2 videos" (a YouTube search for `creator` as words), else a channel lookup. */
export type WatchCommand = { creator: string; shorts: boolean; topic?: boolean };
export type WatchVideo = { id: string; title: string; publishedAt: string; views: number; durationSec: number; thumb: string; channel?: string; live?: boolean };
/** Feed order: "viral" = most viewed first, "new" = newest first. */
export type Sort = "viral" | "new";
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
  /^what (?:did|has|have) (.+?) (?:just )?upload(?:ed)?(?: (?:recently|lately|today|yesterday|this week))?$/i,
  /^what (?:did|has|have) (@[\w.-]+) (?:just )?post(?:ed)?(?: (?:recently|lately|today|yesterday|this week))?$/i, // "post" alone is social media talk
];
// After the creator forms: "show me videos about minecraft", "show me cs2 videos" → a topic search.
const TOPIC_FORMS = [
  new RegExp(`^${VERB} (?:the |some )?(?:${REC} )?${NUM}${KIND} (?:about|on) (.+)$`, "i"),
  new RegExp(`^${VERB} (?:the |some )?(?:${REC} )?(.+?) ${KIND}$`, "i"),
];
const NOT_CREATOR = /^(?:my|our|your|his|her|their|its|the|this|that|these|those|me|us|him|them|it|he|she|they|you|i|we|some|any|all|someone|somebody|anyone|everyone|people|youtube|trending|popular|funny|cat|cats|dog|dogs|music|today|yesterday|good|best|top|new|cool|random|more|other|news|trailer|trailers|category|categories|date|views|popularity|everybody|everything|week|month|year|time|game|games|sports|gaming|movie|movies|tv|kids|life)$/i;
const NOT_START = /^(?:my|our|your|the|some|this|that|last|next|today|yesterday) |^\d+$/i;
// Topic words that are really about THEATER's own list/player ("play the next video", "show me my saved videos").
const NOT_TOPIC_START = /^(?:next|previous|prev|last|same|another|random|full|long|longer|short|shorter|older|newer|old|saved|watched|liked|favou?rites?|this|that|these|those|other|more|current|whole|entire)$/i;
const ORDINAL = /^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))$/i;

/** The whole message must be a "find this creator's videos" command; ordinary questions → null. */
export function parseWatchCommand(text: string): WatchCommand | null {
  const s = clean(text);
  for (const re of FORMS) {
    const m = re.exec(s);
    if (!m) continue;
    const creator = m[1].trim().replace(/^@/, "").replace(/(?:'s|s'|')$/, "");
    if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,39}$/u.test(creator) || creator.split(" ").length > 4) return null;
    if (NOT_CREATOR.test(creator) || NOT_START.test(creator) || new RegExp(`\\b${KIND}\\b`, "i").test(creator)) return null;
    return { creator, shorts: /\bshorts?\b/i.test(s) };
  }
  for (const re of TOPIC_FORMS) {
    const m = re.exec(s);
    if (!m) continue;
    const topic = m[1].trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .:'&+_-]{1,59}$/u.test(topic) || topic.split(" ").length > 6) return null;
    if (NOT_CREATOR.test(topic) || NOT_START.test(topic) || /'s\b|s'$/.test(topic) || new RegExp(`\\b${KIND}\\b`, "i").test(topic)) return null;
    const words = topic.split(" ");
    if (NOT_TOPIC_START.test(words[0]) || words.some((x) => ORDINAL.test(x))) return null;
    if (ORBIT_PLACE(topic)) return null; // "show me the studio videos" is about ORBIT itself, not a YouTube topic
    return { creator: topic, shorts: /\bshorts?\b/i.test(s), topic: true };
  }
  return null;
}

const ORBIT_PLACE = (t: string) => {
  const w = t.toLowerCase().replace(/^(?:the|my|our)\s+/, "");
  return ["core", "galaxy", "clips", "stats", "my clips", "my channel"].includes(w) || PLANETS.some((p) => p.id === w || p.name.toLowerCase() === w);
};

export const ALIASES: Record<string, string> = { cs2: "Counter-Strike 2", cs: "Counter-Strike 2", fn: "Fortnite", mc: "Minecraft", gta: "GTA", val: "Valorant", r6: "Rainbow Six Siege" };
/** A topic chip / spoken topic → the search words (game shorthands expanded), or null when it isn't one (1-60 chars). */
export function topicQuery(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!/^[^\p{C}]{1,60}$/u.test(t)) return null;
  return ALIASES[t.toLowerCase()] ?? t;
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

/** What Google bills per call: search.list 100 units, every list call we use here 1. */
export const unitCost = (endpoint: string) => (endpoint === "search" ? 100 : 1);
export const plan = (units: number, unitsLeft: number): number | string => (unitsLeft >= units ? units : "Today's YouTube budget is used up; it resets at midnight Pacific time");
/** YouTube units for one lookup: channel (skipped when its id is cached) + uploads playlist + video stats, 1 each. A string = can't. */
export const planWatch = (channelCached: boolean, unitsLeft: number): number | string => plan(channelCached ? 2 : 3, unitsLeft);
/** A topic: search.list + one videos.list. */
export const planTopic = (unitsLeft: number): number | string => plan(unitCost("search") + unitCost("videos"), unitsLeft);

/** Only YouTube's image host goes into <img src> (thumbnails come from the API or localStorage). */
/** nextPageToken handed back by the client: opaque, but only these characters are forwarded to YouTube. */
export const isPageToken = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(s);
/** An optional ISO country code for YouTube's regionCode. */
export const regionCode = (s: unknown) => (typeof s === "string" && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : undefined);

/** The Find box: "@x" or a channel link → creator; a game shorthand (cs2, fn…) or a category chip name → topic, never a
 *  channel lookup (YouTube has an unrelated @cs2); anything else → creator first, with the topic fallback. */
export function findMode(input: string, topics: readonly string[]): "creator" | "topic" {
  const t = input.replace(/\s+/g, " ").trim().toLowerCase();
  if (t.startsWith("@") || /(?:^|\/\/|\.)(?:youtube\.com|youtu\.be)\//.test(t)) return "creator";
  return Object.hasOwn(ALIASES, t) || topics.some((x) => x.trim().toLowerCase() === t) ? "topic" : "creator";
}

export const safeThumb = (u: unknown) => (typeof u === "string" && /^https:\/\/i\d?\.ytimg\.com\//.test(u) ? u : "");

type Thumbs = Record<string, { url?: unknown } | undefined> | undefined;
type Item = { id?: unknown; snippet?: { title?: unknown; channelTitle?: unknown; publishedAt?: unknown; liveBroadcastContent?: unknown; thumbnails?: Thumbs };
  contentDetails?: { duration?: unknown }; statistics?: { viewCount?: unknown } };
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** videos.list items → long-form videos (or only Shorts when asked), in API order; upcoming premieres, live streams
 *  (unless `live`) and malformed items dropped. */
export function pickVideos(items: unknown, shorts: boolean, live = true): WatchVideo[] {
  return (Array.isArray(items) ? (items as Item[]) : []).flatMap((v) => {
    const sn = v?.snippet;
    if (!isVideoId(v?.id) || !sn || !str(sn.publishedAt) || sn.liveBroadcastContent === "upcoming" || (!live && sn.liveBroadcastContent === "live")) return [];
    const t = sn.thumbnails;
    const video: WatchVideo = { id: v.id, title: str(sn.title).slice(0, 200), publishedAt: str(sn.publishedAt), views: Number(v.statistics?.viewCount) || 0,
      durationSec: parseIsoDuration(str(v.contentDetails?.duration)), thumb: safeThumb(str(t?.medium?.url) || str(t?.high?.url) || str(t?.default?.url)),
      channel: str(sn.channelTitle).slice(0, 100), ...(sn.liveBroadcastContent === "live" ? { live: true } : {}) };
    return isShort(video) === shorts ? [video] : [];
  });
}
/** The newest `n` uploads of a channel. */
export const pickLatest = (items: unknown, shorts: boolean, n = 3): WatchVideo[] =>
  pickVideos(items, shorts).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, n);
/** Most viewed first ("viral") or newest first ("new"); a new array. */
export const sortVideos = (vs: WatchVideo[], sort: Sort): WatchVideo[] =>
  [...vs].sort(sort === "viral" ? (a, b) => b.views - a.views : (a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
/** Each id once, first occurrence kept (feed pages can overlap). */
export function dedupe(vs: WatchVideo[]): WatchVideo[] {
  const seen = new Set<string>();
  return vs.filter((v) => !seen.has(v.id) && !!seen.add(v.id));
}
/** "All": several creators' videos merged (newest or most viewed first), each id once. */
export const mergeByDate = (lists: WatchVideo[][], n = 48, sort: Sort = "new"): WatchVideo[] => sortVideos(dedupe(lists.flat()), sort).slice(0, n);
/** Endless scroll loads the next page by itself, except after a failure and beyond 3 topic pages (101 units each). */
export const autoLoad = (kind: string | undefined, pages: number, stalled: boolean) => !stalled && (kind !== "topic" || pages < 3);
/** After a page: stop auto-paging when YouTube repeats the token, or when pages add nothing (a creator's Shorts-only page is
 *  cheap: 2 in a row; any other feed: 1). The "Load more" button takes over. */
export function afterPage(kind: string | undefined, before: number, after: number, prevNext: string | undefined, next: string | undefined, emptyRun = 0) {
  const run = after > before ? 0 : emptyRun + 1;
  return { emptyRun: run, stalled: (!!next && next === prevNext) || run >= (kind === "creator" ? 2 : 1) };
}
/** Published in the last 24 h (the "NEW" badge). */
export const isNew = (v: WatchVideo, now: number) => now - Date.parse(v.publishedAt) < 86_400_000;

/** "Found 3 new Jynxzi videos: 1. …, 2. …, 3. … Which one should I open?" */
export function watchReply(channel: string, videos: WatchVideo[], shorts = false, topic = false): string {
  const kind = shorts ? "Short" : "video";
  if (topic) return videos.length ? `${videos.length === 1 ? `Here is a ${kind}` : `Here are ${videos.length} ${kind}s`} about ${channel}. Which one should I open?`
    : `I couldn't find any recent ${shorts ? "Shorts" : "videos"} about ${channel}.`;
  if (!videos.length) return `I couldn't find any recent ${shorts ? "Shorts" : "long videos"} from ${channel}.`;
  const list = videos.slice(0, 3).map((v, i) => `${i + 1}. ${v.title}`).join(", ") + (videos.length > 3 ? " and more" : ""); // speech: only the top 3
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

/** Keeps an in-memory cache bounded: drops expired entries, then the oldest (Map keeps insertion order) beyond `max`. */
export function pruneCache<V extends { at: number }>(m: Map<string, V>, now: number, ttlMs: number, max = 200) {
  for (const [k, v] of m) if (now - v.at >= ttlMs) m.delete(k);
  for (const k of m.keys()) { if (m.size < max) break; m.delete(k); }
}
