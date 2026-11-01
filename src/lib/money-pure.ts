// Money view (roadmap 3), pure, tested in tests/money.test.ts. IO: money.ts; API: /api/business/money; UI: MoneyPanel.tsx.
// Monthly profit & loss in cents: income = paid invoices (by paid day), costs = expenses he logs + ORBIT's own spend
// (Claude API-equivalent USD and approved Higgsfield credits, each converted with a rate he sets; 0 = not counted).
// VAT summary per month (KMD is monthly in Estonia) and a deadline calendar for FIE or OÜ. Not tax advice: he checks with an accountant.
import { totals, toCents, MAX_CENTS, euro, inLast, isOverdue, type Invoice } from "./invoices-pure.ts";
import { localDay } from "./morning-pure.ts";

export const FORMS = ["FIE", "OÜ"] as const;
export type Form = (typeof FORMS)[number];
export const CATEGORIES = ["software", "hardware", "ads", "services", "office", "travel", "fees", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const VAT_RATES = [24, 13, 9, 0]; // Estonia: standard 24 % (from 1 July 2025), reduced 13 % and 9 %
export const RECEIPT_TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };
export const MAX_RECEIPT = 10 * 1024 * 1024;

export type Expense = { id: string; day: string; category: Category; gross: number; vat: number; note: string; receipt: string | null; created: string };
export type Settings = { form: Form | ""; vatRegistered: boolean; vatBasis: "invoice" | "cash"; eurPerUsd: number; eurPerCredit: number;
  revenueTarget?: number }; // € per month he aims to be paid (BUSINESS overview); 0 or missing = none
export type Store = { settings: Settings; expenses: Expense[]; vatPaid: Record<string, number>; apiUsd: Record<string, number> };
export const DEFAULT_SETTINGS: Settings = { form: "", vatRegistered: false, vatBasis: "invoice", eurPerUsd: 0, eurPerCredit: 0 };
export const emptyStore = (): Store => ({ settings: { ...DEFAULT_SETTINGS }, expenses: [], vatPaid: {}, apiUsd: {} });

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max) : "");
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// ---- Trust boundary: request bodies -------------------------------------------------

/** His expense form → an expense. `gross` is the receipt total (with VAT); VAT is a rate (worked out of the total) or an amount. */
export function parseExpense(b: Record<string, unknown>, id: string, now: number): Expense | string {
  const day = b.day === undefined || b.day === "" ? localDay(new Date(now)) : b.day;
  if (!isDay(day)) return "Date must be YYYY-MM-DD";
  if (!CATEGORIES.includes(b.category as Category)) return `Category must be one of ${CATEGORIES.join(", ")}`;
  const gross = toCents(b.amount);
  if (!(gross > 0 && gross <= MAX_CENTS)) return "Amount must be a positive sum in euros, like 12.50";
  let vat: number;
  if (b.vat !== undefined && b.vat !== "") { vat = toCents(b.vat); if (!(vat >= 0 && vat <= gross)) return "VAT must be between 0 and the amount"; }
  else {
    const rate = Number(b.vatRate ?? 0);
    if (!VAT_RATES.includes(rate)) return `VAT rate must be one of ${VAT_RATES.join(", ")} %`;
    vat = Math.round((gross * rate) / (100 + rate));
  }
  return { id, day, category: b.category as Category, gross, vat, note: clean(b.note, 200), receipt: null, created: new Date(now).toISOString() };
}

const rate = (v: unknown, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= hi ? n : null;
};

export function patchSettings(b: Record<string, unknown>, cur: Settings): Settings | string {
  const s = { ...cur };
  if (b.form !== undefined) { if (b.form !== "" && !FORMS.includes(b.form as Form)) return "Form must be FIE or OÜ"; s.form = b.form as Form | ""; }
  if (b.vatRegistered !== undefined) { if (typeof b.vatRegistered !== "boolean") return "vatRegistered must be true or false"; s.vatRegistered = b.vatRegistered; }
  if (b.vatBasis !== undefined) { if (b.vatBasis !== "invoice" && b.vatBasis !== "cash") return "VAT basis must be invoice or cash"; s.vatBasis = b.vatBasis; }
  if (b.eurPerUsd !== undefined) { const v = rate(b.eurPerUsd, 10); if (v === null) return "€ per USD must be 0-10"; s.eurPerUsd = v; }
  if (b.eurPerCredit !== undefined) { const v = rate(b.eurPerCredit, 100); if (v === null) return "€ per Higgsfield credit must be 0-100"; s.eurPerCredit = v; }
  if (b.revenueTarget !== undefined) { const v = rate(b.revenueTarget, 10_000_000); if (v === null) return "Monthly target must be €0-10,000,000"; s.revenueTarget = Math.round(v); }
  return s;
}

