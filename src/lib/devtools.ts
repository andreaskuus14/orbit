import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, FAST_MODEL } from "./claude";
import { safeFetch } from "./memory";
import {
  MAX_FAVS, WHY_SYSTEM, boundedSet, cleanFavourite, parseExploreSorts, parseIcons, parseLegacyList, parseOpenverse, trendPrompt,
  type Sound, type TrendSort,
} from "./devtools-pure";
import { orbitDataDir } from "./data-dir";
import { findRisers, parseSnaps, pushSnap, toSnapshot, type Riser } from "./trend-rise-pure";

// DevWorld game-dev tools: Openverse sound search + local favourites, and the Roblox Trend Radar.
// All outbound HTTP goes through safeFetch (SSRF guard, size cap); results are cached in memory with a size cap.

export type { Sound, TrendSort };
const UA = "ORBIT/0.2 (personal game-dev assistant)";
const getJson = async (url: string, maxBytes = 3_000_000) => (await safeFetch(url, "application/json", UA, maxBytes)).res.json() as Promise<unknown>;

/* ---------- sounds ---------- */

const soundCache = new Map<string, { at: number; p: Promise<Sound[]> }>();
export function searchSounds(q: string, now = Date.now()): Promise<Sound[]> {
  const key = q.toLowerCase();
  const c = soundCache.get(key);
  if (c && now - c.at < 30 * 60_000) return c.p;
  const p = getJson(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&page_size=20`).then(parseOpenverse);
  p.catch(() => soundCache.delete(key)); // never cache a failure
  boundedSet(soundCache, key, { at: now, p }, 60);
  return p;
}

const favFile = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "sound-favourites.json");
};
const g = globalThis as unknown as { __orbitFavs?: Promise<unknown> };
/** Favourites errors safe to show the user (never a local path). */
export class FavError extends Error { constructor(m: string, readonly status = 500) { super(m); } }
const unavailable = (e: unknown): never => {
  if (e instanceof FavError) throw e;
  console.error("[devtools] favourites file:", e);
  throw new FavError("Favourites file unavailable");
};
async function readFavs(): Promise<Sound[]> {
  try {
    const j = JSON.parse(await readFile(favFile(), "utf8"));
    return (Array.isArray(j) ? j : []).map(cleanFavourite).filter((s): s is Sound => !!s);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    return unavailable(e); // locked/corrupt: never overwrite
  }
}
function updateFavs(fn: (f: Sound[]) => Sound[]): Promise<Sound[]> {
  const p = (g.__orbitFavs ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await readFavs()).slice(0, MAX_FAVS);
    try {
      await mkdir(path.dirname(favFile()), { recursive: true });
      await writeFile(favFile() + ".tmp", JSON.stringify(next, null, 2));
      await rename(favFile() + ".tmp", favFile());
    } catch (e) { unavailable(e); }
    return next;
  });
  g.__orbitFavs = p;
  return p;
}
export const getFavourites = readFavs;
export const addFavourite = (s: Sound) => updateFavs((f) => {
  if (f.length >= MAX_FAVS && !f.some((x) => x.id === s.id)) throw new FavError(`Favourites full (${MAX_FAVS})`, 400);
  return [s, ...f.filter((x) => x.id !== s.id)];
});
export const removeFavourite = (id: string) => updateFavs((f) => f.filter((x) => x.id !== id));

/* ---------- Roblox Trend Radar ---------- */

export type Trends = { source: string; sorts: TrendSort[]; at: number; error?: string; tried: string[]; risers?: Riser[] };

/** Append a snapshot to <data dir>/trend-history.json (atomic) and return current risers. Never throws. */
async function recordSnapshot(sorts: TrendSort[], now: number): Promise<Riser[]> {
  const file = path.join(orbitDataDir(), "trend-history.json");
  try {
    const old = parseSnaps(JSON.parse(await readFile(file, "utf8").catch(() => "[]"))); // shortcut: a corrupt file restarts history (it's only a cache)
    const snaps = pushSnap(old, toSnapshot(sorts, now));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file + ".tmp", JSON.stringify(snaps));
    await rename(file + ".tmp", file);
    return findRisers(snaps);
  } catch (e) {
    console.error("[devtools] trend history:", e instanceof Error ? e.message : e);
    return [];
  }
}

async function fromExplore(): Promise<TrendSort[]> {
  const sid = randomUUID();
  const j = await getJson(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${sid}`);
  let sorts = parseExploreSorts(j);
  // get-sorts usually carries the games inline (Oct 2026); if a wanted sort came back empty, ask for its content directly.
  const empty = ["top-trending", "up-and-coming"].filter((id) => !sorts.some((s) => s.id === id && s.games.length));
  for (const id of empty) {
    const more = parseExploreSorts(await getJson(`https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${sid}&sortId=${id}`).catch(() => null));
    sorts = [...sorts.filter((s) => s.id !== id), ...more];
  }
  return sorts.filter((s) => s.games.length);
}
async function fromLegacy(): Promise<TrendSort[]> {
  // shortcut: older games API answered 404 when checked (Oct 2026); kept as a best-effort fallback, shape unverified.
  const j = (await getJson("https://games.roblox.com/v1/games/sorts?model.gameSortsContext=GamesDefaultSorts")) as { sorts?: { token?: unknown; displayName?: unknown }[] };
  const s = (j.sorts ?? []).find((x) => typeof x.token === "string") ?? null;
  if (!s) throw new Error("no sorts");
  const list = parseLegacyList(await getJson(`https://games.roblox.com/v1/games/list?model.sortToken=${encodeURIComponent(String(s.token))}&model.maxRows=15`), String(s.displayName ?? "Popular"));
  return list?.games.length ? [list] : [];
}
async function addIcons(sorts: TrendSort[]) {
  const ids = [...new Set(sorts.flatMap((s) => s.games.map((x) => x.universeId)))].slice(0, 100);
  if (!ids.length) return;
  const icons = parseIcons(await getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids.join(",")}&size=150x150&format=Png&isCircular=false`).catch(() => null));
  for (const s of sorts) for (const x of s.games) x.icon = icons.get(x.universeId) ?? null;
}

const TREND_MS = 30 * 60_000;
const tc = globalThis as unknown as { __orbitTrends?: { at: number; p: Promise<Trends> } };
export function getTrends(now = Date.now()): Promise<Trends> {
  if (tc.__orbitTrends && now - tc.__orbitTrends.at < TREND_MS) return tc.__orbitTrends.p;
  const p = (async (): Promise<Trends> => {
    const tried: string[] = [];
    for (const [source, fn] of [["Roblox explore API (get-sorts)", fromExplore], ["Roblox games API (legacy sorts)", fromLegacy]] as const) {
      try {
        const sorts = await fn();
        if (sorts.length) { await addIcons(sorts); return { source, sorts, at: now, tried, risers: await recordSnapshot(sorts, now) }; }
        tried.push(`${source}: no games returned`);
      } catch (e) { tried.push(`${source}: ${(e as Error).message}`); }
    }
    return { source: "none", sorts: [], at: now, tried, error: "Roblox didn't return any public game lists right now." };
  })();
  tc.__orbitTrends = { at: now, p };
  void p.then((t) => { if (!t.sorts.length && tc.__orbitTrends?.p === p) tc.__orbitTrends = { at: now - TREND_MS + 2 * 60_000, p }; }); // retry a failure after 2 min
  return p;
}

const WHY_MS = 6 * 3600_000;
const wc = globalThis as unknown as { __orbitWhy?: { at: number; key: string; p: Promise<{ text: string; at: number }> } };
/** "Why is it trending?": the current list (data only) → patterns + ideas. Cached 6 h per list. */
export async function whyTrending(sb: SupabaseClient, userId: string, now = Date.now()): Promise<{ text: string; at: number; source: string }> {
  const t = await getTrends(now);
  if (!t.sorts.length) throw new Error(t.error ?? "No trend data");
  const prompt = trendPrompt(t.sorts);
  const key = t.source; // the list drifts every refresh; one analysis per source per 6 h keeps AI cost flat
  const c = wc.__orbitWhy;
  if (c && c.key === key && now - c.at < WHY_MS) return { ...(await c.p), source: t.source };
  const p = askClaude(prompt, WHY_SYSTEM, { lane: "background", model: FAST_MODEL }).then(async (r) => {
    await recordUsage(sb, userId, "devtools.trends", r, FAST_MODEL).catch(() => {});
    return { text: r.text.slice(0, 4000), at: now };
  });
  wc.__orbitWhy = { at: now, key, p };
  p.catch(() => { if (wc.__orbitWhy?.p === p) wc.__orbitWhy = undefined; });
  return { ...(await p), source: t.source };
}
