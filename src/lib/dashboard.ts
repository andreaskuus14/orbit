// Pure helpers for the country dashboard on the news globe: everything here is computed from real headlines.
import { importance } from "./geo.ts";

type S = { title: string; source: string | null; published_at: string | null; countries?: string[]; score?: number };

/** Headline volume over time: 2-hour buckets for the last day, or daily buckets for the last week when coverage is older. */
export function newsFlow(stories: S[], now = Date.now()) {
  const ages = stories.map((s) => (s.published_at ? (now - Date.parse(s.published_at)) / 3600_000 : NaN)).filter((h) => h >= 0);
  const recent = ages.filter((h) => h < 24).length;
  const daily = ages.length > 0 && recent / ages.length < 0.7;
  const n = daily ? 7 : 12, span = daily ? 24 : 2;
  const counts = new Array(n).fill(0);
  for (const h of ages) { const i = Math.floor(h / span); if (i < n) counts[n - 1 - i]++; }
  const labels = counts.map((_, i) => (daily ? `${n - 1 - i}d` : `${(n - 1 - i) * span}h`));
  return { counts, labels, unit: daily ? "per day · last 7 days" : "per 2 h · last 24 h" };
}

/** How heavy the coverage is: share of MAJOR and KEY stories. */
export function severity(stories: S[]) {
  let major = 0, key = 0;
  for (const s of stories) { const v = s.score ?? importance(s.title); if (v >= 3) major++; else if (v >= 2) key++; }
  const total = stories.length;
  return { major, key, total, pct: total ? Math.round(((major + key * 0.5) / total) * 100) : 0 };
}

/** Most-cited outlets. */
export function topSources(stories: S[], max = 5) {
  const m = new Map<string, number>();
  for (const s of stories) { const k = (s.source ?? "Unknown").replace(/\s+-\s+.*$/, "").trim() || "Unknown"; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name, n]) => ({ name, n }));
}

/** Other countries that appear in the same headlines. */
export function linkedCountries(stories: S[], self: string, max = 6) {
  const m = new Map<string, number>();
  for (const s of stories) for (const c of s.countries ?? []) if (c !== self) m.set(c, (m.get(c) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name, n]) => ({ name, n }));
}

/** 68_350_000 → "68.4M", 3.1e12 → "3.1T". */
export function compact(v: number) {
  const a = Math.abs(v);
  for (const [d, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) if (a >= d) return `${(v / d).toFixed(a / d >= 100 ? 0 : 1)}${u}`;
  return v.toFixed(a < 10 ? 1 : 0);
}

const TOPICS: [string, string][] = [
  ["Conflict", "war|strike|missile|drone|troops|attack|killed|ceasefire|military|shelling|bomb|army|invasion|hostage|soldier|navy|weapon|terror|shooting|raid|airstrike|frontline|warship|nuclear"],
  ["Politics", "election|minister|parliament|president|vote|party|government|sanction|summit|diplomat|senate|congress|pm|mp|councillor|labour|tory|conservative|reform|policy|law|bill|referendum|campaign|leader|king|royal|white house|kremlin|regime|opposition"],
  ["Economy", "economy|inflation|market|stock|bank|rates|trade|tariff|jobs|gdp|oil prices|budget|recession|investor|price|cost|fee|charge|tax|wage|pay|business|compan(?:y|ie)|industry|sector|airline|energy|housing|mortgage|debt|profit|deal|ceo|billion|million"],
  ["Tech", "ai|tech|software|cyber|chip|startup|openai|starlink|robot|app|internet|data|satellite|space|nasa|smartphone|google|apple|microsoft|meta"],
  ["Climate", "climate|flood|wildfire|storm|drought|earthquake|heatwave|emission|hurricane|typhoon|weather|heat|rain|snow|environment|pollution|wildlife"],
  ["Health", "health|virus|outbreak|hospital|vaccine|disease|cancer|covid|nhs|doctor|patient|medical|drug|mental health"],
  ["Society", "court|police|protest|school|crime|migrant|culture|sport|football|trial|arrest|book|film|music|art|festival|church|famil(?:y|ie)|child|children|racist|racism|women|celebrit(?:y|ie)|actor|author|award|education|universit(?:y|ie)|student"],
].map(([name, w]) => [name, `\\b(?:${w})(?:s|es)?\\b`]);

/** One best topic per story (most keyword hits, earlier group wins ties); unmatched → "Other". */
export function topics(stories: { title: string; summary?: string | null }[]) {
  const m = new Map<string, number>();
  for (const s of stories) {
    const text = `${s.title} ${s.summary ?? ""}`;
    let best = "Other", hits = 0;
    for (const [name, re] of TOPICS) { const n = text.match(new RegExp(re, "gi"))?.length ?? 0; if (n > hits) { best = name; hits = n; } }
    m.set(best, (m.get(best) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
}

/** Headline key: no " - Source" suffix, straight quotes, no punctuation, single spaces. */
const norm = (t: string) => t.replace(/\s+[-|–—]\s+(?:[^\s-|–—]+\s?){1,5}$/, "").toLowerCase().replace(/[‘’‚‛]/g, "'").replace(/[“”„]/g, '"')
  .replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

/** Drops near-duplicate headlines, keeping the first (best-ranked) one. */
export function dedupe<T extends { title: string; url?: string }>(stories: T[]): T[] {
  const kept: { url?: string; key: string }[] = [];
  return stories.filter((s) => {
    const key = norm(s.title);
    const dup = kept.some((k) => (s.url && k.url === s.url) || k.key === key ||
      (Math.min(k.key.length, key.length) >= 30 && (k.key.includes(key) || key.includes(k.key))));
    if (!dup) kept.push({ url: s.url, key });
    return !dup;
  });
}
