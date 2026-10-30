// Voice/CORE object context (roadmap G16 + X06 groundwork): what "this", "the client", "client Kask" point at, read from
// the deep link of the current URL hash (deeplink-pure.ts) as the single source. Spoken Estonian/English dates, numbers and
// ordinals. Pure — tested in tests/voice-target.test.ts. UI: components/voice/object-command.ts, CORE: core-turn.ts.
import { linkFromHash, linkToHash, type DeepLink, type LinkKind } from "./deeplink-pure.ts";
import type { PanelId } from "./planets.ts";

export type Rec = { kind: LinkKind; id: string; name: string; planet: PanelId };
export type Intent =
  | { act: "summarize" } | { act: "overdue" } | { act: "save" }
  | { act: "open"; kind: LinkKind | null; name: string }; // name "" = a bare reference ("the client", "that project")
export type Resolved = { status: "one"; rec: Rec } | { status: "many"; options: Rec[] } | { status: "none" };

const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);

/** A deep link from the client, re-checked with the same rules as the URL (round trip), or null. Trust boundary for CORE. */
export function safeLink(raw: unknown): DeepLink | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const l = { planet: r.planet, view: r.view, kind: r.kind, id: r.id } as DeepLink;
  return typeof l.planet === "string" ? linkFromHash(linkToHash(l)) : null;
}

/** The line CORE gets about what is on screen: ids only, never record contents. "" when nothing is open. */
export function contextLine(l: DeepLink | null): string {
  if (!l) return "";
  const bits = [`planet ${l.planet}`, l.view && `view ${l.view}`, l.kind && l.id && `selected ${l.kind} ${l.id}`].filter(Boolean);
  return `\n\nOn screen now (what "this" refers to): ${bits.join(", ")}.`;
}

const KIND_WORDS: [RegExp, LinkKind][] = [
  [/^(?:client|customer|prospect|klient|kliendi|klienti)$/, "client"],
  [/^(?:task|project|ülesanne|ülesande|projekt|projekti)$/, "task"],
  [/^(?:goal|eesmärk|eesmärgi)$/, "goal"],
  [/^(?:memory|note|märge|märkme|mälu)$/, "memory"],
];
const kindOf = (w: string) => KIND_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
const LEAD = /^(?:(?:hey |ok |okay )?orbit |please |palun |can you |could you )+/;
const DET = /^(?:the|that|this|see|seda|selle|too|toda) /;

/** Whole-utterance object commands; anything else → null (goes on to CORE, which sees contextLine). */
export function parseIntent(text: string): Intent | null {
  const s = norm(text).replace(LEAD, "");
  if (/^(?:summari[sz]e|sum up|kokkuvõte|tee kokkuvõte|võta kokku)(?: (?:this|it|that|see|seda|sellest))?$/.test(s)) return { act: "summarize" };
  if (/^(?:open|show|ava|näita)(?: me| mulle)? (?:the |all )?(?:overdue|late|hilinenud|üle tähtaja)(?: (?:ones|items|tasks|asjad|ülesanded))?$/.test(s)) return { act: "overdue" };
  if (/^(?:save|salvesta)(?: (?:this|that|see|seda|selle))? (?:version|versioon|versiooni|revision)$/.test(s)) return { act: "save" };
  const m = /^(?:open|show|go to|ava|näita|mine)(?: me| mulle)? (.+)$/.exec(s);
  if (!m) return null;
  const rest = m[1].replace(DET, "").split(" ");
  const kind = kindOf(rest[0]);
  if (!kind) return null; // "open studio" is navigation (nav-pure), not a record
  return { act: "open", kind, name: rest.slice(1).join(" ") };
}

/** Exact whole-word name match only, never the "nearest" name: a misheard name finds nothing rather than another record.
 *  A bare reference prefers the record on screen; with several candidates it asks (status "many"). */
export function resolve(intent: { kind: LinkKind | null; name: string }, recs: Rec[], here: DeepLink | null): Resolved {
  const pool = recs.filter((r) => !intent.kind || r.kind === intent.kind);
  if (!intent.name) {
    const cur = here?.id ? pool.find((r) => r.id === here.id && r.kind === here.kind) : undefined;
    if (cur) return { status: "one", rec: cur };
    return pool.length === 1 ? { status: "one", rec: pool[0] } : pool.length ? { status: "many", options: pool.slice(0, 5) } : { status: "none" };
  }
  const want = words(intent.name);
  const exact = pool.filter((r) => norm(r.name) === want.join(" "));
  const hits = exact.length ? exact : pool.filter((r) => { const w = words(r.name); return want.every((x) => w.includes(x)); });
  return hits.length === 1 ? { status: "one", rec: hits[0] } : hits.length ? { status: "many", options: hits.slice(0, 5) } : { status: "none" };
}

