// Autonomy levels, server glue (rules: autonomy-pure.ts). State: <ORBIT data dir>/autonomy.json, cached on globalThis so the
// decision points (policy decide, night shift, scheduler, send/publish paths) can read it synchronously. Missing file = defaults
// = today's behaviour. The auto runner (tickAutonomy) does nothing unless the owner switched an area to auto with the typed phrase.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { stopAllOn } from "./stop-all";
import { emit } from "./claude";
import { DONE_KEEP_MS, UNDO_MS, autoPush, autonomyAllows, doneToday, parseAutonomy, patchLimits, pickAuto, setLevel,
  type Action, type AllowCtx, type Area, type AutoArea, type AutonomyState, type Candidate, type Levels } from "./autonomy-pure";

const file = () => path.join(orbitDataDir(), "autonomy.json");
const g = globalThis as unknown as { __orbitAutonomy?: AutonomyState; __orbitAutonomySave?: Promise<unknown> };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export function autonomyState(): AutonomyState {
  if (!g.__orbitAutonomy) { try { g.__orbitAutonomy = parseAutonomy(readFileSync(file(), "utf8")); } catch { g.__orbitAutonomy = parseAutonomy(""); } }
  return g.__orbitAutonomy;
}
export const autonomyLevels = (): Levels => autonomyState().levels;
/** autonomyAllows with the saved levels, limits and Stop-all filled in. */
export const allows = (area: Area, action: Action, ctx: AllowCtx = {}) =>
  autonomyAllows(area, action, { levels: autonomyLevels(), limits: autonomyState().limits, stopAll: stopAllOn(), ...ctx });

/** Serialized change → memory at once → atomic save. fn returns an error string to refuse (nothing changes). */
function update(fn: (s: AutonomyState) => AutonomyState | string): Promise<AutonomyState | string> {
  const p = (g.__orbitAutonomySave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(structuredClone(autonomyState()));
    if (typeof next === "string") return next;
    next.done = next.done.filter((d) => Date.now() - Date.parse(d.at) < DONE_KEEP_MS);
    g.__orbitAutonomy = next;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(next));
    await rename(file() + ".tmp", file());
    return next;
  });
  g.__orbitAutonomySave = p;
  return p;
}

export async function setAreaLevel(sb: SupabaseClient, userId: string, area: unknown, level: unknown, confirm: unknown) {
  const from = autonomyLevels()[area as Area];
  const r = await update((s) => setLevel(s, area, level, confirm));
  if (typeof r !== "string" && from !== level) await emit(sb, userId, "autonomy.change", "core", { area, from, to: level });
  return r;
}
export const setLimits = (b: Record<string, unknown>) => update((s) => { const l = patchLimits(b, s.limits); return typeof l === "string" ? l : { ...s, limits: l }; });
export const cancelAuto = (id: unknown) => update((s) => (s.pending.some((p) => p.id === id) ? { ...s, pending: s.pending.filter((p) => p.id !== id) } : "Already gone (sent, or cancelled)"));
/** Stop-all: every queued auto action is cancelled (nothing fires after Resume without being picked again). */
export const clearAutoQueue = () => (autonomyState().pending.length ? update((s) => ({ ...s, pending: [] })).catch(() => {}) : Promise.resolve());

const push = async (m: ReturnType<typeof autoPush>) => {
  const { pushProblem, deliver } = await import("./remote-push");
  if (!pushProblem()) void deliver(m);
};

