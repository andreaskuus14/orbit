import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, createBudget, emit, recordUsage } from "./claude";
import { stopAllOn } from "./stop-all";
import { allows, autonomyLevels } from "./autonomy";
import { nightOff } from "./autonomy-pure";
import { callsSince, lastCoreCallAt, usageHold } from "./usage-meter";
import { today } from "./goals-pure";
import { FOLLOWUP_SYSTEM, dueFollowups, followupPrompt, type Prospect } from "./business-pure";
import { scoutDue } from "./niche-pure";
import { NIGHT_KINDS, PERSONA_STUDIO_RUNS, addTonight, fits, goalOutcome, inWindow, nightKey, nightPush, nightReport, parseNight, patchNightSettings, planNight, researchRequest, startBlock, tonightBlocked, wakePushDue,
  type NightItem, type NightRun, type NightState, type NightTask, type NightUser } from "./night-pure";

// Night shift runner (rules: night-pure.ts). Called every scheduler tick; starts at most one run at a time, in the night window,
// while the owner is idle. Background lane only; every step re-checks Stop-all, usageHold, the window and the night's budget.
// Agent work goes through runTask/advance, so anything an agent wants to do outside ORBIT waits in the existing approval flow.
// State (settings, the "tonight" queue, last night's run): <ORBIT data dir>/night.json.

const file = () => path.join(orbitDataDir(), "night.json");
const g = globalThis as unknown as { __orbitNight?: { ac: AbortController | null; write: Promise<unknown> } };
const N = (g.__orbitNight ??= { ac: null, write: Promise.resolve() });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

const load = async (): Promise<NightState> => parseNight(await readFile(file(), "utf8").catch(() => ""));
/** Serialized read → fn → atomic write, so the API and the runner never lose each other's changes. */
function update<T>(fn: (s: NightState) => T): Promise<T> {
  const p = N.write.catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return out;
  });
  N.write = p;
  return p;
}
const user = (s: NightState, id: string): NightUser => (s.users[id] ??= { tonight: [], drafted: {} });

/** Stop-all: abort the running night (its agent task and drafts stop; goal drivers are aborted by Stop-all itself). */
export function abortNightShift() { N.ac?.abort(); }
export const nightRunning = () => !!N.ac;

/** Scheduler tick: the wake-time push, then maybe start tonight's run (not awaited: a run takes up to the night). Never throws. */
export async function maybeNightShift(sb: SupabaseClient, userIds: string[], now = Date.now()) {
  try {
    const st = await load();
    for (const id of userIds) {
      const run = st.users[id]?.run;
      if (!wakePushDue(now, st.settings, run)) continue;
      await update((s) => { const r = user(s, id).run; if (r) r.pushed = new Date(now).toISOString(); }); // claimed first: never twice
      const { pushProblem, deliver } = await import("./remote-push");
      if (!pushProblem()) void deliver(nightPush({ done: count(run!, "done"), approvals: count(run!, "approval"), failed: count(run!, "failed") }));
    }
    if (N.ac) return;
    // shortcut: "idle" = no CORE chat for idleMin minutes (the server can't see the PC's keyboard; scripts/night checks that before sleeping).
    const id = userIds[0]; // ORBIT has one owner; the run acts for him
    if (!id || !allows("night-shift", "background").ok || startBlock({ now, s: st.settings, run: st.users[id]?.run, lastActive: lastCoreCallAt(), stopAll: stopAllOn(), hold: usageHold() })) return;
    N.ac = new AbortController();
    void runNight(sb, id, N.ac).catch((e) => console.error("[orbit] night shift failed:", msg(e))).finally(() => { N.ac = null; });
  } catch (e) { console.error("[orbit] night shift check failed:", msg(e)); }
}
const count = (r: NightRun, s: NightItem["status"]) => r.items.filter((i) => i.status === s).length;

