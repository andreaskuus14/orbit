// Dependency-free logic, unit-tested in tests/pure.test.ts (node --test).
// Keep this file free of imports and non-erasable TS syntax.

/** Reciprocal-rank fusion of several ranked id lists (e.g. full-text + semantic). */
export function rrfMerge(lists: string[][], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const citeRe = (prefix: string) => new RegExp(`\\[${prefix}:${UUID}\\]`, "gi");

/** Ids cited as [m:<uuid>] (memories) or [a:<uuid>] (articles), in first-cited order, deduped. */
export function parseCitations(text: string, prefix = "m"): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(citeRe(prefix))) {
    const id = m[1].toLowerCase();
    if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}

/** Replace [m:<uuid>] markers with [n] where n is the 1-based citation number; unknown ids are removed. */
export function numberCitations(text: string, ids: string[], prefix = "m"): string {
  return text.replace(citeRe(prefix), (_, id: string) => {
    const n = ids.indexOf(id.toLowerCase());
    return n === -1 ? "" : `[${n + 1}]`;
  });
}

// USD per million tokens, from https://platform.claude.com/docs/en/models/overview (Oct 2026).
// shortcut: Haiku is listed "from" $0.10/$0.50, so its cost may be under-reported; verify on the pricing page.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

/** Cost in USD, or null if the model's price is unknown (so callers can flag it rather than record $0). */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (SSRF guard). */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  let v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  try { v6 = new URL(`http://[${v6}]`).hostname.slice(1, -1); } catch { return true; } // canonical form; unparsable (zone ids too) fails closed
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6); // IPv4-mapped in hex form (::ffff:7f00:1)
  if (mapped) { const [h, l] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)]; return isPrivateIp(`${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`); }
  return (
    v6 === "::" || v6 === "::1" ||
    v6.startsWith("64:ff9b:") || // NAT64 (64:ff9b::/96, and the local-use 64:ff9b:1::/48): reaches any IPv4, private ones too
    v6.startsWith("2002:") || // 6to4: embeds an IPv4 address
    /^::(?:[0-9a-f]{1,4}:)?[0-9a-f]{1,4}$/.test(v6) || // deprecated IPv4-compatible ::a.b.c.d
    v6.startsWith("fc") || v6.startsWith("fd") || // unique local
    v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || // link-local
    v6.startsWith("ff") // multicast
  );
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Crude readable-text extraction from HTML for link capture. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title: title.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e]), text };
}

/** Normalise user-entered tags: lowercase, trimmed, unique, max 20 of max 40 chars. */
export function cleanTags(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase().replace(/^#/, "").slice(0, 40);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 20);
}

/** Return a trimmed string within [min,max] chars, or null if invalid. */
export function str(v: unknown, max: number, min = 0): string | null {
  if (typeof v !== "string") return min === 0 && v == null ? "" : null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
}

/** Full-text query where ANY word may match ("what did I save about pets" → "what or did or i or save or about or pets"). */
export function toOrQuery(q: string): string {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 30).join(" or ");
}

/* ---------------- news (Phase 2) ---------------- */

export type FeedItem = { title: string; url: string; published: string | null; summary: string; source: string | null };

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return null;
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}

// Feeds often entity-escape their HTML ("&lt;p&gt;"), so decode once, then strip tags.
const plain = (html: string) =>
  htmlToText(`<p>${html.replace(/&(lt|gt|amp|quot|#39);/g, (_, e: string) => ENTITIES[e])}</p>`).text.replace(/\s+/g, " ").trim();

