// Entity graph + contradiction check (pure, tested in tests/entity-graph.test.ts). IO: entity-graph.ts; API: /api/memories/entities;
// UI: MemoryEntities.tsx in the MEMORY panel; one brief line. Rules only, no model call. Journal (LIFE) memories are dropped here
// even if a caller passes them. Conflicts settle by memory-types-pure.ts weight before anything is asked. Merges are only ever SUGGESTED: claims group across names only after the owner confirms.

import { currentOnly, resolveClaims, weight } from "./memory-types-pure.ts";

export type EKind = "person" | "project" | "place";
export type Src = { id: string; type: "memory" | "fact" | "person"; title: string; at: string; weight?: number }; // weight: memory-types-pure.ts
export type Mention = { form: string; kind?: EKind; src: Src };
export type Attr = "birthday" | "employer" | "home";
export type Claim = { form: string; attr: Attr; value: string; norm: string; src: Src };
export type MergeSuggestion = { key: string; keys: string[]; forms: string[]; kind: EKind; confidence: number };
export type Contradiction = { key: string; entity: string; attr: Attr; options: { norm: string; value: string; src: Src }[] };
export type EntityDecisions = { same: string[][]; different: string[]; contra: Record<string, string> }; // same: confirmed form-key groups; different: rejected pair keys

export const LINK = 0.75, SUGGEST = 0.8, MAX_SHOWN = 3;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
/** Name tokens: an email's local part split on . _ - +, else the folded words. Digits dropped. */
export const tokens = (form: string) => fold(isEmail(form) ? form.split("@")[0] : form).replace(/['’]s\b/g, "").split(/[^a-z]+/).filter(Boolean);
/** One key per surface form: an email whole (lowercased), a name as its folded words. */
export const formKey = (form: string) => (isEmail(form) ? form.toLowerCase() : tokens(form).join(" "));
const pairKey = (a: string, b: string) => [a, b].sort().join("|");
/** FNV-1a: a short stable id for keys sent to the route (no names or emails in URLs/logs). */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** How sure two surface forms name the same thing (0–1). `firsts`: how many multi-word names start with each first token. */
export function linkScore(a: string, b: string, firsts: Map<string, number>): number {
  const ta = tokens(a), tb = tokens(b), email = isEmail(a) || isEmail(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(" ") === tb.join(" ")) return email ? 0.95 : 1;
  const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (s.length === 1 && l.length >= 2) return l[0] === s[0] && s[0].length >= 3 ? (firsts.get(s[0]) === 1 ? (email ? 0.8 : 0.85) : 0.4) : 0;
  if (s.length === l.length && s.every((t, i) => t === l[i] || (Math.min(t.length, l[i].length) === 1 && t[0] === l[i][0]))) return 0.75; // "M. Tamm"
  if (s.length >= 2 && s[0] === l[0] && s[s.length - 1] === l[l.length - 1]) return 0.8; // "Mart Tamm" / "Mart Juhan Tamm"
  return 0;
}

type Node = { key: string; forms: Set<string>; kinds: Set<EKind>; srcs: Src[] };
/** Clusters of surface forms (union-find, strongest links first). Confirmed groups join at 1; rejected pairs never join. */
export function resolveEntities(mentions: Mention[], d: EntityDecisions, maxNodes = 800) {
  const nodes = new Map<string, Node>();
  for (const m of mentions) {
    const k = formKey(m.form);
    if (k.length < 2) continue;
    const n = nodes.get(k) ?? (nodes.size < maxNodes ? { key: k, forms: new Set<string>(), kinds: new Set<EKind>(), srcs: [] } : null);
    if (!n) continue;
    n.forms.add(m.form.trim()); if (m.kind) n.kinds.add(m.kind); n.srcs.push(m.src); nodes.set(k, n);
  }
  const list = [...nodes.values()], firsts = new Map<string, number>();
  for (const n of list) { const t = tokens(n.key); if (t.length >= 2 && !isEmail(n.key)) firsts.set(t[0], (firsts.get(t[0]) ?? 0) + 1); }
  const parent = new Map(list.map((n) => [n.key, n.key])), conf = new Map(list.map((n) => [n.key, 1]));
  const find = (k: string): string => { const p = parent.get(k)!; if (p === k) return k; const r = find(p); parent.set(k, r); return r; };
  const confirmed = new Set<string>();
  const union = (a: string, b: string, w: number) => { const ra = find(a), rb = find(b); if (ra === rb) return; parent.set(rb, ra); conf.set(ra, Math.min(conf.get(ra)!, conf.get(rb)!, w)); };
  for (const g of d.same) { const ks = g.filter((k) => nodes.has(k)); ks.slice(1).forEach((k) => union(ks[0], k, 1)); ks.forEach((k) => confirmed.add(k)); }
  const no = new Set(d.different), edges: [string, string, number][] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.kinds.size && b.kinds.size && ![...a.kinds].some((k) => b.kinds.has(k))) continue; // a person never merges into a project
    if (no.has(pairKey(a.key, b.key))) continue;
    const w = linkScore(a.key, b.key, firsts);
    if (w >= LINK) edges.push([a.key, b.key, w]);
  }
  for (const [a, b, w] of edges.sort((x, y) => y[2] - x[2])) {
    const ra = find(a), rb = find(b);
    // A rejected pair blocks the whole chain: never join two clusters that hold a pair he said were different.
    const ca = list.filter((n) => find(n.key) === ra), cb = list.filter((n) => find(n.key) === rb);
    if (ca.some((x) => cb.some((y) => no.has(pairKey(x.key, y.key))))) continue;
    union(a, b, w);
  }
  const groups = new Map<string, Node[]>();
  for (const n of list) { const r = find(n.key); groups.set(r, [...(groups.get(r) ?? []), n]); }
  return [...groups.entries()].map(([root, ns]) => ({
    root, keys: ns.map((n) => n.key), forms: ns.flatMap((n) => [...n.forms]),
    kind: (ns.flatMap((n) => [...n.kinds])[0] ?? "person") as EKind,
    confidence: ns.every((n) => confirmed.has(n.key)) ? 1 : conf.get(root)!,
    confirmed: ns.every((n) => confirmed.has(n.key)),
  }));
}
export type ResolvedEntity = ReturnType<typeof resolveEntities>[number];

