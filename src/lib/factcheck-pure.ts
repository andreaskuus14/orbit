// Fact check, pure parts (tests: tests/factcheck.test.ts). A small local NLI model (factcheck-worker.mjs, run by factcheck.ts)
// reads each claim next to the text of the source it cites and says: the source backs it, says otherwise, or doesn't say.
// Briefings: unbacked claims get "(not backed by the source)", claims the source contradicts are removed, and a backed claim on
// an important topic with only one outlet behind it gets "(only one source)". CORE web answers: one note at the end.
// Anything failing or out of time keeps today's text (the checker only ever adds marks or removes contradicted sentences).

export type Nli = [entail: number, neutral: number, contradict: number];
export type Verdict = "backed" | "not_backed" | "contradicted" | "unchecked";
export type Claim = { key: number; sentence: string; sources: string[] }; // sources: ids (briefings) or links (CORE)
export type Source = { id: string; text: string; outlet?: string | null; topic?: string | null };

/** Checked on 48 hand-labelled claims from 6 real news articles (scripts/factcheck-eval.ts): entailment must be clear to count as backed. */
export const BACKED_AT = 0.9;
/** Removed only when the source clearly says otherwise and no window comes close to backing it (contradiction alone is noisy). */
export const CONTRA_AT = 0.95, CONTRA_MAX_ENTAIL = 0.2;
export const WINDOWS_PER_SOURCE = 4;

export const FLAG = { en: "not backed by the source", et: "allikas seda ei kinnita" } as const;
export const ONE_SOURCE = { en: "only one source", et: "ainult üks allikas" } as const;
type L = keyof typeof FLAG;

