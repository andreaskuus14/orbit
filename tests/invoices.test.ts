import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approveProblem, dashboard, daysLate, editInvoice, invoicePdf, isOverdue, newInvoice, nextNumber, overdueLine, parseSeller, readyProblem,
  refCheckDigit, refNumber, refValid, reminderDraft, remindDue, setStatus, toCents, totals, view, briefInvoices, remoteInvoices, invoicePushes, PUSH_AGAIN_DAYS,
  type Invoice, type Seller,
} from "../src/lib/invoices-pure.ts";

const NOW = Date.parse("2026-10-26T10:00:00.000Z"), TODAY = "2026-10-26";
const seller = parseSeller({ name: "Andreas OÜ", regCode: "12345678", vatNo: "EE123456789", address: "Tartu mnt 1, Tallinn", iban: "EE38 2200 2210 2014 5685", email: "a@example.com" }) as Seller;
const noVat: Seller = { ...seller, vatNo: "" };
const src = { kind: "prospect" as const, id: "p1", label: "Cake Shop" };
const make = (s: Seller | null = seller, cents = 50000, existing: string[] = []) =>
  newInvoice("i1", { source: src, buyer: { name: "Cake Shop", email: "c@shop.ee" }, line: { text: "Website", cents } }, s, existing, NOW);
const sent = (o: Partial<Invoice> = {}) => ({ ...(setStatus(make(), "sent", NOW, seller) as Invoice), ...o });

test("Estonian 7-3-1 reference numbers", () => {
  assert.equal(refCheckDigit("123456"), 1); // 1234561, the textbook example
  assert.equal(refNumber("123"), "1232");
  assert.equal(refCheckDigit("2026001"), 1); // from the right: 1·7+0·3+0·1+6·7+2·3+0·1+2·7 = 69 → 70
  assert.ok(refValid(refNumber("2026001")));
  assert.ok(refValid("1234561"));
  assert.ok(!refValid("1234562"));
  assert.ok(!refValid("1"));
  assert.throws(() => refCheckDigit("12a"));
});

test("invoice numbers count up per year and carry a valid reference", () => {
  assert.deepEqual(nextNumber([], 2026).number, "2026-001");
  const n = nextNumber(["2026-001", "2026-007", "2025-099"], 2026);
  assert.equal(n.number, "2026-008");
  assert.ok(refValid(n.ref) && n.ref.startsWith("2026008"));
});

test("totals in cents with VAT once on the net", () => {
  const i = { lines: [{ text: "a", qty: 3, cents: 333 }, { text: "b", qty: 1.5, cents: 1001 }], vat: { on: true, rate: 24 } };
  const t = totals(i);
  assert.deepEqual(t.lines, [999, 1502]);
  assert.equal(t.net, 2501);
  assert.equal(t.vat, 600); // 600.24 → 600
  assert.equal(t.gross, 3101);
  assert.equal(totals({ ...i, vat: { on: false, rate: 24 } }).gross, 2501);
  assert.equal(toCents("12,5"), 1250);
  assert.equal(toCents("€ 1000.99"), 100099);
  assert.ok(Number.isNaN(toCents("12.345")));
});

test("new invoice: VAT follows the seller's KMKR, 14-day terms", () => {
  const a = make();
  assert.equal(a.status, "draft");
  assert.ok(a.vat.on && a.vat.rate === 24);
  assert.equal(a.due, "2026-11-09");
  assert.equal(make(noVat).vat.on, false);
});

test("seller validation", () => {
  assert.equal(typeof parseSeller({ regCode: "123" }), "string");
  assert.equal(typeof parseSeller({ vatNo: "123456789" }), "string");
  assert.equal((parseSeller({ vatNo: "ee 123456789" }) as Seller).vatNo, "EE123456789");
});

