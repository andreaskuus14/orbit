import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlines, emptyStore, foldApi, monthsOf, parseExpense, patchSettings, pnl, receiptName, setVatPaid, toCsv, workday, type Expense, type Inputs, type Pnl, type Store } from "../src/lib/money-pure.ts";
import type { Invoice } from "../src/lib/invoices-pure.ts";

const NOW = Date.parse("2026-10-26T10:00:00.000Z");
const inv = (o: Partial<Invoice>): Invoice => ({
  id: "i", number: "2026-001", ref: "", source: { kind: "prospect", id: "p", label: "" }, buyer: { name: "Cake Shop", regCode: "", vatNo: "", address: "", email: "" },
  lines: [{ text: "Site", qty: 1, cents: 100_00 }], vat: { on: true, rate: 24 }, issued: "2026-09-25", due: "2026-10-09", status: "paid", sentAt: null,
  paidAt: "2026-10-05", notes: "", reminder: null, reminded: [], created: "", updated: "", ...o,
});
const exp = (o: Partial<Expense> = {}) => ({ ...(parseExpense({ category: "software", amount: "12.40", vatRate: 24, day: "2026-10-03", note: "Hosting" }, "e1", NOW) as Expense), ...o });
const store = (o: Partial<Store> = {}): Store => ({ ...emptyStore(), ...o, settings: { ...emptyStore().settings, ...o.settings } });

test("expenses: gross with VAT worked out of a rate, or an explicit amount; bad input refused", () => {
  const e = exp();
  assert.equal(e.gross, 1240);
  assert.equal(e.vat, 240); // 1240 * 24/124
  assert.equal((parseExpense({ category: "ads", amount: "10", vat: "1,5" }, "e", NOW) as Expense).vat, 150);
  assert.match((parseExpense({ category: "ads", amount: "10" }, "e", NOW) as Expense).day, /^2026-10-2[67]$/); // today, local time
  assert.equal(typeof parseExpense({ category: "beer", amount: "10" }, "e", NOW), "string");
  assert.equal(typeof parseExpense({ category: "ads", amount: "-1" }, "e", NOW), "string");
  assert.equal(typeof parseExpense({ category: "ads", amount: "10", vat: "11" }, "e", NOW), "string");
  assert.equal(typeof parseExpense({ category: "ads", amount: "10", vatRate: 20 }, "e", NOW), "string");
  assert.equal(typeof parseExpense({ category: "ads", amount: "10", day: "2026-02-30" }, "e", NOW), "string");
});

test("periods: month, quarter, year", () => {
  assert.deepEqual(monthsOf("2026-10"), ["2026-10"]);
  assert.deepEqual(monthsOf("2026-Q4"), ["2026-10", "2026-11", "2026-12"]);
  assert.equal(monthsOf("2026")!.length, 12);
  assert.equal(monthsOf("2026-13"), null);
  assert.equal(monthsOf("2026-Q5"), null);
});

test("P&L in cents: paid invoices are income, VAT-registered costs count net, ORBIT spend converted", () => {
  const x: Inputs = {
    invoices: [inv({}), inv({ id: "d", status: "draft", paidAt: null }), inv({ id: "s", status: "sent", paidAt: null, issued: "2026-10-10" })],
    store: store({ settings: { form: "OÜ", vatRegistered: true, vatBasis: "invoice", eurPerUsd: 0.9, eurPerCredit: 0.05 }, expenses: [exp()], apiUsd: { "2026-10-01": 2.5, "2026-09-30": 9 }, vatPaid: { "2026-10": 1000 } }),
    credits: [{ at: "2026-10-02T12:00:00.000Z", credits: 40 }],
  };
  const p = pnl(x, "2026-10") as Pnl, r = p.sum;
  assert.equal(r.income, 100_00);
  assert.equal(r.costs, 1000); // 12.40 - 2.40 VAT
  assert.equal(r.orbitApi, 225); // 2.5 USD * 0.9
  assert.equal(r.orbitHf, 200); // 40 credits * €0.05
  assert.equal(r.profit, 100_00 - 1000 - 225 - 200);
  assert.equal(p.margin, 85.8);
  assert.equal(r.outVat, 2400); // invoice basis: only the sent one issued in October
  assert.equal(r.inVat, 240);
  assert.equal(r.vatOwed, 2160);
  assert.equal(r.vatPaid, 1000);
  assert.deepEqual(p.byCategory, [{ category: "software", cents: 1000 }]);

  const cash = pnl({ ...x, store: { ...x.store, settings: { ...x.store.settings, vatBasis: "cash" } } }, "2026-10") as Pnl;
  assert.equal(cash.sum.outVat, 2400); // the paid one, paid in October

  const plain = pnl({ ...x, store: { ...x.store, settings: { ...x.store.settings, vatRegistered: false } } }, "2026-Q4") as Pnl;
  assert.equal(plain.sum.costs, 1240); // whole receipt is cost
  assert.equal(plain.sum.outVat + plain.sum.inVat, 0);
  assert.equal(plain.rows.length, 3);
  assert.equal(pnl(x, "2026-11") && (pnl(x, "2026-11") as Pnl).margin, null);
  assert.equal(typeof pnl(x, "oct"), "string");
});

