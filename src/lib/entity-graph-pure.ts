// Entity graph + contradiction check (pure, tested in tests/entity-graph.test.ts). IO: entity-graph.ts; API: /api/memories/entities;
// UI: the MEMORY review queue (memory-review-pure.ts); one brief line. Rules only, no model call. Journal (LIFE) memories are dropped here
// even if a caller passes them. Conflicts settle by memory-types-pure.ts weight before anything is asked. Merges are only ever SUGGESTED, and only with 2+ independent signals (signals()): claims group across names only after the owner confirms.

import { currentOnly, resolveClaims, weight } from "./memory-types-pure.ts";

export type EKind = "person" | "project" | "place" | "org";
export type Src = { id: string; type: "memory" | "fact" | "person"; title: string; at: string; weight?: number }; // weight: memory-types-pure.ts
export type Mention = { form: string; kind?: EKind; src: Src; ids?: string[] }; // ids: stable "namespace:value", e.g. "domain:nytimes.com"
export type Attr = "birthday" | "employer" | "home";
export type Claim = { form: string; attr: Attr; value: string; norm: string; src: Src };
/** Why two names were linked: a name rule (exact/email/first/initial/middle/acronym) or a shared stable id ("id"). */
export type Ev = { code: "exact" | "email" | "first" | "initial" | "middle" | "acronym" | "id"; a: string; b: string };
export type Cls = "duplicate" | "revision" | "continuation" | "contradiction";
export type Side = { form: string; srcs: Pick<Src, "title" | "at" | "type">[]; facts: { attr: Attr; value: string; at: string; conflict: boolean }[] };
/** relation "same": one thing under several names; "related": something links them (shared id, an acronym) but names do not prove it. */
export type MergeSuggestion = { key: string; keys: string[]; forms: string[]; kind: EKind; confidence: number;
  relation?: "same" | "related"; evidence?: Ev[]; sides?: Side[]; cls?: Cls; keep?: { name: string; facts: { attr: Attr; value: string }[]; ask: Attr[] } };
export type MergeHist = { key: string; keys: string[]; forms: string[]; act: "same" | "different" | "undo"; at: string };
export type Contradiction = { key: string; entity: string; attr: Attr; options: { norm: string; value: string; src: Src }[] };
export type EntityDecisions = { same: string[][]; different: string[]; contra: Record<string, string>; history?: MergeHist[] }; // same: confirmed form-key groups; different: rejected pair keys (never suggested again)

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

const ART = new Set(["the", "a", "an"]);
const core = (t: string[]) => (t.length > 1 && ART.has(t[0]) ? t.slice(1) : t);
/** Organisation-looking names: "The Seattle Times" is an org, so "Seattle" (a place) never joins it as a first name. */
export const ORG = /\b(?:times|news|post|journal|herald|tribune|gazette|daily|bank|university|ministry|inc|ltd|llc|corp|company|group|agency|media|foundation)\b/;
function link(a: string, b: string, firsts: Map<string, number>): [number, Ev["code"] | null] {
  const ta = core(tokens(a)), tb = core(tokens(b)), email = isEmail(a) || isEmail(b);
  if (!ta.length || !tb.length) return [0, null];
  if (ta.join(" ") === tb.join(" ")) return email ? [0.95, "email"] : [1, "exact"];
  const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // "NYT" / "The New York Times": an acronym alone is only related; a shared stable id makes it the same.
  if (s.length === 1 && l.length >= 2 && s[0].length >= 2 && s[0] === l.map((t) => t[0]).join("")) return [0.6, "acronym"];
  if (s.length === 1 && l.length >= 2) return l[0] === s[0] && s[0].length >= 3 && !ORG.test(l.join(" ")) ? (firsts.get(s[0]) === 1 ? [email ? 0.8 : 0.85, "first"] : [0.4, "first"]) : [0, null];
  if (s.length === l.length && s.every((t, i) => t === l[i] || (Math.min(t.length, l[i].length) === 1 && t[0] === l[i][0]))) return [0.75, "initial"]; // "M. Tamm"
  // Middle name only ("Mart Tamm" / "Mart Juhan Tamm"). Equal lengths never: "The Moscow Times" / "The Seattle Times" share only a shell.
  if (s.length >= 2 && s.length < l.length && s[0] === l[0] && s[s.length - 1] === l[l.length - 1]) return [0.8, "middle"];
  return [0, null];
}
/** How sure two surface forms name the same thing (0–1). `firsts`: how many multi-word names start with each first token. */
export const linkScore = (a: string, b: string, firsts: Map<string, number>) => link(a, b, firsts)[0];
/** Stable ids: "conflict" when a namespace both carry has no shared value (different domains block any suggestion). */
export function idRel(a: Iterable<string>, b: Iterable<string>): { rel: "conflict" | "match" | "none"; shared?: string } {
  const A = [...a], B = new Set(b), shared = A.find((x) => B.has(x));
  if (shared) return { rel: "match", shared };
  const ns = (x: string) => x.split(":")[0], nb = new Set([...B].map(ns));
  return A.some((x) => nb.has(ns(x))) ? { rel: "conflict" } : { rel: "none" };
}

