// Invoices (roadmap B6), pure, tested in tests/invoices.test.ts. IO: invoices.ts; API: /api/business/invoices; UI: InvoicesPanel.tsx.
// An invoice is made from a BUSINESS prospect or an agreed negotiation, with Estonian fields (registry code, KMKR, VAT on/off,
// due date, 7-3-1 reference number). Status is his: draft → sent (he sends it) → paid (he marks it). "Overdue" is derived.
// Reminders for overdue ones are drafts only; they go out through the BUSINESS send path after his click, never automatically.
// Money is kept in cents (integers) so totals never drift.
import { pdfDoc, pdfText, type PdfPage } from "./pdf-pure.ts";
import { emailIn } from "./business-pure.ts";
import { localDay } from "./morning-pure.ts";
import { dayKey } from "./agent-stats-pure.ts";

export const STATUSES = ["draft", "sent", "paid"] as const;
export type Status = (typeof STATUSES)[number];
export type View = Status | "overdue";
export const DEFAULT_VAT = 24; // Estonian standard rate from 1 July 2025
export const DEFAULT_TERMS = 14; // days
export const MAX_LINES = 20, MAX_CENTS = 100_000_000; // €1M

export type Party = { name: string; regCode: string; vatNo: string; address: string; email: string };
export type Seller = Party & { iban: string; bank: string; phone: string };
export type Line = { text: string; qty: number; cents: number }; // cents: unit price without VAT
export type Source = { kind: "prospect" | "negotiation"; id: string; label: string };
export type Reminder = { text: string; subject: string; at: string };
export type Invoice = {
  id: string; number: string; ref: string; source: Source; buyer: Party; lines: Line[]; vat: { on: boolean; rate: number };
  issued: string; due: string; status: Status; sentAt: string | null; paidAt: string | null; notes: string;
  reminder: Reminder | null; // the draft waiting for his approval
  reminded: { at: string; via: "email" | "copy" | "unknown" }[];
  pushedAt?: string; // last phone push about its waiting reminder (once a week at most)
  refunds?: Refund[]; // money he paid back on a paid invoice (BUS06); counted on its own day, never hidden in "paid"
  created: string; updated: string;
};
export type Refund = { day: string; cents: number; note: string; at: string }; // cents: gross (with VAT), as he paid it back

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, max) : "");
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** The one money window (BUS06): day falls in the last `days` days up to today. Invoices, Money and the digests all use it. */
export const inLast = (day: string, today: string, days: number) => { const d = daysBetween(day, today); return d >= 0 && d <= days; };

