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

// ── Bridge overlay (components/MissionControl.tsx): API bodies are untrusted JSON, so every reader tolerates junk. ──
const o = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const arr = (x: unknown) => (Array.isArray(x) ? x.map(o) : []);
const s = (x: unknown) => (typeof x === "string" ? x : "");
const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const p2 = (v: number) => String(v).padStart(2, "0");

/** ms → "04:05" / "1:02:03" / "2d 03:04"; negative or bad → "00:00". */
export function clockDur(ms: number): string {
  const t = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0, d = Math.floor(t / 86400), h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60;
  return d ? `${d}d ${p2(h)}:${p2(m)}` : h ? `${h}:${p2(m)}:${p2(t % 60)}` : `${p2(m)}:${p2(t % 60)}`;
}

/** Time until an ISO date: "T−01:02:03"; "T−0" once due; "" for a bad date. */
export function countdown(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? (t <= now ? "T−0" : `T−${clockDur(t - now)}`) : "";
}

/** used / limit as a whole 0-100 percentage; 0 when there is no limit. */
export const usagePct = (used: number, limit: number) => (limit > 0 && Number.isFinite(used) ? Math.min(100, Math.max(0, Math.round((used / limit) * 100))) : 0);

export type BridgeTask = { id: string; agent: string; title: string; step: string; steps: number; elapsed: string };
/** /api/tasks → running tasks with their latest trace step and time since start. */
export function bridgeTasks(body: unknown, now: number): BridgeTask[] {
  return arr(o(body).tasks).filter((t) => t.status === "running").map((t) => {
    const trace = arr(t.trace), last = trace[trace.length - 1];
    const started = Date.parse(s(t.started_at) || s(t.created_at));
    return { id: s(t.id), agent: s(t.agent), title: s(t.title), steps: trace.length, step: last ? s(last.step).replace(/_/g, " ") : "starting",
      elapsed: Number.isFinite(started) ? clockDur(now - started) : "--:--" };
  });
}

export type Waiting = { id: string; title: string; where: "operations" | "agents" };
/** Tasks awaiting approval (approved in OPERATIONS) + pending proposals (approved in AGENTS). Read-only: never approves. */
export function bridgeApprovals(tasks: unknown, proposals: unknown): Waiting[] {
  return [...arr(o(tasks).tasks).filter((t) => t.status === "awaiting_approval").map((t) => ({ id: s(t.id), title: s(t.title) || "Task", where: "operations" as const })),
    ...arr(o(proposals).proposals).filter((p) => p.status === "pending").map((p) => ({ id: s(p.id), title: s(p.title) || "Proposal", where: "agents" as const }))];
}

export type BridgeStudio = { jobs: { id: string; name: string; step: string; pct: number }[]; next: { title: string; at: string } | null; scheduled: number };
/** /api/studio/clips → unfinished jobs (and done jobs re-rendering a clip) + the soonest scheduled Short. */
export function bridgeStudio(body: unknown, now: number): BridgeStudio {
  const jobs = arr(o(body).jobs), live: BridgeStudio["jobs"] = [];
  let next: BridgeStudio["next"] = null, scheduled = 0;
  for (const j of jobs) {
    const clips = arr(j.clips);
    if (!["done", "failed"].includes(s(j.status)) || clips.some((c) => c.status === "rendering"))
      live.push({ id: s(j.id), name: s(j.source), step: s(j.step) || s(j.status), pct: usagePct(n(j.progress), 1) }); // progress is a 0-1 fraction
    for (const c of clips) {
      const pub = o(c.publish), at = Date.parse(s(pub.scheduledFor));
      if (pub.status !== "scheduled" || !(at > now)) continue;
      scheduled++;
      if (!next || at < Date.parse(next.at)) next = { title: s(pub.title) || s(c.title), at: s(pub.scheduledFor) };
    }
  }
  return { jobs: live, next, scheduled };
}
