// Trend Radar, YouTube side: Gaming "most popular" chart snapshots → rising videos + hot topics. Pure; tested in tests/yt-trend.test.ts.

export type YtVid = { id: string; title: string; channel: string; views: number; rank: number };
export type YtSnap = { at: number; videos: YtVid[] };
export type YtRiser = { id: string; title: string; channel: string; views: number; rank: number; rankJump: number; isNew: boolean; viewsPerHour: number | null; strong: boolean };
export type Topic = { term: string; count: number };

const H = 3600_000;
export const YT_BASE_MIN = 0.5 * H, YT_BASE_MAX = 36 * H; // how old the comparison snapshot may be
export const MIN_VPH = 20_000, STRONG_VPH = 100_000; // views gained per hour
export const RANK_RISE = 5, RANK_STRONG = 15, NEW_TOP = 25; // "new on the list" only counts in the top 25

const ID = /^[\w-]{11}$/;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** videos.list?chart=mostPopular JSON → one snapshot (rank = 1-based position). Junk items dropped. */
export function parsePopular(j: unknown, at: number): YtSnap {
  const items = (j as { items?: unknown })?.items;
  const videos = (Array.isArray(items) ? items : [])
    .filter((v): v is { id: string; snippet?: { title?: unknown; channelTitle?: unknown }; statistics?: { viewCount?: unknown } } => typeof v?.id === "string" && ID.test(v.id))
    .map((v, i) => ({ id: v.id, title: String(v.snippet?.title ?? "").slice(0, 200), channel: String(v.snippet?.channelTitle ?? "").slice(0, 100), views: n(v.statistics?.viewCount), rank: i + 1 }));
  return { at, videos };
}

/** File JSON → snapshots, malformed ones dropped, oldest first. */
export function parseYtSnaps(j: unknown): YtSnap[] {
  if (!Array.isArray(j)) return [];
  return j.filter((s): s is YtSnap => !!s && typeof s.at === "number" && Array.isArray(s.videos))
    .map((s) => ({ at: s.at, videos: s.videos.filter((v) => v && typeof v.id === "string" && typeof v.views === "number" && typeof v.rank === "number") }))
    .sort((a, b) => a.at - b.at);
}

/** Newest snapshot vs the most recent one ≥ 30 min older (≤ 36 h): rank climbs, view velocity, new entries. Fastest first. */
export function findYtRisers(snaps: YtSnap[], limit = 10): YtRiser[] {
  const now = snaps.at(-1);
  const base = now && snaps.findLast((s) => now.at - s.at >= YT_BASE_MIN && now.at - s.at <= YT_BASE_MAX);
  if (!now || !base) return [];
  const hours = (now.at - base.at) / H;
  const prev = new Map(base.videos.map((v) => [v.id, v]));
  const out: YtRiser[] = [];
  for (const v of now.videos) {
    const p = prev.get(v.id);
    const isNew = !p && v.rank <= NEW_TOP;
    const rankJump = p ? Math.max(0, p.rank - v.rank) : 0;
    const viewsPerHour = p ? Math.max(0, Math.round((v.views - p.views) / hours)) : null;
    if (!isNew && rankJump < RANK_RISE && (viewsPerHour ?? 0) < MIN_VPH) continue;
    out.push({ ...v, rankJump, isNew, viewsPerHour, strong: rankJump >= RANK_STRONG || (viewsPerHour ?? 0) >= STRONG_VPH });
  }
  return out.sort((a, b) => (b.viewsPerHour ?? -1) - (a.viewsPerHour ?? -1) || b.rankJump - a.rankJump || a.rank - b.rank).slice(0, limit);
}

const STOP = new Set(("the a an and or of to in on for with at by from is are was be it this that my your our i you we me us he she they " +
  "new vs best how why what when who all most more just get got can will not no yes but so out up one first last ever every day days " +
  "video videos official trailer gameplay game games gaming live stream shorts short part episode update full world funny epic " +
  "challenge reaction playing played play tried try made make won win lost").split(" "));
const words = (t: string) => t.toLowerCase().replace(/#/g, " ").split(/[^\p{L}\p{N}']+/u).map((w) => w.replace(/^'+|'+$/g, ""))
  .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w));

/** Most common keywords / two-word names across titles (each counted once per title, ≥ 2 titles). */
export function hotTopics(titles: string[], limit = 8): Topic[] {
  const c = new Map<string, number>();
  for (const t of titles) {
    const w = words(t);
    for (const term of new Set([...w, ...w.slice(1).map((x, i) => `${w[i]} ${x}`)])) c.set(term, (c.get(term) ?? 0) + 1);
  }
  const all = [...c].filter(([, k]) => k >= 2);
  // a word that only ever appears inside a bigram ("grow" in "grow garden") adds nothing
  return all.filter(([t, k]) => t.includes(" ") || !all.some(([b, kb]) => b !== t && kb === k && b.split(" ").includes(t)))
    .sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length || a[0].localeCompare(b[0]))
    .slice(0, limit).map(([term, count]) => ({ term, count }));
}