/** "12,50" / "€12.5" / 12.5 → 1250 cents, or NaN. */
export function toCents(v: unknown): number {
  const s = typeof v === "number" ? String(v) : String(v ?? "").trim().replace(/[€\s]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
export const euro = (cents: number) => `€${(cents / 100).toFixed(2)}`;

// ---- Estonian reference number (viitenumber), method 7-3-1 -------------------------

/** The check digit for a base: digits weighted 7, 3, 1, 7, 3, 1… from the right; the digit that rounds the sum up to a ten. */
export function refCheckDigit(base: string): number {
  if (!/^\d{1,19}$/.test(base)) throw new Error("Reference base must be 1–19 digits");
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += Number(base[base.length - 1 - i]) * w[i % 3];
  return (10 - (sum % 10)) % 10;
}
export const refNumber = (base: string) => base + refCheckDigit(base);
/** A full reference number (2–20 digits) whose last digit checks out. */
export const refValid = (ref: string) => /^\d{2,20}$/.test(ref) && refCheckDigit(ref.slice(0, -1)) === Number(ref.at(-1));

/** Next number in the year: "2026-001"…; its reference number is built from the same digits ("2026001" + check). */
export function nextNumber(existing: string[], year: number): { number: string; ref: string } {
  const pre = `${year}-`;
  const top = existing.filter((n) => n.startsWith(pre)).map((n) => Number(n.slice(pre.length))).filter(Number.isInteger).reduce((a, b) => Math.max(a, b), 0);
  const number = `${pre}${String(top + 1).padStart(3, "0")}`;
  return { number, ref: refNumber(number.replace("-", "")) };
}

// ---- Totals ---------------------------------------------------------------------

export type Totals = { net: number; vat: number; gross: number; lines: number[] };
/** Line totals rounded to the cent, VAT once on the net sum (rounded half up). */
export function totals(i: Pick<Invoice, "lines" | "vat">): Totals {
  const lines = i.lines.map((l) => Math.round(l.qty * l.cents));
  const net = lines.reduce((a, b) => a + b, 0);
  const vat = i.vat.on ? Math.round((net * i.vat.rate) / 100) : 0;
  return { net, vat, gross: net + vat, lines };
}

// ---- Parsing (trust boundary: request bodies) ---------------------------------------

export function parseSeller(b: Record<string, unknown>): Seller | string {
  const s: Seller = {
    name: clean(b.name, 120), regCode: clean(b.regCode, 20), vatNo: clean(b.vatNo, 20).toUpperCase().replace(/\s/g, ""), address: clean(b.address, 200),
    email: clean(b.email, 120), iban: clean(b.iban, 40).toUpperCase().replace(/\s/g, ""), bank: clean(b.bank, 80), phone: clean(b.phone, 40),
  };
  if (s.regCode && !/^\d{8}$/.test(s.regCode) && !/^\d{11}$/.test(s.regCode)) return "Registry code must be 8 digits (or an 11-digit personal code for a sole trader)";
  if (s.vatNo && !/^EE\d{9}$/.test(s.vatNo)) return "KMKR number must look like EE123456789";
  if (s.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s.iban)) return "IBAN looks wrong";
  return s;
}

export function parseBuyer(b: unknown): Party | string {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const p: Party = { name: clean(o.name, 120), regCode: clean(o.regCode, 20), vatNo: clean(o.vatNo, 20).toUpperCase().replace(/\s/g, ""), address: clean(o.address, 200), email: clean(o.email, 120) };
  if (!p.name) return "Who is the invoice to? Add the buyer's name";
  if (p.vatNo && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(p.vatNo)) return "Buyer's VAT number looks wrong";
  return p;
}

export function parseLines(v: unknown): Line[] | string {
  if (!Array.isArray(v) || !v.length) return "Add at least one line";
  if (v.length > MAX_LINES) return `At most ${MAX_LINES} lines`;
  const out: Line[] = [];
  for (const x of v) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const text = clean(o.text, 200), qty = Number(String(o.qty ?? 1).replace(",", ".")), cents = toCents(o.price); // euros as he typed them
    if (!text) return "Every line needs a description";
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10_000) return "Quantity must be above 0";
    if (!Number.isFinite(cents) || cents < 0 || cents > MAX_CENTS) return "Price must be a number of euros";
    out.push({ text, qty: Math.round(qty * 1000) / 1000, cents });
  }
  return out;
}

/** His edits to a draft (only drafts change: a sent invoice is a record). Fields left out stay. */
export function editInvoice(i: Invoice, b: Record<string, unknown>, now: number): Invoice | string {
  if (i.status !== "draft") return "Only a draft can be edited";
  const next = { ...i };
  if (b.buyer !== undefined) { const p = parseBuyer(b.buyer); if (typeof p === "string") return p; next.buyer = p; }
  if (b.lines !== undefined) { const l = parseLines(b.lines); if (typeof l === "string") return l; next.lines = l; }
  if (b.vatOn !== undefined || b.vatRate !== undefined) {
    const rate = b.vatRate === undefined ? i.vat.rate : Number(String(b.vatRate).replace(",", "."));
    if (!Number.isFinite(rate) || rate < 0 || rate > 50) return "VAT rate must be 0–50 %";
    next.vat = { on: b.vatOn === undefined ? i.vat.on : b.vatOn === true, rate };
  }
  if (b.issued !== undefined) { if (!isDay(b.issued)) return "Invoice date must be YYYY-MM-DD"; next.issued = b.issued; }
  if (b.due !== undefined) { if (!isDay(b.due)) return "Due date must be YYYY-MM-DD"; next.due = b.due; }
  if (next.due < next.issued) return "Due date can't be before the invoice date";
  if (b.notes !== undefined) next.notes = clean(b.notes, 500);
  if (totals(next).gross > MAX_CENTS) return "That total is too large";
  next.updated = new Date(now).toISOString();
  return next;
}

// ---- Making one ------------------------------------------------------------------

