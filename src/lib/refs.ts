import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeFetch } from "./memory";
import { askClaude, FAST_MODEL } from "./claude";
import {
  IDEAS_SYSTEM, PICK_SYSTEM, STYLE_SYSTEM, addToBoard, addToStyle, createCache, ideasPrompt, normaliseCreator, normaliseOpenverse, normaliseReddit, parseIdeas,
  parsePicks, parseStyle, parseToolboxIds, MAX_BOARD, pickPrompt, rankByStyle, removeFromBoard, removeFromStyle, styledQuery, stylePrompt, urls,
  validateBoardItem, validateStyle, EMPTY_STYLE, type BoardItem, type Pick, type RefItem, type RefKind, type Style,
} from "./refs-pure";

// GAME DEV → Reference board, server half: web searches (all via safeFetch), AI pick/ideas, and the local moodboard
// stored in <ORBIT data dir>/refs.json (same pattern as life.ts).

export type Section = { kind: RefKind; items: RefItem[]; error?: string };
export type SearchResult = { query: string; sections: Section[] };

const TTL = 30 * 60_000;
const g = globalThis as unknown as { __orbitRefsCache?: ReturnType<typeof createCache<Section>>; __orbitRefsFails?: ReturnType<typeof createCache<Section>>; __orbitRefs?: Promise<unknown> };
const cache = (g.__orbitRefsCache ??= createCache<Section>(150, TTL));
const fails = (g.__orbitRefsFails ??= createCache<Section>(150, 60_000)); // a failed source is retried after 60 s, not on every search

// Reddit's API rules want "<platform>:<app id>:<version> (by …)"; one UA for every source keeps it simple.
const UA = "web:orbit:0.2 (personal game-dev reference tool)";
async function getJson(url: string): Promise<unknown> {
  const { res } = await safeFetch(url, "application/json", UA, 2_000_000);
  return res.json();
}

async function creator(q: string): Promise<RefItem[]> {
  const ids = parseToolboxIds(await getJson(urls.toolboxSearch(q)));
  if (!ids.length) return [];
  const [details, thumbs] = await Promise.all([getJson(urls.toolboxDetails(ids)), getJson(urls.thumbnails(ids)).catch(() => null)]);
  return normaliseCreator(ids, details, thumbs);
}
const SOURCES: Record<RefKind, (q: string) => Promise<RefItem[]>> = {
  creator,
  openverse: async (q) => normaliseOpenverse(await getJson(urls.openverse(q))),
  reddit: async (q) => normaliseReddit(await getJson(urls.reddit(q))),
};

/** All three sources in parallel; a failing source becomes { items: [], error }, remembered for 60 s.
 *  With style keywords: Openverse/Reddit queries get 1–2 appended; the Creator Store keyword stays raw (extra words hurt it) and is re-ranked instead. */
export async function searchRefs(query: string, keywords: string[] = []): Promise<SearchResult> {
  const sections = await Promise.all((Object.keys(SOURCES) as RefKind[]).map(async (kind): Promise<Section> => {
    const q = kind === "creator" ? query : styledQuery(query, keywords);
    const key = `${kind}:${q.toLowerCase()}`;
    const hit = cache.get(key, Date.now()) ?? fails.get(key, Date.now());
    if (hit) return kind === "creator" ? { ...hit, items: rankByStyle(hit.items, keywords) } : hit;
    try {
      const items = await SOURCES[kind](q);
      cache.set(key, { kind, items }, Date.now());
      return { kind, items: kind === "creator" ? rankByStyle(items, keywords) : items };
    } catch (e) {
      const s: Section = { kind, items: [], error: e instanceof Error ? e.message.slice(0, 160) : "Unavailable" };
      fails.set(key, s, Date.now());
      return s;
    }
  }));
  return { query, sections };
}

/** Search with the saved style's keywords when `styled` (the "Match my style" toggle) and a style exists. */
export async function searchStyled(query: string, styled: boolean): Promise<SearchResult> {
  return searchRefs(query, styled ? (await read()).style.keywords : []);
}