test("CSV for the accountant: lines, VAT summary, quoting and formula guard", () => {
  const x: Inputs = { invoices: [inv({ buyer: { name: "=HYPERLINK(\"x\")", regCode: "", vatNo: "", address: "", email: "" } })], store: store({ expenses: [exp({ note: "a, b" })] }), credits: [] };
  const csv = toCsv(x, pnl(x, "2026-10") as Pnl), rows = csv.split("\r\n");
  assert.equal(rows[0], "date,type,number_or_category,party_or_note,net_eur,vat_eur,gross_eur,receipt_file");
  assert.equal(rows[1], `2026-10-05,income,2026-001,"'=HYPERLINK(""x"")",100.00,24.00,124.00,`);
  assert.equal(rows[2], `2026-10-03,expense,software,"a, b",10.00,2.40,12.40,`);
  assert.ok(rows.includes("2026-10,100.00,12.40,0.00,87.60,0.00,0.00,0.00,0.00"));
});

test("ORBIT API spend folds from the 7-day meter without double counting", () => {
  const day = 86_400_000, calls = [{ at: NOW - 1000, cost: 1 }, { at: NOW - 2000, cost: 0.5 }, { at: NOW - 8 * day, cost: 99 }, { at: NOW - 3 * day }];
  const once = foldApi({ "2026-01-01": 3 }, calls, NOW);
  assert.deepEqual(foldApi(once, calls, NOW), once);
  const vals = Object.values(once);
  assert.ok(vals.includes(1.5) && vals.includes(3) && !vals.includes(99));
});

test("settings, VAT paid and receipt names are checked", () => {
  const s = emptyStore().settings;
  assert.equal((patchSettings({ form: "FIE", eurPerUsd: "0,92" }, s) as typeof s).eurPerUsd, 0.92);
  assert.equal(typeof patchSettings({ form: "AS" }, s), "string");
  assert.equal(typeof patchSettings({ eurPerCredit: -1 }, s), "string");
  const st = emptyStore();
  assert.equal(setVatPaid(st, "2026-09", "123.45"), "");
  assert.equal(st.vatPaid["2026-09"], 12345);
  assert.equal(setVatPaid(st, "2026-09", ""), "");
  assert.equal(st.vatPaid["2026-09"], undefined);
  assert.notEqual(setVatPaid(st, "2026-9", "1"), "");
  assert.equal(receiptName("e1", "Receipt.PDF", 1000), "e1.pdf");
  assert.ok(typeof receiptName("e1", "x.exe", 1000) !== "string");
  assert.ok(typeof receiptName("../e", "x.pdf", 1000) !== "string");
  assert.ok(typeof receiptName("e1", "x.pdf", 11 * 1024 * 1024) !== "string");
});

