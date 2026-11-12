// Autonomy levels, server glue (rules: autonomy-pure.ts). State: <ORBIT data dir>/autonomy.json, cached on globalThis so the
// decision points (policy decide, night shift, scheduler, send/publish paths) can read it synchronously. Missing file = defaults
// = today's behaviour. The auto runner (tickAutonomy) does nothing unless the owner switched an area to auto with the typed phrase.
import { readStoreSync, writeStore } from "./safe-file.ts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { WINDOW_DAYS, snoozeTrust, taskDecisions, type TrustDecision } from "./trust-pure";
import { stopAllOn } from "./stop-all";
import { emit } from "./claude";
import { DONE_KEEP_MS, UNDO_MS, autoApprove, lockedAutonomy, autoClock, cancelPending, clipVersion, sendOutcome, undoAutoApprove, autoLedger, draftCandidate, type Fired, autoPush, autonomyAllows, quietAuto, doneToday, parseAutonomy, patchLimits, pickAuto, setLevel,
  type Action, type AllowCtx, type Area, type AutoArea, type AutonomyState, type Candidate, type Levels } from "./autonomy-pure";

const file = () => path.join(orbitDataDir(), "autonomy.json");
const g = globalThis as unknown as { __orbitAutonomy?: AutonomyState; __orbitAutonomySave?: Promise<unknown> };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export function autonomyState(): AutonomyState {
  if (!g.__orbitAutonomy) {
    try { g.__orbitAutonomy = parseAutonomy(readStoreSync(file())); }
    catch (e) { return lockedAutonomy(`Autonomy settings couldn't be loaded (${msg(e)}), so nothing runs on its own until that's fixed`); } // not cached, never saved; update() refuses
  }
  return g.__orbitAutonomy;
}
export const autonomyLevels = (): Levels => autonomyState().levels;
/** autonomyAllows with the saved levels, limits and Stop-all filled in. */
export const allows = (area: Area, action: Action, ctx: AllowCtx = {}) =>
  autonomyAllows(area, action, { levels: autonomyLevels(), limits: autonomyState().limits, stopAll: stopAllOn(), ...ctx });

/** Serialized change → memory at once → atomic save. fn returns an error string to refuse (nothing changes). */
function update(fn: (s: AutonomyState) => AutonomyState | string): Promise<AutonomyState | string> {
  const p = (g.__orbitAutonomySave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(structuredClone(g.__orbitAutonomy ?? (g.__orbitAutonomy = parseAutonomy(readStoreSync(file()))))); // unreadable throws: nothing saved over it
    if (typeof next === "string") return next;
    next.done = next.done.filter((d) => Date.now() - Date.parse(d.at) < DONE_KEEP_MS);
    g.__orbitAutonomy = next;
    await writeStore(file(), JSON.stringify(next));
    return next;
  });
  g.__orbitAutonomySave = p;
  return p;
}

export async function setAreaLevel(sb: SupabaseClient, userId: string, area: unknown, level: unknown, confirm: unknown) {
  const from = autonomyLevels()[area as Area];
  const rp = await import("./remote-push"), push = rp.canNotify() ? "" : rp.pushProblem(); // the push after each auto action is part of the deal: no push (Web Push or ntfy), no auto
  const r = await update((s) => setLevel(s, area, level, confirm, Date.now(), push));
  if (typeof r !== "string" && from !== level) await emit(sb, userId, "autonomy.change", "core", { area, from, to: level });
  return r;
}
export const setLimits = (b: Record<string, unknown>) => update((s) => { const l = patchLimits(b, s.limits); return typeof l === "string" ? l : { ...s, limits: l }; });
/** His Cancel: that version is never queued again (a new draft / changed clip may be). */
export const cancelAuto = (id: unknown) => update((s) => (s.pending.some((p) => p.id === id) ? cancelPending(s, (p) => p.id !== id) : "Already gone (sent, or cancelled)"));
/** Trust ladder: his "Not now" on a suggestion (rules: trust-pure.ts). */
export const snoozeArea = (area: unknown) => update((s) => snoozeTrust(s, area, Date.now()));
/** The last WINDOW_DAYS of his decisions: agent tasks' approve/reject (tasks.pending) and memory merge/retract accepts (ledger). */
export async function trustHistory(sb: SupabaseClient, userId: string): Promise<TrustDecision[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [tasks, hyg] = await Promise.all([
    sb.from("tasks").select("pending, finished_at").eq("user_id", userId).gte("finished_at", since).limit(1000),
    sb.from("events").select("created_at, payload").eq("user_id", userId).eq("type", "memory.hygiene").gte("created_at", since).limit(1000),
  ]);
  return [...taskDecisions(tasks.data ?? []), ...(hyg.data ?? []).map((e) => ({ kind: "memory.hygiene", at: e.created_at, approved: (e.payload as { decision?: string })?.decision === "accepted" }))];
}
/** Stop-all: every queued auto action is cancelled the same way, so Resume doesn't re-queue them. */
export const clearAutoQueue = () => (autonomyState().pending.length ? update((s) => cancelPending(s, () => false)).catch(() => {}) : Promise.resolve());

