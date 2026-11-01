// BUSINESS overview (pure, tested in tests/business-overview.test.ts): the one strip at the top of BUSINESS and the morning card's
// business line. Actuals (paid this month, invoices) and expected (paying clients' monthly fees) are never added together.
// Each source arrives with when it was read; a source that failed with no earlier good read is null and every number from it
// is null ("no data"), never 0. IO: business-overview.ts; route: /api/business/overview; UI: BusinessOverview.tsx.
import { dueFollowups, type Prospect } from "./business-pure.ts";
import { daysLate, euro, isOverdue, totals, type Invoice } from "./invoices-pure.ts";

/** A delivery milestone that waits on him: a paying client's OPERATIONS project paused (waiting) or one of its tasks failed (blocked). */
export type Blocker = { ref: string; client: string; clientId: string; state: "waiting" | "blocked"; title: string; at: string; task?: string };
/** at: when the source was read; stale: an earlier good read served because the latest one failed. */
export type Src<T> = { data: T; at: string; stale?: boolean } | null;
export type OverviewIn = {
  now: number; today: string; // today: local YYYY-MM-DD; the month is its first 7 characters
  invoices: Src<Invoice[]>; prospects: Src<(Prospect & { touch?: { last: string; replied: boolean } | null })[]>; blockers: Src<Blocker[]>;
  target: number; // € per month he set (0 = none)
};
/** A record behind a number: client opens the BUSINESS client row, task the OPERATIONS task, money the Money view. */
export type Rec = { id: string; label: string; cents?: number; client?: string; task?: string; money?: true };
/** n and cents are null when the source has no data. */
export type Metric = { n: number | null; cents: number | null; items: Rec[]; at: string | null; stale?: boolean };
export const METRICS = ["paid", "expected", "outstanding", "overdue", "opportunities", "followups", "blockers"] as const;
export type MetricId = (typeof METRICS)[number];
export type Overview = Record<MetricId, Metric> & { month: string; target: { cents: number; pct: number | null } | null };

export const OPEN_STAGES = ["lead", "contacted", "replied", "pilot"] as const;

const metric = <T>(src: Src<T>, items: (d: T) => Rec[]): Metric => {
  if (!src) return { n: null, cents: null, items: [], at: null };
  const it = items(src.data);
  return { n: it.length, cents: it.reduce((a, r) => a + (r.cents ?? 0), 0), items: it, at: src.at, ...(src.stale && { stale: true }) };
};
const inv = (i: Invoice, cents: number, extra = ""): Rec => ({ id: i.id, label: `${i.number} · ${i.buyer.name}${extra}`, cents, money: true });

export function businessOverview(x: OverviewIn): Overview {
  const month = x.today.slice(0, 7);
  const sent = (l: Invoice[]) => l.filter((i) => i.status === "sent");
  // shortcut: paid is gross invoices marked paid this month; refunds stay in BUSINESS → Money, subtract them if he asks.
  const paid = metric(x.invoices, (l) => l.filter((i) => i.status === "paid" && i.paidAt?.startsWith(month)).map((i) => inv(i, totals(i).gross)));
  const t = Math.round((Number(x.target) || 0) * 100);
  return {
    month, paid,
    expected: metric(x.prospects, (ps) => ps.filter((p) => p.stage === "paying" && Number(p.fee) > 0).map((p) => ({ id: p.id, label: p.name, cents: Math.round(Number(p.fee) * 100), client: p.id }))),
    outstanding: metric(x.invoices, (l) => sent(l).map((i) => inv(i, totals(i).gross))),
    overdue: metric(x.invoices, (l) => sent(l).filter((i) => isOverdue(i, x.today)).sort((a, b) => a.due.localeCompare(b.due)).map((i) => inv(i, totals(i).gross, ` · ${daysLate(i, x.today)}d late`))),
    opportunities: metric(x.prospects, (ps) => ps.filter((p) => (OPEN_STAGES as readonly string[]).includes(p.stage)).map((p) => ({ id: p.id, label: `${p.name} · ${p.stage}`, client: p.id, ...(Number(p.fee) > 0 && { cents: Math.round(Number(p.fee) * 100) }) }))),
    followups: metric(x.prospects, (ps) => dueFollowups(ps, x.now).map((p) => ({ id: p.id, label: p.name, client: p.id }))),
    blockers: metric(x.blockers, (bs) => bs.map((b) => ({ id: b.ref, label: `${b.client} · ${b.title}`, client: b.clientId, ...(b.task && { task: b.task }) }))),
    target: t > 0 ? { cents: t, pct: paid.cents === null ? null : Math.round((100 * paid.cents) / t) } : null,
  };
}

export const BLOCKER_DAYS = 14; // a failed delivery task older than this is history, not an active blocker
/** Active delivery blockers: paying clients' delivery projects (prospect-crm opsProject) that are paused, or have a recently failed task. Done projects never block. */
export function deliveryBlockers(clients: { id: string; name: string; project: string }[], projects: { id: string; name: string; status: string; updated_at: string }[],
  failed: { id: string; title: string; project_id: string | null; finished_at: string | null }[], now: number): Blocker[] {
  const out: Blocker[] = [];
  for (const c of clients) {
    const p = projects.find((x) => x.id === c.project);
    if (!p || p.status === "done") continue;
    if (p.status === "paused") out.push({ ref: `project:${p.id}`, client: c.name, clientId: c.id, state: "waiting", title: p.name, at: p.updated_at });
    for (const t of failed) if (t.project_id === p.id && t.finished_at && now - Date.parse(t.finished_at) <= BLOCKER_DAYS * 86_400_000)
      out.push({ ref: `task:${t.id}`, client: c.name, clientId: c.id, state: "blocked", title: t.title, at: t.finished_at, task: t.id });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The morning card's compact line (English, spoken too). Missing sources say "no data"; expected is labelled as not cash. "" when nothing at all loaded. */
export function overviewLine(o: Overview): string {
  if (METRICS.every((k) => o[k].n === null)) return "";
  const nd = "no data";
  const paid = o.paid.cents === null ? `paid this month: ${nd}` : `${euro(o.paid.cents)} paid this month${o.target ? ` (${o.target.pct}% of the ${euro(o.target.cents)} target)` : ""}`;
  const parts = [
    paid,
    o.expected.cents === null ? `expected: ${nd}` : o.expected.cents ? `${euro(o.expected.cents)}/month expected (not cash)` : "",
    o.outstanding.cents === null ? `invoices: ${nd}` : o.outstanding.n ? `${euro(o.outstanding.cents)} outstanding${o.overdue.n ? `, ${euro(o.overdue.cents!)} overdue` : ""}` : "",
    o.followups.n === null ? "" : o.followups.n ? `${o.followups.n} follow-up${o.followups.n === 1 ? "" : "s"} due` : "",
    o.blockers.n ? `${o.blockers.n} delivery blocker${o.blockers.n === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Business: ${parts.join(" · ")}`;
}