test("edits: only drafts, validated", () => {
  const e = editInvoice(make(), { lines: [{ text: "Logo", qty: "2", price: "150,00" }], vatOn: false, due: "2026-12-01" }, NOW) as Invoice;
  assert.equal(totals(e).gross, 30000);
  assert.equal(e.due, "2026-12-01");
  assert.equal(typeof editInvoice(make(), { due: "2026-01-01" }, NOW), "string"); // before issued
  assert.equal(typeof editInvoice(make(), { lines: [] }, NOW), "string");
  assert.equal(typeof editInvoice(make(), { buyer: { name: "" } }, NOW), "string");
  assert.equal(editInvoice(sent(), { notes: "x" }, NOW), "Only a draft can be edited");
});

test("status: sent needs Estonian basics, paid only after sent", () => {
  assert.match(readyProblem(make(), null), /Your details/);
  assert.match(readyProblem(make(), { ...seller, iban: "" }), /IBAN/);
  assert.match(readyProblem(make(), noVat), /KMKR/); // VAT on, no KMKR
  assert.equal(setStatus(make(), "paid", NOW, seller), "Mark it sent first");
  const s = sent();
  assert.equal(s.status, "sent");
  const p = setStatus(s, "paid", NOW, seller, "2026-10-20") as Invoice;
  assert.equal(p.paidAt, "2026-10-20");
  assert.equal((setStatus(p, "sent", NOW, seller) as Invoice).paidAt, null); // undo a wrong "paid"
  assert.equal((setStatus(s, "draft", NOW, seller) as Invoice).status, "draft");
  assert.equal(typeof setStatus({ ...s, reminded: [{ at: "x", via: "copy" }] }, "draft", NOW, seller), "string");
});

test("overdue is derived: sent and past due, never on the due day", () => {
  const s = sent({ due: "2026-10-26" });
  assert.ok(!isOverdue(s, TODAY));
  assert.ok(isOverdue(s, "2026-10-27"));
  assert.equal(view(s, "2026-10-27"), "overdue");
  assert.equal(daysLate(s, "2026-11-05"), 10);
  assert.ok(!isOverdue({ ...s, status: "paid" }, "2027-01-01"));
  assert.ok(!isOverdue(make(), "2027-01-01"));
});

test("who owes what", () => {
  const a = sent({ id: "a", due: "2026-10-01" }), b = sent({ id: "b", due: "2026-11-30", buyer: { ...a.buyer, name: "Bakery" } });
  const c = { ...sent({ id: "c" }), status: "paid" as const, paidAt: "2026-10-20" };
  const d = dashboard([a, b, c, make()], TODAY);
  const g = totals(a).gross;
  assert.equal(d.open, 2 * g);
  assert.equal(d.overdue, g);
  assert.equal(d.paid30, g);
  assert.equal(d.drafts, 1);
  assert.deepEqual(d.byBuyer.map((x) => x.buyer), ["Cake Shop", "Bakery"]);
});

test("reminders: drafts only for overdue, version-checked approval, weekly at most", () => {
  const od = sent({ due: "2026-10-01" });
  assert.equal(typeof reminderDraft(sent(), seller, "English", TODAY, NOW), "string");
  const r = reminderDraft(od, seller, "English", TODAY, NOW) as { text: string; subject: string; at: string };
  assert.match(r.text, /invoice 2026-001 for €620\.00 was due on 2026-10-01 \(25 days ago\)/);
  assert.match(r.text, new RegExp(od.ref));
  assert.match((reminderDraft(od, seller, "Estonian", TODAY, NOW) as { text: string }).text, /viitenumber/);
  const w = { ...od, reminder: r };
  assert.equal(approveProblem(w, r.at, TODAY), "");
  assert.match(approveProblem(w, "old", TODAY), /changed/);
  assert.match(approveProblem({ ...w, status: "paid" }, r.at, TODAY), /no longer overdue/);
  assert.deepEqual(remindDue([od, w], TODAY).map((x) => x.reminder), [null]);
  assert.equal(remindDue([{ ...od, reminded: [{ at: "2026-10-22T09:00:00Z", via: "email" }] }], TODAY).length, 0);
  assert.equal(remindDue([{ ...od, reminded: [{ at: "2026-10-18T09:00:00Z", via: "email" }] }], TODAY).length, 1);
  assert.equal(briefInvoices([w], TODAY)[0].id, `invoice:${od.id}`);
});