async function runNight(sb: SupabaseClient, userId: string, ac: AbortController) {
  const st = await load(), s = st.settings, now = Date.now(), key = nightKey(now, s);
  const prev = st.users[userId]?.run;
  const run: NightRun = prev?.key === key ? { ...prev, stopped: undefined, endedAt: undefined } : { id: randomUUID(), key, startedAt: new Date(now).toISOString(), calls: 0, ms: 0, items: [] };
  const seg = Date.now(), base = { calls: run.calls, ms: run.ms };
  const used = () => ({ calls: base.calls + callsSince(seg), ms: base.ms + Date.now() - seg });
  const save = () => { Object.assign(run, used()); return update((x) => { user(x, userId).run = structuredClone(run); }); };
  await save();
  if (!prev || prev.key !== key) await emit(sb, userId, "night.start", "core", { night: run.id });
  console.log("[orbit] night shift starting");

  const { queue, deferred } = planNight(await planInput(sb, userId, st, run), s, used());
  run.deferred = deferred;
  for (const t of queue) {
    if (ac.signal.aborted || stopAllOn()) { run.stopped = "stop-all"; break; }
    if (usageHold()) { run.stopped = "usage"; break; }
    if (!inWindow(Date.now(), s)) { run.stopped = "window"; break; }
    if (!fits(t, used(), s)) { run.deferred = (run.deferred ?? 0) + 1; run.stopped = "budget"; continue; }
    const item = await runOne(sb, userId, t, ac.signal).catch((e): NightItem => ({ kind: t.kind, ref: t.ref, label: t.label, status: "failed", why: msg(e), at: new Date().toISOString() }));
    if (ac.signal.aborted && item.status !== "done") { run.stopped = "stop-all"; break; } // cut off midway: not reported as a failure, retried on Resume
    run.items.push(item);
    await save();
    await emit(sb, userId, "night.task", "core", { night: run.id, kind: t.kind, ref: t.ref.slice(0, 128), status: item.status });
  }
  run.endedAt = new Date().toISOString();
  await save();
  const u = used();
  await emit(sb, userId, "night.end", "core", { night: run.id, done: count(run, "done"), approvals: count(run, "approval"), failed: count(run, "failed"), calls: u.calls, minutes: Math.round(u.ms / 60_000) });
  console.log(`[orbit] night shift ${run.stopped ? `stopped (${run.stopped})` : "done"}: ${run.items.length} item(s), ${u.calls} Claude call(s)`);
}

async function planInput(sb: SupabaseClient, userId: string, st: NightState, run: NightRun) {
  const [goals, prospects, board] = await Promise.all([
    sb.from("goals").select("id, doc").eq("user_id", userId).in("status", ["approved", "running", "waiting"]).limit(30),
    sb.from("prospects").select("id, name, stage, updated_at, notes").eq("user_id", userId).eq("stage", "contacted").limit(300),
    import("./niche").then((n) => n.nicheBoard()).catch(() => null),
  ]);
  return {
    tonight: st.users[userId]?.tonight ?? [], goals: (goals.data ?? []) as { id: string; doc: import("./goals-pure").Goal }[],
    followups: dueFollowups((prospects.data ?? []) as Prospect[], Date.now()), drafted: st.users[userId]?.drafted ?? {},
    nicheDue: !!board && !board.busy && scoutDue({ lastAttempt: board.lastAttempt ?? undefined, lastOk: board.lastOk ?? undefined }, Date.now()),
    deals: await import("./deals").then((d) => d.dueCount(), () => 0),
    rivals: await import("./rivals").then((r) => r.rivalsDue(), () => 0),
    health: true,
    personas: await import("./personas").then((m) => m.personasDue(userId), () => false),
    handled: run.items.map((i) => `${i.kind}:${i.ref}`), now: Date.now(), today: today(), off: nightOff(autonomyLevels()),
    boost: await import("./lessons").then(async (m) => Object.fromEntries(await Promise.all(NIGHT_KINDS.map(async (k) => [k, await m.nightBoost(userId, k)] as const))), () => ({})),
  };
}

