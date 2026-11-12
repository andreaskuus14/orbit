// Outbound-payload check: with private data in context, web/agent tools still run, but each outgoing query/URL/brief is matched
// against the private text in this turn's context and only a call that would carry a piece of it out is refused (policy-pure decide()).

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\d[\d ()-]{6,}\d/g;
const AMOUNT = /\d[\d ,.]*\d\s?(?:€|eur|usd|\$)|[€$]\s?\d[\d ,.]*/gi;
const NAME = /\p{Lu}[\p{Ll}'-]{2,}(?:\s+\p{Lu}[\p{Ll}'-]{2,})+/gu; // two+ capitalised words: a person's or company's name
export const RUN = 4; // a distinctive phrase: this many words in a row copied from private text
const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
export const words = (s: string) => norm(s).split(/[^\p{L}\p{N}@.+-]+/u).filter(Boolean);
/** Leak-check tokens: letters/digits only, so a URL slug (argued-with-my_sister.html) splits like spaced prose. */
export const tokens = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const digits = (s: string) => s.replace(/\D/g, "");

/** Every string inside a tool input (query, url, task brief, nested fields), joined: what would leave ORBIT. */
export const outgoing = (input: unknown): string =>
  typeof input === "string" ? input : Array.isArray(input) ? input.map(outgoing).join("\n")
  : input && typeof input === "object" ? Object.values(input).map(outgoing).join("\n") : "";

/** The private piece the outgoing text would carry out, or "". Words the owner typed in his own message never count.
 *  noText: private data is in the session but its text isn't at hand (earlier turn, server restarted): refuse any email/phone/amount. */
export function outboundLeak(out: string, privateText: readonly string[], question = "", noText = false): string {
  const priv = norm(privateText.join("\n")), q = norm(question), o = decodeURIComponentSafe(out);
  if (!o.trim()) return "";
  const own = (s: string) => q.includes(norm(s)) || (digits(s).length >= 7 && digits(q).includes(digits(s)));
  for (const re of [EMAIL, PHONE, AMOUNT]) for (const m of o.match(re) ?? []) {
    if (own(m)) continue;
    if (noText) return m.trim();
    if (priv.replace(/\s/g, "").includes(norm(m).replace(/\s/g, ""))) return m.trim();
  }
  if (!priv) return "";
  for (const m of o.match(NAME) ?? []) { // every adjacent pair inside a capitalised run ("Mari Tamm Rakvere" → "Mari Tamm")
    const p = m.split(/\s+/);
    for (let i = 0; i + 1 < p.length; i++) { const n = `${p[i]} ${p[i + 1]}`; if (!own(n) && priv.includes(norm(n))) return n; }
  }
  const w = tokens(o), pw = ` ${tokens(priv).join(" ")} `, qw = ` ${tokens(q).join(" ")} `;
  for (let i = 0; i + RUN <= w.length; i++) {
    const run = w.slice(i, i + RUN).join(" ");
    if (pw.includes(` ${run} `) && !qw.includes(` ${run} `)) return run;
  }
  return "";
}

export function decodeURIComponentSafe(s: string) {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

/** Private tool results in this turn's steps (core.ts "You called <tool> <json>\nRESULT:\n..." form): the text to guard. */
export const privateResults = (steps: readonly string[], tools: readonly string[]) =>
  steps.filter((s) => tools.some((t) => s.startsWith(`You called ${t} `))).map((s) => s.slice(s.indexOf("\nRESULT:\n") + 9));

