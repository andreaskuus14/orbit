// THEATER memory: "Your creators" chips and the "Continue watching" row. Pure list logic (no DOM); the store keeps them in
// localStorage, so everything read back is validated here. Tested in tests/theater-history.test.ts.
import { isVideoId, safeThumb, topicQuery, type WatchVideo } from "./watch-pure.ts";

export type SavedCreator = { name: string; pinned: boolean };
export type Watched = WatchVideo & { channel: string; at: number };
export const MAX_RECENT = 8, MAX_PINNED = 8, MAX_HISTORY = 20;

const NAME = /^[^\p{C}]{1,40}$/u; // the Find box's limit; no control characters
const key = (s: string) => s.trim().toLowerCase();

/** Deduped (case-insensitive, first wins), pinned first (max 8), then recents newest first (max 8). */
function tidy(list: SavedCreator[]): SavedCreator[] {
  const seen = new Set<string>();
  const out = list.filter((c) => !seen.has(key(c.name)) && !!seen.add(key(c.name)));
  return [...out.filter((c) => c.pinned).slice(0, MAX_PINNED), ...out.filter((c) => !c.pinned).slice(0, MAX_RECENT)];
}

/** Whatever JSON.parse gave back → a valid list (junk entries dropped). */
export function parseCreators(raw: unknown): SavedCreator[] {
  if (!Array.isArray(raw)) return [];
  return tidy(raw.flatMap((c: { name?: unknown; pinned?: unknown } | null) =>
    typeof c?.name === "string" && NAME.test(c.name.trim()) ? [{ name: c.name.trim(), pinned: c.pinned === true }] : []));
}

/** A searched creator moves to the front (keeping its pin). */
export function addCreator(list: SavedCreator[], name: string): SavedCreator[] {
  const n = name.trim();
  if (!NAME.test(n)) return list;
  return tidy([{ name: n, pinned: list.some((c) => c.pinned && key(c.name) === key(n)) }, ...list]);
}

/** Star / unstar. Pinning a 9th is refused (unchanged list) so no older favourite silently drops. */
export function togglePin(list: SavedCreator[], name: string): SavedCreator[] {
  const c = list.find((x) => key(x.name) === key(name));
  if (!c || (!c.pinned && list.filter((x) => x.pinned).length >= MAX_PINNED)) return list;
  return tidy(list.map((x) => (x === c ? { ...x, pinned: !x.pinned } : x)));
}

export const removeCreator = (list: SavedCreator[], name: string) => list.filter((c) => key(c.name) !== key(name));

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Stored history → valid entries (bad video ids dropped), newest first, deduped by id, max 20. */
export function parseHistory(raw: unknown): Watched[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((v: Record<string, unknown> | null) => {
    if (!v || !isVideoId(v.id) || seen.has(v.id)) return [];
    seen.add(v.id);
    return [{ id: v.id, title: text(v.title, 200), publishedAt: text(v.publishedAt, 40), views: num(v.views), durationSec: num(v.durationSec),
      thumb: safeThumb(text(v.thumb, 500)), channel: text(v.channel, 100), at: Math.min(num(v.at), 8.64e15) }]; // Date's max, so the "opened" label can format it
  }).sort((a, b) => b.at - a.at).slice(0, MAX_HISTORY);
}

/** An opened video goes to the front (re-opening moves it up). */
export function addWatched(list: Watched[], v: WatchVideo, channel: string, at: number): Watched[] {
  if (!isVideoId(v.id)) return list;
  return [{ ...v, channel, at }, ...list.filter((x) => x.id !== v.id)].slice(0, MAX_HISTORY);
}

// Category chips ("All" is fixed and not in the list). No stored list yet = the defaults.
export const DEFAULT_TOPICS = ["CS2", "Fortnite", "Minecraft", "Valorant", "GTA"];
export const MAX_TOPICS = 12;
/** Stored topics → valid labels (deduped case-insensitively, max 12); not an array = never saved → defaults. */
export function parseTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_TOPICS;
  return raw.reduce<string[]>((acc, t) => (typeof t === "string" ? addTopic(acc, t) : acc), []);
}
/** Appends a topic; a duplicate, an invalid label or a 13th is refused (unchanged list). */
export function addTopic(list: string[], t: string): string[] {
  const n = t.replace(/\s+/g, " ").trim();
  if (!topicQuery(n) || n.toLowerCase() === "all" || list.length >= MAX_TOPICS || list.some((x) => key(x) === key(n))) return list;
  return [...list, n];
}
export const removeTopic = (list: string[], t: string) => list.filter((x) => key(x) !== key(t));
