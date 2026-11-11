// Weekly outcome IO (rules: outcome-week-pure.ts). Read only: YouTube Analytics, the prospects table, prospect-crm timelines, invoices.json.
// Each source is soft: a failure or missing connection becomes null ("not connected"), never a made-up number.
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayKey } from "./agent-stats-pure";
import { weekOutcome, TZ, weekStart, type Week, type WeekIn } from "./outcome-week-pure";

const soft = async <T>(label: string, read: () => Promise<T | null>): Promise<T | null> => {
  try { return await read(); } catch (e) { console.error("[outcome-week]", label, e instanceof Error ? e.message : e); return null; }
};

export async function getWeek(sb: SupabaseClient, now = Date.now()): Promise<Week> {
  const today = dayKey(new Date(now), TZ);
  // Filter by date (a day of slack for the zone; weekOutcome buckets exactly) instead of a row cap that could silently undercount.
  const since = `${new Date(Date.parse(`${weekStart(today)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`;
  const [views, prospects, events, invoices] = await Promise.all([
    soft<WeekIn["views"]>("views", async () => {
      const a = await import("./yt-analytics").then((m) => m.getAnalytics({ range: 7 }));
      return a.connected ? { start: a.range.start, end: a.range.end, views: a.totals.views } : null;
    }),
    soft<WeekIn["prospects"]>("prospects", async () => {
      const { data, error } = await sb.from("prospects").select("id,created_at").gte("created_at", since);
      if (error) throw new Error(error.message);
      return data ?? [];
    }),
    soft<WeekIn["events"]>("events", () => import("./prospect-crm").then((m) => m.loadCrm())),
    soft<WeekIn["invoices"]>("invoices", () => import("./invoices").then((m) => m.allInvoices())),
  ]);
  return weekOutcome({ today, views, prospects, events, invoices });
}