type Node = { key: string; forms: Set<string>; kinds: Set<EKind>; srcs: Src[]; ids: Set<string> };
/** Clusters of surface forms (union-find, strongest links first). Confirmed groups join at 1; rejected pairs never join. */
export const resolveEntities = (mentions: Mention[], d: EntityDecisions, maxNodes = 800) => resolveGraph(mentions, d, maxNodes).ents;
/** resolveEntities plus "related" pairs: linked by something, but not enough to call them the same. */
export function resolveGraph(mentions: Mention[], d: EntityDecisions, maxNodes = 800) {
  const nodes = new Map<string, Node>();
  for (const m of mentions) {
    const k = formKey(m.form);
    if (k.length < 2) continue;
    const n = nodes.get(k) ?? (nodes.size < maxNodes ? { key: k, forms: new Set<string>(), kinds: new Set<EKind>(), srcs: [], ids: new Set<string>() } : null);
    if (!n) continue;
    n.forms.add(m.form.trim()); if (m.kind) n.kinds.add(m.kind); n.srcs.push(m.src); m.ids?.forEach((i) => n.ids.add(i.toLowerCase())); nodes.set(k, n);
  }
  for (const n of nodes.values()) if (!n.kinds.size && ORG.test(n.key)) n.kinds.add("org");
  const list = [...nodes.values()], firsts = new Map<string, number>();
  for (const n of list) { const t = tokens(n.key); if (t.length >= 2 && !isEmail(n.key)) firsts.set(t[0], (firsts.get(t[0]) ?? 0) + 1); }
  const parent = new Map(list.map((n) => [n.key, n.key])), conf = new Map(list.map((n) => [n.key, 1])), evs = new Map<string, Ev[]>();
  const find = (k: string): string => { const p = parent.get(k)!; if (p === k) return k; const r = find(p); parent.set(k, r); return r; };
  const confirmed = new Set<string>();
  const union = (a: string, b: string, w: number, ev: Ev[] = []) => { const ra = find(a), rb = find(b); if (ra === rb) return; parent.set(rb, ra); conf.set(ra, Math.min(conf.get(ra)!, conf.get(rb)!, w)); evs.set(ra, [...(evs.get(ra) ?? []), ...(evs.get(rb) ?? []), ...ev]); };
  for (const g of d.same) { const ks = g.filter((k) => nodes.has(k)); ks.slice(1).forEach((k) => union(ks[0], k, 1)); ks.forEach((k) => confirmed.add(k)); }
  const no = new Set(d.different), edges: [string, string, number, Ev[]][] = [], near: [string, string, number, Ev[]][] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.kinds.size && b.kinds.size && ![...a.kinds].some((k) => b.kinds.has(k))) continue; // a person never merges into a project
    if (no.has(pairKey(a.key, b.key))) continue;
    const id = idRel(a.ids, b.ids);
    if (id.rel === "conflict") continue; // different domains: never even suggested
    let [w, code] = link(a.key, b.key, firsts);
    const ev: Ev[] = code && w >= 0.5 ? [{ code, a: [...a.forms][0], b: [...b.forms][0] }] : [];
    if (id.rel === "match") { ev.push({ code: "id", a: [...a.forms][0], b: id.shared! }); w = w >= 0.5 ? Math.max(w, 0.9) : 0.6; } // renamed org: related only
    if (w >= LINK) edges.push([a.key, b.key, w, ev]); else if (w >= 0.5) near.push([a.key, b.key, w, ev]);
  }
  const ids = (ns: Node[]) => ns.flatMap((n) => [...n.ids]);
  for (const [a, b, w, ev] of edges.sort((x, y) => y[2] - x[2])) {
    const ra = find(a), rb = find(b);
    // A rejected pair or conflicting ids block the whole chain: never join two clusters that hold a pair he said were different.
    const ca = list.filter((n) => find(n.key) === ra), cb = list.filter((n) => find(n.key) === rb);
    if (ca.some((x) => cb.some((y) => no.has(pairKey(x.key, y.key)))) || idRel(ids(ca), ids(cb)).rel === "conflict") continue;
    union(a, b, w, ev);
  }
  const groups = new Map<string, Node[]>();
  for (const n of list) { const r = find(n.key); groups.set(r, [...(groups.get(r) ?? []), n]); }
  const ents = [...groups.entries()].map(([root, ns]) => ({
    root, keys: ns.map((n) => n.key), forms: ns.flatMap((n) => [...n.forms]),
    kind: (ns.flatMap((n) => [...n.kinds])[0] ?? "person") as EKind,
    confidence: ns.every((n) => confirmed.has(n.key)) ? 1 : conf.get(root)!,
    confirmed: ns.every((n) => confirmed.has(n.key)),
    evidence: evs.get(root) ?? [], parts: ns.map((n) => ({ key: n.key, forms: [...n.forms], srcs: n.srcs })),
  }));
  const node = (k: string) => nodes.get(k)!, kindOf = (n: Node) => ([...n.kinds][0] ?? "person") as EKind;
  const related = near.filter(([a, b]) => find(a) !== find(b)).map(([a, b, w, ev]) => ({
    root: a, keys: [a, b], forms: [...node(a).forms, ...node(b).forms], kind: kindOf(node(a)), confidence: w, confirmed: false, evidence: ev,
    parts: [a, b].map((k) => ({ key: k, forms: [...node(k).forms], srcs: node(k).srcs })),
  }));
  return { ents, related };
}
export type ResolvedEntity = ReturnType<typeof resolveEntities>[number];

