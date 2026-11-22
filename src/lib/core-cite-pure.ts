// Inline citations for a CORE answer, Claude-app style: every claim from the web, VAULT or memory gets a small number that opens
// its source (page, file, memory), numbered in reading order. Pure (server, tests, browser); no model call.
// Server (core.ts) → citeInfo(): which links CORE actually opened and what the local fact check (factcheck-pure.ts) said about the
// claims citing each one, plus the files it read. Saved on the answer's trace (step "cite"), so a reopened chat shows the same marks.
// Client → citeAnswer(): the answer text with [[cN]] markers and the numbered source list. A number gets "!" when its page doesn't
// back the claim, "?" when CORE never opened it this turn; in a turn that read the web, a sentence with figures but no source gets
// [[nosrc]] ("no source"). Private items never get here: journal/LIFE memories are never cited by title (core-used-pure redacts them).

export type Check = "backed" | "not_backed" | "contradicted" | "unchecked" | "unopened";
export type CiteInfo = { links: { u: string; v: Check }[]; files: { name: string; vault: boolean }[]; web: boolean };
export type Cite = { id: string; title: string; kind: string; at?: string };
export type SourceRef = { n: number; kind: "web" | "memory" | "week" | "file"; title: string; href?: string; id?: string; cite?: Cite; check?: Check };
export type Cited = { text: string; sources: SourceRef[] };

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;
const trimUrl = (u: string) => u.replace(/[.,;:!?*_]+$/, "");
/** Host without www + path without trailing slash (no query, no fragment): the same key factcheck-pure uses. "" when bad. */
export function linkKey(u: string): string {
  try {
    const x = new URL(trimUrl(u));
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(x.hostname)) return ""; // ORBIT's own pages, not sources
    return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`;
  } catch { return ""; }
}
const RANK: Record<Check, number> = { backed: 0, unchecked: 1, not_backed: 2, contradicted: 3, unopened: 4 };
const worst = (a: Check | undefined, b: Check): Check => (!a || RANK[b] > RANK[a] ? b : a);

/** Server side. claims/verdicts: the fact check's per-sentence results (sources = link keys); unseen: links no tool or context
 *  in this turn contained; files: VAULT files read (vault_read) and attached file names; web: the turn searched or opened pages. */
export function citeInfo(x: { answer: string; claims?: { key: number; sources: string[] }[]; verdicts?: Map<number, string>; unseen?: readonly string[]; files?: { name: string; vault: boolean }[]; web?: boolean }): CiteInfo {
  const by = new Map<string, Check>();
  for (const u of noCode(x.answer).match(URL_RE) ?? []) { const k = linkKey(u); if (k && !by.has(k)) by.set(k, "unchecked"); }
  for (const c of x.claims ?? []) {
    const v = x.verdicts?.get(c.key);
    const check: Check = v === "backed" || v === "not_backed" || v === "contradicted" ? v : "unchecked";
    for (const s of c.sources) if (by.has(s)) by.set(s, worst(by.get(s) === "unchecked" ? undefined : by.get(s), check));
  }
  for (const u of x.unseen ?? []) { const k = linkKey(u); if (by.has(k)) by.set(k, "unopened"); }
  const files = [...new Map((x.files ?? []).filter((f) => f.name).map((f) => [f.name, f])).values()].slice(0, 20);
  return { links: [...by].slice(0, 40).map(([u, v]) => ({ u, v })), files, web: !!x.web };
}

const noCode = (t: string) => t.replace(/```[\s\S]*?```/g, "");
// The end notes core.ts appends (unseenNote, fact check answerNote): with inline marks they say the same thing twice.
const NOTES = /\n\n_(?:Note: CORE didn't open |Fact check: |Faktikontroll: )[\s\S]*?\._(?=\n|$)/g;
export const stripNotes = (t: string) => t.replace(NOTES, "");

// One pass over the prose: memory [m:id], week [n] (already numbered by citeWeek), file [f:name], markdown links, bare/<> links.
const TOKEN = /\[m:([0-9a-f-]{36})\]|\[f:([^\]\n]{1,200})\]|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>()[\]"'`]+)|\[(\d{1,2})\]/gi;
// A sentence that states figures (numbers, money, percentages, years): the claims that most need a source.
const FIGURE = /\d[\d,.]*\s?(%|percent|€|\$|£|eur|usd|million|billion|bn|m\b|k\b)|[€$£]\s?\d|\b(19|20)\d{2}\b|\b\d{2,}\b/i;