/** A receipt upload's stored name (`<expense id>.<ext>`), or an error. */
export function receiptName(id: string, fileName: string, size: number): string | { error: string } {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
  if (!RECEIPT_TYPES[ext]) return { error: "Receipt must be a PDF or a photo (jpg, png, webp, heic)" };
  if (!(size > 0 && size <= MAX_RECEIPT)) return { error: "Receipt can be at most 10 MB" };
  if (!/^[\w-]{1,64}$/.test(id)) return { error: "Bad expense id" };
  return `${id}.${ext}`;
}

// ---- ORBIT's own spend ------------------------------------------------------------

/** Folds the usage meter's calls (kept 7 days) into per-day API-equivalent USD that is kept for good. The oldest, partly
 *  forgotten day is skipped; newer days are recomputed whole, so folding again never double counts. */
export function foldApi(apiUsd: Record<string, number>, calls: { at: number; cost?: number }[], now: number): Record<string, number> {
  const oldest = localDay(new Date(now - 7 * 86_400_000)), out = { ...apiUsd }, fresh: Record<string, number> = {};
  for (const c of calls) {
    const d = localDay(new Date(c.at));
    if (d > oldest && c.at <= now) fresh[d] = (fresh[d] ?? 0) + (Number.isFinite(c.cost) ? c.cost! : 0);
  }
  for (const [d, v] of Object.entries(fresh)) out[d] = Math.round(v * 1e4) / 1e4;
  return out;
}

// ---- Periods and the P&L ------------------------------------------------------------

/** "2026-10" (month), "2026-Q4" (quarter) or "2026" (year) → its months. */
export function monthsOf(period: string): string[] | null {
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2])|-Q([1-4]))?$/.exec(period);
  if (!m) return null;
  if (m[2]) return [period];
  const from = m[3] ? (Number(m[3]) - 1) * 3 + 1 : 1, n = m[3] ? 3 : 12;
  return Array.from({ length: n }, (_, i) => `${m[1]}-${String(from + i).padStart(2, "0")}`);
}

export type Inputs = { invoices: Invoice[]; store: Store; credits: { at: string; credits: number }[] };
export type Row = {
  month: string; income: number; incomeVat: number; costs: number; orbitApi: number; orbitHf: number; profit: number;
  outVat: number; inVat: number; vatOwed: number; vatPaid: number;
};

/** The VAT share of a refund: the same share the invoice's total had. */
export const refundVat = (cents: number, t: { vat: number; gross: number }) => (t.gross ? Math.round((cents * t.vat) / t.gross) : 0);

const zero = (month: string): Row => ({ month, income: 0, incomeVat: 0, costs: 0, orbitApi: 0, orbitHf: 0, profit: 0, outVat: 0, inVat: 0, vatOwed: 0, vatPaid: 0 });

/** One month in cents. Income is paid invoices by paid day (cash), net of VAT. A VAT-registered expense costs its net and its VAT
 *  is input VAT; otherwise the whole receipt is cost. Output VAT follows his basis: invoice day (sent or paid ones) or paid day. */