test("Estonian deadlines: KMD by the 20th, FIE and OÜ calendars, weekends and holidays shift", () => {
  assert.equal(workday("2026-03-15"), "2026-03-16"); // Sunday → Monday, as on EMTA's 2026 calendar
  assert.equal(workday("2026-08-20"), "2026-08-21"); // Restoration of Independence Day
  assert.equal(workday("2026-10-20"), "2026-10-20");

  const vat = deadlines({ ...emptyStore().settings, vatRegistered: true }, "2026-10-26", 40);
  assert.deepEqual(vat.map((d) => d.day), ["2026-11-20"]);
  assert.match(vat[0].title, /KMD.*October/);
  assert.equal(vat[0].daysLeft, 25);

  const fie = deadlines({ ...emptyStore().settings, form: "FIE" }, "2026-11-11", 40).map((d) => `${d.day} ${d.title}`);
  assert.deepEqual(fie, ["2026-12-10 TSD for November", "2026-12-15 FIE income tax advance payment", "2026-12-15 FIE social tax advance payment"]);
  const formE = deadlines({ ...emptyStore().settings, form: "FIE" }, "2027-04-01", 40).find((d) => /form E/.test(d.title))!;
  assert.equal(formE.day, "2027-04-30");

  const ou = deadlines({ ...emptyStore().settings, form: "OÜ" }, "2027-06-01", 40).find((d) => /Annual report/.test(d.title))!;
  assert.equal(ou.day, "2027-06-30");
  assert.match(ou.title, /2026/);
  assert.ok(deadlines({ ...emptyStore().settings, form: "OÜ" }, "2027-06-01", 40).every((d) => d.source.startsWith("https://")));
});

test("BUS06 refunds lower income and output VAT in the month paid back, and show in the CSV", () => {
  const i = inv({ refunds: [{ day: "2026-11-02", cents: 62_00, note: "partial", at: "" }] }); // gross 124.00, VAT 24.00
  const x: Inputs = { invoices: [i], store: store({ settings: { vatRegistered: true } as Store["settings"] }), credits: [] };
  const oct = pnl(x, "2026-10") as Pnl, nov = pnl(x, "2026-11") as Pnl;
  assert.equal(oct.sum.income, 100_00);
  assert.equal(nov.sum.income, -50_00); assert.equal(nov.sum.outVat, -12_00);
  assert.match(toCsv(x, nov), /2026-11-02,refund,2026-001,Cake Shop: partial,-50\.00,-12\.00,-62\.00/);
});

test("BUS06 money split: each bucket has its records, pipeline is never in kept cash, digest line uses the same numbers", async () => {
  const { moneySplit, moneyLine } = await import("../src/lib/money-pure.ts");
  const today = "2026-10-26";
  const invoices = [
    inv({ id: "a", paidAt: "2026-10-05", refunds: [{ day: "2026-10-10", cents: 24_00, note: "", at: "" }] }), // paid 124.00
    inv({ id: "b", number: "2026-002", status: "sent", paidAt: null, due: "2026-10-01" }), // overdue 124.00
    inv({ id: "c", number: "2026-003", status: "sent", paidAt: null, due: "2026-11-30" }),
    inv({ id: "d", number: "2026-004", paidAt: "2026-08-01" }), // outside the window
    inv({ id: "e", number: "2026-005", status: "draft", paidAt: null }),
  ];
  const clients = [{ id: "p1", name: "Cake", stage: "paying", fee: 150 }, { id: "p2", name: "Salon", stage: "pilot", fee: 99 }, { id: "p3", name: "X", stage: "lead", fee: 500 }];
  const s = moneySplit({ invoices, expenses: [exp({ day: "2026-10-20" }), exp({ id: "old", day: "2026-01-01" })], clients }, today);
  assert.deepEqual([s.expected.cents, s.pipeline.cents, s.invoiced.cents, s.overdue.cents, s.paid.cents, s.refunds.cents, s.expenses.cents, s.drafts],
    [150_00, 99_00, 248_00, 124_00, 124_00, 24_00, 12_40, 1]);
  assert.equal(s.kept, 124_00 - 24_00 - 12_40);
  assert.deepEqual(s.overdue.items.map((i) => i.id), ["b"]);
  assert.deepEqual(s.expenses.items.map((i) => i.id), ["e1"]);
  const line = moneyLine(s, "1 invoice overdue: €124.00");
  assert.match(line, /€124\.00 paid in, €24\.00 refunded, €12\.40 spent/);
  assert.match(line, /€248\.00 invoiced, not paid yet · 1 invoice overdue/);
  assert.match(line, /€150\.00\/month expected from clients \(not cash\)/);
  assert.doesNotMatch(line, /99/); // pipeline stays out of the digest
  assert.equal(moneyLine(moneySplit({ invoices: [], expenses: [], clients: [] }, today)), "");
});
