// Property-based tests (fast-check, MIT) for invoice, VAT, refund, P&L and bank-reconcile money math.
// Each test states its rule in plain words; fast-check tries thousands of random inputs against it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { DEFAULT_VAT, MAX_CENTS, euro, newInvoice, parseLines, toCents, totals, refCheckDigit, refValid, refNumber, addRefund, refunded, setStatus, type Invoice, type Line, type Seller } from "../src/lib/invoices-pure.ts";
import { VAT_RATES, parseExpense, refundVat, refundVats, monthRow, pnl, emptyStore, type Store } from "../src/lib/money-pure.ts";
import { parseCents, reconcile, type BankLine } from "../src/lib/reconcile-pure.ts";

const RUNS = { numRuns: 3000 };
const NOW = Date.parse("2026-10-26T10:00:00.000Z");

// Exact half-up rounding of a/b for non-negative integers (no floats).
const halfUp = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

const line = fc.record({ text: fc.constant("Work"), qty: fc.integer({ min: 1, max: 10_000_000 }).map((q) => q / 1000), cents: fc.integer({ min: 0, max: 1_000_000 }) });
const vatRate = fc.oneof(fc.constantFrom(...VAT_RATES), fc.integer({ min: 0, max: 5000 }).map((bp) => bp / 100));
const inv = fc.record({ lines: fc.array(line, { minLength: 1, maxLength: 20 }), vat: fc.record({ on: fc.boolean(), rate: vatRate }) });

test("Estonian standard VAT default is 24 % (EMTA: from 1 July 2025)", () => {
  assert.equal(DEFAULT_VAT, 24);
  assert.deepEqual(VAT_RATES, [24, 13, 9, 0]);
});

test("invoice total = sum of lines + VAT, never negative, each line rounded half up to the exact cent", () => {
  fc.assert(fc.property(inv, (i) => {
    const t = totals(i);
    assert.equal(t.net, t.lines.reduce((a, b) => a + b, 0));
    assert.equal(t.gross, t.net + t.vat);
    assert.ok(t.net >= 0 && t.vat >= 0 && t.gross >= t.net);
    i.lines.forEach((l, k) => {
      const q = Math.round(l.qty * 1000);
      assert.equal(t.lines[k], halfUp(q * l.cents, 1000), `line ${k}: ${l.qty} × ${l.cents}`);
      assert.ok(Math.abs(t.lines[k] - l.qty * l.cents) <= 0.5 + 1e-6, "rounding never moves a line by more than half a cent");
    });
    for (const x of [t.net, t.vat, t.gross, ...t.lines]) assert.ok(Number.isSafeInteger(x), "money stays whole cents");
  }), RUNS);
});

test("VAT is the rate on the net, rounded half up once (never per line), and 0 when VAT is off", () => {
  fc.assert(fc.property(inv, (i) => {
    const t = totals(i);
    if (!i.vat.on) return assert.equal(t.vat, 0);
    const bp = Math.round(i.vat.rate * 100);
    assert.equal(t.vat, halfUp(t.net * bp, 10_000), `net ${t.net} at ${i.vat.rate} %`);
  }), RUNS);
});

test("regression: 1.005 × €1.00 is €1.01 and 264.174 × €9082.50 is €2,399,360.36 (float lost a cent on both)", () => {
  assert.deepEqual(totals({ lines: [{ text: "x", qty: 1.005, cents: 100 }], vat: { on: false, rate: 24 } }).lines, [101]);
  assert.deepEqual(totals({ lines: [{ text: "Work", qty: 264.174, cents: 908250 }, { text: "Work", qty: 0.001, cents: 0 }], vat: { on: false, rate: 0 } }).lines, [239936036, 0]); // fast-check counterexample
  assert.equal(totals({ lines: [{ text: "x", qty: 1, cents: 100 }], vat: { on: true, rate: 0.5 } }).vat, 1);
  assert.equal(totals({ lines: [{ text: "x", qty: 1, cents: 1000 }], vat: { on: true, rate: 22.05 } }).vat, 221); // 220.5 → 221
});

test("typed euros → cents: what euro() prints reads back as the same cents", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: MAX_CENTS }), (c) => {
    assert.equal(toCents(euro(c)), c);
    assert.equal(toCents(euro(c).replace(".", ",")), c); // Estonian keyboard
    assert.match(euro(c), /^€\d+\.\d{2}$/);
  }), RUNS);
});

test("parsed invoice lines never carry a negative or over-limit price", () => {
  fc.assert(fc.property(fc.array(fc.record({ text: fc.string({ maxLength: 5 }), qty: fc.oneof(fc.double(), fc.string()), price: fc.oneof(fc.double(), fc.string({ maxLength: 12 })) }), { minLength: 1, maxLength: 3 }), (v) => {
    const r = parseLines(v);
    if (typeof r === "string") return;
    for (const l of r as Line[]) assert.ok(l.cents >= 0 && l.cents <= MAX_CENTS && Number.isInteger(l.cents) && l.qty > 0 && l.qty <= 10_000);
  }), RUNS);
});