/** Clusters worth asking about: 2+ different names, not yet confirmed, confident enough ("same"), then "related" pairs.
 *  Best first, at most `max`. Each carries the evidence, both sides' sources and facts, and the class of difference. Never auto-merged. */
export function mergeSuggestions(ents: ResolvedEntity[], max = MAX_SHOWN, x: { related?: ResolvedEntity[]; claims?: Claim[] } = {}): MergeSuggestion[] {
  const enough = (e: ResolvedEntity) => signals(e, x.claims ?? []).length >= MIN_SIGNALS; // one look-alike name is never enough (owner report: a wrong link)
  const same = ents.filter((e) => e.keys.length >= 2 && !e.confirmed && e.confidence >= SUGGEST && enough(e)).map((e) => ({ e, relation: "same" as const }));
  const rel = (x.related ?? []).filter(enough).map((e) => ({ e, relation: "related" as const }));
  return [...same.sort((a, b) => b.e.confidence - a.e.confidence || b.e.keys.length - a.e.keys.length), ...rel.sort((a, b) => b.e.confidence - a.e.confidence)]
    .slice(0, max).map(({ e, relation }) => ({ key: `same:${hash([...e.keys].sort().join("|"))}`, keys: e.keys, forms: [...new Set(e.forms)].slice(0, 6), kind: e.kind,
      confidence: e.confidence, relation, evidence: e.evidence.slice(0, 6), ...compareSides(e.parts, x.claims ?? []) }));
}

export const MIN_SIGNALS = 2;
/** Independent kinds of evidence that the names are one thing: a name rule (exact/email/first/initial/middle/acronym), a shared
 *  stable id (same domain), and an agreeing fact (same birthday / employer / home on both sides). Several name rules count once. */
export function signals(e: Pick<ResolvedEntity, "evidence" | "parts">, claims: Claim[]): ("name" | "id" | "fact")[] {
  const out = new Set<"name" | "id" | "fact">(e.evidence.map((v) => (v.code === "id" ? "id" as const : "name" as const)));
  const per = e.parts.map((p) => new Set(claims.filter((c) => c.form !== "me" && formKey(c.form) === p.key).map((c) => `${c.attr}=${c.norm}`)));
  if (per.some((a, i) => per.slice(i + 1).some((b) => [...a].some((v) => b.has(v))))) out.add("fact");
  return [...out];
}

