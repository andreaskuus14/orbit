// INTELLIGENCE evidence layer (INT01-07), pure and tested in tests/news-intel.test.ts. Server store: news-intel.ts.
import { clusterArticles, normalizeUrl } from "./pure.ts";
import { normUrl, type Check } from "./mission-checks-pure.ts";

export type Art = { id: string; title: string; url: string; source: string | null; summary?: string; topic?: string | null; published_at: string | null };

// ---------- INT01: events ----------
const norm = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
/** Title without a trailing " - Outlet" / " | Outlet" tag, normalized. */
export const titleKey = (t: string) => norm(t.replace(/\s+[-|–—]\s+[^-|–—]{2,40}$/, ""));
/** Content fingerprint of the summary; null when too short to identify a copy. */
export const contentKey = (s?: string) => { const n = norm(s ?? ""); return n.length >= 80 ? n.slice(0, 200) : null; };

/** Group articles into events: exact URL, title or content matches merge first (deterministic), then headline similarity. */
export function clusterEvents<T extends Art>(items: T[]): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map<string, number>();
  items.forEach((a, i) => {
    for (const k of [`u:${normalizeUrl(a.url)}`, `t:${titleKey(a.title)}`, contentKey(a.summary) && `c:${contentKey(a.summary)}`]) {
      if (!k) continue;
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i); else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, T[]>();
  items.forEach((a, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), a]); });
  // Similarity pass on one representative per exact group, then expand back.
  const reps = [...groups.values()].map((g) => ({ ...g[0], members: g }));
  return clusterArticles(reps).map((c) => c.flatMap((r) => r.members))
    .sort((a, b) => independentSources(b) - independentSources(a) || b.length - a.length);
}

/** Syndicated copies (same headline or same text) count once, whatever outlet republished them. */
export function independentSources(group: Art[]): number {
  const origins = new Map<string, string>(); // copy key -> origin id
  let n = 0;
  for (const a of group) {
    const keys = [`t:${titleKey(a.title)}`, contentKey(a.summary) && `c:${contentKey(a.summary)}`].filter(Boolean) as string[];
    if (keys.some((k) => origins.has(k))) { keys.forEach((k) => origins.set(k, "x")); continue; }
    keys.forEach((k) => origins.set(k, a.id)); n++;
  }
  return n;
}

/** Stable id for an event: its earliest article's URL. Revision changes when a new independent source or newer article arrives. */
export function eventKey(group: Art[]): string {
  const first = [...group].sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? "") || a.url.localeCompare(b.url))[0];
  return normalizeUrl(first.url);
}
export const eventRev = (group: Art[]) =>
  `${independentSources(group)}:${group.reduce((m, a) => (a.published_at && a.published_at > m ? a.published_at : m), "")}`;

// ---------- INT02: what changed since the last acknowledged briefing ----------
export type Status = "new" | "corrected" | "resolved";
const RESOLVED = /\b(resolved|ends?|ended|over|lifted|released|freed|agreed|deal reached|reopen(s|ed)?|lõpp|leping)\b/i;
/** Developments to show: new events, and known events with a newer revision (resolved if the headline says so, else corrected/updated). Unchanged = hidden. */
export function developments(ack: Record<string, string>, events: { key: string; rev: string; title: string }[]): { key: string; status: Status }[] {
  return events.flatMap((e) => {
    if (!(e.key in ack)) return [{ key: e.key, status: "new" as Status }];
    if (ack[e.key] === e.rev) return [];
    return [{ key: e.key, status: (RESOLVED.test(e.title) ? "resolved" : "corrected") as Status }];
  });
}

// ---------- INT04: preferences ----------
export type Length = "short" | "normal" | "long";
export type Prefs = { topics: string[]; regions: string[]; projects: string[]; exclusions: string[]; length: Length; less: string[] };
export const LIMIT: Record<Length, number> = { short: 5, normal: 10, long: 20 };
const list = (v: unknown, max = 30) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
  .map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, max);
export function cleanPrefs(v: unknown): Prefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { topics: list(o.topics), regions: list(o.regions), projects: list(o.projects), exclusions: list(o.exclusions),
    length: o.length === "short" || o.length === "long" ? o.length : "normal", less: list(o.less, 200) };
}
const has = (text: string, term: string) => ` ${norm(text)} `.includes(` ${norm(term)} `);
/** "Less like this" stores the story's headline key; similar headlines (≥half the words shared) are hidden later. */
const words = (s: string) => new Set(s.split(" ").filter((w) => w.length > 2));
export function lessLike(title: string, less: string[]): boolean {
  const t = words(titleKey(title));
  return less.some((l) => { const w = words(l); let i = 0; for (const x of w) if (t.has(x)) i++; return w.size > 0 && i / w.size >= 0.5; });
}
export const excluded = (text: string, p: Prefs) => p.exclusions.some((x) => has(text, x)) || lessLike(text, p.less);

/** One sentence: why this story is in the owner's briefing. */
export function whyThis(group: Art[], p: Prefs): string {
  const text = group.map((a) => `${a.title} ${a.summary ?? ""}`).join(" ");
  const hit = (xs: string[]) => xs.find((x) => has(text, x));
  const n = independentSources(group);
  const proj = hit(p.projects), region = hit(p.regions), topic = hit(p.topics) ?? group.find((a) => a.topic)?.topic;
  const base = proj ? `Mentions your project ${proj}` : region ? `About your region ${region}` : topic ? `Matches your topic ${topic}` : "Top story in your feeds";
  return `${base}; ${n} independent source${n === 1 ? "" : "s"}.`;
}

