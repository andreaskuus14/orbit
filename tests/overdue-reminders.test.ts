import { test } from "node:test";
import assert from "node:assert/strict";
import { clientLang, newInvoice, parseSeller, remindDue, reminderDraft, setStatus, totals, type Invoice, type Party, type Seller } from "../src/lib/invoices-pure.ts";
import { overdueUnpaid, type BankLine } from "../src/lib/reconcile-pure.ts";
import { readFileSync } from "node:fs";

// Made-up clients and amounts only.
const NOW = Date.parse("2026-10-01T10:00:00Z");
const seller = parseSeller({ name: "A OÜ", regCode: "12345678", vatNo: "EE123456789", address: "Tallinn", iban: "EE38 2200 2210 2014 5685", email: "a@example.com" }) as Seller;
const party = (p: Partial<Party>): Party => ({ name: "", regCode: "", vatNo: "", address: "", email: "", ...p });
const inv = (id: string, net: number, buyer: Partial<Party>, existing: string[]): Invoice => {
  const d = newInvoice(id, { source: { kind: "prospect", id, label: id }, buyer, line: { text: "Work", cents: net } }, seller, existing, NOW);
  return setStatus(d, "sent", NOW, seller) as Invoice; // issued 2026-10-01, due 2026-10-15
};
const line = (row: number, day: string, cents: number, ref = "", text = ""): BankLine => ({ row, day, cents, name: "Payer", ref, text });

test("overdue + no matching bank payment → needs a reminder; paid or not yet covered → not", () => {
  const a = inv("a", 50000, { name: "Kohvik Test OÜ", email: "x@test.ee" }, []);
  const b = inv("b", 20000, { name: "Example Ltd", email: "y@example.com" }, [a.number]);
  const c = inv("c", 30000, { name: "Other Ltd" }, [a.number, b.number]);
  const lines = [line(2, "2026-10-12", totals(a).gross, a.ref), line(3, "2026-10-30", -1500), line(4, "2026-11-10", 999)];
  const out = overdueUnpaid(lines, [a, b, c], "2026-11-20");
  assert.deepEqual(out.map((u) => u.invoice.id).sort(), ["b", "c"]); // a was paid by reference
  assert.equal(out[0].daysLate, 36);
  // Not past due yet: nothing.
  assert.deepEqual(overdueUnpaid(lines, [a, b, c], "2026-10-14"), []);
  // A bank file that ends before the due date can't say it wasn't paid.
  assert.deepEqual(overdueUnpaid([line(2, "2026-10-10", 100)], [b], "2026-11-20"), []);
  assert.deepEqual(overdueUnpaid([], [b], "2026-11-20"), []);
  // A draft already waiting, or one sent this week, isn't drafted again.
  const waiting = { ...b, reminder: { text: "x", subject: "y", at: "2026-11-19T10:00:00Z" } };
  assert.deepEqual(remindDue(overdueUnpaid(lines, [waiting, c], "2026-11-20").map((u) => u.invoice), "2026-11-20").map((i) => i.id), ["c"]);
});

test("reminder language follows the client", () => {
  assert.equal(clientLang(party({ name: "Kohvik Tõru OÜ" })), "Estonian");
  assert.equal(clientLang(party({ name: "Kask", regCode: "90000001" })), "Estonian");
  assert.equal(clientLang(party({ name: "Kask", vatNo: "EE 100000000" })), "Estonian");
  assert.equal(clientLang(party({ name: "Kask", email: "info@kask.ee" })), "Estonian");
  assert.equal(clientLang(party({ name: "Kask", address: "Pikk 1, Tallinn" })), "Estonian");
  assert.equal(clientLang(party({ name: "Example Ltd", email: "a@example.com", address: "London" })), "English");
  assert.equal(clientLang(party({ name: "Asterix GmbH" })), "English"); // "AS" inside a word isn't a legal form
});

test("the reminder is a polite draft only, in that language; nothing sends it", () => {
  const b = inv("b", 20000, { name: "Kohvik Tõru OÜ", email: "x@test.ee" }, []);
  const r = reminderDraft(b, seller, clientLang(b.buyer), "2026-11-20", NOW);
  assert.ok(typeof r !== "string");
  assert.match(r.text, /^Tere, Kohvik Tõru OÜ!/);
  assert.match(r.subject, /^Meeldetuletus: arve/);
  // The panel only drafts (action "remind"); "approve" (the send) is his own click in Invoices.
  const panel = readFileSync(new URL("../src/components/ReconcilePanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /action: "remind"/);
  assert.doesNotMatch(panel, /action: "approve"/);
  // Auto never sends anything about invoices (autonomy-pure blocks the word).
  const auto = readFileSync(new URL("../src/lib/autonomy-pure.ts", import.meta.url), "utf8");
  assert.match(auto, /"invoice", "invoices"/);
});
