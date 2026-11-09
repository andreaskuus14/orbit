// Which web links in a CORE answer CORE can't show it read: a link that no tool result, memory, attachment or chat text in
// this turn's prompt contained. Those are marked in the answer instead of passing as sources. Tests: tests/core-sources.test.ts.
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;
const trim = (u: string) => u.replace(/[.,;:!?*_]+$/, "");

/** Host without www (lowercase) + path without trailing slash + query; no fragment. "" for a bad or local URL. */
export function normUrl(u: string): string {
  try {
    const x = new URL(trim(u));
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return ""; // ORBIT's own pages, not sources
    return `${host}${x.port ? `:${x.port}` : ""}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch { return ""; }
}

/** Distinct links in `answer` (in order) that appear in none of `seen`. */
export function unseenLinks(answer: string, seen: readonly string[]): string[] {
  const known = new Set(seen.flatMap((t) => t.match(URL_RE) ?? []).map(normUrl));
  const out = new Map<string, string>();
  for (const u of answer.match(URL_RE) ?? []) { const n = normUrl(u); if (n && !known.has(n) && !out.has(n)) out.set(n, trim(u)); }
  return [...out.values()];
}

/** Distinct external links cited in `answer`. */
export const citedLinks = (answer: string): number => new Set((answer.match(URL_RE) ?? []).map(normUrl).filter(Boolean)).size;

/** The note appended to the answer: names up to 5 unchecked links. */
export function unseenNote(urls: readonly string[]): string {
  if (!urls.length) return "";
  const one = urls.length === 1;
  return `\n\n_Note: CORE didn't open ${one ? "this source" : `these ${urls.length} sources`} this turn, so ${one ? "it is" : "they are"} unchecked: ${urls.slice(0, 5).map((u) => `<${u}>`).join(", ")}${urls.length > 5 ? ", …" : ""}._`;
}
