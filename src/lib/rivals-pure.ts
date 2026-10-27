// BUSINESS competitor watch ("Rivals"): for each kept niche, up to 5 public competitor pages, read weekly, read-only.
// Pure: URL checks, robots.txt, item/price extraction (JSON-LD Product/Offer first), week-over-week diff, report lines.
// IO: rivals.ts (store <ORBIT data dir>/business/rivals.json, last 8 weeks). Tested in tests/rivals.test.ts.
import { marginOf, normUrl, type Margin } from "./niche-pure.ts";

export type RivalItem = { title: string; price?: number; currency?: string; url?: string };
export type RivalSnap = { url: string; items: RivalItem[]; error?: string };
export type RivalStore = { urls: Record<string, string[]>; weeks: { at: string; niches: Record<string, RivalSnap[]> }[]; // urls and week.niches keyed by niche id
  lastAttempt?: string; lastOk?: string; lastError?: string };

export const MAX_RIVALS = 5, KEEP_WEEKS = 8, MAX_ITEMS = 60;

/** The owner's list for one niche: public http(s) links only, deduped, at most 5; else the reason. */
export function checkRivalUrls(v: unknown): string[] | string {
  if (!Array.isArray(v)) return "urls must be a list";
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const u = normUrl(raw.trim());
    if (!u) return `Not a web link: ${raw.slice(0, 80)}`;
    const p = new URL(u);
    if (p.username || p.password) return "Links with a login in them aren't allowed";
    if (!out.includes(u)) out.push(u);
  }
  return out.length > MAX_RIVALS ? `At most ${MAX_RIVALS} competitor links per niche` : out;
}

/* robots.txt: the group for our agent token (else "*"), longest matching rule wins, Allow wins a tie. */
export function robotsAllows(txt: string, pathAndQuery: string, agent = "orbit"): boolean {
  type Rule = { allow: boolean; pat: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  for (const line of txt.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2];
    if (key === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && cur) cur.rules.push({ allow: key === "allow", pat: val });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules).filter((r) => r.pat);
  let best: Rule | null = null;
  for (const r of rules) {
    const re = new RegExp("^" + r.pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (!re.test(pathAndQuery)) continue;
    if (!best || r.pat.length > best.pat.length || (r.pat.length === best.pat.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

/* ---- Extraction ---- */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const clean = (s: unknown, max = 140) => typeof s === "string"
  ? s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => ENT[e.toLowerCase()] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : m))
    .replace(/<[^>]*>/g, "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** "1,299.00", "12,99", 19 → a number, or undefined. */
export function priceNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[^\d.,]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.299,00 / 12,99
  else s = s.replace(/,/g, "");
  return priceNum(s ? Number(s) : NaN);
}

const types = (o: Record<string, unknown>) => ([] as unknown[]).concat(o["@type"] ?? []).map(String);
const abs = (u: unknown, base: string) => { try { return typeof u === "string" && u ? new URL(u, base).href : undefined; } catch { return undefined; } };

function offerOf(o: unknown): { price?: number; currency?: string } {
  const offers = ([] as unknown[]).concat(o ?? []);
  for (const x of offers) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>, spec = (r.priceSpecification ?? {}) as Record<string, unknown>;
    const price = priceNum(r.price) ?? priceNum(r.lowPrice) ?? priceNum(spec.price);
    if (price !== undefined) return { price, currency: clean(r.priceCurrency ?? spec.priceCurrency, 3).toUpperCase() || undefined };
  }
  return {};
}

/** JSON-LD Product (and ProductGroup, ItemList, @graph) → items. */
export function jsonLdItems(html: string, base: string): RivalItem[] {
  const out: RivalItem[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const o = v as Record<string, unknown>, t = types(o);
    if (t.some((x) => /^(Product|ProductGroup|IndividualProduct)$/.test(x))) {
      const title = clean(o.name);
      let { price, currency } = offerOf(o.offers);
      if (price === undefined && Array.isArray(o.hasVariant)) for (const h of o.hasVariant) { ({ price, currency } = offerOf((h as Record<string, unknown>)?.offers)); if (price !== undefined) break; }
      if (title) out.push({ title, price, currency, url: abs(o.url, base) });
      return;
    }
    for (const k of ["@graph", "itemListElement", "item", "mainEntity"]) walk(o[k], depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim()), 0); } catch { /* a broken block is skipped */ }
  }
  return out;
}

