// "Plan my day" IO: gathers today's calendar (read-only), approvals already waiting, open goals' next steps/deadlines and confirmed
// commitments, builds the plan with dayplan-pure and keeps it in <data dir>/dayplan.json (today's plan, his drag order, the commitment inbox).
// Read-only: nothing is sent, approved or changed anywhere else. LIFE data stays local: no model call here.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { adjustPlan } from "./life-plan-pure";
import { localDay } from "./morning-pure";
import { acceptPlan, buildPlan, carryForward, commitmentItems, dayStat, type DayStat, decideCommitment, dragOrder, eveningReport, inferCommitments, markDone, type Commitment, type DayPlan, type PlanItem } from "./dayplan-pure";

type Store = { plan?: DayPlan; prev?: DayPlan; order?: string[]; commitments: Commitment[]; history?: DayStat[] };
const file = () => path.join(orbitDataDir(), "dayplan.json");
const load = async (): Promise<Store> => { try { const j = JSON.parse(await readFile(file(), "utf8")); return { ...j, commitments: Array.isArray(j?.commitments) ? j.commitments : [] }; } catch { return { commitments: [] }; } };
let saving: Promise<unknown> = Promise.resolve();
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = saving.catch(() => {}).then(async () => {
    const s = await load();
    const r = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return r;
  });
  saving = p;
  return p;
}
const within = <T>(p: Promise<T>, ms = 5000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const minutes = (t: number, dayStart: number) => Math.round((t - dayStart) / 60_000);

async function gather(sb: SupabaseClient | null, userId: string | null, now: number): Promise<PlanItem[]> {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const [ev, ap, goals, s] = await Promise.all([
    within(import("./gcal").then((x) => x.calendarEvents(1, now))).catch(() => null),
    sb ? within(import("./remote").then((x) => x.pendingApprovals(sb))).catch(() => []) : [],
    sb && userId ? within(import("./goals").then((x) => x.listGoals(sb, userId))).catch(() => []) : [],
    load(),
  ]);
  const items: PlanItem[] = [];
  for (const e of ev ?? []) {
    if (e.allDay) continue;
    const start = Math.max(0, minutes(Date.parse(e.start), d0.getTime())), end = Math.min(24 * 60, minutes(Date.parse(e.end), d0.getTime()));
    if (end > start) items.push({ id: `cal:${e.start}:${e.title.slice(0, 40)}`, title: e.title, min: end - start, flexible: false, fixed: { start, end }, source: { kind: "calendar", label: "Google Calendar", open: { panel: "life" } } });
  }
  for (const a of ap) items.push({ id: `ap:${a.id}`, title: `Review: ${a.title}`, min: 10, flexible: true, source: { kind: "approval", label: "Approvals", open: a.kind === "clip" ? { panel: "studio", view: "review" } : a.kind === "send" ? { panel: "business" } : { panel: "studio" } } });
  for (const g of goals) {
    const doc = g.doc;
    if (doc.status === "done" || doc.status === "stopped") continue;
    const step = doc.steps.find((x) => x.status === "waiting" || x.status === "pending");
    if (!step && !doc.deadline) continue;
    items.push({ id: `goal:${g.id}`, title: step ? `${doc.title}: ${step.what}` : `${doc.title} (deadline ${doc.deadline})`, min: step?.status === "waiting" ? 15 : 45, flexible: true,
      ...(doc.deadline && { due: doc.deadline }), source: { kind: doc.deadline ? "deadline" : "goal", label: `Goal: ${doc.title}`, open: { goal: g.id } } });
  }
  for (const b of await within(import("./school").then((x) => x.schoolToday(now))).catch(() => [])) // planned study blocks stay fixed
    items.push({ id: `school:${b.start}`, title: `Study: ${b.title}`, min: minutes(b.end, b.start), flexible: false, fixed: { start: minutes(b.start, d0.getTime()), end: minutes(b.end, d0.getTime()) }, source: { kind: "deadline", label: "School planner", open: { panel: "life" } } });
  return [...items, ...commitmentItems(s.commitments)];
}

/** A fresh proposal for today (keeps his drag order; an accepted plan is returned as is until he re-plans). */
export async function planDay(sb: SupabaseClient | null, userId: string | null, opts: { fresh?: boolean; now?: number } = {}): Promise<DayPlan> {
  const now = opts.now ?? Date.now(), day = localDay(new Date(now)), d = new Date(now);
  const s = await load();
  if (!opts.fresh && s.plan?.day === day && s.plan.accepted) return s.plan;
  const order = s.plan?.day === day ? s.order ?? [] : [];
  const newDay = !!s.plan && s.plan.day !== day, prev = newDay ? s.plan : s.prev, stat = newDay ? dayStat(s.plan!) : null;
  const history = [...(s.history ?? []), ...(stat ? [stat] : [])].slice(-14);
  const max = Number(process.env.ORBIT_MAX_PLANNED_HOURS);
  const plan = buildPlan(carryForward(await gather(sb, userId, now), prev, day), { day, now: d.getHours() * 60 + d.getMinutes(), history,
    ...(max > 0 && max <= 16 && { maxPlanned: Math.round(max * 60) }) }, order);
  await update((x) => { x.plan = plan; x.order = order; x.prev = prev; x.history = history; });
  return plan;
}

export const currentPlan = async () => (await load()).plan ?? null;

/** Drag: move one flexible task before another (or to the end), then re-place. */
export async function movePlan(sb: SupabaseClient | null, userId: string | null, id: string, beforeId: string | null): Promise<DayPlan | string> {
  const s = await load();
  if (!s.plan) return "No plan yet";
  if (s.plan.accepted) return "Today's plan is already accepted";
  const order = dragOrder(s.plan, id, beforeId);
  if (typeof order === "string") return order;
  await update((x) => { x.order = order; });
  return planDay(sb, userId, { fresh: true });
}

/** LIF02: a block ran over (or he changed it): the smallest shift of later flexible blocks; fixed ones never move. */
export const adjust = (id: string, extra: number) => update((s) => {
  if (!s.plan) return "No plan yet";
  const r = adjustPlan(s.plan, id, extra);
  if (typeof r !== "string") s.plan = r.plan;
  return r;
});
export const accept = () => update((s) => (s.plan ? (s.plan = acceptPlan(s.plan, new Date().toISOString())) : "No plan yet"));
export const setDone = (id: string, done: boolean) => update((s) => {
  if (!s.plan) return "No plan yet";
  const r = markDone(s.plan, id, done);
  if (typeof r !== "string") s.plan = r;
  return r;
});
export async function review(now = Date.now()) {
  const p = (await load()).plan, d = new Date(now);
  return p?.day === localDay(d) ? eveningReport(p, d.getHours() * 60 + d.getMinutes()) : null;
}

export const commitments = async () => (await load()).commitments.filter((c) => c.status === "awaiting" || c.status === "confirmed");
export const captureCommitments = (text: string, source: { kind: string; ref?: string }) => update((s) => {
  const found = inferCommitments(text, source, new Date());
  s.commitments = [...found, ...s.commitments].slice(0, 200);
  return found;
});
/** His own confirmed task (e.g. an open loop he turned into one): goes straight into "Plan my day". */
export const addTask = (text: string, source: { kind: string; ref?: string }, est?: { min?: number; rank?: number; due?: string }) => update((s) => {
  const c: Commitment = { id: `c-${Date.now().toString(36)}-t`, text: text.slice(0, 200), owner: "me", missing: [], status: "confirmed", source, at: new Date().toISOString(), ...est };
  s.commitments = [c, ...s.commitments].slice(0, 200);
  return c;
});
export const decide = (id: string, ok: boolean, due?: string) => update((s) => {
  const r = decideCommitment(s.commitments, id, ok, due);
  if (typeof r !== "string") s.commitments = r;
  return typeof r === "string" ? r : r.find((c) => c.id === id)!;
});
