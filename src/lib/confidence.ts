// Deterministic half of research verification: source independence, claim labels, overall confidence and
// tolerant parsing of the model's JSON. Pure (no I/O) so it is unit-tested; the AI/fetch half is verify.ts.

export type Label = "Confirmed" | "Single source" | "Disputed" | "Unverified";
export type Level = "high" | "medium" | "low";
export type Claim = { claim: string; sources: string[] };
export type Verdict = { claim: number; supports: number[]; contradicts: number[] };
export type Counts = Record<Label, number>;

// shortcut: tiny public-suffix list, not the full PSL; add entries (or use a PSL package) if odd domains get merged wrongly.
const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "gov.au", "co.nz", "co.jp", "ne.jp", "or.jp",
  "com.br", "com.cn", "com.hk", "com.sg", "com.tr", "com.mx", "co.in", "co.za", "co.kr", "com.ar", "com.tw",
]);

/** Registrable domain ("www.bbc.co.uk/news" → "bbc.co.uk"); null for anything that isn't an http(s) URL. */
export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch { return null; }
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  const parts = host.split(".");
  const n = TWO_PART_SUFFIXES.has(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/** Number of independent sources: distinct registrable domains. */
export function independentCount(urls: string[]): number {
  return new Set(urls.map(registrableDomain).filter((d): d is string => !!d)).size;
}

/** Label for one claim from the source URLs that support and contradict it. */
export function labelFor(supporting: string[], contradicting: string[]): Label {
  if (independentCount(contradicting) > 0) return "Disputed";
  const n = independentCount(supporting);
  return n >= 2 ? "Confirmed" : n === 1 ? "Single source" : "Unverified";
}

export function countLabels(labels: Label[]): Counts {
  const c: Counts = { Confirmed: 0, "Single source": 0, Disputed: 0, Unverified: 0 };
  for (const l of labels) c[l]++;
  return c;
}

/** Overall level: high = mostly confirmed and nothing disputed; low = notable disputes or mostly unsupported. */
export function overallConfidence(c: Counts): Level {
  const n = c.Confirmed + c["Single source"] + c.Disputed + c.Unverified;
  if (!n) return "low";
  if (c.Disputed / n > 0.25 || (c.Confirmed + c["Single source"]) / n < 0.5) return "low";
  if (c.Disputed === 0 && c.Confirmed / n >= 0.6) return "high";
  return "medium";
}

export function confidenceLine(c: Counts): string {
  return `Confidence: ${overallConfidence(c)} — ${c.Confirmed} confirmed, ${c["Single source"]} single source, ${c.Disputed} disputed, ${c.Unverified} unverified`;
}

/** First JSON array in a model reply (code fences, prose or a {"claims": [...]} wrapper tolerated); [] on garbage. */
export function parseJsonArray(text: string): unknown[] {
  const t = text.replace(/```(?:json)?/gi, "");
  const tryParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  const arr = a !== -1 && b > a ? tryParse(t.slice(a, b + 1)) : undefined;
  if (Array.isArray(arr)) return arr;
  const o = t.indexOf("{"), p = t.lastIndexOf("}");
  const obj = o !== -1 && p > o ? tryParse(t.slice(o, p + 1)) : undefined;
  if (obj && typeof obj === "object") {
    const inner = Object.values(obj as Record<string, unknown>).find(Array.isArray);
    if (inner) return inner as unknown[];
  }
  return [];
}

const isUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\/\S+$/i.test(u.trim());

/** Claims from the extraction reply: each a non-empty sentence plus the http(s) URLs it relied on. */
export function parseClaims(text: string, max = 8): Claim[] {
  const out: Claim[] = [];
  for (const x of parseJsonArray(text)) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const claim = typeof r.claim === "string" ? r.claim : typeof r.text === "string" ? r.text : "";
    if (!claim.trim()) continue;
    const raw = Array.isArray(r.sources) ? r.sources : Array.isArray(r.urls) ? r.urls : [];
    out.push({ claim: claim.trim().slice(0, 400), sources: [...new Set(raw.filter(isUrl).map((u) => u.trim()))].slice(0, 5) });
    if (out.length >= max) break;
  }
  return out;
}

const nums = (v: unknown, max: number) =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= max))] : [];

/** Per-claim verdicts (1-based claim and source numbers); out-of-range numbers are dropped. */
export function parseVerdicts(text: string, claims: number, sources: number): Verdict[] {
  const out: Verdict[] = [];
  for (const x of parseJsonArray(text)) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const claim = Number(r.claim);
    if (!Number.isInteger(claim) || claim < 1 || claim > claims || out.some((v) => v.claim === claim)) continue;
    out.push({ claim, supports: nums(r.supports, sources), contradicts: nums(r.contradicts, sources) });
  }
  return out;
}