test("regression (fast-check counterexample [{qty: 5e-324}]): a quantity that rounds to 0 is refused, not saved as 0", () => {
  assert.equal(typeof parseLines([{ text: "!", qty: 5e-324, price: "0" }]), "string");
  assert.equal(typeof parseLines([{ text: "x", qty: "0,0004", price: "1" }]), "string");
});

test("7-3-1 reference numbers: every generated one checks out, and changing any one digit breaks it", () => {
  fc.assert(fc.property(fc.stringMatching(/^[0-9]{1,19}$/), fc.nat(), fc.integer({ min: 1, max: 9 }), (base, at, bump) => {
    const ref = refNumber(base);
    assert.ok(refValid(ref));
    const k = at % ref.length, bad = ref.slice(0, k) + ((Number(ref[k]) + bump) % 10) + ref.slice(k + 1);
    assert.ok(!refValid(bad), `${ref} → ${bad}`);
    assert.ok(refCheckDigit(base) >= 0 && refCheckDigit(base) <= 9);
  }), RUNS);
});

// ---- refunds and the P&L ----

const seller: Seller = { name: "A OÜ", regCode: "12345678", vatNo: "EE123456789", address: "Tallinn", email: "", iban: "EE382200221020145685", bank: "", phone: "" };
const paidInvoice = (cents: number, rate: number): Invoice => {
  const i = newInvoice("i1", { source: { kind: "prospect", id: "p", label: "x" }, buyer: { name: "Shop" }, line: { text: "Work", cents } }, seller, [], NOW);
  const s = setStatus({ ...i, vat: { on: true, rate } }, "sent", NOW, seller) as Invoice;
  return setStatus(s, "paid", NOW, seller, "2026-10-26") as Invoice;
};

test("refunds never exceed what was paid, and refunding it all in pieces cancels exactly its VAT and income", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 5_000_000 }), fc.constantFrom(24, 13, 9, 22), fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 6 }), (net, rate, parts) => {
    let i = paidInvoice(net, rate);
    const t = totals(i), sum = parts.reduce((a, b) => a + b, 0);
    let left = t.gross;
    parts.forEach((p, k) => { // split the gross into pieces in proportion to `parts`, the last takes the rest
      const c = k === parts.length - 1 ? left : Math.min(left, Math.max(1, Math.floor((t.gross * p) / sum)));
      if (c <= 0) return;
      const next = addRefund(i, { amount: (c / 100).toFixed(2), day: "2026-10-27" }, NOW);
      assert.equal(typeof next, "object", String(next));
      i = next as Invoice; left -= c;
    });
    assert.equal(refunded(i), t.gross);
    assert.equal(typeof addRefund(i, { amount: "0.01", day: "2026-10-27" }, NOW), "string", "nothing left to refund");
    const vats = refundVats(i);
    assert.equal(vats.reduce((a, b) => a + b, 0), t.vat, "refund VAT adds up to the invoice VAT");
    vats.forEach((v, k) => assert.ok(Math.abs(v - refundVat(i.refunds![k].cents, t)) <= 1, "each piece is its fair share ±1 cent"));
    const store: Store = { ...emptyStore(), settings: { ...emptyStore().settings, vatRegistered: true } };
    const r = monthRow({ invoices: [i], store, credits: [] }, "2026-10");
    assert.equal(r.income, 0, "fully refunded: no income left");
    assert.equal(r.incomeVat, 0);
    assert.equal(r.outVat, 0, "fully refunded: no output VAT left to declare");
  }), { numRuns: 1500 });
});

test("regression (fast-check counterexample [494, 24, [1, 214, 193]]): €4.94 + 24 % refunded as €0.01 + €3.21 + €2.91 left 1 cent of output VAT", () => {
  let i = paidInvoice(494, 24); // gross €6.13, VAT €1.19
  for (const a of ["0.01", "3.21", "2.91"]) i = addRefund(i, { amount: a, day: "2026-10-27" }, NOW) as Invoice;
  assert.equal(refunded(i), 613);
  assert.deepEqual(refundVats(i), [0, 63, 56]); // old per-piece rounding gave 0 + 62 + 56 = 118 of 119
  const store: Store = { ...emptyStore(), settings: { ...emptyStore().settings, vatRegistered: true } };
  assert.equal(monthRow({ invoices: [i], store, credits: [] }, "2026-10").outVat, 0);
});

test("expense VAT worked out of a receipt total: 0 ≤ VAT ≤ total, net + VAT = total, and the rate holds to a cent", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: MAX_CENTS }), fc.constantFrom(...VAT_RATES), (gross, rate) => {
    const e = parseExpense({ day: "2026-10-01", category: "software", amount: (gross / 100).toFixed(2), vatRate: rate }, "e1", NOW);
    assert.equal(typeof e, "object");
    const x = e as Exclude<typeof e, string>;
    assert.equal(x.gross, gross);
    assert.ok(x.vat >= 0 && x.vat <= gross && Number.isInteger(x.vat));
    assert.ok(Math.abs((gross - x.vat) * rate / 100 - x.vat) <= 1, "VAT ≈ rate × net within a cent");
  }), RUNS);
});