export type From = { source: Source; buyer: Partial<Party>; line: { text: string; cents: number } };
/** A new draft. Seller not VAT-registered (no KMKR) → VAT off by default. */
export function newInvoice(id: string, f: From, seller: Seller | null, existing: string[], now: number): Invoice {
  const t = new Date(now).toISOString(), issued = dayKey(new Date(now), "Europe/Tallinn"); // his calendar day, like `today` (UTC is a day behind after midnight in Tallinn)
  return {
    id, ...nextNumber(existing, Number(issued.slice(0, 4))), source: f.source,
    buyer: { name: clean(f.buyer.name, 120), regCode: clean(f.buyer.regCode, 20), vatNo: clean(f.buyer.vatNo, 20), address: clean(f.buyer.address, 200), email: clean(f.buyer.email, 120) },
    lines: [{ text: clean(f.line.text, 200) || "Services", qty: 1, cents: Math.max(0, Math.min(MAX_CENTS, Math.round(f.line.cents) || 0)) }],
    vat: { on: !!seller?.vatNo, rate: DEFAULT_VAT }, issued, due: addDays(issued, DEFAULT_TERMS), status: "draft", sentAt: null, paidAt: null, notes: "",
    reminder: null, reminded: [], created: t, updated: t,
  };
}

/** What's missing before it can go out (PDF or "mark sent"): Estonian invoice basics. "" when ready. */
export function readyProblem(i: Invoice, s: Seller | null): string {
  if (!s?.name || !s.regCode || !s.address) return "Add your name, registry code and address under Your details first";
  if (!s.iban) return "Add your IBAN under Your details so they can pay";
  if (i.vat.on && !s.vatNo) return "VAT is on but you have no KMKR number: add it, or turn VAT off";
  if (!i.buyer.name) return "Add the buyer's name";
  if (!i.lines.length || totals(i).gross <= 0) return "The invoice total is zero";
  return "";
}

// ---- Status --------------------------------------------------------------------

export const isOverdue = (i: Pick<Invoice, "status" | "due">, today: string) => i.status === "sent" && today > i.due;
export const view = (i: Pick<Invoice, "status" | "due">, today: string): View => (isOverdue(i, today) ? "overdue" : i.status);
export const daysLate = (i: Pick<Invoice, "due">, today: string) => Math.max(0, daysBetween(i.due, today));

/** His status clicks. sent → draft is allowed only for a slip of the finger (nothing reminded yet); paid → sent undoes a wrong "paid". */
export function setStatus(i: Invoice, to: unknown, now: number, s: Seller | null, paidOn?: unknown): Invoice | string {
  const at = new Date(now).toISOString();
  if (to === "sent") {
    if (i.status === "draft") { const why = readyProblem(i, s); if (why) return why; return { ...i, status: "sent", sentAt: at, updated: at }; }
    if (i.status === "paid") return i.refunds?.length ? "It has refunds on record: remove them first" : { ...i, status: "sent", paidAt: null, updated: at };
    return "It's already marked sent";
  }
  if (to === "paid") {
    if (i.status !== "sent") return "Mark it sent first";
    const day = paidOn === undefined || paidOn === "" ? dayKey(new Date(now), "Europe/Tallinn") : paidOn; // his Tallinn day, whatever the server zone
    if (!isDay(day)) return "Paid date must be YYYY-MM-DD";
    return { ...i, status: "paid", paidAt: day, reminder: null, updated: at };
  }
  if (to === "draft") {
    if (i.status !== "sent" || i.reminded.length) return "Only a sent invoice with no reminders can go back to draft";
    return { ...i, status: "draft", sentAt: null, reminder: null, updated: at };
  }
  return "Status must be sent, paid or draft";
}

// ---- Refunds (BUS06) -------------------------------------------------------------

