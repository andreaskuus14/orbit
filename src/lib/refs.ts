import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeFetch } from "./memory";
import { askClaude, FAST_MODEL } from "./claude";
import {
  IDEAS_SYSTEM, PICK_SYSTEM, addToBoard, createCache, ideasPrompt, normaliseCreator, normaliseOpenverse, normaliseReddit, parseIdeas,
  parsePicks, parseToolboxIds, MAX_BOARD, pickPrompt, removeFromBoard, urls, validateBoardItem, type BoardItem, type Pick, type RefItem, type RefKind,
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

/** All three sources in parallel; a failing source becomes { items: [], error }, remembered for 60 s. */
export async function searchRefs(query: string): Promise<SearchResult> {
  const key = query.toLowerCase();
  const sections = await Promise.all((Object.keys(SOURCES) as RefKind[]).map(async (kind): Promise<Section> => {
    const hit = cache.get(`${kind}:${key}`, Date.now()) ?? fails.get(`${kind}:${key}`, Date.now());
    if (hit) return hit;
    try {
      const s: Section = { kind, items: await SOURCES[kind](query) };
      cache.set(`${kind}:${key}`, s, Date.now());
      return s;
    } catch (e) {
      const s: Section = { kind, items: [], error: e instanceof Error ? e.message.slice(0, 160) : "Unavailable" };
      fails.set(`${kind}:${key}`, s, Date.now());
      return s;
    }
  }));
  return { query, sections };
}

/** Top 3 for a Roblox build: the server re-reads its own (cached) results, so the client never supplies candidates. */
export async function pickBest(query: string): Promise<Pick[]> {
  const items = (await searchRefs(query)).sections.flatMap((s) => s.items);
  if (!items.length) return [];
  const r = await askClaude(pickPrompt(query, items), PICK_SYSTEM, { lane: "background", model: FAST_MODEL });
  return parsePicks(r.text, items.map((i) => i.id));
}

export async function brainstorm(query: string): Promise<string[]> {
  const r = await askClaude(ideasPrompt(query), IDEAS_SYSTEM, { lane: "background", model: FAST_MODEL });
  return parseIdeas(r.text);
}

/* ---------- moodboard file ---------- */

const MAX_FILE = 2_000_000;
const file = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "refs.json");
};

async function read(): Promise<BoardItem[]> {
  try {
    // Too big = hand-edited or broken: refuse (throwing also blocks writes) rather than parse it or overwrite it.
    if ((await stat(file())).size > MAX_FILE) throw new Error("The moodboard file is too large");
    const s = JSON.parse(await readFile(file(), "utf8"));
    return Array.isArray(s.board) ? s.board.flatMap((b: unknown) => validateBoardItem(b) ?? []).slice(-MAX_BOARD) : [];
  } catch (e) {
    // Only a missing file means empty; a locked/corrupt file must never be overwritten.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
function update(fn: (b: BoardItem[]) => BoardItem[]): Promise<BoardItem[]> {
  const p = (g.__orbitRefs ?? Promise.resolve()).catch(() => {}).then(async () => {
    const board = fn(await read());
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify({ board }, null, 2));
    await rename(file() + ".tmp", file());
    return board;
  });
  g.__orbitRefs = p;
  return p;
}

export const getBoard = (): Promise<BoardItem[]> => read();
export const saveToBoard = (item: RefItem, word: string) => update((b) => addToBoard(b, item, word, new Date()));
export const removeBoardItem = (id: string, word: string) => update((b) => removeFromBoard(b, id, word));
