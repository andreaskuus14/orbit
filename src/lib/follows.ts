import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeFetch } from "./memory";
import { parseFeed } from "./pure";
import { topicFeedUrl } from "./pulse";
import { COUNTRIES, displayName, geoTag } from "./geo";
import { MAX_TOPICS, cleanTopic, isNew, needsRefresh, newest, sameTopic, type Headline } from "./follows-pure";

// INTELLIGENCE topic watch: the owner's followed topics, stored locally in <ORBIT data dir>/follows.json
// (same folder as youtube-oauth.json). Headlines come from the same Google News search feed /api/news/search uses,
// cached per topic in the file and fetched again at most every 30 minutes.

type Store = { topics: { name: string; added: string }[]; cache: Record<string, { at: number; items: Headline[] }>; lastVisit: number; prevVisit: number };
export type TopicNews = { name: string; at: number | null; items: (Headline & { new: boolean })[] };

const file = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "follows.json");
};
const g = globalThis as unknown as { __orbitFollows?: Promise<unknown> };
const key = (t: string) => t.toLocaleLowerCase();

async function read(): Promise<Store> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8"));
    return { topics: Array.isArray(s.topics) ? s.topics : [], cache: s.cache && typeof s.cache === "object" ? s.cache : {},
      lastVisit: Number(s.lastVisit) || 0, prevVisit: Number(s.prevVisit) || 0 };
  } catch (e) {
    // Only a missing file means "nothing followed"; anything else (locked, corrupt) must not be overwritten with an empty list.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { topics: [], cache: {}, lastVisit: 0, prevVisit: 0 };
    throw e;
  }
}
/** Read-modify-write, one at a time; tmp + rename so a crash never leaves a half-written file. */
function update<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  const p = (g.__orbitFollows ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await read();
    const out = await fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 2));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitFollows = p;
  return p;
}

async function fetchTopic(topic: string): Promise<Headline[] | null> {
  try {
    const { res } = await safeFetch(topicFeedUrl(topic, "2d"), "application/rss+xml, application/xml, text/xml");
    return parseFeed((await res.text()).slice(0, 2_000_000)).items.slice(0, 15)
      .map((it) => ({ title: it.title, url: it.url, source: it.source, published_at: it.published }));
  } catch { return null; } // offline or blocked: keep the old cache
}

export async function listFollows(): Promise<string[]> { return (await read()).topics.map((t) => t.name); }

export async function follow(raw: string): Promise<{ topic: string } | { error: string }> {
  const topic = cleanTopic(raw);
  if (!topic) return { error: "Topic must be 2–60 characters (a name, country or subject)" };
  return update((s) => {
    if (s.topics.some((t) => sameTopic(t.name, topic))) return { topic };
    if (s.topics.length >= MAX_TOPICS) return { error: `You can follow up to ${MAX_TOPICS} topics` };
    s.topics.push({ name: topic, added: new Date().toISOString() });
    return { topic };
  });
}
export async function unfollow(raw: string): Promise<boolean> {
  return update((s) => {
    const before = s.topics.length;
    s.topics = s.topics.filter((t) => !sameTopic(t.name, raw.trim()));
    delete s.cache[key(raw.trim())];
    return s.topics.length < before;
  });
}

/** Every followed topic with its latest 3 headlines (stale ones refetched, at most every 30 min).
 *  visit: marks now as the owner's last visit; `new` compares with the visit before. */
export async function followedNews(visit = false, now = Date.now()) {
  // Fetch outside the write queue (a slow feed mustn't block follow/unfollow), then merge in one short update.
  const snap = await read();
  const stale = snap.topics.filter((t) => needsRefresh(snap.cache[key(t.name)]?.at, now));
  const got = await Promise.all(stale.map((t) => fetchTopic(t.name)));
  return update((s) => {
    // A failed fetch still stamps the time (keeping old items) so an outage doesn't refetch on every load.
    stale.forEach((t, i) => {
      if (s.topics.some((x) => sameTopic(x.name, t.name))) s.cache[key(t.name)] = { at: now, items: got[i] ?? s.cache[key(t.name)]?.items ?? [] };
    });
    // A visit moves lastVisit to now and keeps the one before, so "new" survives reloads until the next visit.
    if (visit) { s.prevVisit = s.lastVisit; s.lastVisit = now; }
    const since = s.prevVisit || now - 86400_000;
    const topics: TopicNews[] = s.topics.map((t) => {
      const c = s.cache[key(t.name)];
      return { name: t.name, at: c?.at ?? null, items: newest(c?.items ?? []).map((h) => ({ ...h, new: isNew(h, since) })) };
    });
    return { topics, countries: followedCountries(topics), lastVisit: since };
  });
}

/** Countries the followed-topic news is about (a topic that is itself a country counts too); the globe pulses these. */
function followedCountries(topics: TopicNews[]): string[] {
  const out = new Set<string>();
  for (const t of topics) {
    const own = COUNTRIES.find((c) => sameTopic(c.name, t.name) || sameTopic(displayName(c.name), t.name));
    if (own && t.items.length) out.add(own.name);
    for (const h of t.items) for (const c of geoTag(h.title, "", 2)) out.add(c);
  }
  return [...out];
}

/** For the morning card: the top new headline per followed topic (newer than `since`, default the last 24 h). */
export async function topicHeadlines(since = Date.now() - 86400_000): Promise<(Headline & { topic: string })[]> {
  const { topics } = await followedNews(false);
  return topics.flatMap((t) => {
    const h = t.items.find((x) => isNew(x, since));
    return h ? [{ title: h.title, url: h.url, source: h.source, published_at: h.published_at, topic: t.name }] : [];
  });
}