export const MAX_REFUNDS = 20;
export const refunded = (i: Pick<Invoice, "refunds">) => (i.refunds ?? []).reduce((a, r) => a + r.cents, 0);
/** His record of money paid back on a paid invoice: at most what is left of its total, on or after the paid day. */
export function addRefund(i: Invoice, b: Record<string, unknown>, now: number): Invoice | string {
  if (i.status !== "paid" || !i.paidAt) return "Only a paid invoice can have a refund";
  const at = new Date(now).toISOString(), day = b.day === undefined || b.day === "" ? dayKey(new Date(now), "Europe/Tallinn") : b.day;
  if (!isDay(day)) return "Refund date must be YYYY-MM-DD";
  if (day < i.paidAt) return "A refund can't be before the invoice was paid";
  const cents = toCents(b.amount), left = totals(i).gross - refunded(i);
  if (!(cents > 0 && cents <= left)) return `Refund must be a sum between €0.01 and ${euro(left)}`;
  if ((i.refunds ?? []).length >= MAX_REFUNDS) return "Too many refunds on one invoice";
  return { ...i, refunds: [...(i.refunds ?? []), { day, cents, note: clean(b.note, 200), at }], updated: at };
}
/** Takes back his last refund record (a slip of the finger). */
export const dropRefund = (i: Invoice, now: number): Invoice | string =>
  i.refunds?.length ? { ...i, refunds: i.refunds.slice(0, -1), updated: new Date(now).toISOString() } : "No refund to remove";

// ---- Who owes what ----------------------------------------------------------------

export type Owed = { buyer: string; open: number; overdue: number; count: number; oldestDue: string };
export type Dashboard = { open: number; overdue: number; paid30: number; refunds30: number; drafts: number; byBuyer: Owed[] };
/** Totals in cents: unpaid sent invoices per buyer (most overdue first), plus what came in (paid30) and went back (refunds30) over the last 30 days. */
export function dashboard(list: Invoice[], today: string): Dashboard {
  const by = new Map<string, Owed>();
  let open = 0, overdue = 0, paid30 = 0, refunds30 = 0, drafts = 0;
  for (const i of list) {
    const g = totals(i).gross;
    for (const r of i.refunds ?? []) if (inLast(r.day, today, 30)) refunds30 += r.cents;
    if (i.status === "draft") { drafts++; continue; }
    if (i.status === "paid") { if (i.paidAt && inLast(i.paidAt, today, 30)) paid30 += g; continue; }
    const key = i.buyer.name.toLowerCase(), o = by.get(key) ?? { buyer: i.buyer.name, open: 0, overdue: 0, count: 0, oldestDue: i.due };
    o.open += g; o.count++; open += g;
    if (isOverdue(i, today)) { o.overdue += g; overdue += g; }
    if (i.due < o.oldestDue) o.oldestDue = i.due;
    by.set(key, o);
  }
  const byBuyer = [...by.values()].sort((a, b) => b.overdue - a.overdue || a.oldestDue.localeCompare(b.oldestDue));
  return { open, overdue, paid30, refunds30, drafts, byBuyer };
}

// ---- Reminders (drafts only) --------------------------------------------------------

export const REMIND_LANGS = ["English", "Estonian"] as const;
export const REMIND_AGAIN_DAYS = 7;
/** A polite reminder for an overdue invoice. Deterministic (no AI): it states exactly the numbers on the invoice. */
export function reminderDraft(i: Invoice, s: Seller | null, lang: unknown, today: string, now: number): Reminder | string {
  if (!isOverdue(i, today)) return "Only an overdue invoice gets a reminder";
  const t = euro(totals(i).gross), late = daysLate(i, today), me = s?.name || "";
  const pay = [s?.iban && `IBAN ${s.iban}${s.bank ? ` (${s.bank})` : ""}`, `reference number ${i.ref}`].filter(Boolean).join(", ");
  const text = lang === "Estonian"
    ? `Tere${i.buyer.name ? `, ${i.buyer.name}` : ""}!\n\nTuletan meelde, et arve nr ${i.number} summas ${t} maksetähtaeg oli ${i.due} (${late} päeva tagasi) ja ma ei ole makset veel näinud. Palun tasuge see: ${pay.replace("reference number", "viitenumber")}.\n\nKui olete juba maksnud, siis palun vabandust ja andke mulle teada.\n\nLugupidamisega\n${me}`
    : `Hello${i.buyer.name ? ` ${i.buyer.name}` : ""},\n\nA friendly reminder that invoice ${i.number} for ${t} was due on ${i.due} (${late} day${late === 1 ? "" : "s"} ago) and I haven't seen the payment yet. Please pay it to ${pay}.\n\nIf you've already paid, thank you, and please ignore this message.\n\nBest regards,\n${me}`;
  const subject = (lang === "Estonian" ? `Meeldetuletus: arve ${i.number}` : `Reminder: invoice ${i.number}`) + (me ? ` (${me})` : "");
  return { text: text.trim(), subject: subject.replace(/[\r\n]+/g, " ").slice(0, 150), at: new Date(now).toISOString() }; // at doubles as the version he approves
}
/** The exact email a reminder approval covers (approval-pure contentHash; the panel and Remote hash the same shape). */
export const reminderContent = (i: Pick<Invoice, "buyer" | "reminder">) => ({ to: emailIn(i.buyer.email) ?? "", subject: i.reminder?.subject ?? "", text: i.reminder?.text ?? "" });
/** Why his approve click can't go ahead ("" = it can): a draft is waiting and it is still overdue. Its exact version is checked by approvalGate. */
export function approveProblem(i: Invoice | undefined, today: string): string {
  if (!i) return "Not found";
  if (!i.reminder) return "No reminder is waiting";
  if (!isOverdue(i, today)) return "It's no longer overdue (paid or not sent)";
  return "";
}
/** Overdue invoices that may get a reminder draft now: never reminded, or the last one is a week old. */
export const remindDue = (list: Invoice[], today: string) =>
  list.filter((i) => isOverdue(i, today) && !i.reminder && !(i.reminded.length && daysBetween(localDay(new Date(i.reminded.at(-1)!.at)), today) < REMIND_AGAIN_DAYS));

