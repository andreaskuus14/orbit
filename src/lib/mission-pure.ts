// MISSION CONTROL + TEAMS (pure, tested in tests/mission.test.ts). UI: src/components/AgentMission.tsx, TeamBuilder.tsx.
import { validateChain, type ChainView, type Draft } from "./chains-pure.ts";

/** "just now" / "4m ago" / "3h ago" / "2d ago"; "" for a missing or bad date. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  return s < 45 ? "just now" : s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}

export type LogLine = { key: string; ok: boolean; text: string };

/** Task trace (untrusted JSON) → short plain-text lines, newest last; keeps only the last `max`. */
export function traceLines(trace: unknown, max = 40): LogLine[] {
  if (!Array.isArray(trace)) return [];
  const out: LogLine[] = [];
  trace.forEach((raw, i) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as { step?: unknown; detail?: unknown; ms?: unknown; ok?: unknown };
    const step = typeof r.step === "string" ? r.step : "step";
    const detail = typeof r.detail === "string" ? r.detail.replace(/\s+/g, " ").trim() : "";
    const ms = typeof r.ms === "number" && Number.isFinite(r.ms) && r.ms > 0 ? r.ms : 0;
    const time = ms ? ` (${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`})` : "";
    out.push({ key: `${i}`, ok: r.ok !== false, text: `${step.replace(/_/g, " ")}${detail ? ` — ${detail.length > 160 ? `${detail.slice(0, 160)}…` : detail}` : ""}${time}` });
  });
  return out.slice(-max);
}

/** First ~n chars of a result on one line. */
export const excerpt = (s: string | null | undefined, n = 180) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** Running/waiting chains → [fromAgent, toAgent] hand-offs: the current (first not-done) step's previous agent → its agent. Deduped. */
export function beamPairs(chains: Pick<ChainView, "status" | "steps">[]): [string, string][] {
  const seen = new Set<string>(), out: [string, string][] = [];
  for (const c of chains) {
    if (c.status !== "running" && c.status !== "waiting") continue;
    const k = c.steps.findIndex((s) => s.status !== "done");
    if (k < 1) continue;
    const from = c.steps[k - 1].agent, to = c.steps[k].agent, id = `${from}>${to}`;
    if (from === to || seen.has(id)) continue;
    seen.add(id); out.push([from, to]);
  }
  return out;
}

export const chainActive = (chains: Pick<ChainView, "status">[]) => chains.some((c) => c.status === "running" || c.status === "waiting");

/** Same rules as the server (validateChain), plus: every agent must be on the roster. */
export function checkTeam(goal: string, steps: { agent: string; request: string }[], roster: string[]): Draft | string {
  const d = validateChain({ goal, steps });
  if (typeof d === "string") return d;
  const bad = d.steps.findIndex((s) => !roster.includes(s.agent));
  return bad >= 0 ? `step ${bad + 1}: unknown agent "${d.steps[bad].agent}"` : d;
}

/** Move item i by dir (-1 up, +1 down); out of range → the same array. */
export function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