/** Parse RSS 2.0 or Atom into items. Tolerant: skips items without a title or link. */
export function parseFeed(xml: string): { title: string; items: FeedItem[] } {
  const atom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const head = xml.slice(0, xml.search(atom ? /<entry[\s>]/i : /<item[\s>]/i) >>> 0 || xml.length);
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const title = plain(tag(b, "title") ?? "");
    let url = atom
      ? (b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i) ?? b.match(/<link[^>]*href=["']([^"']+)/i))?.[1] ?? ""
      : (tag(b, "link") ?? b.match(/<guid[^>]*isPermaLink=["']true["'][^>]*>([^<]+)/i)?.[1] ?? "");
    url = url.replace(/&amp;/g, "&").trim();
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const published = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const summary = plain(tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "").slice(0, 600);
    const source = tag(b, "source");
    items.push({ title, url, published: published && !isNaN(Date.parse(published)) ? new Date(published).toISOString() : null, summary, source: source ? plain(source) : null });
  }
  return { title: plain(tag(head, "title") ?? ""), items };
}

/** Canonical form for de-duplication: no tracking params, fragment or trailing slash. */
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|ocid$)/i.test(k)) url.searchParams.delete(k);
    url.hostname = url.hostname.replace(/^www\./, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

const STOP = new Set("the a an and or of to in on for with at by from as is are was were be been it its this that these those after over into about new says say said will can could how why what who when than more amid".split(" "));
const tokens = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));

function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/** Greedy grouping of headlines about the same event. Largest, most recent groups first. */
export function clusterArticles<T extends { title: string; published_at: string | null }>(items: T[], threshold = 0.3): T[][] {
  const groups: { toks: Set<string>; items: T[] }[] = [];
  for (const it of items) {
    const t = tokens(it.title);
    const g = groups.find((x) => jaccard(x.toks, t) >= threshold);
    if (g) { g.items.push(it); for (const w of t) g.toks.add(w); } else groups.push({ toks: t, items: [it] });
  }
  const newest = (g: T[]) => Math.max(...g.map((i) => (i.published_at ? Date.parse(i.published_at) : 0)));
  return groups.map((g) => g.items).sort((a, b) => b.length - a.length || newest(b) - newest(a));
}

export type BriefingKind = "morning" | "midday" | "evening" | "weekly";
export const SLOTS: { kind: BriefingKind; hour: number; minute: number; weekday?: number }[] = [
  { kind: "morning", hour: 7, minute: 30 },
  { kind: "midday", hour: 12, minute: 30 },
  { kind: "evening", hour: 19, minute: 0 },
  { kind: "weekly", hour: 18, minute: 30, weekday: 0 }, // Sunday
];

/** Most recent scheduled time for a slot at or before `now` (local time). */
export function lastSlotTime(slot: (typeof SLOTS)[number], now: Date): Date {
  const d = new Date(now);
  d.setHours(slot.hour, slot.minute, 0, 0);
  if (slot.weekday === undefined) { if (d > now) d.setDate(d.getDate() - 1); return d; }
  d.setDate(d.getDate() - ((d.getDay() - slot.weekday + 7) % 7));
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}

/** Slots whose latest time has passed (within `graceHours`) with no briefing since. Catches up if the PC was asleep. */
export function dueSlots(now: Date, lastRun: Partial<Record<BriefingKind, string>>, graceHours = 4): BriefingKind[] {
  return SLOTS.filter((s) => {
    const t = lastSlotTime(s, now);
    if (now.getTime() - t.getTime() > graceHours * 3600_000) return false;
    const last = lastRun[s.kind];
    return !last || Date.parse(last) < t.getTime();
  }).map((s) => s.kind);
}

/* ---------------- agents (Phase 3) ---------------- */

export type AgentStep = { thought: string; tool?: string; input?: Record<string, unknown>; final?: string; garbled?: true };

/** Read one agent reply. Agents must answer with a single JSON object; anything unparseable counts as a final answer. */
export function parseAgentReply(text: string): AgentStep {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const j = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
      const thought = typeof j.thought === "string" ? j.thought : "";
      if (typeof j.tool === "string" && j.tool) {
        const input = j.input && typeof j.input === "object" && !Array.isArray(j.input) ? (j.input as Record<string, unknown>) : {};
        return { thought, tool: j.tool, input };
      }
      if (typeof j.final === "string") return { thought, final: j.final };
    } catch {
      /* fall through: treat as plain answer */
    }
  }
  // The model sometimes writes its native XML tool-call syntax instead of our JSON: run the first call, don't show it.
  const call = /<invoke name="([\w.-]+)">([\s\S]*?)(?:<\/invoke>|$)/.exec(t);
  if (call) {
    const input: Record<string, unknown> = {};
    for (const m of call[2].matchAll(/<parameter name="([\w.-]+)">([\s\S]*?)<\/parameter>/g)) input[m[1]] = m[2].trim();
    return { thought: t.slice(0, call.index).replace(/<\/?function_calls>/g, "").trim(), tool: call[1], input };
  }
  // Native tool-call markup with nothing runnable left in it (the CLI blanks those to <invoke_placeholder>): never an answer.
  if (/<invoke[\s_>]|<\/?function_calls>/.test(t)) return { thought: "", garbled: true };
  return { thought: "", final: text.trim() };
}