// ---- Morning brief / night report lines ----------------------------------------------

/** "2 invoices overdue: €1,240.00 (oldest Cake Shop, 9 days late)"; "" when none. */
export function overdueLine(list: Invoice[], today: string): string {
  const od = list.filter((i) => isOverdue(i, today)).sort((a, b) => a.due.localeCompare(b.due));
  if (!od.length) return "";
  const sum = od.reduce((a, i) => a + totals(i).gross, 0), o = od[0];
  return `${od.length} invoice${od.length === 1 ? "" : "s"} overdue: ${euro(sum)} (oldest ${o.buyer.name}, ${daysLate(o, today)} days late)`;
}
/** Brief decisions: reminder drafts waiting for his approval (they only open BUSINESS). */
export const briefInvoices = (list: Invoice[], today: string) =>
  list.filter((i) => i.reminder && isOverdue(i, today)).slice(0, 3).map((i) => ({
    id: `invoice:${i.id}`, title: `Reminder to ${i.buyer.name}`, what: `the payment reminder to ${i.buyer.name} for invoice ${i.number}`, open: { panel: "business" as const },
  }));

// ---- Phone remote (approvals list + push) ----------------------------------------

/** Reminder drafts waiting for his click, as phone approval items (remote.ts adds the HMAC id). `to` only when approving
 *  will email it (same rule as approveReminder); otherwise he copies the text himself. seen = the draft's `at`, echoed back exactly on approve. */
export const remoteInvoices = (list: Invoice[], today: string, canEmail: boolean) =>
  list.filter((i) => i.reminder && isOverdue(i, today)).map((i) => ({
    key: `invoice:${i.id}`, title: `Invoice ${i.number}`, detail: "BUSINESS invoice reminder", buyer: i.buyer.name, amount: euro(totals(i).gross),
    daysLate: daysLate(i, today), message: i.reminder!.text, content: reminderContent(i), ...(canEmail && emailIn(i.buyer.email) && { to: emailIn(i.buyer.email)! }),
  }));

export const PUSH_AGAIN_DAYS = 7;
/** Waiting reminders to push about now: at most once per invoice per week (pushedAt is stamped by the caller before sending). */
export function invoicePushes(list: Invoice[], today: string, now: number) {
  return list.filter((i) => i.reminder && isOverdue(i, today) && !(i.pushedAt && now - Date.parse(i.pushedAt) < PUSH_AGAIN_DAYS * 86_400_000)).map((i) => {
    const n = daysLate(i, today);
    return { id: i.id, title: `Invoice ${i.number} is ${n} day${n === 1 ? "" : "s"} overdue — a reminder is ready`, body: "Read it and approve it in Remote." };
  });
}

// ---- PDF ------------------------------------------------------------------------

const A4 = { w: 595, h: 842, m: 50 };
/** Crude wrap by characters (Helvetica averages ~0.5 em). shortcut: not width-exact; use font metrics if long lines overflow. */
const wrap = (s: string, size: number, width: number) => {
  const max = Math.max(10, Math.floor(width / (size * 0.5))), out: string[] = [];
  let cur = "";
  for (const w of s.split(/\s+/)) { if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) out.push(cur);
  return out.length ? out : [""];
};
const money = (c: number) => (c / 100).toFixed(2);