export function citeAnswer(content: string, citations: readonly Cite[] = [], info?: CiteInfo | null): Cited {
  const text = info ? stripNotes(content) : content;
  const sources: SourceRef[] = [], at = new Map<string, number>();
  const checks = new Map((info?.links ?? []).map((l) => [l.u, l.v]));
  const files = new Map((info?.files ?? []).map((f) => [f.name, f]));
  const add = (key: string, make: (n: number) => SourceRef) => { let n = at.get(key); if (!n) { n = sources.length + 1; at.set(key, n); sources.push(make(n)); } return n; };
  const mark = (n: number) => { const c = sources[n - 1].check; return `[[c${n}${c === "not_backed" || c === "contradicted" ? "!" : c === "unopened" ? "?" : ""}]]`; };
  const web = (raw: string, label?: string) => {
    const u = trimUrl(raw), k = linkKey(u);
    if (!k) return null;
    const n = add(`w:${k}`, (n) => ({ n, kind: "web", title: label?.trim() || k.replace(/\/.*$/, ""), href: u, ...(checks.get(k) && { check: checks.get(k) }) }));
    return { n, tail: raw.slice(u.length) };
  };
  const prose = (s: string) => s.replace(TOKEN, (all, mem: string, file: string, label: string, mdUrl: string, angled: string, bare: string, num: string) => {
    if (mem) {
      const c = citations.find((x) => x.id.toLowerCase() === mem.toLowerCase());
      return c ? mark(add(`m:${c.id}`, (n) => ({ n, kind: c.kind.startsWith("week:") ? "week" : "memory", title: c.title, id: c.id, cite: c }))) : "";
    }
    if (file) {
      const f = files.get(file.trim());
      return f ? mark(add(`f:${f.name}`, (n) => ({ n, kind: "file", title: f.name, ...(f.vault && { href: `/api/vault?file=${encodeURIComponent(f.name)}&raw=1` }) }))) : file.trim();
    }
    if (mdUrl) { const w = web(mdUrl, label); return w ? `${label}${mark(w.n)}` : all; }
    if (angled || bare) { const w = web(angled || bare); return w ? `${mark(w.n)}${w.tail}` : all; }
    if (num) { // a week citation citeWeek already numbered: [k] = citations[k-1]
      const c = citations[Number(num) - 1];
      return c && c.kind.startsWith("week:") ? mark(add(`m:${c.id}`, (n) => ({ n, kind: "week", title: c.title, id: c.id, cite: c }))) : all;
    }
    return all;
  });
  // Code blocks stay as written; everything else gets markers, then (web turns only) the figures with no source get flagged.
  const out = text.split(/(```[\s\S]*?(?:```|$))/).map((part, i) => (i % 2 ? part : prose(part))).join("");
  return { text: info?.web ? flagUncited(out) : out, sources };
}

/** Sentences outside code, headings and tables that state figures and carry no [[c]] marker get " [[nosrc]]". */
export function flagUncited(text: string): string {
  return text.split(/(```[\s\S]*?(?:```|$))/).map((part, i) => i % 2 ? part : part.split("\n").map((line) => {
    const s = line.trim();
    if (!s || /^(#|\||>|_)/.test(s)) return line;
    return line.split(/(?<=[.!?])(\s+)/).map((seg) => {
      const bare = seg.replace(/\[\[c\d+[!?]?\]\]/g, "");
      if (seg.trim().length < 25 || /\[\[(c\d+|nosrc)/.test(seg) || !FIGURE.test(bare)) return seg;
      const end = seg.match(/[.!?:;]*\s*$/)!.index!;
      return `${seg.slice(0, end)} [[nosrc]]${seg.slice(end)}`;
    }).join("");
  }).join("\n")).join("");
}

/** The saved cite info off an answer's trace, or null (older answers). */
export function traceCite(trace: readonly { step: string; cite?: unknown }[] | undefined): CiteInfo | null {
  const c = (trace ?? []).find((s) => s.step === "cite")?.cite as CiteInfo | undefined;
  return c && Array.isArray(c.links) && Array.isArray(c.files) ? c : null;
}

/** One marker token for the renderer: number + flag, "nosrc", or null. */
export function parseMarker(tok: string): { n: number; flag: "" | "!" | "?" } | "nosrc" | null {
  if (tok === "[[nosrc]]") return "nosrc";
  const m = /^\[\[c(\d+)([!?]?)\]\]$/.exec(tok);
  return m ? { n: Number(m[1]), flag: m[2] as "" | "!" | "?" } : null;
}
export const MARKER_RE = /(\[\[c\d+[!?]?\]\]|\[\[nosrc\]\])/;
