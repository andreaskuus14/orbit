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

// ---------- multi-fact claims (v2) ----------
// A briefing sentence often joins several facts, from several cited outlets ("X killed three, and Y said 15 were rescued [1][2]").
// Checked whole against one two-sentence window it almost never reaches "backed" (22 Nov midday: 11 true claims flagged, one
// true claim deleted). So each claim is also split into its facts; a fact may be backed by any window of any source it cites.

/** The separate facts of a claim (the claim itself when it has only one). Splits on "; " and on ", and/but/while/with/saying"
 *  and " and " before a new subject; pieces under 3 words stay with the piece before them. */
export function atoms(sentence: string): string[] {
  const s = sentence.replace(/\s+/g, " ").trim();
  const bits = s.split(/;\s+|,\s+(?=(?:and|but|while|with|saying|after which|although)\s)|\s+and\s+(?=(?:he|she|they|it|the|a|an|his|her|their|its|four|three|two|\d+|[A-Z][a-z]+)\s)/)
    .map((b) => b.replace(/^(?:and|but|while|with|although|after which)\s+/i, "").replace(/[.;,\s]+$/, "").trim()).filter(Boolean);
  const out: string[] = [];
  for (const b of bits) { if (b.split(" ").length < 3 && out.length) out[out.length - 1] += `, ${b}`; else out.push(b); }
  return out.length > 1 ? out : [s];
}
/** The k windows (one-, two- and three-sentence) across all given texts that share the most words with the text. */
export function bestAcross(text: string, sources: string[], k: number): string[] {
  const all = sources.flatMap((t) => { const s = sentences(t); return [...s, ...windows(t), ...s.slice(0, -2).map((x, i) => `${x} ${s[i + 1]} ${s[i + 2]}`)]; });
  return [...new Set(all)].map((w, i) => ({ w, i, s: overlap(text, w) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, k).map((x) => x.w);
}
/** A source counts as read when we have more than a headline and a snippet of it. */
export const READ_MIN = 600;
export const ATOM_BACKED_AT = 0.9;
export type Pair2 = { claim: number; atom: number; premise: string; hypothesis: string }; // atom -1 = the whole sentence

/** Model inputs for the v2 check, and the rule that turns their scores into verdicts. */
export function checkPairs(claims: Claim[], sources: Map<string, Source>, k = 6) {
  const pairs: Pair2[] = [], factPairs: Pair2[] = []; // whole claims first: under a tight time budget they decide most claims
  const meta = new Map<number, { atoms: number; read: boolean }>();
  for (const c of claims) {
    const texts = c.sources.map((id) => sources.get(id)?.text).filter((t): t is string => !!t);
    if (!texts.length) continue;
    const parts = atoms(c.sentence);
    meta.set(c.key, { atoms: parts.length, read: texts.some((t) => t.length >= READ_MIN) });
    for (const premise of bestAcross(c.sentence, texts, k)) pairs.push({ claim: c.key, atom: -1, premise, hypothesis: c.sentence });
    if (parts.length > 1) parts.forEach((a, j) => { for (const premise of bestAcross(a, texts, 4)) factPairs.push({ claim: c.key, atom: j, premise, hypothesis: a }); });
  }
  pairs.push(...factPairs);
  const decide = (scores: (Nli | null)[]): Map<number, Verdict> => {
    const by = new Map<string, (Nli | null)[]>();
    pairs.forEach((p, i) => { const key = `${p.claim}:${p.atom}`; by.set(key, [...(by.get(key) ?? []), scores[i] ?? null]); });
    const max = (l: (Nli | null)[], i: 0 | 2) => Math.max(0, ...l.filter((x): x is Nli => !!x).map((x) => x[i]));
    return new Map(claims.map((c) => {
      const m = meta.get(c.key);
      if (!m) return [c.key, "unchecked" as Verdict];
      const whole = by.get(`${c.key}:-1`) ?? [];
      const atomL = Array.from({ length: m.atoms > 1 ? m.atoms : 0 }, (_, j) => by.get(`${c.key}:${j}`) ?? []);
      const lists = [whole, ...atomL];
      if (max(whole, 0) >= BACKED_AT || (atomL.length && atomL.every((l) => max(l, 0) >= ATOM_BACKED_AT))) return [c.key, "backed" as Verdict];
      if (lists.some((l) => l.some((x) => x === null))) return [c.key, "unchecked" as Verdict]; // not all read in time
      // Removal needs the whole claim clearly contradicted and no part of it close to backed (contradiction alone is noisy).
      const anyNear = lists.some((l) => max(l, 0) >= 0.5);
      if (max(whole, 2) >= CONTRA_AT && max(whole, 0) < CONTRA_MAX_ENTAIL && !anyNear) return [c.key, "contradicted" as Verdict];
      // Flag only what we could really check: a claim resting on headlines and snippets alone stays unmarked.
      return [c.key, (m.read ? "not_backed" : "unchecked") as Verdict];
    }));
  };
  return { pairs, decide };
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