/** The invoice as a one-page A4 PDF (lines beyond the page continue on the next). */
export function invoicePdf(i: Invoice, s: Seller): Uint8Array {
  const pages: PdfPage[] = [];
  let page: PdfPage = { ops: [] }, y = A4.h - A4.m;
  const t = (x: number, font: "F1" | "F2", size: number, str: string) => page.ops.push(pdfText(x, y, font, size, str));
  const right = (xr: number, font: "F1" | "F2", size: number, str: string) => page.ops.push(pdfText(xr - str.length * size * 0.5, y, font, size, str));
  const newPage = () => { pages.push(page); page = { ops: [] }; y = A4.h - A4.m; };
  const tot = totals(i);

  t(A4.m, "F2", 20, `ARVE / INVOICE ${i.number}`); y -= 30;
  const party = (x: number, head: string, p: Party, extra: string[]) => {
    let yy = y;
    page.ops.push(pdfText(x, yy, "F2", 9, head)); yy -= 13;
    for (const l of [p.name, p.address, p.regCode && `Reg. code ${p.regCode}`, p.vatNo && `KMKR ${p.vatNo}`, p.email, ...extra].filter(Boolean) as string[]) {
      page.ops.push(pdfText(x, yy, "F1", 9, l)); yy -= 12;
    }
    return yy;
  };
  const yl = party(A4.m, "Seller / Müüja", s, [s.phone]), yr = party(320, "Buyer / Ostja", i.buyer, []);
  y = Math.min(yl, yr) - 10;
  for (const [k, v] of [["Invoice date / Kuupäev", i.issued], ["Due date / Maksetähtaeg", i.due], ["Reference no / Viitenumber", i.ref]]) { t(A4.m, "F1", 9, k); t(200, "F2", 9, v); y -= 13; }
  y -= 10;
  page.ops.push(`0.5 w ${A4.m} ${y + 12} m ${A4.w - A4.m} ${y + 12} l S`);
  t(A4.m, "F2", 9, "Description / Kirjeldus"); right(380, "F2", 9, "Qty"); right(460, "F2", 9, "Price"); right(A4.w - A4.m, "F2", 9, "Total"); y -= 16;
  for (const [n, l] of i.lines.entries()) {
    const rows = wrap(l.text, 9, 270);
    if (y - rows.length * 12 < A4.m + 120) newPage();
    rows.forEach((r, k) => { t(A4.m, "F1", 9, r); if (!k) { right(380, "F1", 9, String(l.qty)); right(460, "F1", 9, money(l.cents)); right(A4.w - A4.m, "F1", 9, money(tot.lines[n])); } y -= 12; });
  }
  page.ops.push(`0.5 w ${A4.m} ${y + 4} m ${A4.w - A4.m} ${y + 4} l S`); y -= 12;
  const sum = (k: string, v: string, bold = false) => { t(330, bold ? "F2" : "F1", bold ? 11 : 9, k); right(A4.w - A4.m, bold ? "F2" : "F1", bold ? 11 : 9, v); y -= bold ? 16 : 13; };
  sum("Subtotal / Summa", money(tot.net));
  if (i.vat.on) sum(`VAT / Käibemaks ${i.vat.rate}%`, money(tot.vat));
  else sum("VAT / Käibemaks", "not charged");
  sum("Total EUR / Kokku", money(tot.gross), true);
  y -= 14;
  t(A4.m, "F2", 9, "Payment / Makse"); y -= 13;
  for (const l of [`IBAN ${s.iban}${s.bank ? ` (${s.bank})` : ""}`, `Reference no / Viitenumber ${i.ref}`, `Due / Tähtaeg ${i.due}`]) { t(A4.m, "F1", 9, l); y -= 12; }
  if (i.notes) { y -= 8; for (const l of wrap(i.notes, 9, A4.w - 2 * A4.m)) { if (y < A4.m + 20) newPage(); t(A4.m, "F1", 9, l); y -= 12; } }
  pages.push(page);
  pages.forEach((p, k) => p.ops.push(pdfText(A4.m, 28, "F1", 7, `${s.name} · invoice ${i.number} · page ${k + 1} of ${pages.length}`)));
  return pdfDoc(pages, A4, `Invoice ${i.number}`);
}
