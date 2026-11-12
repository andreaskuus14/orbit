// Agents as ships: each agent task flies from AGENTS to the planet its work concerns, docks, then flies home. Pure.
import type { PlanetId } from "./planets.ts";

export type ShipTask = { id: string; title: string; agent: string; status: string; request?: string | null };
export type ShipStatus = "running" | "awaiting_approval" | "done" | "failed";
export type Ship = { id: string; title: string; target: PlanetId; status: ShipStatus; launchedAt: number; endedAt: number | null };
export type Phase = "launch" | "cruise" | "dock" | "return" | "gone";
export type ShipFrame = { phase: Phase; u: number; alpha: number; amber: number; red: number }; // u: 0 = AGENTS, 1 = docked; all finite

export const MAX_SHIPS = 12;
export const T = { launch: 1200, cruise: 3000, ret: 3500, flash: 900 } as const; // ms
const LAUNCH_U = 0.15; // the launch burn covers the first stretch, then the ship cruises the rest

// Keywords say what the work concerns; they win over the agent's home turf.
const KEYWORDS: [RegExp, PlanetId][] = [
  [/\b(youtube|video|videos|channel|clip|clips|thumbnail|shorts)\b/i, "studio"],
  [/\b(roblox|game|games|luau|playtest|gamedev)\b/i, "creation"],
  [/\b(client|clients|business|lead|leads|pipeline|outreach)\b/i, "business"],
  [/\b(architecture|architect|building|floor ?plan)\b/i, "arch"],
  [/\b(habit|habits|journal|reminder|reminders|sleep)\b/i, "life"],
  [/\b(vault|pdf|document|documents)\b/i, "vault"],
  [/\b(memory|memories|note|notes|knowledge)\b/i, "memory"],
  [/\b(news|briefing|headlines|research)\b/i, "intelligence"],
  [/\b(automation|automations|workflow|schedule)\b/i, "operations"],
  [/\b(analytics|usage|stats|metrics)\b/i, "analytics"],
];
const AGENT_HOME: Record<string, PlanetId> = {
  atlas: "intelligence", pulse: "intelligence", sentinel: "intelligence", echo: "memory", forge: "creation", vector: "analytics", flow: "operations",
};

export function shipTarget(t: Pick<ShipTask, "title" | "agent" | "request">): PlanetId {
  const text = `${t.title ?? ""} ${(t.request ?? "").slice(0, 400)}`;
  for (const [re, id] of KEYWORDS) if (re.test(text)) return id;
  return AGENT_HOME[(t.agent ?? "").toLowerCase()] ?? "agents";
}

/** queued tasks have not launched yet; cancelled ones fly home like finished ones. */
export function shipStatus(s: string): ShipStatus | null {
  return s === "running" || s === "awaiting_approval" || s === "done" || s === "failed" ? s : s === "cancelled" ? "done" : null;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const fin = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Outbound path position at time `now` (0 → 1). */
function outU(launchedAt: number, now: number, reduced: boolean): number {
  if (reduced) return 1;
  const e = now - launchedAt;
  if (e < T.launch) return LAUNCH_U * ease(e / T.launch) ** 1.5; // slow start, building thrust
  return LAUNCH_U + (1 - LAUNCH_U) * ease((e - T.launch) / T.cruise);
}

export function shipFrame(s: Ship, now: number, reduced: boolean): ShipFrame {
  if (s.endedAt === null) {
    const e = now - s.launchedAt, u = outU(s.launchedAt, now, reduced);
    const phase: Phase = reduced || e >= T.launch + T.cruise ? "dock" : e < T.launch ? "launch" : "cruise";
    // Awaiting approval: amber blink (steady amber with reduced motion).
    const amber = s.status === "awaiting_approval" ? (reduced ? 1 : 0.5 + 0.5 * Math.cos((now / 1000) * Math.PI * 2)) : 0;
    return { phase, u: fin(u), alpha: 1, amber: fin(amber), red: 0 };
  }
  const r = (now - s.endedAt) / T.ret;
  if (r >= 1) return { phase: "gone", u: 0, alpha: 0, amber: 0, red: 0 };
  const from = outU(s.launchedAt, s.endedAt, reduced); // turns around wherever it was
  const u = reduced ? from : from * (1 - ease(r));
  const alpha = r < 0.5 ? 1 : 1 - ease((r - 0.5) * 2);
  const red = s.status === "failed" ? Math.max(0, 1 - (now - s.endedAt) / T.flash) : 0;
  return { phase: "return", u: fin(u), alpha: fin(alpha), amber: 0, red: fin(red) };
}

/** Merge the latest task snapshot into the fleet. Tasks missing from the snapshot are treated as done. */
export function reconcileShips(prev: Ship[], tasks: ShipTask[], now: number): Ship[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Ship[] = [];
  const seen = new Set<string>();
  for (const s of prev) {
    seen.add(s.id);
    const t = byId.get(s.id), st = t ? shipStatus(t.status) : "done";
    let next = s;
    if (st && s.endedAt === null) {
      if (st === "done" || st === "failed") next = { ...s, status: st, endedAt: now };
      else if (st !== s.status || (t && t.title !== s.title)) next = { ...s, status: st, title: t?.title ?? s.title };
    }
    if (shipFrame(next, now, false).phase !== "gone") out.push(next);
  }
  for (const t of tasks) {
    const st = shipStatus(t.status);
    if (seen.has(t.id) || (st !== "running" && st !== "awaiting_approval")) continue; // never launch a ship that already finished
    out.push({ id: t.id, title: t.title, target: shipTarget(t), status: st, launchedAt: now, endedAt: null });
  }
  return out.slice(-MAX_SHIPS); // newest win
}
