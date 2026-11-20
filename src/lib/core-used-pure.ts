// "What I used" under a CORE answer: the memories, facts, files, modules/tools and web pages a turn drew on, as titles with age.
// Built only from data the turn already has (citations + trace + context refs); no model call. Private items (journal/LIFE
// memories, private module reads) never show a title or text: only "a private note". Pure: server, tests and browser.

export type UsedItem = { kind: "memory" | "file" | "tool" | "web" | "fact" | "private"; title?: string; n?: number; ageDays?: number };
export type Used = { items: UsedItem[]; shown: UsedItem[]; more: number };
type Cite = { id: string; title: string; kind: string; at?: string };
type Step = { step: string; ok?: boolean };
export type UsedExtras = {
  memories?: { id: string; title: string; kind: string; created_at?: string; updated_at?: string }[]; // everything that went into the prompt
  files?: string[]; // attached file names
  context?: ("facts" | "world" | "people")[]; // context blocks that were in the prompt
};

export const USED_CAP = 6;
const DAY = 86_400_000;
// Steps that are the engine's own bookkeeping, not something the answer drew on.
const META = new Set(["search_memory", "think", "review", "fallback", "reflex", "local", "verify", "error", "budget", "cancelled", "answer_eval", "sources", "route", "native", "receipt", "navigate", "used"]);
const PAGES = new Set(["fetch_url", "read_url"]), SEARCHES = new Set(["web_search", "read_news"]);
const isPrivateKind = (k: string) => /^(journal|life)/i.test(k);
const clip = (s: string, n: number) => { const x = s.replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const ageOf = (at: string | undefined, now: number) => { const t = at ? Date.parse(at) : NaN; return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : undefined; };

/** Attached file names out of CORE's attachment prompt block (names only, never the text). */
export function attachmentNames(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/<attachment name=("(?:[^"\\]|\\.)*")>/g)) { try { out.push(String(JSON.parse(m[1]))); } catch { /* skip */ } }
  const img = /Images attached to this message \(you can see them\): ([^\n]+)\./.exec(block);
  if (img) for (const m of img[1].matchAll(/"(?:[^"\\]|\\.)*"/g)) { try { out.push(String(JSON.parse(m[0]))); } catch { /* skip */ } }
  return out;
}

export function buildUsed(x: { citations?: Cite[]; trace?: Step[]; privateTools?: readonly string[]; extras?: UsedExtras; now?: number }): Used {
  const now = x.now ?? Date.now(), priv = new Set(x.privateTools ?? []);
  const items: UsedItem[] = [], seen = new Set<string>();
  let privateN = 0;
  const memory = (id: string, title: string, kind: string, at?: string) => {
    if (seen.has(id)) return; seen.add(id);
    if (isPrivateKind(kind)) { privateN++; return; }
    if (kind.startsWith("week:")) { items.push({ kind: "tool", title: "week_review" }); return; } // a week-review source: the module, not its text
    const ageDays = ageOf(at, now);
    items.push({ kind: "memory", title: clip(title, 48) || "memory", ...(ageDays !== undefined && { ageDays }) });
  };
  for (const c of x.citations ?? []) memory(c.id, c.title, c.kind, c.at); // cited ones first
  for (const m of x.extras?.memories ?? []) memory(m.id, m.title, m.kind, m.updated_at ?? m.created_at);
  // trace: private module reads, web pages/searches, other tools
  let pages = 0, searches = 0;
  const tools = new Map<string, number>();
  for (const s of x.trace ?? []) {
    if (s.ok === false || META.has(s.step)) continue;
    if (priv.has(s.step)) privateN++;
    else if (PAGES.has(s.step)) pages++;
    else if (SEARCHES.has(s.step)) searches++;
    else tools.set(s.step, (tools.get(s.step) ?? 0) + 1);
  }
  if (privateN) items.push({ kind: "private", n: privateN });
  for (const k of x.extras?.context ?? []) items.push({ kind: "fact", title: k });
  for (const f of [...new Set(x.extras?.files ?? [])]) items.push({ kind: "file", title: clip(f, 48) });
  for (const [name, n] of tools) if (!items.some((i) => i.kind === "tool" && i.title === name)) items.push({ kind: "tool", title: name, ...(n > 1 && { n }) });
  if (pages) items.push({ kind: "web", title: "pages", n: pages });
  if (searches) items.push({ kind: "web", title: "searches", n: searches });
  // "memory" items first, then the rest in order (private right after the memories, so it is never capped out of sight by tools)
  return { items, shown: items.slice(0, USED_CAP), more: Math.max(0, items.length - USED_CAP) };
}

type T = (key: string, vars?: Record<string, string | number>) => string;
/** One item as text: "memory: 'pet sim economy' · 12 d", "file: plan.pdf", "web: 3 pages", "a private note". */
export function usedItemText(i: UsedItem, t: T): string {
  if (i.kind === "private") return (i.n ?? 1) > 1 ? t("used.privateN", { n: i.n ?? 1 }) : t("used.private");
  if (i.kind === "memory") {
    const age = i.ageDays === undefined ? "" : ` · ${i.ageDays < 1 ? t("used.today") : t("used.days", { n: i.ageDays })}`;
    return `${t("used.memory")}: '${i.title}'${age}`;
  }
  if (i.kind === "file") return `${t("used.file")}: ${i.title}`;
  if (i.kind === "fact") return `${t("used.factLabel")}: ${t(`used.fact.${i.title}`)}`;
  if (i.kind === "web") { const n = i.n ?? 1; return t(i.title === "searches" ? (n === 1 ? "used.search1" : "used.searches") : (n === 1 ? "used.page1" : "used.pages"), { n }); }
  return `${t("used.tool")}: ${i.title!.replace(/_/g, " ")}${i.n ? ` ×${i.n}` : ""}`;
}
/** The compact line (≤6 items + "+N more"), or the full list when `full`. "" when there is nothing to show. */
export function usedLine(u: Used, t: T, full = false): string {
  const list = full ? u.items : u.shown;
  if (!list.length) return "";
  return list.map((i) => usedItemText(i, t)).join(" · ") + (!full && u.more ? ` · ${t("used.more", { n: u.more })}` : "");
}
