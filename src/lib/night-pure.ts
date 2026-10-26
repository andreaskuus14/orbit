// Night shift (pure, tested in tests/night.test.ts). IO: night.ts (run from the scheduler tick), API: /api/night, UI: NightShift.tsx.
// Each night window (default 01:00-06:30 Europe/Tallinn) while the owner is idle, ORBIT works a bounded queue of things that are
// already safe unattended: his "tonight" asks, the next step of approved goal plans, BUSINESS follow-up drafts, Shorts packaging up
// to review, the weekly niche scout and memory hygiene. Nothing here publishes, sends or spends: every outside effect stays behind
// its existing owner-click approval. Budget: max Claude calls + minutes per night; usageHold and Stop-all end the run.
import { clean, nextMove, type Goal } from "./goals-pure.ts";
import type { PushMessage } from "./remote-push-pure.ts";

export type NightSettings = { enabled: boolean; from: string; until: string; tz: string; wake: string; maxCalls: number; maxMinutes: number; idleMin: number };
export const NIGHT_DEFAULTS: NightSettings = { enabled: true, from: "01:00", until: "06:30", tz: "Europe/Tallinn", wake: "08:00", maxCalls: 40, maxMinutes: 150, idleMin: 30 };
export const TONIGHT_MAX = 10, TEXT_MAX = 500, MAX_GOALS = 3, MAX_RESEARCH = 4, MAX_FOLLOWUPS = 3;
export const DRAFT_AGAIN_MS = 7 * 86_400_000; // a prospect gets at most one overnight follow-up draft a week
export const PERSONA_STUDIO_RUNS = 2; // real look-only Studio playtests per night (each up to 4 minutes); the rest is simulated
export const RESEARCH_AGENTS = ["atlas", "nova", "forge", "vector", "echo", "sentinel"];

export const NIGHT_KINDS = ["research", "goal", "business", "clips", "niche", "hygiene", "deals", "health", "personas"] as const;
export type NightKind = (typeof NIGHT_KINDS)[number];
export const ITEM_STATUSES = ["done", "approval", "failed", "skipped"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
// calls/minutes: the estimate the planner budgets with (the runner measures what was really used).
export type NightTask = { kind: NightKind; ref: string; label: string; calls: number; minutes: number };
export type Open = { task: string } | { goal: string; step?: number; stepId?: string } | { panel: "studio" | "business" | "memory" | "agents" | "markets" };
export type NightItem = { kind: NightKind; ref: string; label: string; status: ItemStatus; why?: string; open?: Open; draft?: string; at: string };
export type NightRun = { id: string; key: string; startedAt: string; endedAt?: string; calls: number; ms: number; items: NightItem[]; stopped?: string; deferred?: number; pushed?: string };
export type TonightItem = { id: string; text: string; agent: string; by: "owner" | "core"; at: string };
export type NightUser = { tonight: TonightItem[]; run?: NightRun; drafted: Record<string, string> };
export type NightState = { settings: NightSettings; users: Record<string, NightUser> };

// ---- Settings and state -----------------------------------------------------

const hm = (s: string) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s); return m ? +m[1] * 60 + +m[2] : NaN; };
const validTz = (tz: unknown) => { try { return typeof tz === "string" && !!tz && !!new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { return false; } };
const int = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : NaN);

/** POST body → new settings, or why not. Only the fields given change. */
export function patchNightSettings(b: Record<string, unknown>, cur: NightSettings): NightSettings | string {
  const s = { ...cur };
  if (b.enabled !== undefined) { if (typeof b.enabled !== "boolean") return "enabled must be true or false"; s.enabled = b.enabled; }
  for (const k of ["from", "until", "wake"] as const) if (b[k] !== undefined) { if (typeof b[k] !== "string" || Number.isNaN(hm(b[k] as string))) return `${k} must be HH:MM (24-hour)`; s[k] = b[k] as string; }
  if (b.tz !== undefined) { if (!validTz(b.tz)) return "tz must be a time zone like Europe/Tallinn"; s.tz = b.tz as string; }
  const nums = { maxCalls: [1, 200], maxMinutes: [10, 480], idleMin: [0, 240] } as const;
  for (const [k, [lo, hi]] of Object.entries(nums) as [keyof typeof nums, readonly [number, number]][]) {
    if (b[k] === undefined) continue;
    const v = int(b[k], lo, hi);
    if (Number.isNaN(v)) return `${k} must be a whole number ${lo}-${hi}`;
    s[k] = v;
  }
  if (s.from === s.until) return "the night window needs a different start and end";
  return s;
}