async function runOne(sb: SupabaseClient, userId: string, t: NightTask, signal: AbortSignal): Promise<NightItem> {
  const at = () => new Date().toISOString(), base = { kind: t.kind, ref: t.ref, label: t.label };
  switch (t.kind) {
    case "research": {
      const st = await load(), item = st.users[userId]?.tonight.find((x) => x.id === t.ref);
      if (!item) return { ...base, status: "skipped", why: "Removed from tonight's list", at: at() };
      const { data: task, error } = await sb.from("tasks").insert({ user_id: userId, agent: item.agent, title: `🌙 Tonight: ${item.text}`.slice(0, 200), request: researchRequest(item.text),
        status: "running", started_at: at() }).select("id").single(); // never "queued": kickQueue must not start it a second time
      if (error) throw error;
      const { runTask } = await import("./agents");
      const r = await runTask(sb, userId, task.id, 0, createBudget(10 * 60_000, t.calls), signal);
      if (r.status === "cancelled") return { ...base, status: "failed", why: "Stopped", at: at() }; // stays on tonight's list
      await update((x) => { const u = user(x, userId); u.tonight = u.tonight.filter((y) => y.id !== item.id); });
      return { ...base, status: r.status === "done" ? "done" : r.status === "awaiting_approval" ? "approval" : "failed", ...(r.error ? { why: String(r.error).slice(0, 200) } : {}), open: { task: task.id }, at: at() };
    }
    case "goal": {
      const goals = await import("./goals");
      const before = await goals.getGoal(sb, t.ref);
      if (!before) return { ...base, status: "skipped", why: "The goal is gone", at: at() };
      await goals.advance(sb, userId, t.ref, 1);
      return { ...base, ...goalOutcome(t.ref, before.doc, (await goals.getGoal(sb, t.ref))?.doc ?? null), at: at() };
    }
    case "business": {
      // Only a draft: it's kept in the night report for the owner to read, copy and send himself; the prospect row isn't touched.
      const { data: p, error } = await sb.from("prospects").select("name, kind, notes, draft, stage").eq("user_id", userId).eq("id", t.ref).maybeSingle();
      if (error) throw error;
      if (!p || p.stage !== "contacted" || !p.draft?.trim()) return { ...base, status: "skipped", why: "No longer waiting for a follow-up", at: at() };
      const r = await askClaude(followupPrompt(p, "English"), FOLLOWUP_SYSTEM, { lane: "background", purpose: "business.followup", timeoutMs: 90_000, signal });
      await recordUsage(sb, userId, "business.followup", r);
      const draft = r.text.trim().slice(0, 4000);
      if (!draft || draft === p.draft.trim()) return { ...base, status: "failed", why: "The draft came back empty or repeated the first one", at: at() };
      await update((x) => { user(x, userId).drafted[t.ref] = at(); });
      return { ...base, status: "approval", draft, open: { panel: "business" }, at: at() };
    }
    case "clips": { // titles, descriptions and slots for rendered clips; publishing stays the owner's Approve click
      const [{ packageNow }, { listJobs }] = await Promise.all([import("./clips/autopilot"), import("./clips/factory")]);
      // Shorts autopilot v2: the week's scripts + Higgsfield prices (get_cost only) → one morning "Approve N Shorts" batch.
      const plan = await import("./clips/shorts-plan").then((m) => m.prepShorts(userId, signal)).catch((e) => { console.error("[orbit] shorts plan:", e); return null; });
      await packageNow();
      const ready = (await listJobs()).flatMap((j) => j.clips).filter((c) => c.status === "ready").length;
      const label = [ready && `${ready} Short${ready > 1 ? "s" : ""} ready for your review`, plan?.batch.label].filter(Boolean).join(" · ");
      return label ? { ...base, label, status: "approval", open: { panel: "studio" }, at: at() } : { ...base, status: "skipped", why: "No clips waiting", at: at() };
    }
    case "niche": {
      const n = await import("./niche");
      const before = (await n.nicheBoard()).lastOk;
      await n.maybeWeeklyScout();
      const b = await n.nicheBoard();
      return b.lastOk && b.lastOk !== before ? { ...base, status: "done", label: "New BUSINESS niche ideas", open: { panel: "business" }, at: at() } : { ...base, status: b.lastError ? "failed" : "skipped", why: (b.lastError ?? "Not due").slice(0, 200), at: at() };
    }
    case "rivals": { // read-only public pages, no model call; the report lives in BUSINESS → Niches
      const { rivalsLine } = await import("./rivals-pure");
      return { ...base, label: rivalsLine(await (await import("./rivals")).runRivals(signal)), status: "done", open: { panel: "business" }, at: at() };
    }
    case "deals": { // read-only web hunt; a great deal pushes "Deal found" and may ring him after 08:00 (call-pure)
      const r = await (await import("./deals")).huntDeals(sb, userId, "background", { signal, max: t.calls });
      if (!r.wishes) return { ...base, status: "skipped", why: "No wish was due", at: at() };
      return { ...base, label: r.great ? `${r.great} great deal${r.great > 1 ? "s" : ""} found` : `Deal hunt: ${r.offers} offer${r.offers === 1 ? "" : "s"}, none great yet`, status: "done", open: { panel: "markets" }, at: at() };
    }
    case "health": { // reads logs and failures, writes notes for the Doctor panel; never touches code
      const r = await (await import("./health")).runHealth(sb, userId, signal);
      return r.fresh ? { ...base, label: `Health check: ${r.fresh} new problem${r.fresh > 1 ? "s" : ""} (see the Doctor panel)`, status: "done", at: at() }
        : { ...base, status: "skipped", why: r.open ? `Nothing new; ${r.open} known problem${r.open > 1 ? "s" : ""} still open` : "Nothing broke", at: at() };
    }
    case "personas": { // look-only Studio runs + one walkthrough; backlog proposals wait for his Add click in GAME DEV → Personas
      const { runPersonaPlaytest } = await import("./personas");
      const r = await runPersonaPlaytest(sb, userId, { studioRuns: PERSONA_STUDIO_RUNS, day: nightKey(Date.now(), (await load()).settings), signal });
      return { ...base, label: r.line, status: r.proposals.length ? "approval" : "done", ...(r.proposals.length ? { why: `${r.proposals.length} backlog proposal${r.proposals.length > 1 ? "s" : ""} in GAME DEV → Personas` } : {}), at: at() };
    }
    case "hygiene": {
      const h = await (await import("./memory-hygiene")).getHygiene(sb, userId); // no model call: this week's merge/retract suggestions
      const k = h.proposals.filter((p) => p.status === "pending").length;
      return k ? { ...base, label: `${k} memory tidy-up suggestion${k > 1 ? "s" : ""}`, status: "approval", open: { panel: "memory" }, at: at() } : { ...base, status: "skipped", why: "Nothing to tidy", at: at() };
    }
  }
}

