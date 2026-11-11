// Decision records (JARVIS gap 1), pure, tested in tests/decisions.test.ts. "I decided X because Y, revisit in 3 months" becomes ONE
// memory row (kind "decision"): no new table. what/why/dates live in the row's title, content and tags:
//   decided:YYYY-MM-DD, revisit:YYYY-MM-DD (the owner's Europe/Tallinn calendar day), "revisited" = closed (he edits tags in MEMORY).
// Due logic: dueDecisions → needs-you-pure (cause "revisit"). Saving: CORE's save_decision, preview first, written only after he confirms.
const TZ = "Europe/Tallinn", DAY = 86_400_000;
export type Parsed = { what: string; why: string; decided: string; revisit: string | null };
export type DecisionRow = { id: string; kind?: string | null; title: string; tags?: string[] | null };
export type Due = { id: string; what: string; revisit: string; daysLate: number };

/** The Europe/Tallinn calendar day (YYYY-MM-DD) of an instant: his "today", whatever the server's zone. */
export const tallinnDay = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** day + n days / n months (a month-end clamps: 31 Jan + 1 month = 28/29 Feb). */
export function addToDay(day: string, n: number, unit: "d" | "w" | "m" | "y"): string {
  if (unit === "d" || unit === "w") return iso(utc(day) + n * (unit === "w" ? 7 : 1) * DAY);
  const d = new Date(utc(day)), dom = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n * (unit === "y" ? 12 : 1));
  d.setUTCDate(Math.min(dom, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return iso(+d);
}

const UNIT: Record<string, "d" | "w" | "m" | "y"> = { day: "d", days: "d", week: "w", weeks: "w", month: "m", months: "m", year: "y", years: "y",
  päev: "d", päeva: "d", päevad: "d", nädal: "w", nädala: "w", kuu: "m", kuud: "m", aasta: "y", nädalal: "w", kuul: "m", aastal: "y" };
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ühe: 1, kahe: 2, kolme: 3, nelja: 4, viie: 5, kuue: 6 };
/** "in 3 months" / "next week" / "on 2026-12-01" / "3 kuu pärast" / "kuupäeval 2026-12-01" → a day, or null when not understood. */
export function revisitDay(spec: string, today: string): string | null {
  const t = spec.toLowerCase().replace(/[.!?]+$/, "").trim();
  let m = /(\d{4}-\d{2}-\d{2})/.exec(t);
  if (m) return Number.isNaN(utc(m[1])) || iso(utc(m[1])) !== m[1] ? null : m[1];
  if ((m = /\bnext (week|month|year)\b/.exec(t) ?? /\b(?:järgmisel?|tuleval) (nädalal|kuul|aastal)\b/.exec(t))) return addToDay(today, 1, UNIT[m[1]] ?? UNIT[m[1] + "s"] ?? "m");
  m = /\bin (\d+|an?|one|two|three|four|five|six) (day|week|month|year)s?\b/.exec(t) ?? /(?<![\p{L}\d])(\d+|ühe|kahe|kolme|nelja|viie|kuue)\s*(päeva|nädala|kuu|aasta)\s+pärast/u.exec(t);
  if (m) return addToDay(today, /^\d+$/.test(m[1]) ? +m[1] : NUM[m[1]], UNIT[m[2]]);
  m = /(?<![\p{L}\d])(päeva|nädala|kuu|aasta)\s+pärast/u.exec(t); // "kuu pärast" = in a month
  return m ? addToDay(today, 1, UNIT[m[1]]) : null;
}

const LEAD = /^\s*(?:(?:i|we)(?:'ve| have)? decided|(?:i|we) have made (?:a|the) decision|otsustasin|otsustasime|olen otsustanud|oleme otsustanud)\b[\s,:]*(?:to |that |on |et )?/i;
const REVISIT = /[,;.]?\s*(?:\b(?:(?:i|we)(?:'ll| will)? )?(?:revisit|review|re-?check|come back to|look at (?:it|this) again)\b|(?<![\p{L}])(?:ma |me )?(?:vaatan|vaatame|kontrollin|kontrollime)(?: see[a-z]*)? (?:üle|uuesti)(?![\p{L}])|(?<![\p{L}])(?:tuleme|tulen) selle juurde tagasi)(.*)$/isu;
const WHY = /[,;]?\s*(?:\bbecause(?: of)?\b|(?<![\p{L}])sest(?![\p{L}])|(?<![\p{L}])kuna(?![\p{L}]))\s*/iu;
const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").slice(0, 300);

/** What / why / when from one sentence (English or Estonian). null when it isn't a decision ("I decided…") or has no "what". */
export function parseDecision(text: string, now: number): Parsed | null {
  if (!LEAD.test(text)) return null;
  const today = tallinnDay(now);
  let body = text.replace(LEAD, ""), revisit: string | null = null;
  const r = REVISIT.exec(body);
  if (r) { revisit = revisitDay(r[1], today); body = body.slice(0, r.index); }
  const parts = body.split(WHY), what = tidy(parts[0]), why = tidy(parts.slice(1).join(" "));
  return what.length < 3 ? null : { what, why, decided: today, revisit };
}

/** The memory row to save (fields for reflect.ts saveCoreMemory / validateMemory). */
export function decisionMemory(p: Parsed): { title: string; content: string; kind: "decision"; tags: string[] } {
  return { kind: "decision", title: `Decision: ${p.what}`.slice(0, 200),
    content: `Decided: ${p.what}\nWhy: ${p.why || "(not given)"}\nDecided on: ${p.decided}\nRevisit: ${p.revisit ?? "no date set"}`,
    tags: ["decision", `decided:${p.decided}`, ...(p.revisit ? [`revisit:${p.revisit}`] : [])] };
}

/** Read-only preview CORE shows before anything is written. */
export const decisionPreview = (p: Parsed) =>
  `Not saved yet. Ask him to confirm this decision, then call save_decision again with the same text and confirmed:true.\nWhat: ${p.what}\nWhy: ${p.why || "(not given)"}\nDecided: ${p.decided}\nRevisit: ${p.revisit ?? "no date understood (saved without a reminder unless he gives one)"}`;

/** Confirmation: his latest message is a short, plain yes (EN/ET). A question, a "no", or a long message is not. */
export const confirmsDecision = (msg: string) =>
  /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|confirm(?:ed)?|correct|right|save it|do it|go ahead|jah|jaa|jap|kinnitan|salvesta|olgu|just)(?:[\s,.!]+(?:save it|save|please|do it|go ahead|thanks|palun|aitäh|salvesta))*[\s.!]*$/iu.test(msg.trim());

/** Decisions whose revisit day has come (his Tallinn today or earlier), not closed ("revisited"), oldest first. One per row. */
export function dueDecisions(rows: DecisionRow[], now: number): Due[] {
  const today = tallinnDay(now), out: Due[] = [];
  for (const r of rows) {
    const tags = r.tags ?? [];
    if (r.kind !== "decision" || tags.some((t) => t === "revisited" || t === "superseded" || t === "revoked")) continue;
    const day = tags.find((t) => /^revisit:\d{4}-\d{2}-\d{2}$/.test(t))?.slice(8);
    if (day && day <= today) out.push({ id: r.id, what: r.title.replace(/^Decision:\s*/, ""), revisit: day, daysLate: Math.round((utc(today) - utc(day)) / DAY) });
  }
  return out.sort((a, b) => a.revisit.localeCompare(b.revisit) || a.id.localeCompare(b.id));
}