export function monthRow(x: Inputs, month: string): Row {
  const s = x.store.settings, r: Row = { ...zero(month), vatPaid: x.store.vatPaid[month] ?? 0 };
  for (const i of x.invoices) {
    if (i.status === "draft") continue;
    const t = totals(i), paidHere = i.status === "paid" && i.paidAt?.startsWith(month);
    if (paidHere) { r.income += t.net; r.incomeVat += t.vat; }
    if (s.vatRegistered && (s.vatBasis === "cash" ? paidHere : i.issued.startsWith(month))) r.outVat += t.vat;
    for (const f of i.refunds ?? []) { // a refund lowers income (and output VAT, like a credit note) in the month it was paid back
      if (!f.day.startsWith(month)) continue;
      const vat = refundVat(f.cents, t);
      r.income -= f.cents - vat; r.incomeVat -= vat;
      if (s.vatRegistered) r.outVat -= vat;
    }
  }
  for (const e of x.store.expenses) {
    if (!e.day.startsWith(month)) continue;
    r.costs += s.vatRegistered ? e.gross - e.vat : e.gross;
    if (s.vatRegistered) r.inVat += e.vat;
  }
  const usd = Object.entries(x.store.apiUsd).reduce((a, [d, v]) => (d.startsWith(month) ? a + v : a), 0);
  const credits = x.credits.reduce((a, c) => (localDay(new Date(c.at)).startsWith(month) && Number.isFinite(c.credits) ? a + c.credits : a), 0);
  r.orbitApi = Math.round(usd * s.eurPerUsd * 100);
  r.orbitHf = Math.round(credits * s.eurPerCredit * 100);
  r.profit = r.income - r.costs - r.orbitApi - r.orbitHf;
  r.vatOwed = r.outVat - r.inVat; // negative = EMTA owes him
  return r;
}

export type Pnl = { period: string; rows: Row[]; sum: Row; margin: number | null; byCategory: { category: Category; cents: number }[] };

export function pnl(x: Inputs, period: string): Pnl | string {
  const months = monthsOf(period);
  if (!months) return "Period must be YYYY-MM, YYYY-Q1…Q4 or YYYY";
  const rows = months.map((m) => monthRow(x, m)), sum = zero(period);
  for (const r of rows) for (const k of Object.keys(sum) as (keyof Row)[]) if (k !== "month") (sum[k] as number) += r[k] as number;
  const cat = new Map<Category, number>();
  for (const e of x.store.expenses) if (months.some((m) => e.day.startsWith(m))) cat.set(e.category, (cat.get(e.category) ?? 0) + (x.store.settings.vatRegistered ? e.gross - e.vat : e.gross));
  return {
    period, rows, sum, margin: sum.income > 0 ? Math.round((sum.profit * 1000) / sum.income) / 10 : null,
    byCategory: [...cat].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
  };
}

// ---- CSV for the accountant ---------------------------------------------------------