/** Clusters worth asking about: 2+ different names, not yet confirmed, confident enough. Best first, at most `max`. */
export function mergeSuggestions(ents: ResolvedEntity[], max = MAX_SHOWN): MergeSuggestion[] {
  return ents.filter((e) => e.keys.length >= 2 && !e.confirmed && e.confidence >= SUGGEST)
    .sort((a, b) => b.confidence - a.confidence || b.keys.length - a.keys.length)
    .slice(0, max).map((e) => ({ key: `same:${hash([...e.keys].sort().join("|"))}`, keys: e.keys, forms: [...new Set(e.forms)].slice(0, 6), kind: e.kind, confidence: e.confidence }));
}

// ---- claims ("Mart's birthday is 3 May", "Mart works at Bolt", "I live in Tartu") ------------------------------------------
const OWNER = /^(?:my|i|minu|ma|mina)$/i;
const SUBJ = /^(?:\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,2}|[^\s@]+@[^\s@]+\.[^\s@]+)$/u;
const PRONOUN = /^(?:he|she|they|we|you|it|this|that|there|who|everyone|nobody|someone|tema|nad|me|see)$/i;
const OPEN = /^(?:(?:also|btw|and|so|fyi|note|remember|by the way|ps|ja|muide|pea meeles)[,:]?\s+)+/i;
const PATTERNS: [Attr, RegExp][] = [
  ["birthday", /^(.+?)(?:'s|’s)?\s+(?:birthday|bday|sünnipäev)\s*(?:is\s+(?:on\s+)?|on\s+|:\s*)(.+)$/iu],
  ["birthday", /^(.+?)\s+(?:was born on|sündis)\s+(.+)$/iu],
  ["employer", /^(.+?)\s+(?:works|work|is working|started working|töötab)\s+(?:at|for|firmas|ettevõttes)\s+(.+)$/iu],
  ["employer", /^(.+?)(?:'s|’s)?\s+(?:employer|tööandja)\s+(?:is|on)\s+(.+)$/iu],
  ["home", /^(.+?)\s+(?:lives|live|is based|am based)\s+in\s+(.+)$/iu],
  ["home", /^(.+?)\s+elab\s+(.+)$/iu],
];
const MONTHS: [RegExp, number][] = [[/^(?:jan|jaan)/, 1], [/^(?:feb|veeb)/, 2], [/^(?:mar|märts|marts)/, 3], [/^apr/, 4], [/^(?:may|mai)/, 5], [/^(?:jun|juun)/, 6],
  [/^(?:jul|juul)/, 7], [/^aug/, 8], [/^sep/, 9], [/^okt|^oct/, 10], [/^nov/, 11], [/^dets|^dec/, 12]];
const pad = (n: number) => String(n).padStart(2, "0");
const mmdd = (m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${pad(m)}-${pad(d)}` : null);
/** A birthday as "MM-DD" (year ignored): "3 May", "May 3rd", "3. mai", "03.05", "1990-05-03". null when unclear. */
export function birthdayNorm(raw: string): string | null {
  const s = raw.toLowerCase().replace(/(\d)(?:st|nd|rd|th)\b/g, "$1").replace(/\bof\b/g, " ").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return mmdd(+m[2], +m[3]);
  if ((m = /^(\d{1,2})[./](\d{1,2})(?:[./]\d{2,4})?(?!\d)/.exec(s))) return mmdd(+m[2], +m[1]); // European day.month
  const month = (w: string) => MONTHS.find(([re]) => re.test(w))?.[1];
  if ((m = /^(\d{1,2})\.?\s+([\p{L}]+)/u.exec(s)) && month(m[2])) return mmdd(month(m[2])!, +m[1]);
  if ((m = /^([\p{L}]+)\.?\s+(\d{1,2})(?!\d)/u.exec(s)) && month(m[1])) return mmdd(month(m[1])!, +m[2]);
  return null;
}
const SUFFIX = /\s+(?:ou|oü|as|ltd|llc|inc|gmbh|ab|oy)$/;
/** An employer or home as comparable words: cut at the first clause break, no articles, no company suffix. */
export function valueNorm(raw: string): { value: string; norm: string } | null {
  const value = raw.split(/[,;()]|\s+(?:and|but|since|because|now|ja|aga|sest)\s+|\.(?:\s|$)/i)[0].replace(/[.!?…\s]+$/, "").trim();
  const norm = fold(value).replace(/^(?:the|a|an)\s+/, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().replace(SUFFIX, "");
  return norm.length >= 2 && norm.split(" ").length <= 5 ? { value: value.slice(0, 60), norm } : null;
}

/** Claims in one text. The owner ("I", "my", "ma") is the form "me". */
export function claimsIn(text: string, src: Src): Claim[] {
  const out: Claim[] = [];
  for (const raw of text.slice(0, 8000).split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.replace(OPEN, "").trim();
    for (const [attr, re] of PATTERNS) {
      const m = re.exec(s);
      if (!m) continue;
      const subj = m[1].trim();
      if (!(OWNER.test(subj) || SUBJ.test(subj)) || PRONOUN.test(subj) || /\b(?:not|no longer|never|used to|ei)\b/i.test(s)) continue;
      const form = OWNER.test(subj) ? "me" : subj;
      if (attr === "birthday") { const n = birthdayNorm(m[2]); if (n) out.push({ form, attr, value: m[2].replace(/[.!?\s]+$/, "").slice(0, 40), norm: n, src }); }
      else { const v = valueNorm(m[2]); if (v) out.push({ form, attr, ...v, src }); }
      break;
    }
  }
  return out;
}

const NAME = /\b\p{Lu}[\p{Ll}'-]+(?:\s+\p{Lu}[\p{Ll}'-]+){1,2}\b/gu, EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
export type MemIn = { id: string; kind: string; title: string; content: string; created_at: string; source?: string | null; confirmation?: string | null; tags?: string[] | null };
export type FactIn = { id: string; statement: string; status: string; created_at: string; source?: string; supersedes?: string | null };
export type PersonIn = { id: string; name: string; created_at: string };
/** Never LIFE: journal entries are dropped here no matter who calls (defence in depth next to the query's own filter). */
export const usable = (ms: MemIn[]) => ms.filter((m) => m.kind !== "journal");

/** Everything the scan needs from his data: mentions (people, project titles, names, emails, claim subjects/places) and claims. */
export function gather(x: { memories: MemIn[]; facts: FactIn[]; people: PersonIn[] }): { mentions: Mention[]; claims: Claim[] } {
  const mentions: Mention[] = [], claims: Claim[] = [];
  for (const p of x.people) mentions.push({ form: p.name, kind: "person", src: { id: p.id, type: "person", title: p.name, at: p.created_at } });
  // Corrected originals and history copies make no claims; expired temporary notes neither.
  for (const m of currentOnly(usable(x.memories), { now: Date.now() })) {
    const src: Src = { id: m.id, type: "memory", title: m.title.slice(0, 80), at: m.created_at, weight: weight(m) };
    const text = `${m.title}. ${m.content.slice(0, 8000)}`;
    if (m.kind === "project") mentions.push({ form: m.title.slice(0, 60), kind: "project", src });
    for (const f of text.match(NAME) ?? []) mentions.push({ form: f.replace(/['’]s$/, ""), src });
    for (const e of text.match(EMAIL) ?? []) mentions.push({ form: e, kind: "person", src });
    claims.push(...claimsIn(text, src));
  }
  for (const f of x.facts.filter((f) => f.status === "current")) claims.push(...claimsIn(f.statement, { id: f.id, type: "fact", title: f.statement.slice(0, 80), at: f.created_at, weight: weight({ ...f, source: f.source ?? "user_said" }) }));
  for (const c of claims) {
    if (c.form !== "me") mentions.push({ form: c.form, kind: "person", src: c.src });
    if (c.attr === "home") mentions.push({ form: c.value, kind: "place", src: c.src });
  }
  return { mentions, claims };
}

const same = (a: string, b: string) => a === b || (a.length >= 3 && b.length >= 3 && (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `))); // "acme" ~ "acme estonia"
/** Claims about the same entity (exact name or an owner-confirmed merge) and attribute that disagree. Newest first; decided keys skipped. */
export function findContradictions(claims: Claim[], ents: ResolvedEntity[], d: EntityDecisions, max = MAX_SHOWN): Contradiction[] {
  const byKey = new Map<string, ResolvedEntity>();
  for (const e of ents) for (const k of e.keys) byKey.set(k, e);
  const groups = new Map<string, { entity: string; attr: Attr; cs: Claim[] }>();
  for (const c of claims) {
    const k = formKey(c.form), e = byKey.get(k);
    const id = c.form === "me" ? "me" : e?.confirmed ? e.root : k; // unconfirmed merges never group claims
    const name = c.form === "me" ? "me" : e?.confirmed ? [...e.forms].filter((f) => !isEmail(f)).sort((a, b) => b.length - a.length)[0] ?? c.form : c.form;
    const g = groups.get(`${id}|${c.attr}`) ?? { entity: name, attr: c.attr, cs: [] };
    g.cs.push(c); groups.set(`${id}|${c.attr}`, g);
  }
  const out: (Contradiction & { at: string })[] = [];
  for (const [gk, g] of groups) {
    const opts: Contradiction["options"] = [];
    for (const c of [...g.cs].sort((a, b) => b.src.at.localeCompare(a.src.at))) if (!opts.some((o) => same(o.norm, c.norm))) opts.push({ norm: c.norm, value: c.value, src: c.src });
    if (opts.length < 2) continue;
    // 26: correction > provenance > recency; only a real tie between his own statements is asked.
    if (resolveClaims(opts.map((o) => ({ weight: o.src.weight ?? 3, at: o.src.at })))) continue;
    const key = `contra:${hash(`${gk}|${opts.map((o) => o.norm).sort().join("|")}`)}`;
    if (key in d.contra) continue;
    out.push({ key, entity: g.entity, attr: g.attr, options: opts.slice(0, 4), at: opts[0].src.at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max).map(({ at: _at, ...c }) => c);
}

/** The owner's click. "same"/"different" on a merge suggestion; a chosen norm or "skip" on a contradiction. State or why not. */
export function decideEntity(d: EntityDecisions, s: { merges: MergeSuggestion[]; contradictions: Contradiction[] }, key: string, choice: string): EntityDecisions | string {
  const m = s.merges.find((x) => x.key === key);
  if (m) {
    const keys = m.keys;
    if (choice === "same") return { ...d, same: [...d.same.filter((g) => !g.some((k) => keys.includes(k))), [...new Set([...d.same.filter((g) => g.some((k) => keys.includes(k))).flat(), ...keys])]].slice(-500) };
    if (choice === "different") return { ...d, different: [...new Set([...d.different, ...keys.flatMap((a, i) => keys.slice(i + 1).map((b) => pairKey(a, b)))])].slice(-2000) };
    return "Choose same or different";
  }
  const c = s.contradictions.find((x) => x.key === key);
  if (!c) return "That question is gone";
  if (choice !== "skip" && !c.options.some((o) => o.norm === choice)) return "Pick one of the answers";
  return { ...d, contra: { ...d.contra, [key]: choice } };
}

export const emptyDecisions = (): EntityDecisions => ({ same: [], different: [], contra: {} });
const ATTR_SAY: Record<Attr, string> = { birthday: "birthday", employer: "workplace", home: "home town" };
/** The one brief line when memories disagree. */
export function contradictionBrief(cs: Contradiction[]): { id: string; title: string; say: string } | null {
  if (!cs.length) return null;
  const c = cs[0], who = c.entity === "me" ? "your" : `${c.entity}'s`;
  return { id: `entities:${c.key}`, title: cs.length === 1 ? `Which is right? ${who} ${ATTR_SAY[c.attr]}` : `${cs.length} things in memory disagree`,
    say: `Two of your notes disagree about ${who} ${ATTR_SAY[c.attr]}. Which is right? It's in MEMORY.` };
}
