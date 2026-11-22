// Expert source packs for INTELLIGENCE (tests: tests/source-packs.test.ts). Topic searches alone return SEO pages and
// syndicated copies (22 Nov); a professional starts from the primary sources of a field: the engine makers' own blogs,
// Roblox's DevForum announcements, the AI labs, the national broadcaster. Each feed carries a topic, so it lands in "For you"
// (not the world sections). Every URL was checked to serve RSS/Atom on 22 Nov 2026.

export type PackFeed = { url: string; title: string; topic: string };
export type Pack = { id: string; label: string; feeds: PackFeed[] };

export const SOURCE_PACKS: Pack[] = [
  { id: "gamedev", label: "Game dev (Godot, Unity, Unreal, Game Developer)", feeds: [
    { url: "https://godotengine.org/rss.xml", title: "Godot Engine", topic: "game development" },
    { url: "https://unity.com/blog/rss", title: "Unity Blog", topic: "game development" },
    { url: "https://www.unrealengine.com/en-US/rss", title: "Unreal Engine", topic: "game development" },
    { url: "https://www.gamedeveloper.com/rss.xml", title: "Game Developer", topic: "game development" },
  ] },
  { id: "roblox", label: "Roblox (DevForum announcements)", feeds: [
    { url: "https://devforum.roblox.com/c/updates/announcements/36.rss", title: "Roblox DevForum: Announcements", topic: "Roblox" },
  ] },
  { id: "ai", label: "AI (OpenAI, Google AI, The Verge AI)", feeds: [
    { url: "https://openai.com/news/rss.xml", title: "OpenAI News", topic: "artificial intelligence" },
    { url: "https://blog.google/technology/ai/rss/", title: "Google AI Blog", topic: "artificial intelligence" },
    { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", title: "The Verge: AI", topic: "artificial intelligence" },
  ] },
  { id: "youtube", label: "YouTube (official blog)", feeds: [
    { url: "https://blog.youtube/rss/", title: "YouTube Official Blog", topic: "YouTube creators" },
  ] },
  { id: "tech", label: "Hacker News (200+ points)", feeds: [
    { url: "https://hnrss.org/frontpage?points=200", title: "Hacker News: top", topic: "technology" },
  ] },
  { id: "estonia", label: "Estonia (ERR News)", feeds: [
    { url: "https://news.err.ee/rss", title: "ERR News", topic: "Estonia" },
  ] },
  { id: "architecture", label: "Architecture (Dezeen, ArchDaily)", feeds: [
    { url: "https://www.dezeen.com/feed/", title: "Dezeen", topic: "architecture" },
    { url: "https://feeds.feedburner.com/Archdaily", title: "ArchDaily", topic: "architecture" },
  ] },
];

export const packById = (id: unknown) => (typeof id === "string" ? SOURCE_PACKS.find((p) => p.id === id) ?? null : null);

/** Packs worth offering first: those matching a topic he already follows (word overlap, case-insensitive), then the rest. */
export function packOrder(topics: string[]): Pack[] {
  const words = new Set(topics.flatMap((t) => t.toLowerCase().match(/[a-z]{3,}/g) ?? []));
  const hit = (p: Pack) => p.feeds.some((f) => (f.topic.toLowerCase().match(/[a-z]{3,}/g) ?? []).some((w) => words.has(w)));
  return [...SOURCE_PACKS.filter(hit), ...SOURCE_PACKS.filter((p) => !hit(p))];
}