const meta = (html: string, prop: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[.:]/g, "\\$&")}["'][^>]*>`, "i"), tag = html.match(re)?.[0];
  return tag ? clean(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
};

/** A single product page's OpenGraph/product meta (og:title + product:price:amount), when there's no JSON-LD. */
export function metaItems(html: string, base: string): RivalItem[] {
  const price = priceNum(meta(html, "product:price:amount") || meta(html, "og:price:amount"));
  const title = meta(html, "og:title");
  return title && price !== undefined ? [{ title, price, currency: (meta(html, "product:price:currency") || meta(html, "og:price:currency")).toUpperCase() || undefined, url: abs(meta(html, "og:url"), base) ?? base }] : [];
}

/** A YouTube channel's videos page: titles from the embedded page data (no prices). */
export function youtubeItems(html: string): RivalItem[] {
  const out: RivalItem[] = [];
  for (const m of html.matchAll(/"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/g)) {
    try { const title = clean(JSON.parse(`"${m[1]}"`)); if (title) out.push({ title }); } catch { /* skip */ }
  }
  return out;
}

const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Every item on a page: JSON-LD first, then product meta, then YouTube; deduped by title, capped. */
export function extractItems(html: string, base: string): RivalItem[] {
  let items = jsonLdItems(html, base);
  if (!items.length) items = metaItems(html, base);
  if (!items.length && /youtube\.com$/i.test(new URL(base).hostname)) items = youtubeItems(html);
  const seen = new Set<string>();
  return items.filter((i) => { const k = key(i.title); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_ITEMS);
}

/* ---- Diff + report ---- */

export type PriceMove = { title: string; from: number; to: number; currency?: string; url: string };
export type RivalDiff = { added: (RivalItem & { from: string })[]; removed: number; moves: PriceMove[] };

/** This week vs the previous snapshot of the same URL (a failed read on either side is not a change). */
export function diffSnaps(prev: RivalSnap[] | undefined, cur: RivalSnap[]): RivalDiff {
  const d: RivalDiff = { added: [], removed: 0, moves: [] };
  for (const s of cur) {
    const p = prev?.find((x) => x.url === s.url);
    if (!p || p.error || s.error) continue; // first week, or one side unreadable: nothing to compare
    const old = new Map(p.items.map((i) => [key(i.title), i]));
    const now = new Set(s.items.map((i) => key(i.title)));
    for (const i of s.items) {
      const o = old.get(key(i.title));
      if (!o) d.added.push({ ...i, from: s.url });
      else if (o.price !== undefined && i.price !== undefined && o.price !== i.price && (o.currency ?? "") === (i.currency ?? ""))
        d.moves.push({ title: i.title, from: o.price, to: i.price, currency: i.currency, url: s.url });
    }
    d.removed += p.items.filter((i) => !now.has(key(i.title))).length;
  }
  return d;
}

const money = (n: number, c?: string) => (!c || c === "EUR" ? `€${n.toFixed(2)}` : `${n.toFixed(2)} ${c}`);
const isEur = (i: { currency?: string }) => !i.currency || i.currency === "EUR";
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export type RivalReport = { nicheId: string; title: string; lines: string[]; added: number; moves: number; failed: number; pages: number };

/** One niche's Rivals section: new products, price moves and what they mean for his margin (niche-pure marginOf). */
export function rivalReport(n: { id: string; title: string; margin: Margin }, cur: RivalSnap[], prev?: RivalSnap[]): RivalReport {
  const d = diffSnaps(prev, cur), lines: string[] = [];
  const failed = cur.filter((s) => s.error);
  const priced = cur.flatMap((s) => (s.error ? [] : s.items)).filter((i) => i.price !== undefined && isEur(i)).map((i) => i.price!);
  const mine = marginOf(n.margin);
  if (d.added.length) lines.push(`${d.added.length} new product${d.added.length > 1 ? "s" : ""}: ${d.added.slice(0, 4).map((i) => `${i.title}${i.price !== undefined ? ` (${money(i.price, i.currency)})` : ""} at ${host(i.from)}`).join("; ")}${d.added.length > 4 ? "; …" : ""}`);
  for (const m of d.moves.slice(0, 5)) {
    const pct = Math.round(((m.to - m.from) / m.from) * 100);
    let line = `${m.title} at ${host(m.url)}: ${money(m.from, m.currency)} → ${money(m.to, m.currency)} (${pct > 0 ? "+" : ""}${pct}%)`;
    if (isEur(m) && m.to < n.margin.price) { const at = marginOf({ ...n.margin, price: m.to }); line += `; matching it would leave you ${money(at.unit)} (${at.pct}%) per order instead of ${money(mine.unit)}`; }
    lines.push(line);
  }
  if (priced.length) {
    const med = Math.round(median(priced) * 100) / 100, at = marginOf({ ...n.margin, price: med });
    const where = med < n.margin.price ? `below your ${money(n.margin.price)}: at their price you'd keep ${money(at.unit)} (${at.pct}%) per order` : `at or above your ${money(n.margin.price)}: room to hold your price (${money(mine.unit)}, ${mine.pct}% per order)`;
    lines.push(`Rivals' median price ${money(med)} over ${priced.length} product${priced.length > 1 ? "s" : ""}, ${where}`);
  }
  if (prev && !d.added.length && !d.moves.length && cur.some((s) => !s.error)) lines.push("No new products or price moves since last week");
  if (!prev) lines.push("First snapshot: changes show from next week");
  if (failed.length) lines.push(`Couldn't read ${failed.map((s) => `${host(s.url)} (${s.error})`).join(", ")}`);
  return { nicheId: n.id, title: n.title, lines, added: d.added.length, moves: d.moves.length, failed: failed.length, pages: cur.length };
}

/** The night report line for the whole watch. */
export function rivalsLine(r: RivalReport[]): string {
  const added = r.reduce((s, x) => s + x.added, 0), moves = r.reduce((s, x) => s + x.moves, 0), pages = r.reduce((s, x) => s + x.pages - x.failed, 0);
  const what = [added && `${added} new product${added > 1 ? "s" : ""}`, moves && `${moves} price move${moves > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "no changes";
  return `Rivals: ${what} across ${pages} competitor page${pages === 1 ? "" : "s"}`;
}

/** Store with the new week on top, last 8 weeks kept. */
export const addWeek = (s: RivalStore, at: string, niches: Record<string, RivalSnap[]>): RivalStore =>
  ({ ...s, weeks: [{ at, niches }, ...s.weeks].slice(0, KEEP_WEEKS) });

/** The latest week and the one before it, per niche (the previous week that has this niche). */
export function latestPair(s: RivalStore, nicheId: string): { cur?: RivalSnap[]; prev?: RivalSnap[]; at?: string } {
  const i = s.weeks.findIndex((w) => w.niches[nicheId]);
  if (i < 0) return {};
  const j = s.weeks.findIndex((w, k) => k > i && w.niches[nicheId]);
  return { cur: s.weeks[i].niches[nicheId], prev: j < 0 ? undefined : s.weeks[j].niches[nicheId], at: s.weeks[i].at };
}

export const parseRivalStore = (raw: string): RivalStore => {
  if (!raw.trim()) return { urls: {}, weeks: [] };
  const s = JSON.parse(raw) as RivalStore; // a broken file throws instead of being reset
  if (!s || typeof s.urls !== "object" || !Array.isArray(s.weeks)) throw new Error("rivals.json is unreadable");
  return s;
};
