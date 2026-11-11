// Weekly outcome (BUSINESS): views, leads, replies, revenue for the last 7 days, each read from its existing source. Pure; tested in
// tests/outcome-week.test.ts. A source that is missing or failed is "not connected": never 0, never an estimate. IO: outcome-week.ts.
import type { CrmEvent } from "./prospect-crm-pure.ts";
import { totals, type Invoice } from "./invoices-pure.ts";
import { dayKey } from "./agent-stats-pure.ts";

export const WEEK_DAYS = 7;
export type Source = { label: string; link: string };
export type WeekMetric = { value: number; of?: string; source: Source } | { value: null; source: Source };
export type WeekIn = {
  today: string; // local YYYY-MM-DD; the window is the 7 days ending today
  views: { start: string; end: string; views: number } | null; // YouTube Analytics totals (data lags ~2 days, so its own window is shown)
  prospects: { id: string; created_at: string }[] | null;
  events: Record<string, { events: Pick<CrmEvent, "at" | "kind">[] }> | null; // prospect-crm timelines
  invoices: Invoice[] | null;
};
export type Week = { start: string; end: string; views: WeekMetric; leads: WeekMetric; replies: WeekMetric; revenueCents: WeekMetric };

// Every day boundary is his Europe/Tallinn calendar day (dayKey), never UTC and never the server's zone.
export const TZ = "Europe/Tallinn";
const day = (iso: string) => dayKey(new Date(Date.parse(iso)), TZ);
export const weekStart = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) - (WEEK_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
const SRC = {
  views: { label: "YouTube Analytics (Studio)", link: "#o=studio" },
  leads: { label: "BUSINESS pipeline (prospects added)", link: "#o=business&v=pipeline" },
  replies: { label: "BUSINESS client timelines (logged replies)", link: "#o=business&v=pipeline" },
  revenue: { label: "Invoices marked paid (gross)", link: "#o=business&v=money" },
};

export function weekOutcome(x: WeekIn): Week {
  const start = weekStart(x.today), inWeek = (d: string) => d >= start && d <= x.today;
  const m = (src: Source, v: number | null, of?: string): WeekMetric => (v === null ? { value: null, source: src } : { value: v, ...(of && { of }), source: src });
  return {
    start, end: x.today,
    views: x.views ? m(SRC.views, x.views.views, `${x.views.start} – ${x.views.end}`) : m(SRC.views, null),
    leads: m(SRC.leads, x.prospects && x.prospects.filter((p) => inWeek(day(p.created_at))).length),
    replies: m(SRC.replies, x.events && Object.values(x.events).reduce((n, c) => n + (c.events ?? []).filter((e) => e.kind === "reply" && inWeek(day(e.at))).length, 0)),
    revenueCents: m(SRC.revenue, x.invoices && x.invoices.filter((i) => i.status === "paid" && !!i.paidAt && inWeek(i.paidAt)).reduce((a, i) => a + totals(i).gross, 0)),
  };
}
