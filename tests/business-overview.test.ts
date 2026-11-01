import { test } from "node:test";
import assert from "node:assert/strict";
import { businessOverview, deliveryBlockers, overviewLine, type OverviewIn } from "../src/lib/business-overview-pure.ts";
import type { Invoice } from "../src/lib/invoices-pure.ts";
import type { Prospect } from "../src/lib/business-pure.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z"), AT = "2026-11-20T12:00:00.000Z";
const inv = (id: string, o: Partial<Invoice>): Invoice => ({ id, number: `2026-${id}`, ref: "1", source: { kind: "prospect", id: "p", label: "" }, buyer: { name: `B${id}`, regCode: "", vatNo: "", address: "", email: "" },
  lines: [{ text: "x", qty: 1, cents: 10000 }], vat: { on: false, rate: 24 }, issued: "2026-10-01", due: "2026-11-10", status: "sent", sentAt: null, paidAt: null, notes: "", reminder: null, reminded: [], created: AT, updated: AT, ...o });
const pr = (id: string, stage: Prospect["stage"], fee = 0, o: Partial<Prospect & { touch: { last: string; replied: boolean } | null }> = {}) =>
  ({ id, name: `P${id}`, kind: "", contact: "", stage, fee, notes: "", draft: "", created_at: AT, updated_at: AT, ...o });
const base = (o: Partial<OverviewIn> = {}): OverviewIn => ({ now: NOW, today: "2026-11-20", target: 0, blockers: { data: [], at: AT },
  invoices: { data: [inv("1", { status: "paid", paidAt: "2026-11-03" }), inv("2", { status: "paid", paidAt: "2026-10-30" }), inv("3", {}), inv("4", { due: "2026-11-25" }), inv("5", { status: "draft" })], at: AT },
  prospects: { data: [pr("a", "paying", 300), pr("b", "pilot", 200), pr("c", "contacted", 0, { touch: { last: "2026-11-10T09:00:00Z", replied: false } }), pr("d", "lost"), pr("e", "paying", 0)], at: AT }, ...o });

test("actuals and expected stay apart; every number lists its records", () => {
  const o = businessOverview({ ...base(), target: 500 });
  assert.equal(o.paid.cents, 10000); // October's payment is not this month's
  assert.deepEqual(o.paid.items.map((i) => i.id), ["1"]);
  assert.equal(o.expected.cents, 30000); // paying clients' fees only (pilot is pipeline), never added to paid
  assert.deepEqual(o.expected.items.map((i) => i.client), ["a"]);
  assert.equal(o.outstanding.cents, 20000);
  assert.equal(o.overdue.n, 1);
  assert.match(o.overdue.items[0].label, /10d late/);
  assert.deepEqual(o.opportunities.items.map((i) => i.id), ["b", "c"]);
  assert.deepEqual(o.followups.items.map((i) => i.id), ["c"]);
  assert.deepEqual(o.target, { cents: 50000, pct: 20 });
  assert.equal(overviewLine(o), "Business: €100.00 paid this month (20% of the €500.00 target) · €300.00/month expected (not cash) · €200.00 outstanding, €100.00 overdue · 1 follow-up due");
});

test("a source with no data gives null (no data), never 0; a stale one keeps its time", () => {
  const o = businessOverview(base({ invoices: null, prospects: { ...base().prospects!, stale: true }, target: 500 }));
  for (const k of ["paid", "outstanding", "overdue"] as const) { assert.equal(o[k].n, null); assert.equal(o[k].cents, null); }
  assert.deepEqual(o.target, { cents: 50000, pct: null });
  assert.equal(o.expected.stale, true);
  assert.equal(o.expected.at, AT);
  assert.match(overviewLine(o), /^Business: paid this month: no data · €300\.00\/month expected .*invoices: no data/);
  const none = businessOverview(base({ invoices: null, prospects: null, blockers: null }));
  assert.equal(none.expected.n, null);
  assert.equal(overviewLine(none), "");
});

test("delivery blockers: paused projects wait, recent failed tasks block, done projects and old failures don't", () => {
  const clients = [{ id: "a", name: "Cake", project: "pa" }, { id: "b", name: "Salon", project: "pb" }, { id: "c", name: "Done", project: "pc" }];
  const projects = [{ id: "pa", name: "Deliver: Cake", status: "paused", updated_at: "2026-11-15T00:00:00Z" }, { id: "pb", name: "Deliver: Salon", status: "active", updated_at: AT }, { id: "pc", name: "x", status: "done", updated_at: AT }];
  const failed = [{ id: "t1", title: "Set up autopilot", project_id: "pb", finished_at: "2026-11-18T00:00:00Z" }, { id: "t2", title: "old", project_id: "pb", finished_at: "2026-10-01T00:00:00Z" }, { id: "t3", title: "z", project_id: "pc", finished_at: AT }];
  const b = deliveryBlockers(clients, projects, failed, NOW);
  assert.deepEqual(b.map((x) => [x.ref, x.state, x.clientId]), [["project:pa", "waiting", "a"], ["task:t1", "blocked", "b"]]);
  const o = businessOverview(base({ blockers: { data: b, at: AT } }));
  assert.deepEqual(o.blockers.items.map((i) => i.task ?? i.client), ["a", "t1"]);
});