const decode = (s: string) => s.replace(/&#x27;|&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&#160;|&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
/** Source text → sentences (captions and menu lines under 20 chars dropped). */
export function sentences(text: string): string[] {
  return decode(text).split(/\n+|(?<=[.!?]["”’)]?)\s+(?=[A-Z0-9"“(])/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 20);
}
/** Two-sentence windows: short enough for the model to judge, long enough to keep "on Friday" next to the numbers. */
export function windows(text: string): string[] {
  const s = sentences(text);
  return s.length <= 1 ? s : s.slice(0, -1).map((x, i) => `${x} ${s[i + 1]}`);
}

const STOP = new Set("the a an and or of to in on at for by with from as is are was were be been has have had it its this that these those he she they his her their said says will would could up down over after before about than".split(" "));
const terms = (s: string) => (decode(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.,%$£€-]*/gu) ?? []).map((w) => w.replace(/[.,]+$/, "")).filter((w) => w.length > 2 && !STOP.has(w) || /\d/.test(w));
/** Word overlap of a window with the claim (numbers count double): picks which windows are worth the model's time. */
export function overlap(claim: string, window: string): number {
  const w = new Set(terms(window));
  return terms(claim).reduce((n, t) => n + (w.has(t) ? (/\d/.test(t) ? 2 : 1) : 0), 0);
}
/** The k windows of a source that share the most words with the claim (ties keep text order). */
export function bestWindows(claim: string, text: string, k = WINDOWS_PER_SOURCE): string[] {
  return windows(text).map((w, i) => ({ w, i, s: overlap(claim, w) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, k).map((x) => x.w);
}

export type Pair = { claim: number; premise: string; hypothesis: string };
/** Model inputs: for each claim, the best windows of every source it cites that we have text for. */
export function pairsFor(claims: Claim[], sources: Map<string, Source>, k = WINDOWS_PER_SOURCE): Pair[] {
  return claims.flatMap((c) => c.sources.flatMap((id) => {
    const s = sources.get(id);
    return s?.text ? bestWindows(c.sentence, s.text, k).map((premise) => ({ claim: c.key, premise, hypothesis: c.sentence })) : [];
  }));
}

/** Scores of one claim's windows → verdict. A null score = that window ran out of time: a claim is only flagged or removed
 *  once all its windows were read (an unread one might have backed it), so partly read and not yet backed = unchecked. */
export function verdictOf(scores: (Nli | null)[]): Verdict {
  const got = scores.filter((s): s is Nli => !!s);
  if (!got.length) return "unchecked";
  const e = Math.max(...got.map((s) => s[0])), c = Math.max(...got.map((s) => s[2]));
  if (e >= BACKED_AT) return "backed";
  if (got.length < scores.length) return "unchecked";
  if (c >= CONTRA_AT && e < CONTRA_MAX_ENTAIL) return "contradicted";
  return "not_backed";
}
export function verdicts(claims: Claim[], pairs: Pair[], scores: (Nli | null)[]): Map<number, Verdict> {
  const by = new Map<number, (Nli | null)[]>();
  pairs.forEach((p, i) => by.set(p.claim, [...(by.get(p.claim) ?? []), scores[i] ?? null]));
  return new Map(claims.map((c) => [c.key, verdictOf(by.get(c.key) ?? [])]));
}

// ---------- briefings ([a:<id>] citations) ----------
const CITE = /\[a:([0-9a-f-]{36})\]/gi, HAS_CITE = /\[a:[0-9a-f-]{36}\]/i;
/** Same sentence split as checkClaims (news-intel-pure.ts), keeping the separators so the text can be put back together. */
const parts = (content: string) => content.split(/(\n|(?<=[.!?])\s+)/);

/** Cited sentences of a briefing (headings skipped). key = index of the part. */
export function briefingClaims(content: string): Claim[] {
  return parts(content).flatMap((p, key) => {
    if (/^\s*#/.test(p) || !HAS_CITE.test(p)) return [];
    const sources = [...new Set([...p.matchAll(CITE)].map((m) => m[1].toLowerCase()))];
    const sentence = p.replace(CITE, "").replace(/\*\*/g, "").replace(/^\s*([-*]|\d+\.)\s+/, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").trim();
    return sentence.length >= 15 ? [{ key, sentence, sources }] : [];
  });
}

const OUTLET = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
/** Topics where one outlet isn't enough: world/economy/politics feeds, or war, health, money, law and elections words. */
const IMPORTANT = /\b(war|attack|strike|missile|troops|killed|dead|deaths?|casualt|ceasefire|invasion|terror|election|vote|president|prime minister|government|parliament|sanction|court|convicted|sentenced|arrest|law|health|disease|virus|vaccine|outbreak|hospital|inflation|interest rates?|central bank|recession|markets?|stocks?|shares|prices|tax|budget|gdp|earthquake|flood|wildfire|hurricane)\b/i;
export const importantTopic = (sentence: string, sources: Source[]) =>
  sources.some((s) => ["world", "economy", "politics"].includes(s.topic ?? "")) || IMPORTANT.test(sentence);
export const outlets = (sources: Source[]) => new Set(sources.map((s) => OUTLET(s.outlet) || s.id)).size;

export type BriefingCheck = { content: string; backed: number; notBacked: number; removed: number; oneSource: number; unchecked: number };
/** Put the verdicts into the briefing text. A flag goes just before the sentence's citations, so the claim check still reads it. */
export function applyBriefing(content: string, claims: Claim[], v: Map<number, Verdict>, sources: Map<string, Source>, lang: L = "en"): BriefingCheck {
  const ps = parts(content), byKey = new Map(claims.map((c) => [c.key, c]));
  const n = { backed: 0, notBacked: 0, removed: 0, oneSource: 0, unchecked: 0 };
  const mark = (p: string, word: string) => {
    const at = p.search(/\s*\[a:/i);
    if (at > 0) return `${p.slice(0, at)} (${word})${p.slice(at)}`;
    const end = p.match(/[.!?]*\s*$/)!.index!;
    return `${p.slice(0, end)} (${word})${p.slice(end)}`;
  };
  const out = ps.map((p, key) => {
    const c = byKey.get(key);
    if (!c) return p;
    const verdict = v.get(key) ?? "unchecked";
    if (verdict === "unchecked") { n.unchecked++; return p; }
    if (verdict === "contradicted") {
      n.removed++;
      return /^\s*([-*]|\d+\.)\s/.test(p) ? p.match(/^\s*([-*]|\d+\.)\s/)![0] : ""; // the sentence goes; an emptied bullet line is dropped below
    }
    if (verdict === "not_backed") { n.notBacked++; return mark(p, FLAG[lang]); }
    n.backed++;
    const srcs = c.sources.map((id) => sources.get(id)).filter((s): s is Source => !!s);
    if (srcs.length && outlets(srcs) === 1 && importantTopic(c.sentence, srcs)) { n.oneSource++; return mark(p, ONE_SOURCE[lang]); }
    return p;
  });
  const text = out.join("").split("\n").filter((l, i, a) => !(/^\s*([-*]|\d+\.)\s*$/.test(l)) && !(l.trim() === "" && a[i - 1]?.trim() === "" && i > 0)).join("\n")
    .replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ");
  return { content: text, ...n };
}

/** One plain line for the end of a briefing; "" when nothing needs saying. */
export function briefingNote(r: Omit<BriefingCheck, "content">, lang: L = "en"): string {
  if (!r.notBacked && !r.removed) return "";
  if (lang === "et") return `_Faktikontroll: ${[r.removed && `eemaldasin ${r.removed} väidet, mida allikas ei toeta`, r.notBacked && `${r.notBacked} väidet on märgitud „${FLAG.et}“`].filter(Boolean).join("; ")}._`;
  const s = (k: number) => (k === 1 ? "" : "s");
  return `_Fact check: ${[r.removed && `removed ${r.removed} claim${s(r.removed)} the source says otherwise about`, r.notBacked && `${r.notBacked} claim${s(r.notBacked)} marked "${FLAG.en}"`].filter(Boolean).join("; ")}._`;
}

// ---------- CORE web answers (markdown links) ----------
const LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|<?(https?:\/\/[^\s<>()[\]"'`]+)>?/g;
const normLink = (u: string) => { try { const x = new URL(u.replace(/[.,;:!?*_]+$/, "")); return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`; } catch { return ""; } };

/** Sentences of a CORE answer that cite a web link; code blocks skipped. */
export function answerClaims(answer: string): Claim[] {
  const noCode = answer.replace(/```[\s\S]*?```/g, "");
  return noCode.split(/\n|(?<=[.!?])\s+(?=[A-Z0-9*_"“])/).flatMap((p, key) => {
    const links = [...p.matchAll(LINK)].map((m) => normLink(m[1] ?? m[2])).filter(Boolean);
    if (!links.length) return [];
    const sentence = p.replace(/\[([^\]]*)\]\((https?:[^)]+)\)/g, "").replace(LINK, "").replace(/[*_`]/g, "").replace(/^\s*([-*]|\d+\.)\s+/, "")
      .replace(/\(\s*\)/g, "").replace(/\s+([.,;:!?])/g, "$1").replace(/\s+/g, " ").replace(/[\s:–—-]+$/, "").trim();
    return sentence.length >= 20 && /[a-z]{3}/i.test(sentence) ? [{ key, sentence, sources: [...new Set(links)] }] : [];
  });
}

/** What CORE read for each link this turn: a page it opened (fetch/scrape with that url), else the lines naming the link
 *  in a web_search result (those findings are what it saw of that source). */
export function answerSources(tools: { tool: string; input: Record<string, unknown>; output: string }[]): Map<string, Source> {
  const m = new Map<string, Source>();
  const add = (id: string, text: string) => { if (!id || !text.trim()) return; const s = m.get(id); m.set(id, { id, text: s ? `${s.text}\n${text}` : text }); };
  for (const t of tools) {
    if (!t.output || t.output.startsWith("Error")) continue;
    const url = typeof t.input.url === "string" ? normLink(t.input.url) : "";
    if (url && /^(fetch_url|scrape_page|read_news)$/.test(t.tool)) add(url, t.output);
  }
  for (const t of tools) {
    if (t.tool !== "web_search" || !t.output) continue;
    for (const line of t.output.split("\n")) for (const x of line.matchAll(LINK)) {
      const id = normLink(x[1] ?? x[2]);
      if (id && !m.get(id)?.text.includes(line)) add(id, line.replace(/\[([^\]]*)\]\([^)]+\)/g, "$1"));
    }
  }
  return m;
}

/** The note under a CORE answer: names up to 3 unbacked claims. "" when all checked claims are backed. */
export function answerNote(claims: Claim[], v: Map<number, Verdict>, lang: L = "en"): string {
  const bad = claims.filter((c) => v.get(c.key) === "not_backed" || v.get(c.key) === "contradicted");
  if (!bad.length) return "";
  const list = bad.slice(0, 3).map((c) => `“${c.sentence.slice(0, 120)}${c.sentence.length > 120 ? "…" : ""}”`).join(", ") + (bad.length > 3 ? ", …" : "");
  const one = bad.length === 1;
  return lang === "et"
    ? `\n\n_Faktikontroll: ${one ? "see väide" : `need ${bad.length} väidet`} — ${FLAG.et}: ${list}._`
    : `\n\n_Fact check: ${one ? "this claim is" : `these ${bad.length} claims are`} ${FLAG.en} ${one ? "it links" : "they link"}: ${list}._`;
}

export const factcheckOn = (env: Record<string, string | undefined>) => env.ORBIT_FACTCHECK !== "0";
