// "Search everything" (GET /api/search, Warp palette): one query over memories, journal, vault notes/files, CORE chats,
// agent tasks and goals. Each source keeps its own search (memory: hybrid FTS+embeddings; the rest: text), and its own
// ranked list goes into reciprocal-rank fusion here, plus a small recency and exact-title boost. Owner-only, never sent to a model.
import { rrfMerge } from "./pure.ts";
import type { NavTarget } from "./nav-pure.ts";

export type SearchSource = "memory" | "journal" | "note" | "file" | "chat" | "task" | "goal";
export const SOURCES: readonly SearchSource[] = ["memory", "journal", "note", "file", "chat", "task", "goal"];
/** Where Enter goes: the palette maps each to an existing nav event (OPEN_MEMORY_EVENT, OPEN_SOURCE_EVENT, NAV_EVENT). */
export type OpenTarget = { memory: string } | { goal: string } | { task: string } | { chat: string } | { nav: NavTarget };
export type SearchHit = { source: SearchSource; id: string; title: string; snippet: string; at?: string; open: OpenTarget };
export type RankedHit = SearchHit & { score: number };

const DAY = 86_400_000;
export const RECENCY_MAX = 0.004; // ≈ 15 rank places near the top of RRF: orders the sources' equally ranked hits, never beats an exact title
export const EXACT_BOOST = 0.05, PREFIX_BOOST = 0.01; // an exact title beats any rank; a title containing the query gets a nudge

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** 0..RECENCY_MAX, halving every 30 days; unknown dates get nothing. */
export function recency(at: string | undefined, now: number): number {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return 0;
  return RECENCY_MAX * 0.5 ** (Math.max(0, now - t) / (30 * DAY));
}
export function titleBoost(title: string, q: string): number {
  const a = norm(title), b = norm(q);
  if (!b) return 0;
  return a === b ? EXACT_BOOST : a.includes(b) ? PREFIX_BOOST : 0;
}

/** lists: one per source, each already in that source's best-first order. Same source+id twice counts once. */
export function rankHits(lists: SearchHit[][], q: string, now: number, limit = 40): RankedHit[] {
  const key = (h: SearchHit) => `${h.source}:${h.id}`;
  const byKey = new Map<string, SearchHit>();
  for (const l of lists) for (const h of l) if (!byKey.has(key(h))) byKey.set(key(h), h);
  return rrfMerge(lists.map((l) => [...new Set(l.map(key))]))
    .map(({ id, score }) => { const h = byKey.get(id)!; return { ...h, score: score + recency(h.at, now) + titleBoost(h.title, q) }; })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Best-first hits grouped by source (groups ordered by their best hit), at most `per` each. */
export function groupHits(hits: RankedHit[], per = 4): { source: SearchSource; hits: RankedHit[] }[] {
  const g = new Map<SearchSource, RankedHit[]>();
  for (const h of hits) { const l = g.get(h.source) ?? []; if (l.length < per) l.push(h); g.set(h.source, l); }
  return [...g].map(([source, hits]) => ({ source, hits }));
}

/** ~140 chars around the first hit of the query (or of its longest word); else the start of the text. */
export function snip(text: string, q: string, len = 140): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const low = t.toLowerCase();
  const words = [q, ...q.split(/\s+/).sort((a, b) => b.length - a.length)].map((w) => w.toLowerCase()).filter((w) => w.length > 1);
  const i = words.map((w) => low.indexOf(w)).find((x) => x >= 0) ?? -1;
  const s = i < 0 ? 0 : Math.max(0, i - 40);
  return (s > 0 ? "…" : "") + t.slice(s, s + len) + (s + len < t.length ? "…" : "");
}

/** A user string as a literal ILIKE pattern (%, _ and \ escaped), or null when too short to search. */
export function likePattern(q: string): string | null {
  const t = q.trim().slice(0, 200);
  return t.length < 2 ? null : `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** LIFE journal (date → text) matches, newest first: every query word must appear. */
export function journalHits(journal: Record<string, string>, q: string, limit = 8): SearchHit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return Object.entries(journal)
    .filter(([, text]) => typeof text === "string" && words.every((w) => text.toLowerCase().includes(w)))
    .sort(([a], [b]) => b.localeCompare(a)).slice(0, limit)
    .map(([date, text]) => ({ source: "journal", id: date, title: date, snippet: snip(text, q), at: date, open: { nav: { panel: "life", life: "journal" } } }));
}

const NOTE = /\.(md|markdown|txt)$/i;
export const vaultSource = (name: string): SearchSource => (NOTE.test(name) ? "note" : "file");