test("P&L for a quarter or year is exactly the sum of its months; profit = income − costs − ORBIT spend", () => {
  const expense = fc.record({ day: fc.integer({ min: 1, max: 28 }).chain((d) => fc.integer({ min: 1, max: 12 }).map((m) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`)),
    gross: fc.integer({ min: 1, max: 1_000_000 }), vatPct: fc.integer({ min: 0, max: 100 }) });
  fc.assert(fc.property(fc.array(expense, { maxLength: 15 }), fc.boolean(), fc.double({ min: 0, max: 2, noNaN: true }), (ex, reg, eurPerUsd) => {
    const store: Store = { ...emptyStore(), settings: { ...emptyStore().settings, vatRegistered: reg, eurPerUsd },
      expenses: ex.map((e, k) => ({ id: `e${k}`, day: e.day, category: "software", gross: e.gross, vat: Math.floor((e.gross * e.vatPct) / 100), note: "", receipt: null, created: "" })),
      apiUsd: { "2026-03-04": 1.2345, "2026-11-30": 0.5 } };
    const y = pnl({ invoices: [], store, credits: [] }, "2026");
    assert.equal(typeof y, "object");
    const p = y as Exclude<typeof y, string>;
    for (const r of p.rows) assert.equal(r.profit, r.income - r.costs - r.orbitApi - r.orbitHf);
    for (const k of ["income", "costs", "orbitApi", "orbitHf", "profit", "inVat", "outVat"] as const) assert.equal(p.sum[k], p.rows.reduce((a, r) => a + r[k], 0));
    assert.equal(p.byCategory.reduce((a, c) => a + c.cents, 0), p.sum.costs, "category split adds up to the costs");
    for (const r of p.rows) assert.ok(Number.isSafeInteger(r.costs) && Number.isSafeInteger(r.orbitApi));
  }), { numRuns: 800 });
});

// ---- bank CSV ----

const fmtAmount = (c: number, style: number) => {
  const neg = c < 0, a = Math.abs(c), whole = String(Math.floor(a / 100)), frac = String(a % 100).padStart(2, "0");
  const group = (sep: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const s = [`${whole},${frac}`, `${whole}.${frac}`, `${group(" ")},${frac}`, `${group(".")},${frac}`, `${group(",")}.${frac}`, `${group("'")}.${frac}`][style];
  return (neg ? "-" : "") + s;
};

test("bank amounts in every Estonian/English export style read back to the exact cent", () => {
  fc.assert(fc.property(fc.integer({ min: -10_000_000_000, max: 10_000_000_000 }), fc.integer({ min: 0, max: 5 }), (c, style) => {
    assert.equal(parseCents(fmtAmount(c, style)), c, fmtAmount(c, style));
  }), RUNS);
});

test("reconcile: a bank line pays at most one invoice, an invoice is paid at most once, and only by its exact gross", () => {
  const sentInv = (k: number, cents: number): Invoice => {
    const i = newInvoice(`i${k}`, { source: { kind: "prospect", id: "p", label: "x" }, buyer: { name: `B${k % 3}` }, line: { text: "W", cents } }, seller, [], NOW);
    return { ...i, number: `2026-${String(k + 1).padStart(3, "0")}`, ref: refNumber(`2026${String(k + 1).padStart(3, "0")}`), status: "sent", sentAt: "", issued: "2026-10-01", due: "2026-10-15" };
  };
  fc.assert(fc.property(fc.array(fc.constantFrom(1000, 2000, 2480, 5000), { minLength: 1, maxLength: 8 }), fc.array(fc.record({ c: fc.constantFrom(1240, 2480, 3100, 6200, -500), ref: fc.boolean(), k: fc.nat(7), d: fc.integer({ min: 1, max: 28 }) }), { maxLength: 10 }), (nets, ls) => {
    const invoices = nets.map((n, k) => sentInv(k, n));
    const lines: BankLine[] = ls.map((l, row) => ({ row: row + 2, day: `2026-10-${String(l.d).padStart(2, "0")}`, cents: l.c, name: "x", ref: l.ref ? invoices[l.k % invoices.length].ref : "", text: "" }));
    const r = reconcile(lines, invoices);
    const ids = r.matched.map((m) => m.invoice.id), rows = r.matched.map((m) => m.line.row);
    assert.equal(new Set(ids).size, ids.length, "an invoice is matched once");
    assert.equal(new Set(rows).size, rows.length, "a bank line is matched once");
    for (const m of r.matched) assert.equal(m.line.cents, totals(m.invoice).gross);
    assert.equal(r.matched.length + r.bankOnly.length, lines.filter((l) => l.cents > 0).length, "every money-in line is either matched or listed");
    for (const m of r.months) assert.equal(m.diff, m.bank - m.invoices);
  }), { numRuns: 2000 });
});