/** night.json text → state; anything unreadable falls back to defaults (the queue is only ever written atomically). */
export function parseNight(text: string): NightState {
  try {
    const j = JSON.parse(text) as Partial<NightState>;
    const settings = patchNightSettings((j?.settings ?? {}) as Record<string, unknown>, NIGHT_DEFAULTS);
    const users = j?.users && typeof j.users === "object" ? j.users : {};
    for (const u of Object.values(users)) { u.tonight = Array.isArray(u.tonight) ? u.tonight : []; u.drafted = u.drafted && typeof u.drafted === "object" ? u.drafted : {}; }
    return { settings: typeof settings === "string" ? { ...NIGHT_DEFAULTS } : settings, users };
  } catch { return { settings: { ...NIGHT_DEFAULTS }, users: {} }; }
}

/** Add a "look into X tonight" item, or why not. */
export function addTonight(list: TonightItem[], b: { text?: unknown; agent?: unknown }, by: TonightItem["by"], id: string, now: number): TonightItem[] | string {
  const text = clean(b.text, TEXT_MAX);
  if (text.length < 3) return "Say what to work on tonight (3-500 characters)";
  const agent = b.agent === undefined || b.agent === "" ? "atlas" : String(b.agent).toLowerCase();
  if (!RESEARCH_AGENTS.includes(agent)) return `agent must be one of ${RESEARCH_AGENTS.join(", ")}`;
  if (list.length >= TONIGHT_MAX) return `Tonight's list is full (${TONIGHT_MAX}); remove one first`;
  if (list.some((t) => t.text.toLowerCase() === text.toLowerCase())) return "That's already on tonight's list";
  return [...list, { id, text, agent, by, at: new Date(now).toISOString() }];
}

/** The task request for a tonight item: the owner's words fenced as data, with the night rules restated. */
export const researchRequest = (text: string) =>
  `The user queued this for ORBIT's night shift. Work on it while he sleeps and leave a short, sourced report for the morning. ` +
  `Don't act outside ORBIT: anything that would change or send something must go to his approval.\n\n<request>\n${clean(text, TEXT_MAX)}\n</request>`;

