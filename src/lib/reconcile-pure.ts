// Bank reconcile (ticket B3), pure, tested in tests/reconcile.test.ts. UI: ReconcilePanel.tsx inside BUSINESS → Money.
// His bank CSV is read in the browser and never uploaded, stored or sent to a model. Nothing changes on its own: the result lists
// "mark paid" suggestions and he applies each one with a click (the existing invoices status action). Money is integer cents only.
import { addDays, totals, type Invoice } from "./invoices-pure.ts";

export type Format = "swedbank" | "seb" | "lhv" | "generic";
export type Field = "day" | "amount" | "dk" | "ref" | "name" | "text";
export type Mapping = Partial<Record<Field, number>>; // column index per field; day and amount are required
export type BankLine = { row: number; day: string; cents: number; name: string; ref: string; text: string }; // cents > 0: money in

// Header names (lowercased) per field, from Swedbank / SEB / LHV exports in Estonian and English.
const NAMES: Record<Field, string[]> = {
  day: ["kuupäev", "date", "kande kuupäev", "booking date"],
  amount: ["summa", "amount"],
  dk: ["deebet/kreedit", "deebet/kreedit (d/c)", "debit/credit", "debit/credit (d/c)", "d/c", "d/k"],
  ref: ["viitenumber", "reference number", "viide"],
  name: ["saaja/maksja", "saaja/maksja nimi", "sender/receiver name", "beneficiary/payer", "payer"],
  text: ["selgitus", "description", "details"],
};