// ---------- INT03: claims attach to evidence ----------
export type Evidence = { id: string; url: string; evidence?: "fetched" | "snippet"; passage?: string; fetched_url?: string; published_at: string | null };
/** A citation is "fetched" only when its exact URL is the page that was read; otherwise it is labelled a snippet. */
export const evidenceOf = (url: string, fetchedUrl: string | null, passage: string | null, snippet: string): Pick<Evidence, "evidence" | "passage" | "fetched_url"> =>
  fetchedUrl && passage && normUrl(fetchedUrl) === normUrl(url) ? { evidence: "fetched", passage: passage.slice(0, 2500), fetched_url: fetchedUrl } : { evidence: "snippet", passage: snippet.slice(0, 300) };

/** Claim check per cited sentence: every citation resolves, and every number in the sentence appears in a cited passage. */
export function checkClaims(content: string, cites: Evidence[]): (Check & { sentence: string })[] {
  const byId = new Map(cites.map((c) => [c.id, c]));
  const out: (Check & { sentence: string })[] = [];
  content.split(/\n|(?<=[.!?])\s+/).forEach((s, i) => {
    const ids = [...s.matchAll(/\[a:([0-9a-f-]{36})\]/gi)].map((m) => m[1].toLowerCase());
    if (!ids.length) return;
    const found = ids.map((id) => byId.get(id)).filter((c): c is Evidence => !!c);
    const text = s.replace(/\[a:[^\]]+\]/g, "");
    const nums = (text.match(/\d[\d,.]*\d|\d/g) ?? []).map((x) => x.replace(/[,.]$/, ""));
    const pool = found.map((c) => c.passage ?? "").join(" ");
    const missing = nums.filter((x) => !pool.includes(x));
    const ok = found.length === ids.length && !missing.length;
    const what = found.length < ids.length ? "cites a source that is not in the briefing"
      : missing.length ? `number(s) ${missing.join(", ")} not found in the cited ${found.every((c) => c.evidence === "fetched") ? "passages" : "snippets"}`
      : found.some((c) => c.evidence === "fetched") ? "backed by a fetched passage" : "backed by a search snippet only";
    out.push({ step: i, ok, kind: "requirements", what, sentence: text.trim().slice(0, 200) });
  });
  return out;
}

// ---------- INT06: story -> note / watch / proposed task ----------
export type StoryAction = { kind: "note" | "watch" | "task"; title: string; url: string; published_at: string | null; objective?: string; acceptance?: string };
export function storyPayload(a: StoryAction): { error: string } | { kind: "note"; title: string; content: string } | { kind: "watch"; topic: string } | { kind: "task"; title: string; why: string; prompt: string } {
  const title = a.title.trim().slice(0, 180);
  if (!title || !/^https?:\/\//i.test(a.url)) return { error: "A story needs a title and an http(s) link" };
  const src = `Source: ${a.url} (${a.published_at ? a.published_at.slice(0, 10) : "date unknown"})`;
  if (a.kind === "note") return { kind: "note", title, content: `${title}\n\n${src}` };
  if (a.kind === "watch") return { kind: "watch", topic: titleKey(title).split(" ").filter((w) => w.length > 3).slice(0, 3).join(" ").slice(0, 60) || title.slice(0, 60) };
  const objective = a.objective?.trim().slice(0, 300), acceptance = a.acceptance?.trim().slice(0, 300);
  if (!objective || !acceptance) return { error: "A proposed task needs an objective and an acceptance criterion" };
  return { kind: "task", title: `News: ${objective}`.slice(0, 200), why: `From the story "${title}". ${src}`.slice(0, 1000), prompt: `Objective: ${objective}\nAcceptance: ${acceptance}\n${src}` };
}

// ---------- INT07: feed health ----------
export type FeedHealth = { lastSuccess: string | null; lastError: string | null; kind: "ok" | "parse" | "fetch" | "empty" | null; failures: number; nextRetry: string | null };
export const EMPTY_HEALTH: FeedHealth = { lastSuccess: null, lastError: null, kind: null, failures: 0, nextRetry: null };
const BASE_MIN = 15, MAX_MIN = 24 * 60;
export const due = (h: FeedHealth | undefined, now: number) => !h?.nextRetry || Date.parse(h.nextRetry) <= now;
/** Next state after a fetch. Failures back off 15 min, 30, 60 … capped at 24 h; any success resets. */
export function nextHealth(prev: FeedHealth | undefined, r: { ok: true; items: number } | { ok: false; kind: "parse" | "fetch"; error: string }, now: number): FeedHealth {
  const p = prev ?? EMPTY_HEALTH, at = new Date(now).toISOString();
  if (r.ok) return { lastSuccess: at, lastError: null, kind: r.items ? "ok" : "empty", failures: 0, nextRetry: null };
  const failures = p.failures + 1;
  return { ...p, lastError: r.error.slice(0, 300), kind: r.kind, failures, nextRetry: new Date(now + Math.min(MAX_MIN, BASE_MIN * 2 ** (failures - 1)) * 60_000).toISOString() };
}
/** A feed that was failing keeps only items newer than its last success, so a repaired feed doesn't flood old stories. */
export function freshAfterRepair<T extends { published: string | null }>(items: T[], prev: FeedHealth | undefined): T[] {
  if (!prev?.failures || !prev.lastSuccess) return items;
  return items.filter((i) => i.published && i.published > prev.lastSuccess!);
}