/** Scheduler tick (after its Stop-all check): fire due auto actions, then queue new ones. No-op unless an area is on auto. Never throws. */
export async function tickAutonomy(sb: SupabaseClient, userId: string, now = Date.now()) {
  const st = autonomyState();
  if (!st.pending.length && st.levels["business-send"] !== "auto" && st.levels["studio-publish"] !== "auto") return;
  try {
    for (const p of st.pending.filter((x) => Date.parse(x.dueAt) <= now)) {
      const claimed = await update((s) => (s.pending.some((x) => x.id === p.id) ? { ...s, pending: s.pending.filter((x) => x.id !== p.id) } : "gone"));
      if (typeof claimed === "string") continue; // cancelled meanwhile
      const ok = await (p.area === "business-send" ? fireSend(sb, userId, p) : firePublish(p)).catch((e) => { console.error("[orbit] auto action failed:", msg(e)); return false; });
      if (!ok) continue;
      await update((s) => ({ ...s, done: [...s.done, { area: p.area, ref: p.ref, at: new Date().toISOString() }] }));
      await emit(sb, userId, "autonomy.act", "core", { area: p.area, action: p.area === "business-send" ? "send" : "publish", ref: p.ref.slice(0, 128) });
      await push(autoPush(p.area, "done"));
    }
    for (const area of ["business-send", "studio-publish"] as const) {
      if (autonomyLevels()[area] !== "auto") continue;
      const picks = pickAuto(autonomyState(), area, await (area === "business-send" ? sendCandidates(sb, userId) : publishCandidates()), now, stopAllOn());
      if (!picks.length) continue;
      const at = new Date(now).toISOString(), dueAt = new Date(now + UNDO_MS).toISOString();
      await update((s) => ({ ...s, pending: [...s.pending, ...picks.map((c) => ({ id: randomUUID(), area, ref: c.ref, seen: c.seen, label: c.label, at, dueAt }))] }));
      await push(autoPush(area, "queued", picks.length));
    }
  } catch (e) { console.error("[orbit] autonomy tick failed:", msg(e)); }
}

// Existing BUSINESS prospects only (the allowlist): still "To contact", a saved draft, one email address in Contact.
async function sendCandidates(sb: SupabaseClient, userId: string): Promise<Candidate[]> {
  const { emailIn } = await import("./business-pure");
  const { data } = await sb.from("prospects").select("id, name, contact, draft, updated_at").eq("user_id", userId).eq("stage", "lead").neq("draft", "").limit(100);
  return (data ?? []).filter((p) => p.draft?.trim() && emailIn(p.contact ?? "")).map((p) => ({ ref: p.id, seen: p.updated_at, label: `Email to ${String(p.name).slice(0, 80)}`, text: p.draft }));
}

async function fireSend(sb: SupabaseClient, userId: string, p: { ref: string; seen: string }): Promise<boolean> {
  const { data: row } = await sb.from("prospects").select("draft, stage, updated_at").eq("user_id", userId).eq("id", p.ref).maybeSingle();
  // Re-checked at send time: still auto, under the cap, untouched since queued (sendDraft also claims only that version), no money/promises.
  if (!row || row.stage !== "lead" || row.updated_at !== p.seen) return false;
  if (!allows("business-send", "auto", { doneToday: doneToday(autonomyState(), "business-send", Date.now()), text: row.draft ?? "", known: true }).ok) return false;
  const { sendDraft } = await import("./business-send");
  const r = await sendDraft(sb, userId, p.ref, p.seen, "sent automatically by ORBIT, Autonomy: auto");
  if (!r.ok) console.error("[orbit] auto send:", r.status);
  return r.ok;
}

// ORBIT's own rendered clips, waiting for review, that pass the publish checks. Scheduled into the next free slot (private until then).
async function publishCandidates(): Promise<Candidate[]> {
  const [{ listJobs }, { originalityIssue }] = await Promise.all([import("./clips/factory"), import("./clips/publish-checks-pure")]);
  return (await listJobs()).flatMap((j) => j.clips.filter((c) => c.status === "ready" && !c.retryOf && !c.publish && c.video && !originalityIssue(j, c))
    .map((c) => ({ ref: `${j.id}/${c.id}`, seen: c.video!, label: `Short: ${c.title.slice(0, 80)}`, text: "" })));
}

async function firePublish(p: { ref: string; seen: string }): Promise<boolean> {
  const [{ getJob, updateClip, withJobLock }, { scheduleAll }, { originalityIssue }] = await Promise.all([import("./clips/factory"), import("./clips/publish-schedule"), import("./clips/publish-checks-pure")]);
  const [jobId, clipId] = p.ref.split("/");
  const approved = await withJobLock(async () => {
    const job = await getJob(jobId), clip = job?.clips.find((c) => c.id === clipId);
    if (!job || !clip || clip.status !== "ready" || clip.retryOf || clip.video !== p.seen || originalityIssue(job, clip)) return false; // reviewed or changed meanwhile
    if (!allows("studio-publish", "auto", { doneToday: doneToday(autonomyState(), "studio-publish", Date.now()), known: true }).ok) return false;
    await updateClip(job, clip, { status: "approved", reason: "Auto-approved by ORBIT (Autonomy: auto)" });
    return true;
  });
  if (!approved) return false;
  const b = await scheduleAll([p.ref]);
  if (typeof b === "string") console.error("[orbit] auto publish:", b);
  return typeof b !== "string";
}
