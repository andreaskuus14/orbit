// INTELLIGENCE topic watch, the pure parts: "follow Estonia" / "unfollow AI" commands, topic validation,
// the 30-minute refresh throttle and "new since last visit". No I/O — tested in tests/follows.test.ts.

export const REFRESH_MS = 30 * 60_000;
export const MAX_TOPICS = 30;
export type Headline = { title: string; url: string; source: string | null; published_at: string | null };
export type FollowCommand = { action: "follow" | "unfollow"; topic: string };

/** A followable topic (person, country, thing) cleaned up, or null: 2–60 chars, words only, at most 5 words. */
export function cleanTopic(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.normalize("NFC").replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’.!?,]+$/g, "").trim();
  if (t.length < 2 || t.length > 60 || t.split(" ").length > 5) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N} .'’&+#-]*$/u.test(t) ? t : null;
}
export const sameTopic = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

const PREFIX = /^(?:(?:hey |hi |ok |okay )?(?:orbit|core)[,!.]? |please |can you |could you |would you |now )+/i;
const SUFFIX = /(?:,? (?:please|now|for me|thanks|thank you|orbit))+[.!]*$/i;
const VERB = /^(?:(unfollow|stop following|stop tracking|unwatch)|(follow|start following|keep an eye on))\s+(.+)$/i;
// "follow up", "follow me", "follow the instructions": ordinary speech, not a topic.
const NOT_TOPIC = /^(?:up|me|us|along|through|it|this|that|these|those|him|her|them|you|suit|my|your|our|his|their|a|an|some|orders|best|the (?:instructions|steps|rules|plan|link|directions|recipe|guide|money|path|road))\b/i;
// "the news", "the oven", a bare "the": lowercase after "the" is a thing, not a topic ("the Fed" stays).
const THE_THING = /^the(?: \p{Ll}|$)/u;

/** "follow Jynxzi", "Orbit, unfollow AI please", "stop following news about YouTube" → command, else null. */
export function parseFollowCommand(text: string): FollowCommand | null {
  const s = text.replace(/\s+/g, " ").trim().replace(PREFIX, "").replace(SUFFIX, "").trim();
  const m = VERB.exec(s);
  if (!m) return null;
  const rest = m[3].replace(/^(?:the )?(?:news|headlines|stories) (?:about|on|from|for) /i, "").replace(/^the topic /i, "");
  if (NOT_TOPIC.test(rest) || THE_THING.test(rest)) return null;
  const topic = cleanTopic(rest.replace(/ (?:news|headlines)$/i, ""));
  return topic ? { action: m[1] ? "unfollow" : "follow", topic } : null;
}

/** Said right away, before the save finishes. */
export const followAck = (c: FollowCommand) => `${c.action === "follow" ? "Following" : "Unfollowing"} ${c.topic}…`;
/** The real outcome. removed: whether an unfollow found the topic. */
export const followReply = (c: FollowCommand, removed = true) =>
  c.action === "follow" ? `Following ${c.topic}. Its headlines are in Intelligence.` : removed ? `Stopped following ${c.topic}.` : `You weren't following ${c.topic}.`;

/** Refresh throttle: fetch a topic again only when its cache is missing or at least REFRESH_MS old. */
export const needsRefresh = (at: number | undefined, now = Date.now(), ttl = REFRESH_MS) => !at || now - at >= ttl || now < at;

const time = (h: Headline) => (h.published_at ? Date.parse(h.published_at) || 0 : 0);
/** Published after `since` (ms). Undated headlines never count as new. */
export const isNew = (h: Headline, since: number) => time(h) > since;
/** Newest first, duplicates (same headline text) removed. */
export function newest(items: Headline[], n = 3): Headline[] {
  const seen = new Set<string>();
  return [...items].sort((a, b) => time(b) - time(a)).filter((h) => {
    const k = h.title.toLowerCase().replace(/\W+/g, " ").trim();
    return !seen.has(k) && !!seen.add(k);
  }).slice(0, n);
}

/** "5m", "3h", "2d" (or "" when unknown). */
export function age(iso: string | null, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