/** RFC-4180-ish split with the separator guessed from the header line (; , or tab, outside quotes). */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const head = src.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, "");
  const sep = [";", "\t", ","].map((c) => [c, head.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Format from the header row, and the column mapping when the bank is known. */
const ROW_TYPE = ["reatüüp", "row type", "record type", "line type"]; // Swedbank, Estonian and English headers
const BALANCE = /\b(algsaldo|lõppsaldo|käive|saldo|opening balance|closing balance|turnover|balance)\b/i;

export function detect(header: string[]): { format: Format; mapping: Mapping } {
  const h = header.map((x) => x.trim().toLowerCase());
  const mapping: Mapping = {};
  for (const f of Object.keys(NAMES) as Field[]) { const i = h.findIndex((x) => NAMES[f].includes(x)); if (i >= 0) mapping[f] = i; }
  const has = (x: string) => h.includes(x);
  const format: Format = h.some((x) => ROW_TYPE.includes(x)) ? "swedbank"
    : has("kande viide") || has("customer account no") || (has("kliendi konto") && has("tühi")) ? "lhv"
    : has("konto number") || has("tühi") || has("empty") ? "seb" : "generic";
  return { format, mapping: format === "generic" && (mapping.day === undefined || mapping.amount === undefined) ? {} : mapping };
}

/** "1 234,50" / "-12.5" / "1.234,50" / "1,234.50" → signed integer cents, from the digits (no floats), or null. */
export function parseCents(v: string): number | null {
  let s = v.replace(/[\s €]/g, "");
  const neg = s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  s = s.replace(/^[-+(]|\)$/g, "");
  const m = /^([1-9]\d{0,2}(?:([.,' ])\d{3})+|\d+)(?:([.,])(\d{1,2}))?$/.exec(s);
  if (!m || (m[2] && m[3] === m[2])) return null;
  const whole = m[1].replace(/[.,' ]/g, ""), frac = (m[4] ?? "").padEnd(2, "0");
  const c = Number(whole) * 100 + Number(frac);
  return Number.isSafeInteger(c) ? (neg ? -c : c) : null;
}

/** dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd (time ignored) → YYYY-MM-DD, or null. */
export function parseDay(v: string): string | null {
  const t = v.trim().split(/[ T]/)[0];
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t) ?? (/^(\d{4})-(\d{2})-(\d{2})$/.exec(t) && ["", t.slice(8), t.slice(5, 7), t.slice(0, 4)]);
  if (!m) return null;
  const d = `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d ? d : null;
}

export const MAX_ROWS = 20_000;
export type Parsed = { format: Format; header: string[]; mapping: Mapping; lines: BankLine[]; skipped: number[]; problem: string };

/** The CSV text → normalized lines. Pass `mapping` for a generic CSV after his column-mapping step. */
export function parseBank(text: string, mapping?: Mapping): Parsed {
  // U+FFFD = the browser decoded a non-UTF-8 file (Windows-1257 / Latin-1 bank export): names would be garbled, so refuse instead of guessing
  if (text.includes("\uFFFD")) return { format: "generic", header: [], mapping: {}, lines: [], skipped: [], problem: "This file isn't UTF-8 (it has unreadable characters). Export it again as CSV in UTF-8, or open it in a spreadsheet and save as CSV UTF-8." };
  const rows = splitCsv(text), header = rows[0] ?? [];
  const d = detect(header), map = mapping ?? d.mapping;
  const out: Parsed = { format: d.format, header, mapping: map, lines: [], skipped: [], problem: "" };
  if (!rows.length) return { ...out, problem: "The file is empty" };
  if (rows.length > MAX_ROWS + 1) return { ...out, problem: `At most ${MAX_ROWS} rows` };
  if (map.day === undefined || map.amount === undefined) return { ...out, problem: "Pick the date and amount columns" };
  const typeCol = header.findIndex((x) => ROW_TYPE.includes(x.trim().toLowerCase()));
  rows.slice(1).forEach((r, k) => {
    const row = k + 2, get = (f: Field) => (map[f] === undefined ? "" : (r[map[f]!] ?? "").trim());
    if (typeCol >= 0 && r[typeCol]?.trim() !== "20") return; // Swedbank: 10/82/86 are balance and turnover rows, 20 is a payment
    if (typeCol < 0 && BALANCE.test(get("text") + " " + get("name"))) { out.skipped.push(row); return; } // unknown row type: a balance line is never income
    const day = parseDay(get("day")), c = parseCents(get("amount"));
    if (!day || c === null) { out.skipped.push(row); return; }
    const dk = get("dk").toUpperCase();
    const cents = dk === "D" ? -Math.abs(c) : dk === "K" || dk === "C" ? Math.abs(c) : c;
    out.lines.push({ row, day, cents, name: get("name"), ref: get("ref").replace(/\s/g, ""), text: get("text") });
  });
  return out;
}

// ---- Matching -----------------------------------------------------------------------

export const EARLY_DAYS = 3, LATE_DAYS = 90, PAID_SLACK = 7;
export type Match = { line: BankLine; invoice: Invoice; by: "reference" | "number" | "amount+date"; markPaid: { id: string; paidOn: string } | null };
export type Month = { month: string; bank: number; invoices: number; diff: number }; // diff = bank − invoices, in cents
export type Report = { from: string; to: string; matched: Match[]; bankOnly: BankLine[]; paidNoBank: Invoice[]; months: Month[] };

const owed = (i: Invoice) => totals(i).gross; // the payment was the full gross; refunds are their own money-out lines
const inWindow = (i: Invoice, day: string) =>
  i.status === "paid" && i.paidAt ? Math.abs(Date.parse(day) - Date.parse(i.paidAt)) <= PAID_SLACK * 86_400_000
    : day >= addDays(i.issued, -EARLY_DAYS) && day <= addDays(i.due, LATE_DAYS);
const digits = (s: string) => s.replace(/\D/g, "");

/** Money-in lines ↔ sent/paid invoices. Amount must match to the cent; then reference, invoice number, or a single amount+date candidate. */
export function reconcile(lines: BankLine[], invoices: Invoice[]): Report {
  const incoming = lines.filter((l) => l.cents > 0).sort((a, b) => a.day.localeCompare(b.day) || a.row - b.row);
  const days = lines.map((l) => l.day).sort(), from = days[0] ?? "", to = days.at(-1) ?? "";
  const open = invoices.filter((i) => i.status !== "draft"), used = new Set<string>(), matched: Match[] = [], bankOnly: BankLine[] = [];
  const pick = (l: BankLine): Pick<Match, "invoice" | "by"> | null => {
    const same = open.filter((i) => !used.has(i.id) && owed(i) === l.cents);
    const byRef = same.find((i) => l.ref && digits(l.ref) === i.ref) ?? same.find((i) => digits(l.text).includes(i.ref) && i.ref.length >= 4);
    if (byRef) return { invoice: byRef, by: "reference" };
    const byNo = same.find((i) => (l.text + " " + l.ref).includes(i.number));
    if (byNo) return { invoice: byNo, by: "number" };
    const near = same.filter((i) => inWindow(i, l.day));
    return near.length === 1 ? { invoice: near[0], by: "amount+date" } : null; // two equal open invoices: he decides, not a guess
  };
  for (const l of incoming) {
    const m = pick(l);
    if (!m) { bankOnly.push(l); continue; }
    used.add(m.invoice.id);
    matched.push({ line: l, ...m, markPaid: m.invoice.status === "sent" ? { id: m.invoice.id, paidOn: l.day } : null });
  }
  const inRange = (d: string | null) => !!d && d >= from && d <= to;
  const paidNoBank = invoices.filter((i) => i.status === "paid" && inRange(i.paidAt) && !used.has(i.id));
  const months = new Map<string, Month>();
  const m = (k: string) => months.get(k) ?? months.set(k, { month: k, bank: 0, invoices: 0, diff: 0 }).get(k)!;
  for (const l of incoming) m(l.day.slice(0, 7)).bank += l.cents;
  for (const i of invoices) if (i.status === "paid" && inRange(i.paidAt)) m(i.paidAt!.slice(0, 7)).invoices += owed(i);
  for (const x of months.values()) x.diff = x.bank - x.invoices;
  return { from, to, matched, bankOnly, paidNoBank, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}
