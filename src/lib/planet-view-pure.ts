// Planet workspace frame (G01) logic: which view to open, and BUSINESS's Today queue (BUS01). UI: components/WorkspaceFrame.tsx.
import { dueFollowups, type Prospect } from "./business-pure.ts";

export const viewKey = (planet: string) => `orbit.view.${planet}`;
/** The saved view if it's still one of this planet's views, else the first. */
export const pickView = <V extends string>(saved: unknown, views: readonly V[]): V => (views.includes(saved as V) ? (saved as V) : views[0]);

export type TodayKind = "followup" | "send" | "draft";
export type TodayItem = { id: string; name: string; kind: TodayKind };

/** Next actions, most urgent first: follow-ups due (longest waiting first), lead drafts ready to send, then leads with no draft yet. */
export function todayQueue(ps: Prospect[], now: number, max = 8): TodayItem[] {
  const old = (a: Prospect, b: Prospect) => Date.parse(a.updated_at) - Date.parse(b.updated_at);
  const leads = ps.filter((p) => p.stage === "lead").sort(old);
  return [
    ...dueFollowups(ps, now).sort(old).map((p) => ({ id: p.id, name: p.name, kind: "followup" as const })),
    ...leads.filter((p) => p.draft.trim()).map((p) => ({ id: p.id, name: p.name, kind: "send" as const })),
    ...leads.filter((p) => !p.draft.trim()).map((p) => ({ id: p.id, name: p.name, kind: "draft" as const })),
  ].slice(0, max);
}