/** Top 3 for a Roblox build: the server re-reads its own (cached) results, so the client never supplies candidates. */
export async function pickBest(query: string, styled: boolean): Promise<Pick[]> {
  const { style } = await read();
  const items = (await searchRefs(query, styled ? style.keywords : [])).sections.flatMap((s) => s.items);
  if (!items.length) return [];
  const r = await askClaude(pickPrompt(query, items, style.summary), PICK_SYSTEM, { lane: "background", model: FAST_MODEL });
  return parsePicks(r.text, items.map((i) => i.id));
}

export async function brainstorm(query: string): Promise<string[]> {
  const r = await askClaude(ideasPrompt(query, (await read()).style.summary), IDEAS_SYSTEM, { lane: "background", model: FAST_MODEL });
  return parseIdeas(r.text);
}

/* ---------- moodboard file ---------- */

const MAX_FILE = 2_000_000;
const file = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "refs.json");
};

type State = { board: BoardItem[]; style: Style };

async function read(): Promise<State> {
  try {
    // Too big = hand-edited or broken: refuse (throwing also blocks writes) rather than parse it or overwrite it.
    if ((await stat(file())).size > MAX_FILE) throw new Error("The moodboard file is too large");
    const s = JSON.parse(await readFile(file(), "utf8"));
    return {
      board: Array.isArray(s.board) ? s.board.flatMap((b: unknown) => validateBoardItem(b) ?? []).slice(-MAX_BOARD) : [],
      style: validateStyle(s.style),
    };
  } catch (e) {
    // Only a missing file means empty; a locked/corrupt file must never be overwritten.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { board: [], style: EMPTY_STYLE };
    throw e;
  }
}
function update(fn: (s: State) => State): Promise<State> {
  const p = (g.__orbitRefs ?? Promise.resolve()).catch(() => {}).then(async () => {
    const state = fn(await read());
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(state, null, 2));
    await rename(file() + ".tmp", file());
    return state;
  });
  g.__orbitRefs = p;
  return p;
}

export const getBoard = (): Promise<State> => read();
export const saveToBoard = async (item: RefItem, word: string) => (await update((s) => ({ ...s, board: addToBoard(s.board, item, word, new Date()) }))).board;
export const removeBoardItem = async (id: string, word: string) => (await update((s) => ({ ...s, board: removeFromBoard(s.board, id, word) }))).board;

/* ---------- style lock ---------- */

const ids = (items: RefItem[]) => items.map((i) => i.id).join(",");
/** Lock/unlock an item, then re-summarise with AI. The item change is saved first, so an AI failure (busy) only leaves the old summary. */
export async function changeStyle(change: { add: RefItem } | { remove: string }): Promise<{ style: Style; error?: string }> {
  let full = false;
  const { style } = await update((s) => {
    const items = "add" in change ? addToStyle(s.style.items, change.add) : removeFromStyle(s.style.items, change.remove);
    if (!items) { full = true; return s; }
    return { ...s, style: items.length ? { ...s.style, items, updatedAt: new Date().toISOString() } : EMPTY_STYLE };
  });
  if (full) return { style, error: "Your style holds 5 items — remove one first." };
  if (!style.items.length) return { style };
  try {
    const r = await askClaude(stylePrompt(style.items), STYLE_SYSTEM, { lane: "background", model: FAST_MODEL });
    const parsed = parseStyle(r.text);
    if (!parsed) return { style, error: "The style summary didn't come back — edit it by hand or try again." };
    // Only store it if nothing changed meanwhile: a later item change brings its own summary, and a hand-edited summary (bumps updatedAt) wins.
    const saved = await update((s) => (ids(s.style.items) === ids(style.items) && s.style.updatedAt === style.updatedAt ? { ...s, style: { ...s.style, ...parsed, updatedAt: new Date().toISOString() } } : s));
    return { style: saved.style };
  } catch (e) {
    console.error("[orbit] refs style", e);
    return { style, error: "Couldn't write a style summary right now — edit it by hand or try again." };
  }
}

export const setStyleSummary = async (summary: string) =>
  (await update((s) => ({ ...s, style: { ...s.style, summary, updatedAt: new Date().toISOString() } }))).style;
