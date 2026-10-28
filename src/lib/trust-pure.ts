// Trust ladder (pure, tested in tests/trust.test.ts). IO: autonomy.ts trustHistory; API: GET /api/autonomy; UI: Profile → Autonomy.
// From the owner's approval history per action kind, suggest raising an Autonomy area from Ask to Do & report. Suggestions only:
// his Accept click goes through setLevel (POST /api/autonomy {action:"level"}), Not now snoozes the area for 30 days.
// Never for consequential effects (approval-pure CONSEQUENTIAL: send, spend, publish, sign): those stay click-only (AGENTS.md
// rule 6). Never to "auto" (it needs a typed phrase), never from "off" (he switched it off on purpose).
import { EFFECTS, isConsequential } from "./approval-pure.ts";
import { AREAS, AREA_INFO, type Area, type AutonomyState, type Level, type Levels } from "./autonomy-pure.ts";

/** One owner decision on something ORBIT asked about. edited: he changed it before approving. */
export type TrustDecision = { kind: string; at: string; approved: boolean; edited?: boolean };
export type Snooze = Partial<Record<Area, string>>; // area → snoozed until (ISO)

// Action kind → the area whose "Do & report" covers that work. Kinds missing here are never suggested.
export const KIND_AREA: Record<string, Area> = { save_memory: "memory", "memory.hygiene": "memory", add_task: "research" };

const DAY = 86_400_000;
export const WINDOW_DAYS = 30; // "this month"
export const MIN_STREAK = 10; // clean approvals in a row since the last rejection
export const MIN_RATE = 0.9; // approved / decided in the window
export const MAX_EDIT_SHARE = 0.2; // edited approvals / approvals in the window
export const RECENT_DAYS = 14; // the latest decision must be this fresh
export const SNOOZE_DAYS = 30;

export type KindStat = { kind: string; approved: number; rejected: number; edited: number; streak: number; lastAt: number };

/** Per kind, decisions within the window: counts, the clean streak (a rejection resets it; an edited approval neither counts nor resets), latest time. */
export function kindStats(ds: TrustDecision[], now: number): KindStat[] {
  const by = new Map<string, TrustDecision[]>();
  for (const d of ds) {
    const t = Date.parse(d.at);
    if (!(t > now - WINDOW_DAYS * DAY && t <= now)) continue;
    by.set(d.kind, [...(by.get(d.kind) ?? []), d]);
  }
  return [...by].map(([kind, list]) => {
    list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); // newest first
    let streak = 0;
    for (const d of list) { if (!d.approved) break; if (!d.edited) streak++; }
    const approved = list.filter((d) => d.approved);
    return { kind, approved: approved.length, rejected: list.length - approved.length, edited: approved.filter((d) => d.edited).length, streak, lastAt: Date.parse(list[0].at) };
  });
}

/** May this kind ever be suggested for `area`? Known, not consequential (unknown = consequential), area can be "do". */
export const suggestable = (kind: string, area: Area | undefined): area is Area =>
  AREAS.includes(area as Area) && Object.hasOwn(EFFECTS, kind) && !isConsequential(kind) && AREA_INFO[area as Area].levels.includes("do");

export type TrustSuggestion = { kind: string; area: Area; from: Level; to: "do"; approved: number; total: number; streak: number };

/** At most one suggestion per area (the kind with the most approvals), only for areas on Ask that aren't snoozed. */
export function trustSuggestions(ds: TrustDecision[], levels: Levels, snooze: Snooze, now: number, kindArea: Record<string, Area> = KIND_AREA): TrustSuggestion[] {
  const out = new Map<Area, TrustSuggestion>();
  for (const s of kindStats(ds, now)) {
    const area = Object.hasOwn(kindArea, s.kind) ? kindArea[s.kind] : undefined;
    if (!suggestable(s.kind, area) || levels[area] !== "ask") continue;
    if (Date.parse(snooze[area] ?? "") > now) continue;
    const total = s.approved + s.rejected;
    if (s.streak < MIN_STREAK || s.approved / total < MIN_RATE || s.edited / s.approved > MAX_EDIT_SHARE || now - s.lastAt > RECENT_DAYS * DAY) continue;
    if ((out.get(area)?.approved ?? -1) >= s.approved) continue;
    out.set(area, { kind: s.kind, area, from: levels[area], to: "do", approved: s.approved, total, streak: s.streak });
  }
  return [...out.values()];
}

/** His Not now: no trust suggestion for this area for SNOOZE_DAYS. */
export function snoozeTrust(s: AutonomyState, area: unknown, now: number): AutonomyState | string {
  if (!AREAS.includes(area as Area)) return "Unknown area";
  return { ...s, snooze: { ...s.snooze, [area as Area]: new Date(now + SNOOZE_DAYS * DAY).toISOString() } };
}

/** Agent tasks' pending actions (agents.ts PendingAction) → decisions. failed = he approved it, then it failed. */
export const taskDecisions = (rows: { pending?: unknown; finished_at?: string | null }[]): TrustDecision[] =>
  rows.flatMap((r) => (Array.isArray(r.pending) && r.finished_at ? r.pending : [])
    .filter((p: { tool?: unknown; status?: unknown }) => typeof p?.tool === "string" && ["approved", "rejected", "failed"].includes(p.status as string))
    .map((p: { tool: string; status: string }) => ({ kind: p.tool, at: r.finished_at!, approved: p.status !== "rejected" })));
