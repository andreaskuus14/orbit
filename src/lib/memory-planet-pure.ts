// MEMORY planet (the one-surface page): row normalisation, the ask box rule, status line, recent rows, topics and dates.
// No React, no Three. Every field of a row can be missing or the wrong type (#719 crashed on missing tags; a NULL inside a
// text[] crashed on startsWith): everything the UI reads goes through normStar / normMemory first.
// Journal rows are encrypted: the UI only ever shows "Journal entry" for them, never their text, title or tags.
import { isProvTag } from "./memory-capture-pure.ts";

export type Star = { id: string; title: string; kind: string; tags: string[]; folder: string | null; created_at: string | null; source: string | null; x: number; y: number; z: number };
export type Mem = { id: string; title: string; kind: string; content: string; tags: string[]; url: string | null; storage_path: string | null; created_at: string | null; updated_at: string | null; source: string; confirmation: string | null; recheck_at: string | null; locked: boolean };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** A date string the browser can read, else null (never "Invalid Date" on screen). */
export const isoOrNull = (v: unknown): string | null => { const s = str(v); return s && Number.isFinite(Date.parse(s)) ? s : null; };
/** Only real strings, trimmed, no empties, no duplicates (a text[] can hold NULL). */
export const cleanTagList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))] : []);
export const isJournal = (m: { kind?: unknown; locked?: unknown }) => m.kind === "journal" || m.locked === true;

/** One star from /api/memories/map, or null when it has no id. Journal stars keep no title or tags. */
export function normStar(r: unknown): Star | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>, id = str(o.id);
  if (!id) return null;
  const kind = str(o.kind) || "note", journal = kind === "journal";
  return { id, kind, title: journal ? "Journal entry" : (str(o.title)?.trim() || "Untitled"), tags: journal ? [] : cleanTagList(o.tags), folder: journal ? null : str(o.folder),
    created_at: isoOrNull(o.created_at), source: str(o.source), x: num(o.x), y: num(o.y), z: num(o.z) };
}

/** The map payload with every star normalised; links and edges that point at missing stars are dropped. */
export function normMap(raw: unknown) {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(o.items) ? o.items : []).map(normStar).filter((s): s is Star => !!s);
  const ids = new Set(items.map((m) => m.id));
  const links = (Array.isArray(o.links) ? o.links : []).filter((l): l is { from: string; to: string } => !!l && typeof l === "object" && ids.has((l as { from: string }).from) && ids.has((l as { to: string }).to));
  const n = items.length;
  const edges = (Array.isArray(o.edges) ? o.edges : []).filter((e): e is [number, number, number] =>
    Array.isArray(e) && Number.isInteger(e[0]) && Number.isInteger(e[1]) && e[0] >= 0 && e[1] >= 0 && e[0] < n && e[1] < n && Number.isFinite(e[2]));
  return { items, links, edges, total: typeof o.total === "number" ? o.total : n, graph: (o.graph ?? null) as unknown };
}

/** One full memory row (list, search, detail). Journal rows show only "Journal entry · day" and a fixed note. */
export function normMemory(r: unknown): Mem | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>, id = str(o.id);
  if (!id) return null;
  const kind = str(o.kind) || "note", created = isoOrNull(o.created_at), locked = kind === "journal" || o.locked === true;
  return {
    id, kind, locked,
    title: locked ? `Journal entry${created ? ` · ${created.slice(0, 10)}` : ""}` : (str(o.title)?.trim() || "Untitled"),
    content: locked ? "" : (str(o.content) ?? ""), tags: locked ? [] : cleanTagList(o.tags),
    url: locked ? null : str(o.url), storage_path: locked ? null : str(o.storage_path),
    created_at: created, updated_at: isoOrNull(o.updated_at), source: str(o.source) || "unknown",
    confirmation: str(o.confirmation), recheck_at: isoOrNull(o.recheck_at),
  };
}
export const normMemories = (v: unknown): Mem[] => (Array.isArray(v) ? v.map(normMemory).filter((m): m is Mem => !!m) : []);

/** Tags worth showing: no provenance (fp:, via:…), no scope: (shown as the project), never on a journal row. */
export const shownTags = (m: { tags: string[]; kind?: string; locked?: boolean }) => (isJournal(m) ? [] : m.tags.filter((t) => !isProvTag(t) && !t.startsWith("scope:")));

/** "remember …" in the ask box saves; anything else searches. EN + ET, with or without "that"/"et" and a colon. */
export function parseAsk(text: string): { kind: "remember"; content: string } | { kind: "search"; q: string } | null {
  const t = text.trim();
  if (!t) return null;
  const rx = /^(?:please\s+)?(?:remember|note down)(?:\s+that)?\s*[:,-]?\s+(.+)$/is, ex = /^(?:palun\s+)?(?:pea\s+meeles|jäta\s+meelde)(?:\s*,?\s*et)?\s*[:,-]?\s+(.+)$/is;
  const hit = t.match(rx) ?? t.match(ex);
  if (hit && hit[1].trim()) { const c = hit[1].trim(); return { kind: "remember", content: c.charAt(0).toLocaleUpperCase() + c.slice(1) }; }
  return { kind: "search", q: t.slice(0, 500) };
}

