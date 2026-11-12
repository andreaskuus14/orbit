// VAULT intake (incoming invoices, purchase orders): read-only field extraction with page provenance. Rules only; IO in vault-intake.ts.
// A value is trusted only when its quote is really on the cited page; nothing here pays, sends or creates anything.
import { fenceUntrusted } from "./reach/pure.ts";

export const FIELDS = ["supplier", "buyer", "document_no", "date", "due_date", "currency", "net", "vat", "gross", "line_item", "iban", "reference"] as const;
export type Field = (typeof FIELDS)[number];
export type Extracted = { field: Field; value: string; page: number; quote: string; uncertain: boolean; why: string[]; corrected?: number };
export type Sidecar = { v: 1; fileId: string; file: string; hash: string | null; model: string; at: number; pages: { text: string; ocr: boolean }[]; fields: Extracted[] };

/** Under this many non-space characters a page counts as scanned (no text layer) and is OCR'd. */
export const MIN_PAGE_CHARS = 20;
export const needsOcr = (text: string) => text.replace(/\s/g, "").length < MIN_PAGE_CHARS;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** VAULT may hold private documents: intake only ever talks to this PC. Throws for any URL that isn't plain http on loopback. */
export function assertLocal(url: string | null | undefined, what: string): string {
  let u: URL | null = null;
  try { u = new URL(String(url)); } catch { /* falls through */ }
  if (!u || u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) throw new Error(`VAULT intake runs on this PC only; ${what} is not local (${u?.host ?? "no URL"}).`);
  return u.origin;
}

export const SYSTEM = `You read one incoming invoice or purchase order (Estonian or English) and list its fields.
Answer with ONLY a JSON array, no prose: [{"field": "...", "value": "...", "page": <page number>, "quote": "<exact text copied from that page>"}].
Fields: ${FIELDS.join(", ")}. Use "line_item" once per line (value: "description; qty; unit price; amount"). Dates as YYYY-MM-DD, amounts as plain numbers with a dot (1234.50).
The quote must be copied character for character from the cited page. Leave out a field you cannot find; never guess.`;

const PROMPT_MAX = 24_000;
/** The pages as one fenced, untrusted block (document text can contain instructions; it is data). */
export function intakePrompt(pages: string[]): string {
  const body = pages.map((t, i) => `=== page ${i + 1} ===\n${t.trim()}`).join("\n\n");
  return fenceUntrusted("incoming invoice / purchase order (VAULT file)", body, PROMPT_MAX);
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : "");
/** Model answer → valid rows (known field, page in range, non-empty value). Bad JSON → []. */
export function parseFields(answer: string, pageCount: number): Omit<Extracted, "uncertain" | "why">[] {
  const a = answer.indexOf("["), b = answer.lastIndexOf("]");
  let rows: unknown;
  try { rows = JSON.parse(answer.slice(a, b + 1)); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const field = String(o.field ?? "") as Field, page = Number(o.page), value = clip(o.value, 500);
    if (!FIELDS.includes(field) || !Number.isInteger(page) || page < 1 || page > pageCount || !value) return [];
    return [{ field, value, page, quote: clip(o.quote, 500) }];
  });
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** "1 234,50" / "1,234.50" / "1234.5" / "€ 12,20" → cents; null when it isn't one amount. */
export function cents(v: string): number | null {
  let s = v.replace(/[^\d,.-]/g, "");
  if (!/\d/.test(s)) return null;
  const last = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  const dec = last >= 0 && s.length - last - 1 <= 2 ? last : -1; // 1–2 digits after the last separator = decimals
  s = dec >= 0 ? s.slice(0, dec).replace(/[,.]/g, "") + "." + s.slice(dec + 1) : s.replace(/[,.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Flags every row: uncertain unless its quote is verbatim (whitespace-normalized) on its page; amounts also unless net + VAT = gross. */
export function markUncertain(rows: Omit<Extracted, "uncertain" | "why">[], pages: string[]): Extracted[] {
  const out: Extracted[] = rows.map((r) => {
    const why: string[] = [];
    if (!r.quote) why.push("no quote");
    else if (!norm(pages[r.page - 1] ?? "").includes(norm(r.quote))) why.push(`quote not found on page ${r.page}`);
    return { ...r, uncertain: why.length > 0, why };
  });
  const one = (f: Field) => { const h = out.filter((r) => r.field === f); return h.length === 1 ? cents(h[0].value) : null; };
  const [net, vat, gross] = [one("net"), one("vat"), one("gross")];
  const ok = net !== null && vat !== null && gross !== null && net + vat === gross;
  if (!ok) for (const r of out) if (r.field === "net" || r.field === "vat" || r.field === "gross") {
    r.uncertain = true;
    r.why.push(net === null || vat === null || gross === null ? "totals can't be checked (net, VAT or gross missing)" : "net + VAT doesn't equal gross");
  }
  return out;
}

/** The owner's correction: his value, marked checked (no longer uncertain). Returns null for an unknown row. */
export function correct(s: Sidecar, index: unknown, value: unknown, now: number): Sidecar | null {
  const i = Number(index), v = clip(value, 500);
  if (!Number.isInteger(i) || !s.fields[i] || !v) return null;
  const fields = s.fields.map((f, k) => (k === i ? { ...f, value: v, uncertain: false, why: [], corrected: now } : f));
  return { ...s, fields };
}

export const parseSidecar = (j: unknown): Sidecar | null => {
  const o = j as Sidecar | null;
  return o?.v === 1 && typeof o.fileId === "string" && Array.isArray(o.fields) && Array.isArray(o.pages) ? o : null;
};