/** The record "this" means for a change: only the one selected in the deep link. Never inferred. */
export const currentTarget = (here: DeepLink | null): { kind: LinkKind; id: string } | null =>
  here?.kind && here.id ? { kind: here.kind, id: here.id } : null;

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  üks: 1, kaks: 2, kolm: 3, neli: 4, viis: 5, kuus: 6, seitse: 7, kaheksa: 8, üheksa: 9, kümme: 10, üksteist: 11, kaksteist: 12,
};
const ORD: [RegExp, number][] = [
  [/^(?:first|1st|esimene|esimese|esimest|esimesel)$/, 1], [/^(?:second|2nd|teine|teise|teist)$/, 2],
  [/^(?:third|3rd|kolmas|kolmanda|kolmandat)$/, 3], [/^(?:fourth|4th|neljas|neljanda|neljandat)$/, 4],
  [/^(?:fifth|5th|viies|viienda|viiendat)$/, 5], [/^(?:last|viimane|viimase|viimast)$/, -1],
];
/** "9", "üheksa", "nine" → 9. */
export const spokenNumber = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : NUM[norm(w)] ?? null);
/** "the second one" / "teine" / "3." / "viimane" → 1-based index into n options (last = n), else null. */
export function spokenOrdinal(text: string, n: number): number | null {
  for (const w of words(text.replace(/(\d+)\./g, "$1o"))) { // Estonian writes ordinals as "3."
    const o = /^\d+o$/.test(w) ? parseInt(w) : ORD.find(([re]) => re.test(w))?.[1];
    if (o) return o === -1 ? n : o <= n ? o : null;
  }
  return null;
}

const WEEK: [RegExp, number][] = [
  [/^(?:sunday|pühapäev\w*)$/, 0], [/^(?:monday|esmaspäev\w*)$/, 1], [/^(?:tuesday|teisipäev\w*)$/, 2], [/^(?:wednesday|kolmapäev\w*)$/, 3],
  [/^(?:thursday|neljapäev\w*)$/, 4], [/^(?:friday|reede\w*)$/, 5], [/^(?:saturday|laupäev\w*)$/, 6],
];
/** "homme kell 9", "kolmapäeval", "tomorrow at 9 pm", "ülehomme kell 14.30" → a local Date, or null. A weekday is the next one
 *  (never today); no time = 09:00. */
export function parseWhen(text: string, now: Date): Date | null {
  const s = norm(text.replace(/(\d)[.:](\d\d)/g, "$1h$2")).replace(/ülehomme|day after tomorrow/, "D2");
  let days: number | null = /\b(?:täna|today|tonight)\b/.test(s) ? 0 : /\bD2\b/i.test(s) ? 2 : /\b(?:homme|tomorrow)\b/.test(s) ? 1 : null;
  for (const w of s.split(" ")) { const d = WEEK.find(([re]) => re.test(w))?.[1]; if (d !== undefined) days = ((d - now.getDay() + 6) % 7) + 1; }
  const t = /\b(?:kell|at|kl)\s+(\d{1,2}|\p{L}+)(?:h(\d\d))?(?:\s*(am|pm|õhtul|hommikul))?/u.exec(s);
  const hour = t ? spokenNumber(t[1]) : null;
  if (days === null && hour === null) return null;
  const d = new Date(now); d.setDate(d.getDate() + (days ?? 0));
  let h = hour ?? 9;
  if (t?.[3] === "pm" || t?.[3] === "õhtul") h = h % 12 + 12; else if (t?.[3] === "am" && h === 12) h = 0;
  if (h > 23) return null;
  d.setHours(h, t?.[2] ? Number(t[2]) : 0, 0, 0);
  if (days === null && d <= now) d.setDate(d.getDate() + 1); // "kell 9" after nine = tomorrow
  return d;
}

/** Confirmation answer: true yes, false no, null neither. */
export function yesNo(text: string): boolean | null {
  const s = norm(text).replace(LEAD, "");
  if (/^(?:yes|yeah|yep|do it|confirm|ok|okay|jah|jaa|jah palun|tee ära|kinnita|sobib)$/.test(s)) return true;
  if (/^(?:no|nope|cancel|stop|don t|ei|ära|tühista|katkesta)$/.test(s)) return false;
  return null;
}
