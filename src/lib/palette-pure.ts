// Command palette ranking. Pure (no DOM) — tested in tests/palette.test.ts.
export const PALETTE_EVENT = "orbit:palette";
/** detail: { id: string } — open that memory in MEMORY. */
export const OPEN_MEMORY_EVENT = "orbit:open-memory";

/** Lowercase, strip diacritics ("Õhtu" → "ohtu"). */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** 0 = no match. prefix (4) > word start (3) > substring (2) > subsequence (1); shorter labels win ties slightly. */
export function score(query: string, label: string): number {
  const q = fold(query).trim();
  if (!q) return 1;
  const l = fold(label);
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

/** Items matching the query, best first (stable for equal scores). keywords count as extra labels. */
export function rank<T extends { label: string; keywords?: string }>(query: string, items: T[]): T[] {
  return items
    .map((it, i) => ({ it, i, s: Math.max(score(query, it.label), it.keywords ? score(query, it.keywords) * 0.99 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.it);
}

/** Most recent first, de-duplicated by id, capped. */
export function pushRecent(list: string[], id: string, max = 6): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
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
