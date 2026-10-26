// Weekly operator report IO (B7): this week's ledger events (ids and counts only), autonomy levels and lesson scores → operator-pure.ts.
// A failing source counts as nothing rather than failing the report.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRows, type EventRow } from "./ledger-pure";
import { DEFAULT_LEVELS } from "./autonomy-pure";
import { operatorReport, type OperatorReport } from "./operator-pure";
import { weekWindow } from "./week-pure";

const DAY = 86_400_000;
const TYPES = ["night.task", "night.end", "autonomy.act", "deal.hunt", "deal.found", "brief.shown", "health.issue", "higgsfield.spend", "business.stage", "clip.published", "clip.outcome48h", "memory.hygiene"];

export async function getOperatorReport(sb: SupabaseClient, userId: string, now = Date.now()): Promise<OperatorReport> {
  const w = weekWindow(now);
  const from = new Date(Math.min(w.start, now - 90 * DAY)).toISOString(); // 90 days back for the "you always approve" evidence
  const [events, levels, lessons] = await Promise.all([
    Promise.resolve(sb.from("events").select("id, created_at, type, planet, payload, caused_by").eq("user_id", userId).in("type", TYPES)
      .gte("created_at", from).lt("created_at", new Date(w.end).toISOString()).order("created_at").limit(5000)).then((r) => (r.data ?? []) as EventRow[], () => []),
    import("./autonomy").then((a) => a.autonomyLevels(), () => DEFAULT_LEVELS),
    import("./lessons").then((l) => l.lessonsView(userId), () => null),
  ]);
  const ls = lessons ? [...lessons.kept, ...lessons.proposed].map((l) => ({ id: l.id, area: l.area, sign: l.sign, confidence: l.confidence, status: l.status })) : [];
  return operatorReport({ now, events: fromRows(events), levels, lessons: ls });
}