const push = async (m: ReturnType<typeof autoPush>) => {
  const { canNotify, deliver } = await import("./remote-push");
  if (canNotify()) void deliver(m); // Web Push or ntfy
};

/** Scheduler tick (after its Stop-all check): fire due auto actions, then queue new ones. No-op unless an area is on auto. Never throws. */
export async function tickAutonomy(sb: SupabaseClient, userId: string, now = Date.now()) {
  const st = autonomyState();
  if (!st.pending.length && st.levels["business-send"] !== "auto" && st.levels["studio-publish"] !== "auto") return;
  try {
    let clock: ReturnType<typeof autoClock> = { pending: [], opened: {}, due: [] };
    await update((s) => { clock = autoClock(s.pending, now); return { ...s, pending: clock.pending }; }); // quiet hours hold; 08:00 opens the window
    for (const [area, n] of Object.entries(clock.opened) as [AutoArea, number][]) await push(autoPush(area, "queued", n));
    for (const p of clock.due) {
      const claimed = await update((s) => (s.pending.some((x) => x.id === p.id) ? { ...s, pending: s.pending.filter((x) => x.id !== p.id) } : "gone"));
      if (typeof claimed === "string") continue; // cancelled meanwhile
      const r: Fired = await (p.area === "business-send" ? fireSend(sb, userId, p) : firePublish(p)).catch((e): Fired => { console.error("[orbit] auto action failed:", msg(e)); return "skip"; });
      if (r === "skip") continue;
      await update((s) => ({ ...s, done: [...s.done, { area: p.area, ref: p.ref, at: new Date().toISOString() }] })); // counts toward the cap either way
      await emit(sb, userId, "autonomy.act", "core", autoLedger(p.area, p.ref, r)); // an unknown result may have gone out: it's in the ledger too
      await push(autoPush(p.area, r));
    }
    for (const area of ["business-send", "studio-publish"] as const) {
      if (autonomyLevels()[area] !== "auto") continue;
      const picks = pickAuto(autonomyState(), area, await (area === "business-send" ? sendCandidates(sb, userId) : publishCandidates()), now, stopAllOn());
      if (!picks.length) continue;
      const quiet = quietAuto(now), at = new Date(now).toISOString(), dueAt = quiet ? "" : new Date(now + UNDO_MS).toISOString(); // held till 08:00
      await update((s) => ({ ...s, pending: [...s.pending, ...picks.map((c) => ({ id: randomUUID(), area, ref: c.ref, seen: c.seen, label: c.label, at, dueAt }))] }));
      if (!quiet) await push(autoPush(area, "queued", picks.length)); // a held one is pushed when its window opens
    }
  } catch (e) { console.error("[orbit] autonomy tick failed:", msg(e)); }
}

// Existing BUSINESS prospects only (the allowlist): still "To contact", a saved draft, one email address in Contact.
// The filter sees subject + body (exactly what goes out); the version is the draft stamp sendDraft claims.
async function sendCandidates(sb: SupabaseClient, userId: string): Promise<Candidate[]> {
  const { emailIn, sendSubject } = await import("./business-pure");
  // No drafted_at (0026) or source (0027) column yet: an error, so nothing qualifies.
  const { data } = await sb.from("prospects").select("id, name, contact, draft, updated_at, drafted_at, source").eq("user_id", userId).eq("stage", "lead").neq("draft", "").limit(100);
  const { autoExcluded } = await import("./lead-loop-pure"); // B2: lead-loop leads are new to him, so only his own click sends them
  return (data ?? []).filter((p) => p.draft?.trim() && emailIn(p.contact ?? "") && !autoExcluded(p)).map((p) => draftCandidate(p, sendSubject(p.name, p.draft)));
}