const cell = (v: string | number) => {
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`; // spreadsheet formula injection (a plain negative amount is safe)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const eur = (c: number) => (c / 100).toFixed(2);
const line = (xs: (string | number)[]) => xs.map(cell).join(",");

/** Every income and cost line in the period, then the monthly VAT summary. Amounts in euros with a dot. */
export function toCsv(x: Inputs, p: Pnl): string {
  const months = p.rows.map((r) => r.month), inP = (d: string | null) => !!d && months.some((m) => d.startsWith(m));
  const out = [line(["date", "type", "number_or_category", "party_or_note", "net_eur", "vat_eur", "gross_eur", "receipt_file"])];
  for (const i of [...x.invoices].filter((i) => i.status === "paid" && inP(i.paidAt)).sort((a, b) => a.paidAt!.localeCompare(b.paidAt!))) {
    const t = totals(i);
    out.push(line([i.paidAt!, "income", i.number, i.buyer.name, eur(t.net), eur(t.vat), eur(t.gross), ""]));
  }
  for (const i of x.invoices) for (const f of i.refunds ?? []) if (inP(f.day)) {
    const vat = refundVat(f.cents, totals(i));
    out.push(line([f.day, "refund", i.number, `${i.buyer.name}${f.note ? `: ${f.note}` : ""}`, eur(vat - f.cents), eur(-vat), eur(-f.cents), ""]));
  }
  for (const e of [...x.store.expenses].filter((e) => inP(e.day)).sort((a, b) => a.day.localeCompare(b.day)))
    out.push(line([e.day, "expense", e.category, e.note, eur(e.gross - e.vat), eur(e.vat), eur(e.gross), e.receipt ?? ""]));
  for (const r of p.rows) {
    if (r.orbitApi) out.push(line([`${r.month}-01`, "orbit-api", "software", "Claude API-equivalent use (converted)", eur(r.orbitApi), "0.00", eur(r.orbitApi), ""]));
    if (r.orbitHf) out.push(line([`${r.month}-01`, "orbit-higgsfield", "software", "Higgsfield credits approved (converted)", eur(r.orbitHf), "0.00", eur(r.orbitHf), ""]));
  }
  out.push("", line(["month", "income_net_eur", "costs_eur", "orbit_eur", "profit_eur", "output_vat_eur", "input_vat_eur", "vat_owed_eur", "vat_paid_eur"]));
  for (const r of [...p.rows, p.sum]) out.push(line([r.month, eur(r.income), eur(r.costs), eur(r.orbitApi + r.orbitHf), eur(r.profit), eur(r.outVat), eur(r.inVat), eur(r.vatOwed), eur(r.vatPaid)]));
  return out.join("\r\n") + "\r\n";
}

// ---- The money split (BUS06): one definition for BUSINESS, Money and the morning/night digests --------------------------

export const WINDOW_DAYS = 30;
export type Item = { id: string; label: string; cents: number; kind: "client" | "invoice" | "expense" };
export type Bucket = { cents: number; items: Item[] };
/** expected: paying clients' monthly fees, not cash. pipeline: fees of replies and pilots, not cash either.
 *  invoiced: sent and not paid (overdue is part of it). paid: invoices he marked paid in the window. refunds and expenses: paid out in the window.
 *  kept = paid - refunds - expenses: the only figure here that is cash he kept. All in cents, gross (as on the bank statement). */
export type Split = { days: number; today: string; expected: Bucket; pipeline: Bucket; invoiced: Bucket; overdue: Bucket; paid: Bucket; refunds: Bucket; expenses: Bucket; kept: number; drafts: number };
export type Client = { id: string; name: string; stage: string; fee: number };

const bucket = (items: Item[]): Bucket => ({ cents: items.reduce((a, i) => a + i.cents, 0), items: items.sort((a, b) => b.cents - a.cents) });

export function moneySplit(x: { invoices: Invoice[]; expenses: Expense[]; clients: Client[] }, today: string, days = WINDOW_DAYS): Split {
  const fee = (c: Client): Item => ({ id: c.id, label: c.name, cents: Math.round((Number(c.fee) || 0) * 100), kind: "client" });
  const inv = (i: Invoice, cents: number, label = `${i.number} · ${i.buyer.name}`): Item => ({ id: i.id, label, cents, kind: "invoice" });
  const sent = x.invoices.filter((i) => i.status === "sent");
  const paid = bucket(x.invoices.filter((i) => i.status === "paid" && i.paidAt && inLast(i.paidAt, today, days)).map((i) => inv(i, totals(i).gross)));
  const refunds = bucket(x.invoices.flatMap((i) => (i.refunds ?? []).filter((f) => inLast(f.day, today, days)).map((f) => inv(i, f.cents, `${i.number} · ${i.buyer.name} · ${f.day}`))));
  const expenses = bucket(x.expenses.filter((e) => inLast(e.day, today, days)).map((e) => ({ id: e.id, label: `${e.day} · ${e.category}${e.note ? ` · ${e.note}` : ""}`, cents: e.gross, kind: "expense" as const })));
  return {
    days, today,
    expected: bucket(x.clients.filter((c) => c.stage === "paying" && c.fee > 0).map(fee)),
    pipeline: bucket(x.clients.filter((c) => (c.stage === "pilot" || c.stage === "replied") && c.fee > 0).map(fee)),
    invoiced: bucket(sent.map((i) => inv(i, totals(i).gross))),
    overdue: bucket(sent.filter((i) => isOverdue(i, today)).map((i) => inv(i, totals(i).gross))),
    paid, refunds, expenses, kept: paid.cents - refunds.cents - expenses.cents,
    drafts: x.invoices.filter((i) => i.status === "draft").length,
  };
}

/** The digest line (morning card, night report), built from the split so it can't disagree with BUSINESS → Money. "" when there is nothing. */
export function moneyLine(s: Split, overdueDetail = ""): string {
  const cash = [s.paid.cents && `${euro(s.paid.cents)} paid in`, s.refunds.cents && `${euro(s.refunds.cents)} refunded`, s.expenses.cents && `${euro(s.expenses.cents)} spent`].filter(Boolean);
  const parts = [
    cash.length && `last ${s.days} days ${cash.join(", ")}`,
    s.invoiced.cents && `${euro(s.invoiced.cents)} invoiced, not paid yet`,
    s.overdue.cents && (overdueDetail || `${euro(s.overdue.cents)} overdue`),
    s.expected.cents && `${euro(s.expected.cents)}/month expected from clients (not cash)`,
  ].filter(Boolean);
  return parts.length ? `Money: ${parts.join(" · ")}` : "";
}

export const setVatPaid = (s: Store, month: unknown, amount: unknown): string => {
  if (!isMonth(month)) return "Month must be YYYY-MM";
  const c = amount === "" || amount === null ? 0 : toCents(amount);
  if (!(c >= 0 && c <= MAX_CENTS)) return "Paid VAT must be a sum in euros";
  if (c) s.vatPaid[month] = c; else delete s.vatPaid[month];
  return "";
};

// ---- Estonian deadlines ----------------------------------------------------------------

export const SOURCES = {
  kmd: "https://emta.ee/ariklient/maksud-ja-tasumine/kaibemaks/kaibedeklaratsiooni-ja-aruannete-esitamine/maksustamisperiood",
  fie: "https://www.emta.ee/en/business-client/registration-business/businesses/self-employed-persons/self-employed-persons-tax-calendar",
  tsd: "https://emta.ee/en/business-client/taxes-and-payment/income-and-social-taxes/taxation-dividends",
  annual: "https://www.rik.ee/en/e-business-register/annual-report",
};
export type Deadline = { day: string; title: string; note: string; source: string; daysLeft: number };

// shortcut: fixed-date public holidays only (Good Friday / Easter / Pentecost not shifted), fine for the 10th/15th/20th; add Easter if a deadline ever lands on one.
const HOLIDAYS = ["01-01", "02-24", "05-01", "06-23", "06-24", "08-20", "12-24", "12-25", "12-26"];
const DAY = 86_400_000;
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
/** A deadline on a weekend or public holiday moves to the next working day (EMTA's calendar shows 15 March 2026, a Sunday, as 16 March). */
export function workday(day: string): string {
  let t = Date.parse(`${day}T00:00:00Z`);
  for (;;) {
    const d = new Date(t), wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !HOLIDAYS.includes(d.toISOString().slice(5, 10))) return d.toISOString().slice(0, 10);
    t += DAY;
  }
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The next deadlines within `days` of today for his form; VAT ones only when he is VAT-registered. */
export function deadlines(s: Settings, today: string, days = 100): Deadline[] {
  const [y0, m0] = today.split("-").map(Number), out: Omit<Deadline, "daysLeft">[] = [];
  for (let k = -1; k <= Math.ceil(days / 28) + 1; k++) {
    const y = y0 + Math.floor((m0 - 1 + k) / 12), m = ((m0 - 1 + k) % 12 + 12) % 12 + 1; // month the deadline falls in
    const prev = MONTHS[(m + 10) % 12];
    if (s.vatRegistered) out.push({ day: ymd(y, m, 20), title: `KMD + KMD INF for ${prev}, and pay the VAT`, note: "VAT return for last month", source: SOURCES.kmd });
    if (s.form) out.push({ day: ymd(y, m, 10), title: `TSD for ${prev}`, note: s.form === "OÜ" ? "Only if you paid salary or dividends last month (income tax on them is paid by the same day)" : "Only if you paid salaries last month", source: s.form === "OÜ" ? SOURCES.tsd : SOURCES.fie });
    if (s.form === "FIE") {
      if (m % 3 === 0) out.push({ day: ymd(y, m, 15), title: "FIE social tax advance payment", note: "Quarterly advance", source: SOURCES.fie });
      if (m === 9 || m === 12) out.push({ day: ymd(y, m, 15), title: "FIE income tax advance payment", note: "Not needed in some cases: see the EMTA page", source: SOURCES.fie });
      if (m === 4) out.push({ day: ymd(y, m, 30), title: `Income tax return with form E for ${y - 1}`, note: "Annual return of business income", source: SOURCES.fie });
      if (m === 10) out.push({ day: ymd(y, m, 1), title: `Pay extra income tax / social tax for ${y - 1}`, note: "What the return says you still owe", source: SOURCES.fie });
    }
    if (s.form === "OÜ" && m === 6) out.push({ day: ymd(y, m, 30), title: `Annual report for ${y - 1} to the Business Register`, note: "Within 6 months of the financial year's end (calendar year assumed)", source: SOURCES.annual });
  }
  const t0 = Date.parse(`${today}T00:00:00Z`);
  return out.map((d) => { const day = workday(d.day); return { ...d, day, daysLeft: Math.round((Date.parse(`${day}T00:00:00Z`) - t0) / DAY) }; })
    .filter((d) => d.daysLeft >= 0 && d.daysLeft <= days).sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
}