/** CORE's queue_tonight guard: only from the owner's own latest message, and only when he says tonight / overnight. */
export function tonightBlocked(question: string, tainted: boolean): string {
  if (tainted) return "only call queue_tonight as your first tool, for the user's own request";
  if (/^\s*(how|what|why|when|did|does|is|are|was|were)\b/i.test(question) || !/\b(tonight|overnight|over night|while i(?:'m| am)? (?:sleep|asleep|sleeping)|night shift)\b/i.test(question))
    return "only when the user asks in their latest message for something to be done tonight / overnight";
  return "";
}

// ---- When ----------------------------------------------------------------------

/** Local date and minute of the day in `tz`. */
export function localClock(now: number, tz: string): { day: string; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}

export function inWindow(now: number, s: NightSettings): boolean {
  const { min } = localClock(now, s.tz), f = hm(s.from), u = hm(s.until);
  return f < u ? min >= f && min < u : min >= f || min < u;
}

/** A night is named after the local date of the morning it ends on (a 23:00-06:00 window started at 23:30 belongs to tomorrow). */
export function nightKey(now: number, s: NightSettings): string {
  const c = localClock(now, s.tz);
  return hm(s.from) > hm(s.until) && c.min >= hm(s.from) ? localClock(now + 12 * 3_600_000, s.tz).day : c.day;
}

/** Why the night shift can't start now, or "" when it may. A run cut short by Stop-all or the usage hold continues the same night. */
export function startBlock(a: { now: number; s: NightSettings; run?: NightRun; lastActive: number; stopAll: boolean; hold: string }): string {
  if (!a.s.enabled) return "the night shift is off";
  if (a.stopAll) return "Stop-all is on";
  if (!inWindow(a.now, a.s)) return "outside the night window";
  if (a.run?.key === nightKey(a.now, a.s) && (!a.run.stopped || a.run.stopped === "budget")) return "already ran tonight";
  if (a.hold) return a.hold;
  if (a.now - a.lastActive < a.s.idleMin * 60_000) return "the owner is using ORBIT";
  return "";
}

/** The morning push: once, at wake time (up to 3 h after), the morning after a run that did something. */
export function wakePushDue(now: number, s: NightSettings, run?: NightRun): boolean {
  if (!run?.endedAt || run.pushed || !run.items.some((i) => i.status !== "skipped")) return false;
  const c = localClock(now, s.tz), w = hm(s.wake);
  return run.key === c.day && c.min >= w && c.min < w + 180;
}

// ---- What --------------------------------------------------------------------

export type PlanInput = {
  tonight: TonightItem[];
  goals: { id: string; doc: Goal }[];
  followups: { id: string; name: string }[];
  drafted: Record<string, string>;
  nicheDue: boolean;
  health?: boolean; // run the self-healing check (health.ts) tonight: no code changes, at most 3 fast-model notes
  deals?: number; // wishes the deal hunter would cover now (deals.ts dueCount); one read-only web call each
  personas?: boolean; // persona playtest of the pet sim due (personas.ts): 1 walkthrough call + PERSONA_STUDIO_RUNS look-only Studio runs
  handled: string[]; // `${kind}:${ref}` already in this night's run (a continued run doesn't redo them)
  now: number;
  today: string; // goals' budget day (server-local, goals-pure today())
  off?: NightKind[]; // kinds Profile → Autonomy doesn't allow unattended (autonomy-pure nightOff; empty with the defaults)
  boost?: Partial<Record<NightKind, number>>; // kept lessons' prior per kind (lessons.ts nightBoost, ~0.85–1.15); 1 when missing
};

/** The night's queue in order (owner's asks, goal steps, follow-up drafts, deal hunt, Shorts packaging, niche scout, hygiene), trimmed to the
 *  budget left. Tasks that don't fit are counted in `deferred` (tonight items stay queued for the next night). */
export function planNight(i: PlanInput, s: NightSettings, used: { calls: number; ms: number }): { queue: NightTask[]; deferred: number } {
  const all: NightTask[] = [
    { kind: "hygiene", ref: "hygiene", label: "Memory tidy-up suggestions", calls: 0, minutes: 1 } as NightTask,
    ...(i.health ? [{ kind: "health", ref: "health", label: "ORBIT health check", calls: 3, minutes: 5 } as NightTask] : []),
    ...i.tonight.slice(0, MAX_RESEARCH).map((t): NightTask => ({ kind: "research", ref: t.id, label: t.text.slice(0, 120), calls: 8, minutes: 10 })),
    ...i.goals.filter((g) => ["run", "sync"].includes(nextMove(g.doc, i.today).do)).slice(0, MAX_GOALS)
      .map((g): NightTask => ({ kind: "goal", ref: g.id, label: g.doc.title.slice(0, 120), calls: g.doc.budget.callsPerStep, minutes: 10 })),
    ...i.followups.filter((p) => !(i.now - Date.parse(i.drafted[p.id] ?? "") < DRAFT_AGAIN_MS)).slice(0, MAX_FOLLOWUPS)
      .map((p): NightTask => ({ kind: "business", ref: p.id, label: `Follow-up for ${p.name.slice(0, 80)}`, calls: 1, minutes: 2 })),
    ...(i.deals ? [{ kind: "deals", ref: "deals", label: `Deal hunt for ${i.deals} wish${i.deals > 1 ? "es" : ""}`, calls: i.deals, minutes: 6 * i.deals } as NightTask] : []),
    ...(i.personas ? [{ kind: "personas", ref: "personas", label: "Persona playtest of the pet sim", calls: 1 + PERSONA_STUDIO_RUNS, minutes: 5 + 4 * PERSONA_STUDIO_RUNS } as NightTask] : []),
    { kind: "clips", ref: "clips", label: "Shorts packaging up to review", calls: 6, minutes: 10 } as NightTask,
    ...(i.nicheDue ? [{ kind: "niche", ref: "niche", label: "Weekly BUSINESS niche scout", calls: 1, minutes: 10 } as NightTask] : []),
  ].filter((t) => !i.handled.includes(`${t.kind}:${t.ref}`) && !i.off?.includes(t.kind));
  // Kept lessons only reorder ORBIT's own work (so a tight budget defers what he cares less about); his asks, the free tidy-up and the health check stay first.
  const w = (t: NightTask) => (t.kind === "research" || t.kind === "hygiene" || t.kind === "health" ? Infinity : i.boost?.[t.kind] ?? 1);
  all.sort((a, b) => w(b) - w(a)); // stable: equal weights keep the order above
  const queue: NightTask[] = [];
  let calls = used.calls, min = used.ms / 60_000, deferred = 0;
  for (const t of all) {
    if (calls + t.calls > s.maxCalls || min + t.minutes > s.maxMinutes) { deferred++; continue; }
    queue.push(t); calls += t.calls; min += t.minutes;
  }
  return { queue, deferred };
}

/** Whether a task still fits once real usage is known (the runner checks before each one). */
export const fits = (t: NightTask, used: { calls: number; ms: number }, s: NightSettings) => used.calls + t.calls <= s.maxCalls && used.ms / 60_000 + t.minutes <= s.maxMinutes;

/** What one night step did to a goal: compares the goal before and after advance(…, 1). */
export function goalOutcome(id: string, before: Goal, after: Goal | null): Pick<NightItem, "status" | "label" | "why" | "open"> {
  const t = before.title.slice(0, 80);
  if (!after) return { status: "failed", label: t, why: "The goal is gone" };
  const i = after.steps.findIndex((s) => s.status !== "done"), s = after.steps[i];
  const moved = after.steps.filter((x, k) => x.status === "done" && before.steps[k]?.id === x.id && before.steps[k].status !== "done").length;
  const doneNote = moved ? ` (${moved} step${moved > 1 ? "s" : ""} done first)` : "";
  if (after.status === "blocked") return { status: "failed", label: t, why: (after.blocker ?? "A step failed").slice(0, 200), open: { goal: id } };
  if (s?.status === "waiting" && s.taskId) return { status: "approval", label: `${t}: step ${i + 1}'s actions need your approval${doneNote}`, open: { task: s.taskId } };
  if (after.status === "waiting" && s?.status === "pending" && s.needsApproval && !s.ok) return { status: "approval", label: `${t}: step ${i + 1} needs your OK${doneNote}`, open: { goal: id, step: i, stepId: s.id } };
  if (after.proposal) return { status: "approval", label: `${t}: a plan change waits for you${doneNote}`, open: { goal: id } };
  if (moved) return { status: "done", label: `${t}: ${moved} step${moved > 1 ? "s" : ""} done`, open: { goal: id } };
  if (after.status === "done") return { status: "done", label: `${t}: goal finished`, open: { goal: id } };
  return { status: "skipped", label: t, why: (after.waitingFor ?? "Nothing to run").slice(0, 200) };
}

// ---- Morning report ----------------------------------------------------------

export type NightReport = { key: string; startedAt: string; endedAt?: string; running: boolean; done: NightItem[]; approvals: NightItem[]; failed: NightItem[]; calls: number; minutes: number; stopped?: string; deferred: number };

/** "While you slept": last night's run (only on the morning it ends), with approvals the owner already answered dropped.
 *  live: current status of each task the run linked to. */
export function nightReport(run: NightRun | undefined, live: Record<string, string>, now: number, s: NightSettings, running: boolean): NightReport | null {
  if (!run || run.key !== localClock(now, s.tz).day) return null;
  const answered = (i: NightItem) => !!i.open && "task" in i.open && live[i.open.task] !== undefined && live[i.open.task] !== "awaiting_approval";
  const items = run.items.filter((i) => !(i.status === "approval" && answered(i)));
  if (!items.some((i) => i.status !== "skipped") && !running) return null;
  return {
    key: run.key, startedAt: run.startedAt, endedAt: run.endedAt, running, calls: run.calls, minutes: Math.round(run.ms / 60_000), stopped: run.stopped, deferred: run.deferred ?? 0,
    done: items.filter((i) => i.status === "done"), approvals: items.filter((i) => i.status === "approval"), failed: items.filter((i) => i.status === "failed"),
  };
}

/** The wake-time push: counts only (never titles, drafts or results). */
export function nightPush(r: { done: number; approvals: number; failed: number }): PushMessage {
  const title = `Night shift: ${r.done} done, ${r.approvals} to approve${r.failed ? `, ${r.failed} failed` : ""}`;
  return { title, body: "See what ORBIT did while you slept.", url: "/remote#r-appr", tag: "night" };
}

/** Why a run stopped, in the owner's words. */
export const stoppedText = (why?: string) =>
  why === "stop-all" ? "Stopped by Stop-all" : why === "usage" ? "Paused to save your Claude budget" : why === "window" ? "The night window ended" : why === "budget" ? "Tonight's budget was used up" : why ? why : "";