async function fireSend(sb: SupabaseClient, userId: string, p: { ref: string; seen: string }): Promise<Fired> {
  const { sendSubject, sendStamp } = await import("./business-pure");
  const { data: row } = await sb.from("prospects").select("name, contact, draft, stage, updated_at, drafted_at, source").eq("user_id", userId).eq("id", p.ref).maybeSingle();
  // Re-checked at send time: still auto, under the cap, untouched since queued (sendDraft also claims only that version), no money/promises.
  if (!row || row.stage !== "lead" || row.updated_at !== p.seen || !row.drafted_at || (await import("./lead-loop-pure")).autoExcluded(row)) return "skip";
  if (!allows("business-send", "auto", { doneToday: doneToday(autonomyState(), "business-send", Date.now()), text: `${sendSubject(row.name, row.draft ?? "")}\n${row.draft ?? ""}`, known: true }).ok) return "skip";
  const { sendDraft } = await import("./business-send");
  const r = await sendDraft(sb, userId, p.ref, await sendStamp(row), "sent automatically by ORBIT, Autonomy: auto");
  if (!r.ok) console.error("[orbit] auto send:", r.status);
  return sendOutcome(r.ok, r.status);
}

// ORBIT's own rendered clips, waiting for review, that pass the publish checks. Scheduled into the next free slot (private until then).
// The filter sees title + description (scheduleAll's default description is the hook); the version covers video, title and description.
async function publishCandidates(): Promise<Candidate[]> {
  const [{ listJobs }, { originalityIssue }] = await Promise.all([import("./clips/factory"), import("./clips/publish-checks-pure")]);
  return (await listJobs()).flatMap((j) => j.clips.filter((c) => c.status === "ready" && !c.retryOf && !c.publish && c.video && !originalityIssue(j, c))
    .map((c) => ({ ref: `${j.id}/${c.id}`, seen: clipVersion(c), changedAt: j.createdAt, label: `Short: ${c.title.slice(0, 80)}`, text: `${c.title}\n${c.hook}` })));
}

async function firePublish(p: { ref: string; seen: string }): Promise<Fired> {
  const [{ getJob, saveJob, withJobLock, mediaHash }, { scheduleAll }, { originalityIssue }] = await Promise.all([import("./clips/factory"), import("./clips/publish-schedule"), import("./clips/publish-checks-pure")]);
  const [jobId, clipId] = p.ref.split("/");
  const approved = await withJobLock(async () => {
    const job = await getJob(jobId), clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip || clip.status !== "ready" || clip.retryOf || clip.publish || clipVersion(clip) !== p.seen || originalityIssue(job, clip)) return false; // reviewed or changed meanwhile
    if (!allows("studio-publish", "auto", { doneToday: doneToday(autonomyState(), "studio-publish", Date.now()), text: `${clip.title}\n${clip.hook}`, known: true }).ok) return false;
    autoApprove(job, clip, Date.now());
    const { contentHash, clipContent } = await import("./approval-pure");
    clip.approvedHash = await contentHash(clipContent(clip)); // Autonomy: auto approves the media its checks just saw
    clip.approvedMedia = await mediaHash(clip);
    await saveJob(job);
    return true;
  });
  if (!approved) return "skip";
  const b = await scheduleAll([p.ref]);
  if (typeof b !== "string") return "done";
  console.error("[orbit] auto publish:", b);
  await withJobLock(async () => { // back to ready (as autopilot does): an approved clip would be picked up by "Schedule all" later
    const job = await getJob(jobId), clip = job?.clips.find((c) => c.id === clipId);
    if (job && clip && undoAutoApprove(clip)) await saveJob(job);
  }).catch((e) => console.error("[orbit] auto publish couldn't undo approve:", msg(e)));
  return "unsure";
}
