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
/** Every RUN-token phrase of outgoing text. */
export const outRuns = (o: string, tok: (s: string) => string[] = tokens) => { const w = tok(o), r: string[] = []; for (let i = 0; i + RUN <= w.length; i++) r.push(w.slice(i, i + RUN).join(" ")); return r; };
const digits = (s: string) => s.replace(/\D/g, "");

/** Every string inside a tool input (query, url, task brief, nested fields), joined: what would leave ORBIT. */
export const outgoing = (input: unknown): string =>
  typeof input === "string" ? input : Array.isArray(input) ? input.map(outgoing).join("\n")
  : input && typeof input === "object" ? Object.values(input).map(outgoing).join("\n") : "";

/** The private piece the outgoing text would carry out, or "". Words the owner typed in his own message never count.
 *  noText: private data is in the session but its text isn't at hand (earlier turn, server restarted): refuse any email/phone/amount. */
export function outboundLeak(out: string, privateText: readonly string[], question = "", noText = false): string {
  const priv = norm(privateText.join("\n")), q = norm(question), o = unwrap(out);
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
  const pw = ` ${tokens(priv).join(" ")} `, qw = ` ${tokens(q).join(" ")} `;
  for (const run of outRuns(o)) {
    if (pw.includes(` ${run} `) && !qw.includes(` ${run} `)) return run;
  }
  // Spelled apart ("T.o.d.a.y", "my-sister-and", one word per path segment): letters and digits only, a long shared stretch.
  const sq = (s: string) => tokens(s).join(""), ps = sq(priv), os = sq(o), qs = sq(q);
  for (let i = 0; i + SQUASH <= os.length; i++) { const w = os.slice(i, i + SQUASH); if (ps.includes(w) && !qs.includes(w)) return w; }
  return "";
}
const SQUASH = 32; // letters/digits in a row copied from private text, separators ignored

/** What the outgoing text says once URL-encoding (also double), base64/base64url and hex blobs are undone (S: red-team H4). */
function unwrap(out: string): string {
  let o = out;
  for (let i = 0; i < 3; i++) { const d = decodeURIComponentSafe(o); if (d === o) break; o = d; }
  const extra: string[] = [];
  const blobs = (o.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) ?? []).flatMap((m) => [m, ...m.split("/").filter((x) => x.length >= 16)]); // base64 may hold "/", a URL path splits on it
  for (const m of blobs) {
    if (/^[0-9a-f]+$/i.test(m) && m.length % 2 === 0) { const h = Buffer.from(m, "hex").toString("utf8"); if (readable(h)) extra.push(h); continue; }
    const b = Buffer.from(m.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    if (readable(b)) extra.push(b);
  }
  return extra.length ? `${o}\n${extra.join("\n")}` : o;
}
/** Mostly letters, digits, spaces and punctuation: a decoded blob that is text, not random bytes. */
const readable = (s: string) => s.length >= 8 && (s.match(/[\p{L}\p{N}\s.,!?'"-]/gu)?.length ?? 0) / s.length > 0.85;

export function decodeURIComponentSafe(s: string) {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

/** Private tool results in this turn's steps (core.ts "You called <tool> <json>\nRESULT:\n..." form): the text to guard. */
export const privateResults = (steps: readonly string[], tools: readonly string[]) =>
  steps.filter((s) => tools.some((t) => s.startsWith(`You called ${t} `))).map((s) => s.slice(s.indexOf("\nRESULT:\n") + 9));