// ---- API / CORE ----------------------------------------------------------------

/** The "While you slept" section for the morning card (null when last night did nothing, or it isn't that morning). */
export async function getNightReport(sb: SupabaseClient, userId: string, now = Date.now()) {
  const st = await load(), run = st.users[userId]?.run;
  const ids = (run?.items ?? []).flatMap((i) => (i.open && "task" in i.open ? [i.open.task] : []));
  const { data } = ids.length ? await sb.from("tasks").select("id, status").eq("user_id", userId).in("id", ids) : { data: [] };
  return nightReport(run, Object.fromEntries((data ?? []).map((t) => [t.id, t.status])), now, st.settings, nightRunning());
}

export async function nightView(sb: SupabaseClient, userId: string) {
  const st = await load();
  return { settings: st.settings, tonight: st.users[userId]?.tonight ?? [], report: await getNightReport(sb, userId), running: nightRunning() };
}

export const addTonightItem = (userId: string, b: { text?: unknown; agent?: unknown }, by: "owner" | "core") =>
  update((s) => { const u = user(s, userId), r = addTonight(u.tonight, b, by, randomUUID(), Date.now()); if (typeof r === "string") return r; u.tonight = r; return ""; });
export const removeTonightItem = (userId: string, id: string) =>
  update((s) => { const u = user(s, userId), n = u.tonight.length; u.tonight = u.tonight.filter((t) => t.id !== id); return n === u.tonight.length ? "Not on tonight's list" : ""; });
export const setNightSettings = (b: Record<string, unknown>) =>
  update((s) => { const r = patchNightSettings(b, s.settings); if (typeof r === "string") return r; s.settings = r; return ""; });

/** CORE tool queue_tonight {"text", "agent"?}; policy decide() has already checked the owner asked for it in his latest message. */
export async function runTonightTool(userId: string, input: Record<string, unknown>, question: string, tainted: boolean): Promise<string> {
  const blocked = tonightBlocked(question, tainted); // decide() checked this too; kept here like the other module runners
  if (blocked) return `Error: ${blocked}`;
  try {
    const err = await addTonightItem(userId, { text: input.text, agent: input.agent }, "core");
    if (err) return `Error: ${err}`;
    const s = (await load()).settings;
    return `Done: queued for tonight's night shift (${s.from}-${s.until}). An agent works on it while he sleeps; anything it wants to change or send waits for his approval in the morning. Tell him.`;
  } catch (e) { return `Error: ${msg(e)}`; }
}
