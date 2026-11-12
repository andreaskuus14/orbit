import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newInvoice, parseSeller, setStatus, type Invoice, type Seller } from "../src/lib/invoices-pure.ts";
import { parseBank, parseCents, parseDay, reconcile } from "../src/lib/reconcile-pure.ts";

const fx = (n: string) => readFileSync(new URL(`./fixtures/bank/${n}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-01T10:00:00Z");
const seller = parseSeller({ name: "A OÜ", regCode: "12345678", vatNo: "EE123456789", address: "Tallinn", iban: "EE38 2200 2210 2014 5685", email: "a@example.com" }) as Seller;
const inv = (id: string, net: number, existing: string[], paidOn?: string): Invoice => {
  const d = newInvoice(id, { source: { kind: "prospect", id, label: id }, buyer: { name: id, email: "b@x.ee" }, line: { text: "Work", cents: net } }, seller, existing, NOW);
  const s = setStatus(d, "sent", NOW, seller) as Invoice;
  return paidOn ? (setStatus(s, "paid", NOW, seller, paidOn) as Invoice) : s;
};

test("cents come from the digits, never floats", () => {
  assert.equal(parseCents("1 240,00"), 124000);
  assert.equal(parseCents("1.234,56"), 123456);
  assert.equal(parseCents("1,234.56"), 123456);
  assert.equal(parseCents("-0,1"), -10);
  assert.equal(parseCents("0.29"), 29); // 0.29*100 is 28.999… as a float
  assert.equal(parseCents("12,345,6"), null);
  assert.equal(parseCents("abc"), null);
  assert.equal(parseDay("05.10.2026"), "2026-10-05");
  assert.equal(parseDay("2026-11-12 10:00"), "2026-11-12");
  assert.equal(parseDay("31.02.2026"), null);
});

test("detects Swedbank, SEB and LHV from the header and normalizes lines", () => {
  const sw = parseBank(fx("swedbank.csv"));
  assert.equal(sw.format, "swedbank");
  assert.deepEqual(sw.lines.map((l) => [l.day, l.cents, l.ref]), [["2026-10-05", 62000, "20260011"], ["2026-10-07", -1299, ""], ["2026-10-20", 5000, ""]]); // balance rows dropped
  const seb = parseBank(fx("seb.csv"));
  assert.equal(seb.format, "seb");
  assert.deepEqual(seb.lines.map((l) => [l.cents, l.name]), [[124000, "Kohvik Tõru OÜ"], [-840, "Bolt"]]);
  const lhv = parseBank(fx("lhv.csv"));
  assert.equal(lhv.format, "lhv");
  assert.equal(lhv.lines[0].cents, 31000);
});

test("generic CSV needs his column mapping", () => {
  const g = parseBank(fx("generic.csv"));
  assert.equal(g.format, "generic");
  assert.ok(g.problem);
  const m = parseBank(fx("generic.csv"), { day: 0, text: 1, amount: 2 });
  assert.equal(m.problem, "");
  assert.deepEqual(m.lines.map((l) => [l.day, l.cents, l.text]), [["2026-11-12", 31000, "Pagar AS, payment"]]);
  assert.deepEqual(m.skipped, [3]);
});

test("reconcile: matches, leftovers on both sides, month totals to the cent", () => {
  const a = inv("a", 50000, []); // 2026-001, €620 gross, ref 20260011, still "sent"
  const b = inv("b", 100000, [a.number]); // 2026-002, €1240, number in the SEB text
  const c = inv("c", 25000, [a.number, b.number], "2026-11-12"); // paid already; LHV line on that day
  const d = inv("d", 1000, [a.number, b.number, c.number], "2026-10-15"); // paid, but no bank line
  const lines = [...parseBank(fx("swedbank.csv")).lines, ...parseBank(fx("seb.csv")).lines, ...parseBank(fx("lhv.csv")).lines];
  const r = reconcile(lines, [a, b, c, d]);
  assert.deepEqual(r.matched.map((m) => [m.invoice.id, m.by, m.markPaid]), [
    ["a", "reference", { id: "a", paidOn: "2026-10-05" }],
    ["b", "number", { id: "b", paidOn: "2026-11-03" }],
    ["c", "amount+date", null],
  ]);
  assert.deepEqual(r.bankOnly.map((l) => l.cents), [5000]); // the €50 gift; money out is never "unmatched income"
  assert.deepEqual(r.paidNoBank.map((i) => i.id), ["d"]);
  assert.deepEqual(r.months, [
    { month: "2026-10", bank: 67000, invoices: 1240, diff: 65760 },
    { month: "2026-11", bank: 155000, invoices: 31000, diff: 124000 },
  ]);
});

test("two equal open invoices with no reference are left for him, not guessed", () => {
  const a = inv("a", 25000, []), b = inv("b", 25000, [a.number]);
  const r = reconcile(parseBank(fx("lhv.csv")).lines.map((l) => ({ ...l, day: "2026-10-05" })), [a, b]);
  assert.equal(r.matched.length, 0);
  assert.equal(r.bankOnly.length, 1);
});

test("Swedbank English header drops balance/turnover rows; unknown row type never treats a balance as income", () => {
  const en = '"Client account";"Row type";"Date";"Beneficiary/Payer";"Details";"Amount";"Currency";"Debit/Credit";"Archive ID";"Transaction type";"Reference number";"Document number"\n'
    + '"EE1";"10";"01.10.2026";"";"Opening balance";"1 000,00";"EUR";"K";"";"AS";"";""\n'
    + '"EE1";"20";"05.10.2026";"Cake";"Invoice";"620,00";"EUR";"K";"";"MK";"20260011";""\n'
    + '"EE1";"82";"31.10.2026";"";"Turnover";"620,00";"EUR";"K";"";"KL";"";""\n"EE1";"86";"31.10.2026";"";"Closing balance";"1 620,00";"EUR";"K";"";"LS";"";""\n';
  const p = parseBank(en);
  assert.equal(p.format, "swedbank");
  assert.deepEqual(p.lines.map((l) => l.cents), [62000]);
  const rec = parseBank(en.replace('"Row type"', '"Record type"'));
  assert.deepEqual(rec.lines.map((l) => l.cents), [62000]);
  const g = parseBank("Date,Text,Amount\n01.10.2026,Algsaldo,1000\n05.10.2026,Pay,620\n", { day: 0, text: 1, amount: 2 });
  assert.deepEqual(g.lines.map((l) => l.cents), [62000]);
});

test("a paid invoice with a later refund still matches its full payment", () => {
  const c = inv("c", 25000, [], "2026-11-12");
  c.refunds = [{ day: "2026-11-20", cents: 5000, note: "partial", at: "x" }];
  const r = reconcile(parseBank(fx("lhv.csv")).lines, [c]);
  assert.deepEqual(r.matched.map((m) => m.invoice.id), ["c"]);
  assert.equal(r.months[0].diff, 0);
});

test("sub-cent amounts are refused", () => {
  assert.equal(parseCents("0,005"), null);
  assert.equal(parseCents("0,05"), 5);
  assert.equal(parseCents("1 234,50"), 123450);
});

test("a file with U+FFFD (wrong encoding) is refused with a clear message, not parsed", () => {
  const p = parseBank("Kuup\uFFFDev;Summa;Selgitus\n05.10.2026;620,00;Tellimus\n");
  assert.deepEqual(p.lines, []);
  assert.match(p.problem, /isn't UTF-8/);
  assert.equal(parseBank("Kuupäev;Summa;Selgitus\n05.10.2026;620,00;Tellimus\n").problem, "", "proper UTF-8 with ä is fine");
});

test("the balance-word guard only applies when the row type is unknown", () => {
  const head = '"Client account";"Row type";"Date";"Beneficiary/Payer";"Details";"Amount";"Currency";"Debit/Credit";"Archive ID";"Transaction type";"Reference number";"Document number"\n';
  const known = parseBank(head + '"EE1";"20";"05.10.2026";"Balance Pilates OÜ";"Turnover bonus";"50,00";"EUR";"K";"";"MK";"";""\n');
  assert.deepEqual(known.lines.map((l) => l.cents), [5000], "a real payment (type 20) is kept even with balance words in its text");
  const unknown = parseBank("Date,Name,Amount\n05.10.2026,Balance Pilates,50\n", { day: 0, name: 1, amount: 2 });
  assert.deepEqual(unknown.lines, []);
  assert.deepEqual(unknown.skipped, [2], "without a row type the balance-like line is skipped and reported");
});
