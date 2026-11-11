// Invoice dates follow his calendar day (Tallinn), not UTC: between local midnight and 02:00/03:00 UTC is still "yesterday".
process.env.TZ = "Europe/Tallinn";
import test from "node:test";
import assert from "node:assert/strict";
import { addRefund, newInvoice, remindDue, setStatus, type Invoice, type Seller } from "../src/lib/invoices-pure.ts";

const seller: Seller = { name: "Me", regCode: "12345678", vatNo: "", address: "Tallinn", email: "", iban: "EE382200221020145685", bank: "", phone: "" };
const NOW = new Date(2027, 0, 1, 0, 30).getTime(); // 1 Jan 2027 00:30 in Tallinn = 31 Dec 2026 22:30 UTC

test("a new invoice, its paid day and its refund day use the local day", () => {
  const i = newInvoice("i1", { source: { kind: "prospect", id: "p", label: "x" }, buyer: { name: "Cake Shop" }, line: { text: "Site", cents: 1000 } }, seller, ["2026-007"], NOW);
  assert.equal(i.issued, "2027-01-01");
  assert.equal(i.number, "2027-001"); // not the last number of 2026
  const sent = setStatus(i, "sent", NOW, seller) as Invoice;
  const paid = setStatus(sent, "paid", NOW, seller) as Invoice;
  assert.equal(paid.paidAt, "2027-01-01");
  assert.equal((addRefund(paid, { amount: "1" }, NOW) as Invoice).refunds?.[0].day, "2027-01-01");
});

test("the week between reminders counts local days", () => {
  const od = { id: "a", status: "sent", due: "2026-12-01", reminder: null, reminded: [{ at: new Date(2026, 11, 25, 0, 30).toISOString(), via: "copy" }] } as unknown as Invoice;
  assert.equal(remindDue([od], "2027-01-01").length, 1); // reminded on 25 Dec local: 7 days later it may go again
  assert.equal(remindDue([od], "2026-12-31").length, 0);
});
