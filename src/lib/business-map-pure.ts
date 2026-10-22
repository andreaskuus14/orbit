// BUSINESS pipeline map: pure layout for the orbit-ring view in BusinessPanel (tested in tests/business-map.test.ts).
// One ring per stage (outer = lead, inner = paying); lost businesses sit outside every ring.
import { STAGES, STAGE_LABEL, type Prospect, type Stage } from "./business-pure.ts";

export const STAGE_RADIUS: Record<Stage, number> = { lead: 2.5, contacted: 2.05, replied: 1.6, pilot: 1.15, paying: 0.7, lost: 3.1 };
export const STAGE_COLOR: Record<Stage, string> = { lead: "#7dd3fc", contacted: "#a78bfa", replied: "#f472b6", pilot: "#34d399", paying: "#facc15", lost: "#6b7280" };
export const DUE_COLOR = "#f59e0b";

/** FNV-1a: the same id always gives the same angle, so nodes never jump between renders. */
export function idAngle(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return ((h >>> 0) / 0x100000000) * Math.PI * 2;
}

export type MapNode = { id: string; name: string; stage: Stage; x: number; z: number; color: string; due: boolean };

/** One node per prospect on its stage's ring; unknown stages fall back to the lead ring. */
export function mapNodes(ps: Pick<Prospect, "id" | "name" | "stage">[], due: Set<string>): MapNode[] {
  return ps.map((p) => {
    const stage = p.stage in STAGE_RADIUS ? p.stage : "lead";
    const a = idAngle(p.id), r = STAGE_RADIUS[stage];
    const isDue = due.has(p.id) && stage !== "lost";
    return { id: p.id, name: p.name, stage, x: Math.cos(a) * r, z: Math.sin(a) * r, color: isDue ? DUE_COLOR : STAGE_COLOR[stage], due: isDue };
  });
}

/** Scale of a follow-up-due node at time t (s): 1..1.5, always finite; still when motion is reduced. */
export function pulse(t: number, reduced: boolean): number {
  return reduced || !Number.isFinite(t) ? 1.25 : 1.25 + 0.25 * Math.sin(t * 3);
}

/** Text twin of the map for screen readers. */
export function mapSummary(nodes: Pick<MapNode, "stage" | "due">[]): string {
  if (!nodes.length) return "Pipeline map: no businesses yet.";
  const parts = STAGES.map((s) => [s, nodes.filter((n) => n.stage === s).length] as const).filter(([, n]) => n).map(([s, n]) => `${n} ${STAGE_LABEL[s]}`);
  const due = nodes.filter((n) => n.due).length;
  return `Pipeline map: ${parts.join(", ")}${due ? `; ${due} follow-up due` : ""}.`;
}