/** A short title for a saved sentence: first line, at most 80 characters, cut at a word. */
export function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0].trim();
  if (line.length <= 80) return line;
  const cut = line.slice(0, 80), sp = cut.lastIndexOf(" ");
  return `${(sp > 40 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Comma-separated tags from a text field (same rules as cleanTags on the server: trimmed, no empties, no repeats, ≤ 20). */
export const tagsFromText = (s: string) => cleanTagList(s.split(",")).slice(0, 20);

const t = (m: { created_at: string | null }) => (m.created_at ? Date.parse(m.created_at) : -Infinity);
/** Newest first; rows without a date go last (stable). */
export function newestFirst<T extends { created_at: string | null }>(xs: T[]): T[] {
  return xs.map((m, i) => ({ m, i })).sort((a, b) => t(b.m) - t(a.m) || a.i - b.i).map((x) => x.m);
}

/** Counts for the status line: all memories and how many were saved today (local day). */
export function counts(items: { created_at: string | null }[], now = Date.now()) {
  const d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { n: items.length, today: items.reduce((s, m) => s + (t(m) >= start && t(m) <= now + 60_000 ? 1 : 0), 0) };
}

/** Up to k topics for the suggestion chips: the most used tags and projects on non-journal memories. */
export function topTopics(items: { tags: string[]; kind: string; folder?: string | null }[], k = 3): string[] {
  const n = new Map<string, number>();
  for (const m of items) {
    if (m.kind === "journal") continue;
    const names = new Set<string>();
    for (const tag of m.tags) { if (isProvTag(tag) || tag === "superseded" || tag === "journal") continue; names.add((tag.startsWith("scope:") ? tag.slice(6) : tag).toLowerCase()); }
    if (m.folder) names.add(m.folder.toLowerCase());
    for (const x of names) if (x.length >= 2 && x.length <= 32) n.set(x, (n.get(x) ?? 0) + 1);
  }
  return [...n].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([x]) => x);
}

/** "Today" / "Yesterday" / weekday this week / "14 Nov" / "14 Nov 2025"; "" without a date. lang decides the words. */
export function dayLabel(iso: string | null, lang: "en" | "et", now = Date.now()): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const d = new Date(now), start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const loc = lang === "et" ? "et-EE" : "en-GB";
  if (at >= start) return lang === "et" ? "Täna" : "Today";
  if (at >= start - 86_400_000) return lang === "et" ? "Eile" : "Yesterday";
  if (at >= start - 6 * 86_400_000) { const w = new Date(at).toLocaleDateString(loc, { weekday: "long" }); return w.charAt(0).toUpperCase() + w.slice(1); }
  const sameYear = new Date(at).getFullYear() === d.getFullYear();
  return new Date(at).toLocaleDateString(loc, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** How long a delete waits for Undo before it is sent (the toast with a button stays 6 s + reading time). */
export const UNDO_MS = 7000;

/** Rows minus the ones waiting to be deleted (the undo window). */
export const withoutPending = <T extends { id: string }>(xs: T[], pending: ReadonlySet<string>) => (pending.size ? xs.filter((m) => !pending.has(m.id)) : xs);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** POST /api/links body → two different memory ids (uuids only: they go into a PostgREST filter), else null. */
export function linkPair(b: unknown): { from: string; to: string } | null {
  if (!b || typeof b !== "object") return null;
  const { from, to } = b as Record<string, unknown>;
  return typeof from === "string" && typeof to === "string" && UUID.test(from) && UUID.test(to) && from.toLowerCase() !== to.toLowerCase() ? { from, to } : null;
}

/** The map's colour per kind: the row dot and the star share it, so the colour means "this kind" in both places. */
export const KIND_COLOR: Record<string, string> = {
  note: "#9ec9ff", idea: "#ffd27a", link: "#7de3d0", document: "#c3b4ff", image: "#ff9ec7", research: "#7dc4ff",
  conversation: "#b8f0a8", project: "#ffb27a", preference: "#f0a8ff", decision: "#ff8f8f", goal: "#fff3a8",
};
export const kindColor = (k: string) => KIND_COLOR[k] ?? "#a9b4c8";

/** "10:24" (24 h, the owner's locale either way); "" without a date. */
export function timeLabel(iso: string | null, lang: "en" | "et"): string {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? new Date(at).toLocaleTimeString(lang === "et" ? "et-EE" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
}

/** The list grouped by day, newest first as given: Today / Yesterday / "Mon 20 Jan" (+ year when not this year); undated last. */
export function groupByDay<T extends { created_at: string | null }>(xs: T[], lang: "en" | "et", now = Date.now()): { key: string; label: string; items: T[] }[] {
  const out: { key: string; label: string; items: T[] }[] = [], loc = lang === "et" ? "et-EE" : "en-GB", d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  for (const m of xs) {
    const at = m.created_at ? Date.parse(m.created_at) : NaN;
    let key = "none", label = lang === "et" ? "Kuupäevata" : "No date";
    if (Number.isFinite(at)) {
      const day = new Date(at); key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      label = at >= start ? (lang === "et" ? "Täna" : "Today") : at >= start - 86_400_000 ? (lang === "et" ? "Eile" : "Yesterday")
        : day.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", ...(day.getFullYear() === d.getFullYear() ? {} : { year: "numeric" }) });
    }
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(m); else out.push({ key, label: label.charAt(0).toUpperCase() + label.slice(1), items: [m] });
  }
  return out;
}

/** Tags with how many memories carry them (projects from scope: count as tags), most used first; never journal or provenance. */
export function tagCounts(items: { tags: string[]; kind: string }[]): [string, number][] {
  const n = new Map<string, number>();
  for (const m of items) {
    if (m.kind === "journal") continue;
    for (const tag of new Set(m.tags.map((x) => (x.startsWith("scope:") ? x.slice(6) : x)))) if (tag && !isProvTag(tag) && tag !== "superseded") n.set(tag, (n.get(tag) ?? 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
