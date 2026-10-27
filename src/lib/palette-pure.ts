// Command palette ranking. Pure (no DOM) — tested in tests/palette.test.ts.
export const PALETTE_EVENT = "orbit:palette";
/** detail: { id: string } — open that memory in MEMORY. */
export const OPEN_MEMORY_EVENT = "orbit:open-memory";

/** Lowercase, strip diacritics ("Õhtu" → "ohtu"). */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** 0 = no match. prefix (4) > word start (3) > substring (2) > subsequence (1) > every word matches in any order (0.5);
 *  shorter labels win ties slightly. */
export function score(query: string, label: string): number {
  const q = fold(query).trim().replace(/\s+/g, " ");
  if (!q) return 1;
  const l = fold(label), s = single(q, l);
  if (s || !q.includes(" ")) return s;
  // "clips studio" → "STUDIO · Clips"
  return q.split(" ").every((w) => single(w, l) > 0) ? 0.5 + 0.5 / (1 + l.length) : 0;
}

function single(q: string, l: string): number {
  const tie = 1 / (1 + l.length); // < 1, so it never crosses a tier
  if (l.startsWith(q)) return 4 + tie;
  const at = l.indexOf(q);
  if (at > 0 && /[^\p{L}\p{N}]/u.test(l[at - 1])) return 3 + tie;
  if (at >= 0) {
    // a later occurrence may still start a word ("go to memory" for "mem" after an earlier "mem" inside a word)
    if (l.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 3 + tie;
    return 2 + tie;
  }
  let i = 0;
  for (const ch of l) if (ch === q[i]) i++;
  return i === q.length ? 1 + tie : 0;
}

/** Items matching the query, best first (stable for equal scores). keywords count as extra labels; ids in `recent` get a
 *  small boost (0.4, under one tier) so what he used lately wins among equally good matches. */
export function rank<T extends { id?: string; label: string; keywords?: string }>(query: string, items: T[], recent: string[] = []): T[] {
  return items
    .map((it, i) => ({ it, i, s: Math.max(score(query, it.label), it.keywords ? score(query, it.keywords) * 0.99 : 0) }))
    .filter((x) => x.s > 0)
    .map((x) => (x.it.id && recent.includes(x.it.id) ? { ...x, s: x.s + 0.4 } : x))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.it);
}

export type Recent = { id: string; label: string; hint?: string };
/** Most recent first, de-duplicated by id, capped. */
export function pushRecent(list: Recent[], r: Recent, max = 8): Recent[] {
  return [r, ...list.filter((x) => x.id !== r.id)].slice(0, max);
}
/** Stored recents (JSON). Old builds stored bare ids: those keep their id and get a label from `labelOf` (or are dropped). */
export function parseRecent(raw: string | null, labelOf: (id: string) => string | undefined): Recent[] {
  let v: unknown;
  try { v = JSON.parse(raw || "[]"); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: Recent[] = [];
  for (const x of v) {
    const r = typeof x === "string" ? { id: x, label: labelOf(x) } : x && typeof x === "object" ? (x as Record<string, unknown>) : null;
    if (r && typeof r.id === "string" && typeof r.label === "string" && r.label) out.push({ id: r.id, label: r.label, ...(typeof r.hint === "string" ? { hint: r.hint } : {}) });
  }
  return out;
}

/** /api/business body → business names and the people to contact there, for searching in the palette. */
export function prospectRows(body: unknown): { prospects: Recent[]; people: Recent[] } {
  const arr = (body as { prospects?: unknown } | null)?.prospects;
  const prospects: Recent[] = [], people: Recent[] = [];
  if (!Array.isArray(arr)) return { prospects, people };
  for (const p of arr) {
    const o = (p ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string" || !o.name) continue;
    prospects.push({ id: o.id, label: o.name, hint: typeof o.stage === "string" ? `BUSINESS · ${o.stage}` : "BUSINESS" });
    if (typeof o.contact === "string" && o.contact.trim()) people.push({ id: o.id, label: o.contact.trim(), hint: o.name });
  }
  return { prospects, people };
}

/** Pull {id, title} rows out of an API body that may be an array or {results|files|items: [...]}. */
export function rowsOf(body: unknown, max = 6): { id: string; title: string }[] {
  const b = body as Record<string, unknown> | unknown[] | null;
  const arr = Array.isArray(b) ? b : b && typeof b === "object" ? (b.results ?? b.files ?? b.items) : null;
  if (!Array.isArray(arr)) return [];
  const out: { id: string; title: string }[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = o.id ?? o.path ?? o.name, title = o.title ?? o.name ?? o.path;
    if ((typeof id === "string" || typeof id === "number") && typeof title === "string" && title) out.push({ id: String(id), title });
    if (out.length >= max) break;
  }
  return out;
}
