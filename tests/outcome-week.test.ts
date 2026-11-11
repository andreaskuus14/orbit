process.env.TZ = "UTC"; // server zone must not matter: days are Europe/Tallinn
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOutcome, type WeekIn } from "../src/lib/outcome-week-pure.ts";
import type { Invoice } from "../src/lib/invoices-pure.ts";

const inv = (status: "paid" | "sent", paidAt: string | null, cents: number) =>
  ({ id: "i", number: "1", status, paidAt, vat: { on: false, rate: 24 }, lines: [{ text: "x", qty: 1, cents }] }) as unknown as Invoice;
const base: WeekIn = {
  today: "2026-11-11", views: { start: "2026-11-02", end: "2026-11-08", views: 321 },
  prospects: [{ id: "a", created_at: "2026-11-05T10:00:00Z" }, { id: "b", created_at: "2026-11-04T10:00:00Z" }, { id: "c", created_at: "2026-10-01T10:00:00Z" }],
  events: { a: { events: [{ at: "2026-11-06T09:00:00Z", kind: "reply" }, { at: "2026-11-06T08:00:00Z", kind: "sent" }] }, c: { events: [{ at: "2026-10-01T09:00:00Z", kind: "reply" }] } },
  invoices: [inv("paid", "2026-11-10", 10000), inv("paid", "2026-10-01", 5000), inv("sent", null, 7000)],
};

test("each number comes from its source, window is the 7 days ending today", () => {
  const w = weekOutcome(base);
  assert.equal(w.start, "2026-11-05");
  assert.equal(w.views.value, 321); assert.equal((w.views as { of?: string }).of, "2026-11-02 – 2026-11-08");
  assert.equal(w.leads.value, 1); // 11-04 is outside the window
  assert.equal(w.replies.value, 1); // only reply events, only in the window
  assert.equal(w.revenueCents.value, 10000); // paid in the window; sent and old paid excluded
  for (const k of ["views", "leads", "replies", "revenueCents"] as const) assert.ok(w[k].source.label && w[k].source.link.startsWith("#o="));
});

test("a missing source is null (not connected), never 0, and the others still show", () => {
  const w = weekOutcome({ ...base, views: null, prospects: null, events: null, invoices: null });
  for (const k of ["views", "leads", "replies", "revenueCents"] as const) assert.equal(w[k].value, null);
  const z = weekOutcome({ ...base, prospects: [], events: {}, invoices: [] });
  assert.equal(z.leads.value, 0); assert.equal(z.replies.value, 0); assert.equal(z.revenueCents.value, 0);
});

test("the window is his local days: 23:30 local on the last day counts, 00:30 local the next day does not", () => {
  // Tallinn is UTC+2 in November: 00:30 local on 11-12 is 22:30Z on 11-11, so a UTC bucket would wrongly count it.
  const w = weekOutcome({ ...base, today: "2026-11-11", prospects: [
    { id: "in", created_at: "2026-11-11T23:30:00+02:00" }, { id: "next", created_at: "2026-11-12T00:30:00+02:00" },
    { id: "first", created_at: "2026-11-05T00:30:00+02:00" }, { id: "before", created_at: "2026-11-04T23:30:00+02:00" }] });
  assert.equal(w.leads.value, 2); // "in" and "first" only
});