/** URL-safe agent id from a display name ("Market Scout!" → "market-scout"). */
/** read_news "hours": 1-48, or 0 (no/invalid/≤0 value) for the default 7-day search. */
export function newsHours(v: unknown): number {
  const h = Math.round(Number(v) || 0);
  return h > 0 ? Math.min(48, h) : 0;
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 40);
}

/** Old-style Google News article ids embed the publisher URL in base64; newer ids ("AU_yqL…") need Google's API. */
export function decodeGoogleNewsId(id: string): { url: string | null; needsApi: boolean } {
  let raw = "";
  try {
    raw = atob(id.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(id.length / 4) * 4, "="));
  } catch {
    return { url: null, needsApi: true };
  }
  if (raw.includes("AU_yqL")) return { url: null, needsApi: true };
  const m = raw.match(/https?:\/\/[\x21-\x7e]+/);
  return m ? { url: m[0].replace(/[\x00-\x20]+$/, ""), needsApi: false } : { url: null, needsApi: true };
}

/** Main story text of a news page: prefers <article>/<main>, drops short boilerplate lines (menus, captions, buttons). */
export function extractArticle(html: string, maxChars = 4000): { title: string; text: string } {
  const pick = html.match(/<article[\s>][\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s>][\s\S]*?<\/main>/i)?.[0] ?? html;
  const title = htmlToText(html.slice(0, 20_000)).title;
  const lines = htmlToText(pick).text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 60);
  return { title, text: lines.join("\n").slice(0, maxChars) };
}

/* ---------------- automations (Phase 3) ---------------- */

export type Schedule = { every: "hour" | "day" | "week"; hour?: number; minute?: number; weekday?: number };
export type AutomationSpec = {
  name: string; trigger: "schedule" | "event"; schedule: Schedule | null;
  event: "memory.created" | "briefing.ready" | null; kind_filter: string | null; agent: string; prompt: string;
};
export const AUTOMATION_EVENTS = ["memory.created", "briefing.ready"] as const;

/** Validate untrusted automation input (from the UI or from the Flow agent). Returns an error message or the clean spec. */
export function validateAutomation(i: Record<string, unknown>): { error: string } | { spec: AutomationSpec } {
  const name = typeof i.name === "string" ? i.name.trim().slice(0, 100) : "";
  const prompt = typeof i.prompt === "string" ? i.prompt.trim().slice(0, 4000) : "";
  const agent = typeof i.agent === "string" && /^[a-z0-9-]{2,40}$/.test(i.agent) ? i.agent : "nova";
  if (!name) return { error: "Give the automation a name" };
  if (prompt.length < 5) return { error: "Describe what should happen" };
  if (i.trigger === "event") {
    const event = AUTOMATION_EVENTS.find((e) => e === i.event);
    if (!event) return { error: `Event must be one of: ${AUTOMATION_EVENTS.join(", ")}` };
    const kind = typeof i.kind_filter === "string" && /^[a-z]{2,20}$/.test(i.kind_filter) ? i.kind_filter : null;
    return { spec: { name, trigger: "event", schedule: null, event, kind_filter: event === "memory.created" ? kind : null, agent, prompt } };
  }
  const s = (i.schedule && typeof i.schedule === "object" ? i.schedule : {}) as Record<string, unknown>;
  const every = s.every === "hour" || s.every === "week" ? s.every : s.every === "day" ? "day" : null;
  if (!every) return { error: "Schedule must repeat every hour, day or week" };
  const int = (v: unknown, lo: number, hi: number, d: number) => {
    const n = typeof v === "string" && v.trim() ? Number(v) : v; // agents sometimes send "18" instead of 18
    return Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi ? (n as number) : d;
  };
  const schedule: Schedule = { every, minute: int(s.minute, 0, 59, 0) };
  if (every !== "hour") schedule.hour = int(s.hour, 0, 23, 9);
  if (every === "week") schedule.weekday = int(s.weekday, 0, 6, 0);
  return { spec: { name, trigger: "schedule", schedule, event: null, kind_filter: null, agent, prompt } };
}

/** Most recent time the schedule was due at or before `now` (local time). */
export function lastDue(s: Schedule, now: Date): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(s.minute ?? 0);
  if (s.every === "hour") { if (d > now) d.setHours(d.getHours() - 1); return d; }
  d.setHours(s.hour ?? 9);
  if (s.every === "day") { if (d > now) d.setDate(d.getDate() - 1); return d; }
  d.setDate(d.getDate() - ((d.getDay() - (s.weekday ?? 0) + 7) % 7));
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}

