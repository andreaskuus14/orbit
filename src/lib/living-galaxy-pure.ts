// Living galaxy: the owner's real data → how each world looks (warmth, glow, size, spin), BUSINESS leads as stage-coloured
// moons, which world a CORE tool step touches, and the one live line shown when a world is hovered. Pure: tests in
// tests/living-galaxy.test.ts. Counts only: no journal/LIFE text ever reaches the galaxy.
import type { Stage } from "./business-pure.ts"; // type only: the public demo bundle must not pull in business-pure
import type { PlanetId } from "./planets.ts";

const fin01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const cnt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** ORBIT's activity colours: quiet worlds sink to cold steel, busy ones run warm amber; CORE's work is white-gold. */
export const QUIET = "#3d5a80", WARM = "#ffb04d", WORK = "#ffe6b0";
/** Leads by stage, from cold (to contact) to won. "lost" draws nothing. */
export const STAGE_COLOR: Record<Stage, string> = { lead: "#9db6d6", contacted: "#4fd8ff", replied: "#b49cff", pilot: "#ffbe5c", paying: "#6dffae", lost: "#55606e" };

export type Life = { glow: number; cool: number; dim: number; size: number; spin: number };
/** vitality (0..1, 7-day events against the busiest world) → look. undefined (no ledger yet) → neutral, as before. */
export function planetLife(vitality: number | undefined): Life {
  if (vitality === undefined) return { glow: 0, cool: 0, dim: 0, size: 1, spin: 1 };
  const v = fin01(vitality);
  return { glow: v * v, cool: 1 - Math.min(1, v * 2.5), dim: 0.7 * (1 - Math.min(1, v * 2)), size: 0.9 + 0.25 * v, spin: 0.3 + 1.7 * v };
}

// Newest-arriving stage last: a new lead appends a moon instead of reshuffling the rest (it can flare where it lands).
const MOON_ORDER: Stage[] = ["paying", "pilot", "replied", "contacted", "lead"];
/** One moon per open lead, ordered by MOON_ORDER; over cap, each stage keeps its share (largest remainder, min 1 if any). */
export function leadMoons(stages: Partial<Record<Stage, number>> | null | undefined, cap = 24): Stage[] {
  const n = MOON_ORDER.map((s) => cnt(stages?.[s]));
  const total = n.reduce((a, b) => a + b, 0);
  let k = n;
  if (total > cap) {
    const want = n.map((x) => (x * cap) / total);
    k = want.map((w, i) => (n[i] ? Math.max(1, Math.floor(w)) : 0));
    let left = cap - k.reduce((a, b) => a + b, 0);
    const order = want.map((w, i) => [w - Math.floor(w), i] as const).sort((a, b) => b[0] - a[0]);
    for (let j = 0; left > 0 && j < order.length; j++) if (n[order[j][1]] > k[order[j][1]]) { k[order[j][1]]++; left--; }
    for (let i = k.length - 1; left < 0 && i >= 0; i--) while (left < 0 && k[i] > 1) { k[i]--; left++; } // min-1s overshot
    while (left < 0) { // more stages than the cap: the smallest stages drop out
      const i = k.reduce((m, x, j) => (x > 0 && (m < 0 || want[j] < want[m]) ? j : m), -1);
      k[i]--; left++;
    }
  }
  return MOON_ORDER.flatMap((s, i) => Array<Stage>(k[i]).fill(s));
}

/** The world a CORE tool step works on; "edge" = out to the web and back; null = CORE's own thinking. */
export function toolPlanet(tool: string): PlanetId | "edge" | null {
  const t = String(tool);
  if (t === "web_search" || t === "fetch_url") return "edge";
  const exact: Record<string, PlanetId> = {
    search_memory: "memory", save_memory: "memory", read_news: "intelligence", ask_agent: "agents",
    studio_status: "studio", learned: "studio", run_scout: "studio", run_niche: "studio", schedule_approved: "studio",
    plan_task: "operations", suggestions: "operations", propose_rule: "operations", create_goal: "operations", goal_status: "operations",
  };
  if (exact[t]) return exact[t];
  const pre: [string, PlanetId][] = [["lead_", "business"], ["business_", "business"], ["vault_", "vault"], ["life_", "life"], ["habit_", "life"],
    ["automation_", "operations"], ["memory_", "memory"], ["studio_", "studio"], ["clip_", "studio"], ["market_", "markets"], ["arch_", "arch"], ["ws_", "creation"]];
  return pre.find(([p]) => t.startsWith(p))?.[1] ?? null;
}

export type LinePart = { key: string; n?: number; vars?: Record<string, string> }; // an i18n key; n = plural count
export type LineData = { recent?: Record<string, number> | null; today?: Record<string, number> | null; stages?: Partial<Record<Stage, number>> | null; memories?: number; agents?: number; life?: { done: number; total: number } | null };
/** The hovered world's live line, as i18n parts (joined with " · "). [] = nothing known yet. */
export function hoverParts(id: string, d: LineData): LinePart[] {
  const out: LinePart[] = [];
  if (id === "memory" && cnt(d.memories)) out.push({ key: "overview.memories", n: cnt(d.memories) });
  if (id === "agents" && cnt(d.agents)) out.push({ key: "overview.running", n: cnt(d.agents) });
  if (id === "life" && d.life && cnt(d.life.total)) out.push({ key: "galaxy.habits", vars: { done: String(Math.min(cnt(d.life.done), cnt(d.life.total))), total: String(cnt(d.life.total)) } });
  if (id === "business" && d.stages) {
    const open = MOON_ORDER.reduce((a, s) => a + cnt(d.stages![s]), 0); // every stage but "lost"
    if (open) out.push({ key: "galaxy.leads", n: open });
    if (cnt(d.stages.lead)) out.push({ key: "galaxy.toContact", vars: { n: String(cnt(d.stages.lead)) } });
    if (cnt(d.stages.paying)) out.push({ key: "galaxy.won", vars: { n: String(cnt(d.stages.paying)) } });
  }
  if (cnt(d.today?.[id])) out.push({ key: "galaxy.today", n: cnt(d.today![id]) });
  if (d.recent) { const r = cnt(d.recent[id]); out.push(r ? { key: "galaxy.week", n: r } : { key: "galaxy.quiet" }); }
  return out;
}