/** V05: what each side says before anything is proposed — sources, dates, facts (changed ones flagged), the class and the kept result. */
export function compareSides(parts: { key: string; forms: string[]; srcs: Src[] }[], claims: Claim[]): Pick<MergeSuggestion, "sides" | "cls" | "keep"> {
  const per = parts.slice(0, 4).map((p) => {
    const cs = claims.filter((c) => c.form !== "me" && formKey(c.form) === p.key).sort((a, b) => b.src.at.localeCompare(a.src.at));
    const facts = new Map<Attr, Claim>(); for (const c of cs) if (!facts.has(c.attr)) facts.set(c.attr, c); // newest per attribute
    return { p, facts };
  });
  const attrs = [...new Set(per.flatMap((s) => [...s.facts.keys()]))];
  let cls: Cls = "duplicate";
  const keep: { attr: Attr; value: string }[] = [], ask: Attr[] = [], changed = new Set<Attr>();
  for (const attr of attrs) {
    const cs = per.map((s) => s.facts.get(attr)).filter((c): c is Claim => !!c);
    const opts = cs.filter((c, i) => !cs.slice(0, i).some((o) => same(o.norm, c.norm)));
    if (cs.length < per.length && cls === "duplicate") cls = "continuation"; // one side adds a fact the other lacks
    if (opts.length < 2) { keep.push({ attr, value: opts[0].value }); continue; }
    changed.add(attr);
    const win = resolveClaims(opts.map((c) => ({ weight: c.src.weight ?? 3, at: c.src.at, c })));
    if (win) { keep.push({ attr, value: win.c.value }); if (cls !== "contradiction") cls = "revision"; } else { ask.push(attr); cls = "contradiction"; }
  }
  const forms = parts.flatMap((p) => p.forms), name = forms.filter((f) => !isEmail(f)).sort((a, b) => b.length - a.length)[0] ?? forms[0] ?? "";
  return {
    cls, keep: { name, facts: keep, ask },
    sides: per.map(({ p, facts }) => ({ form: p.forms[0] ?? p.key, srcs: [...p.srcs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3).map(({ title, at, type }) => ({ title, at, type })),
      facts: [...facts.values()].map((c) => ({ attr: c.attr, value: c.value, at: c.src.at, conflict: changed.has(c.attr) })) })),
  };
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

/** "The New York Times (nytimes.com)" / "NYT (https://www.nytimes.com/…)": a name with its stable domain. */
const NAMED_DOMAIN = /\b((?:\p{Lu}[\p{Ll}'-]+\s+){0,4}\p{Lu}[\p{Ll}'-]+|\p{Lu}{2,6})\s*\((?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)[^)]*\)/gu;
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
    for (const [, f, dom] of text.matchAll(NAMED_DOMAIN)) mentions.push({ form: f, kind: "org", src, ids: [`domain:${dom.toLowerCase()}`] });
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
/** Claims grouped by entity + attribute (unconfirmed merges never group claims), each group's distinct values newest first. */
function claimGroups(claims: Claim[], ents: ResolvedEntity[]) {
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
  return [...groups].map(([gk, g]) => {
    const opts: Contradiction["options"] = [];
    for (const c of [...g.cs].sort((a, b) => b.src.at.localeCompare(a.src.at))) if (!opts.some((o) => same(o.norm, c.norm))) opts.push({ norm: c.norm, value: c.value, src: c.src });
    return { ...g, opts, key: `contra:${hash(`${gk}|${opts.map((o) => o.norm).sort().join("|")}`)}` };
  });
}

export function findContradictions(claims: Claim[], ents: ResolvedEntity[], d: EntityDecisions, max = MAX_SHOWN): Contradiction[] {
  const out: (Contradiction & { at: string })[] = [];
  for (const { entity, attr, opts, key } of claimGroups(claims, ents)) {
    if (opts.length < 2) continue;
    // 26: correction > provenance > recency; only a real tie between his own statements is asked.
    if (resolveClaims(opts.map((o) => ({ weight: o.src.weight ?? 3, at: o.src.at })))) continue;
    if (key in d.contra) continue;
    out.push({ key, entity, attr, options: opts.slice(0, 4), at: opts[0].src.at });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max).map(({ at: _at, ...c }) => c);
}

/** A memory claim another one replaced: kept, but marked superseded with the date and the replacing value. */
export type Outdated = { id: string; entity: string; attr: Attr; was: string; now: string; since: string };
/** Settled disagreements (by weight/recency, or his "Which is right?" answer): every memory that still says the losing value. */
export function outdatedClaims(claims: Claim[], ents: ResolvedEntity[], d: EntityDecisions): Outdated[] {
  const out: Outdated[] = [];
  for (const { entity, attr, opts, cs, key } of claimGroups(claims, ents)) {
    if (opts.length < 2) continue;
    const win = d.contra[key] && d.contra[key] !== "skip" ? opts.find((o) => o.norm === d.contra[key]) : resolveClaims(opts.map((o) => ({ ...o, weight: o.src.weight ?? 3, at: o.src.at })));
    if (!win) continue;
    for (const c of cs) if (c.src.type === "memory" && !same(c.norm, win.norm)) out.push({ id: c.src.id, entity, attr, was: c.value, now: win.value, since: win.src.at.slice(0, 10) });
  }
  return out;
}
/** The retrieval label for one memory's outdated claims ("" when none). */
export const outdatedLabel = (xs: Outdated[]) => xs.map((x) => `${x.entity === "me" ? "my" : `${x.entity}'s`} ${x.attr}: "${x.was}" is superseded by "${x.now}" (${x.since})`).join("; ");

/** The owner's click. "same"/"different" on a merge suggestion; a chosen norm or "skip" on a contradiction. State or why not. */
export function decideEntity(d: EntityDecisions, s: { merges: MergeSuggestion[]; contradictions: Contradiction[] }, key: string, choice: string, at = new Date().toISOString()): EntityDecisions | string {
  const hist = (h: Omit<MergeHist, "at">) => [...(d.history ?? []), { ...h, at }].slice(-200);
  if (choice === "undo") { // undo a confirmed merge: both names stand alone again; claims regroup on the next scan (no record was ever edited)
    const h = undoable(d).find((x) => x.key === key);
    if (!h) return "Nothing to undo";
    // shortcut: drops these names from whatever confirmed group holds them now, so a later merge that grew the group loses them too.
    return { ...d, same: d.same.map((g) => g.filter((k) => !h.keys.includes(k))).filter((g) => g.length >= 2), history: hist({ key, keys: h.keys, forms: h.forms, act: "undo" }) };
  }
  const m = s.merges.find((x) => x.key === key);
  if (m) {
    const keys = m.keys, h = { key, keys, forms: m.forms };
    if (choice === "same") return { ...d, history: hist({ ...h, act: "same" }), same: [...d.same.filter((g) => !g.some((k) => keys.includes(k))), [...new Set([...d.same.filter((g) => g.some((k) => keys.includes(k))).flat(), ...keys])]].slice(-500) };
    // Rejected = never suggested again; Undo does not exist for it, so a rejection stays rejected.
    if (choice === "different") return { ...d, history: hist({ ...h, act: "different" }), different: [...new Set([...d.different, ...keys.flatMap((a, i) => keys.slice(i + 1).map((b) => pairKey(a, b)))])].slice(-2000) };
    return "Choose same or different";
  }
  const c = s.contradictions.find((x) => x.key === key);
  if (!c) return "That question is gone";
  if (choice !== "skip" && !c.options.some((o) => o.norm === choice)) return "Pick one of the answers";
  return { ...d, contra: { ...d.contra, [key]: choice } };
}

export const emptyDecisions = (): EntityDecisions => ({ same: [], different: [], contra: {}, history: [] });
/** Confirmed merges that can still be undone, newest first. */
export function undoable(d: EntityDecisions, max = 5): MergeHist[] {
  const out: MergeHist[] = [], done = new Set<string>();
  for (const h of [...(d.history ?? [])].reverse()) {
    if (h.act === "undo") done.add(h.key);
    else if (h.act === "same" && !done.has(h.key)) { out.push(h); done.add(h.key); }
  }
  return out.slice(0, max);
}
const ATTR_SAY: Record<Attr, string> = { birthday: "birthday", employer: "workplace", home: "home town" };
/** The one brief line when memories disagree. */
export function contradictionBrief(cs: Contradiction[]): { id: string; title: string; say: string } | null {
  if (!cs.length) return null;
  const c = cs[0], who = c.entity === "me" ? "your" : `${c.entity}'s`;
  return { id: `entities:${c.key}`, title: cs.length === 1 ? `Which is right? ${who} ${ATTR_SAY[c.attr]}` : `${cs.length} things in memory disagree`,
    say: `Two of your notes disagree about ${who} ${ATTR_SAY[c.attr]}. Which is right? It's in MEMORY.` };
}