/** Should a scheduled automation run now? Once per slot, never for slots before it existed, catch-up within a grace window. */
export function automationDue(s: Schedule, lastRun: string | null, createdAt: string, now: Date): boolean {
  const slot = lastDue(s, now);
  const grace = (s.every === "hour" ? 0.5 : 3) * 3600_000;
  if (now.getTime() - slot.getTime() > grace) return false;
  if (slot.getTime() < Date.parse(createdAt)) return false;
  return !lastRun || Date.parse(lastRun) < slot.getTime();
}

/** Human description of a trigger, e.g. "Every Sunday at 18:00". */
export function describeTrigger(a: Pick<AutomationSpec, "trigger" | "schedule" | "event" | "kind_filter">): string {
  if (a.trigger === "event") return a.event === "briefing.ready" ? "When a new briefing is ready" : `When you save ${a.kind_filter ? `a ${a.kind_filter}` : "a memory"}`;
  const s = a.schedule!;
  const t = `${String(s.hour ?? 0).padStart(2, "0")}:${String(s.minute ?? 0).padStart(2, "0")}`;
  if (s.every === "hour") return `Every hour at :${String(s.minute ?? 0).padStart(2, "0")}`;
  if (s.every === "day") return `Every day at ${t}`;
  return `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.weekday ?? 0]} at ${t}`;
}

/** Headline-like links on a page (anchor text of 25+ chars), absolute and de-duplicated. For index/front pages. */
export function extractLinks(html: string, baseUrl: string, max = 25): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ");
  for (const m of body.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = htmlToText(`<p>${m[2]}</p>`).text.replace(/\s+/g, " ").trim();
    if (text.length < 25 || text.length > 200) continue;
    let url: string;
    try { url = new URL(m[1].replace(/&amp;/g, "&"), baseUrl).toString(); } catch { continue; }
    if (!/^https?:/.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ text, url });
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------- network hardening (SSRF, size caps, concurrency) ---------------- */

/** The address to connect to after DNS: refuses empty answers and any private/internal address (a host that
 *  resolves to even one private IP is refused, so round-robin rebinding can't slip one in). */
export function pickPublicAddress<A extends { address: string; family: number }>(addrs: A[]): A {
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("That address is not publicly reachable");
  return addrs[0];
}

/** Only plain http(s) URLs may be fetched; returns the URL for chaining. */
export function assertHttpUrl(url: URL): URL {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) links are allowed");
  return url;
}

/** The next URL when a response is a redirect (null when it isn't). The caller re-validates it like the first. */
export function redirectTarget(status: number, location: string | null | undefined, base: URL): URL | null {
  if (status < 300 || status >= 400 || !location) return null;
  return assertHttpUrl(new URL(location, base));
}

/** Read at most `max` bytes from a byte stream, then stop reading (breaking out cancels/destroys the source). */
export async function readCapped(source: AsyncIterable<Uint8Array>, max: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of source) {
    const room = max - size;
    if (chunk.length >= room) {
      chunks.push(chunk.subarray(0, room));
      size += room;
      truncated = chunk.length > room;
      break;
    }
    chunks.push(chunk);
    size += chunk.length;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  return { bytes, truncated };
}

/** At most `max` calls of `run(fn)` in flight; the rest wait in order. Aborting `signal` while queued gives up the place. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    if (active < max) active++;
    else {
      await new Promise<void>((resolve, reject) => {
        const go = () => { signal?.removeEventListener("abort", stop); resolve(); };
        const stop = () => { const i = queue.indexOf(go); if (i >= 0) queue.splice(i, 1); reject(signal?.reason); };
        queue.push(go);
        signal?.addEventListener("abort", stop, { once: true });
      });
    }
    try { return await fn(); }
    finally {
      const next = queue.shift(); // hand the slot straight over, so a newcomer can't jump in between
      if (next) next(); else active--;
    }
  };
}

/** Tools whose results are the user's private data (memory, activity). */
export const PRIVATE_TOOLS = new Set(["search_memory", "recent_memories", "list_tasks", "orbit_stats", "vault_search", "vault_read", "vault_skill"]);
/** After a tool ran: mark private data in context, and remember the links the news tools returned. */
export function noteToolResult(ctx: { priv?: boolean; links?: Set<string> }, tool: string, out: string) {
  if (PRIVATE_TOOLS.has(tool)) ctx.priv = true;
  if (tool === "news_search" || tool === "read_news" || tool === "web_search") for (const m of out.matchAll(/https?:\/\/[^\s)\]>"]+/g)) (ctx.links ??= new Set()).add(m[0]);
}