test("overdue line for the brief and night report", () => {
  assert.equal(overdueLine([sent()], TODAY), "");
  assert.equal(overdueLine([sent({ due: "2026-10-01" }), sent({ due: "2026-10-20" })], TODAY), "2 invoices overdue: €1240.00 (oldest Cake Shop, 25 days late)");
});

test("PDF: a valid file with Estonian letters and the reference", () => {
  const i = { ...make(), buyer: { ...make().buyer, name: "Õunapuu Süsteemid OÜ" } };
  const b = invoicePdf(i, seller), s = Buffer.from(b).toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4") && s.trimEnd().endsWith("%%EOF"));
  assert.ok(s.includes("\xd5unapuu S\xfcsteemid"));
  assert.ok(s.includes(i.ref) && s.includes("620.00"));
  const xref = Number(s.match(/startxref\n(\d+)/)![1]);
  assert.equal(s.slice(xref, xref + 4), "xref");
});

test("phone remote: waiting reminders become invoice approvals with the full text, buyer, amount and days late", () => {
  const due = sent({ due: "2026-10-17" });
  const r = reminderDraft(due, seller, "English", TODAY, NOW) as { text: string; subject: string; at: string };
  const waiting = { ...due, reminder: r };
  const [a] = remoteInvoices([waiting, sent(), { ...sent({ due: "2026-10-17" }), status: "paid" as const, reminder: r }], TODAY, true);
  assert.equal(remoteInvoices([waiting, sent()], TODAY, true).length, 1); // only an overdue invoice with a draft
  assert.equal(a.key, "invoice:i1");
  assert.equal(a.message, r.text);
  assert.equal(a.seen, r.at); // the version echoed back on approve
  assert.equal(a.buyer, "Cake Shop");
  assert.equal(a.amount, "€620.00");
  assert.equal(a.daysLate, 9);
  assert.equal(a.to, "c@shop.ee");
  assert.equal(remoteInvoices([waiting], TODAY, false)[0].to, undefined); // no Resend: he copies it
  assert.equal(remoteInvoices([{ ...waiting, buyer: { ...waiting.buyer, email: "a@x.ee, b@y.ee" } }], TODAY, true)[0].to, undefined); // same rule as approveReminder
  assert.deepEqual(remoteInvoices([{ ...waiting, due: "2026-10-30" }], TODAY, true), []); // no longer overdue
});

test("invoice push: once per invoice per week, only while a reminder is waiting", () => {
  const due = sent({ due: "2026-10-17" });
  const waiting = { ...due, reminder: reminderDraft(due, seller, "English", TODAY, NOW) as { text: string; subject: string; at: string } };
  const [p] = invoicePushes([waiting], TODAY, NOW);
  assert.equal(p.id, "i1");
  assert.match(p.title, /^Invoice 2026-\d{3} is 9 days overdue — a reminder is ready$/);
  assert.doesNotMatch(p.title + p.body, /Cake|€/); // no buyer or amount on the lock screen
  assert.deepEqual(invoicePushes([due], TODAY, NOW), []); // no draft, no push
  const day = 86_400_000;
  assert.deepEqual(invoicePushes([{ ...waiting, pushedAt: new Date(NOW - (PUSH_AGAIN_DAYS * day - 1)).toISOString() }], TODAY, NOW), []);
  assert.equal(invoicePushes([{ ...waiting, pushedAt: new Date(NOW - PUSH_AGAIN_DAYS * day).toISOString() }], TODAY, NOW).length, 1);
  assert.match(invoicePushes([{ ...waiting, due: "2026-10-25" }], TODAY, NOW)[0].title, / 1 day overdue/);
});
