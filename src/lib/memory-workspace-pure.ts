// MEMORY workspace (MEM01/MEM02), pure: why a search result matched, the filters, projects and what the inspector shows.
// Runs in the browser on rows the owner already loaded; nothing here calls a model. Tested in tests/memory-workspace.test.ts.
import { memoryType, scopeOfRecord, type MemoryType, type Typed } from "./memory-types-pure.ts";
import { snip } from "./search-pure.ts";

export type Mem = Typed & { id: string; title: string; content: string; tags: string[]; url?: string | null; storage_path?: string | null };
export type Why = { by: "title" | "tag" | "content" | "meaning"; passage: string };
export type Filters = { project: string; type: "" | MemoryType; scope: "" | "global" | "chat" | "project"; from: string; to: string };
export const NO_FILTERS: Filters = { project: "", type: "", scope: "", from: "", to: "" };

const words = (q: string) => q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
const has = (text: string, q: string) => { const l = text.toLowerCase(); return l.includes(q.toLowerCase()) || words(q).some((w) => l.includes(w)); };

/** Why a result came back: the exact place the words appear, else the server's meaning (embedding) match. */
export function whyMatched(m: Mem, q: string): Why {
  const query = q.trim();
  if (query && has(m.content, query)) return { by: has(m.title, query) ? "title" : "content", passage: snip(m.content, query) };
  if (query && has(m.title, query)) return { by: "title", passage: m.title };
  const tag = query ? m.tags.find((t) => has(t, query)) : undefined;
  if (tag) return { by: "tag", passage: `#${tag}` };
  return { by: "meaning", passage: snip(m.content, "") };
}

/** The project a memory belongs to: its "scope:" tag, else its folder. */
export const projectOf = (m: Typed) => (m.tags ?? []).find((t) => t.startsWith("scope:"))?.slice(6) || m.folder || null;

export function projects(items: Mem[]): { name: string; items: Mem[] }[] {
  const by = new Map<string, Mem[]>();
  for (const m of items) { const p = projectOf(m); if (p) by.set(p, [...(by.get(p) ?? []), m]); }
  return [...by].map(([name, items]) => ({ name, items })).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

/** Dates are YYYY-MM-DD and inclusive; "to" covers that whole day. */
export function applyFilters<T extends Mem>(items: T[], f: Filters): T[] {
  const from = f.from ? Date.parse(f.from) : -Infinity, to = f.to ? Date.parse(f.to) + 86_400_000 : Infinity;
  return items.filter((m) => {
    const at = Date.parse(m.created_at);
    return (!f.project || projectOf(m) === f.project) && (!f.type || memoryType(m) === f.type)
      && (!f.scope || scopeOfRecord(m).kind === f.scope) && !(at < from) && !(at >= to);
  });
}

export type Inspect = {
  source: string; capturedAt: string; stated: "stated" | "inferred" | "observed" | "history"; type: MemoryType;
  scope: { kind: "global" | "chat" | "project"; where: string | null; expiresAt: number | null };
  link: { url: string | null; file: boolean; missing: boolean };
};
const FILE_SOURCES = new Set(["upload", "document"]);

/** The inspector card. `missing` = the memory says it came from a file/link but none is stored any more. */
export function inspect(m: Mem): Inspect {
  const type = memoryType(m), s = scopeOfRecord(m);
  const file = !!m.storage_path, url = m.url || null;
  return {
    source: m.source || "unknown", capturedAt: m.created_at, type,
    stated: type === "inferred" ? "inferred" : type === "observation" ? "observed" : type === "superseded" ? "history" : "stated",
    scope: { kind: s.kind, where: s.kind === "project" ? s.project ?? null : s.kind === "chat" ? s.chat ?? null : null, expiresAt: s.expiresAt },
    link: { url, file, missing: !file && !url && (FILE_SOURCES.has(m.source ?? "") || m.kind === "document" || m.kind === "image" || m.kind === "link") },
  };
}
