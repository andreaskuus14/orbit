// Daily runs (JARVIS milestone 1): one honest view of ORBIT's three daily workflows — the 07:30 brief, STUDIO clips, the
// business loop — built only from their own records, plus one digest a day to the phone. Each workflow gets one outcome state:
//   planned    its slot is later today
//   attempted  running now
//   completed  finished; `verified` only when the record itself proves the result (rows written, upload read back from YouTube)
//   waiting    finished up to an approval that is his (a lead to file, clips to review)
//   failed     its own record says it failed
//   uncertain  the record can't tell (an upload that may or may not have landed)
//   missed     the slot passed and there is no record at all (ORBIT was off, the scheduler was off, it never fired)
//   off        not set up (the business loop template was never saved / is paused)
//   idle       nothing to do (no new videos)
// Pure; tested in tests/daily.test.ts. IO: daily.ts.

export type DailyState = "planned" | "attempted" | "completed" | "waiting" | "failed" | "uncertain" | "missed" | "off" | "idle";
export type DailyItem = { wf: "brief" | "clips" | "leads"; state: DailyState; verified: boolean; evidence: string; next?: string };
export type DailyView = { day: string; items: DailyItem[] };

const GRACE_MS = 45 * 60_000; // a run that hasn't left a record 45 min after its slot is missed
const RUN_STALE_MS = 30 * 60_000; // a "running" row older than this is a dead run, not a live one

/** Local HH:MM → ms timestamp on the same local day as `now`. */
export function slotAt(now: number, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number), d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export type BriefIn = { briefings: { kind: string; created_at: string; article_count: number }[]; runs: { status: string; detail: string | null; started_at: string }[] };


/** Today's 07:30 brief from `briefings` + `job_runs` (both already filtered to today, newest first). A brief he asked for after
 *  the slot ("manual") stands in for it. */
export function briefState(x: BriefIn, now: number, slot = "07:30"): DailyItem {
  const at = slotAt(now, slot);
  const b = x.briefings.find((r) => r.kind === "morning") ?? x.briefings.find((r) => r.kind === "manual" && Date.parse(r.created_at) >= at);
  // runPulse stores a briefing only with cited articles, so a stored row is itself the proof
  if (b) return { wf: "brief", state: "completed", verified: b.article_count > 0, evidence: `${b.kind === "manual" ? "brief you asked for" : "briefing"} stored ${hm(b.created_at)}, ${b.article_count} articles` };
  const run = x.runs.find((r) => /^morning\b/.test(r.detail ?? "") || (/^manual\b/.test(r.detail ?? "") && Date.parse(r.started_at) >= at));
  if (run?.status === "running") {
    return now - Date.parse(run.started_at) < RUN_STALE_MS
      ? { wf: "brief", state: "attempted", verified: false, evidence: `running since ${hm(run.started_at)}` }
      : { wf: "brief", state: "uncertain", verified: false, evidence: `started ${hm(run.started_at)} and never finished`, next: "Ask CORE for the morning brief again." };
  }
  if (run?.status === "failed") return { wf: "brief", state: "failed", verified: false, evidence: (run.detail ?? "").slice(0, 160), next: "Check the feeds in INTELLIGENCE, then ask for a new brief." };
  if (now < at) return { wf: "brief", state: "planned", verified: false, evidence: `runs at ${slot}` };
  if (now < at + GRACE_MS) return { wf: "brief", state: "planned", verified: false, evidence: `due at ${slot}, starting` };
  // scheduler.ts dueSlots catches the morning brief up any time the same day while ORBIT is on
  if (now < slotAt(now, "23:59")) return { wf: "brief", state: "planned", verified: false, evidence: "not run yet; ORBIT catches it up today while it is on" };
  return { wf: "brief", state: "missed", verified: false, evidence: `no run recorded between ${slot} and 23:59`, next: "ORBIT was off, its scheduler was off (SUPABASE_SECRET_KEY), or Claude's usage limit held it. Ask CORE for a brief if you still want one." };
}

export type ClipJobIn = { status: string; createdAt: string; updatedAt: string; error?: string; clips: { status: string; publish?: { status: string; at: string; destination?: string } }[] };

/** STUDIO over the last 24 h, from the clip job files. A job counts when it started in the window, or is still working; uploads
 *  count by their own time. (updatedAt moves on any edit, e.g. rejecting an old clip, so it isn't used.) */
export function clipsState(jobs: ClipJobIn[], now: number): DailyItem {
  const since = now - 86_400_000;
  const busyJobs = jobs.filter((j) => !["done", "failed"].includes(j.status));
  const fresh = jobs.filter((j) => Date.parse(j.createdAt) >= since || busyJobs.includes(j));
  const pubs = jobs.flatMap((j) => j.clips.map((c) => c.publish)).filter((p): p is NonNullable<typeof p> => !!p && Date.parse(p.at) >= since);
  const count = (st: string) => pubs.filter((p) => p.status === st).length;
  const unknown = count("unknown"), uploading = count("uploading"), pubFailed = count("failed");
  const landed = pubs.filter((p) => p.status === "done" || p.status === "scheduled");
  const checked = landed.filter((p) => p.destination === "ok").length;
  const failedJobs = fresh.filter((j) => j.status === "failed").length;
  const review = fresh.reduce((n, j) => n + j.clips.filter((c) => c.status === "ready").length, 0);
  const parts = [fresh.length && `${fresh.length} source${fresh.length > 1 ? "s" : ""}`, review && `${review} to review`, landed.length && `${landed.length} uploaded (${checked} checked on YouTube)`,
    uploading && `${uploading} uploading`, pubFailed && `${pubFailed} upload${pubFailed > 1 ? "s" : ""} failed`, failedJobs && `${failedJobs} failed`, unknown && `${unknown} upload unsure`].filter(Boolean).join(", ");
  if (unknown) return { wf: "clips", state: "uncertain", verified: false, evidence: parts, next: "Open STUDIO: an upload may or may not have reached YouTube." };
  if (pubFailed) return { wf: "clips", state: "failed", verified: false, evidence: parts, next: "Open STUDIO to see why the upload failed and retry it." };
  if (busyJobs.length || uploading) return { wf: "clips", state: "attempted", verified: false, evidence: parts || `${busyJobs.length} working` };
  if (failedJobs && !review && !landed.length) return { wf: "clips", state: "failed", verified: false, evidence: parts, next: "Open STUDIO to see why and retry." };
  if (review) return { wf: "clips", state: "waiting", verified: false, evidence: parts, next: "Review the clips in STUDIO; nothing uploads without your approve." };
  if (landed.length) return { wf: "clips", state: "completed", verified: checked === landed.length, evidence: parts };
  if (fresh.length) return { wf: "clips", state: "completed", verified: false, evidence: parts };
  return { wf: "clips", state: "idle", verified: false, evidence: "no new videos in the last 24 h", next: "Drop a stream into the STUDIO inbox to get clips." };
}

// slot: the automation's latest due time (pure.ts lastDue); next: its next due time when that is later today; grace: how long
// automations.ts still fires it after the slot (3 h, or 30 min for hourly).
// createdAt: automations.ts never fires a slot from before the automation existed
export type LeadsIn = { automation: { enabled: boolean; slot: number; next: number | null; grace: number; label: string; createdAt?: string } | null; tasks: { status: string; created_at: string; started_at?: string | null; error?: string | null; pending: unknown; receipt: string | null; exec?: "active" | "restart" | "unknown" | "unchecked" }[] };

/** The business loop's latest run since its last due slot (tasks: since that slot, newest first). Follows the real schedule, so a
 *  weekly loop isn't "missed" on the other six days. */
export function leadsState(x: LeadsIn, now: number): DailyItem {
  const a = x.automation;
  if (!a) return { wf: "leads", state: "off", verified: false, evidence: "the Daily business loop isn't saved", next: "Save it in OPERATIONS → Automations (edit the CONDITION first)." };
  if (!a.enabled) return { wf: "leads", state: "off", verified: false, evidence: "the Daily business loop is paused" };
  const t = x.tasks[0];
  if (!t) {
    if (a.next !== null) return { wf: "leads", state: "planned", verified: false, evidence: `runs at ${hm(new Date(a.next).toISOString())} (${a.label})` };
    if (now < a.slot + a.grace) return { wf: "leads", state: "planned", verified: false, evidence: `due ${hm(new Date(a.slot).toISOString())}, starting (${a.label})` };
    if (a.createdAt && Date.parse(a.createdAt) > a.slot) return { wf: "leads", state: "planned", verified: false, evidence: `saved after its last slot; first run at the next one (${a.label})` };
    return { wf: "leads", state: "missed", verified: false, evidence: `no run recorded after its ${new Date(a.slot).toISOString().slice(0, 10)} ${hm(new Date(a.slot).toISOString())} slot (${a.label})`, next: "ORBIT or its scheduler was off at that time, or Claude's usage limit held it." };
  }
  const since = t.started_at ?? t.created_at;
  // execution evidence (agents.ts taskExecution), not age: a long run whose worker is alive stays "running"
  if (t.status === "running" && t.exec && t.exec !== "active") return { wf: "leads", state: "uncertain", verified: false,
    evidence: t.exec === "restart" ? `started ${hm(since)}, before ORBIT restarted; being marked interrupted` : `marked running since ${hm(since)}, but no worker in ORBIT is running it`, next: "Open the run in Agents to see what finished, then run it again." };
  if (t.status === "queued" || t.status === "running") return { wf: "leads", state: "attempted", verified: false, evidence: `${t.status} since ${hm(since)}` };
  if (t.status === "awaiting_approval") return { wf: "leads", state: "waiting", verified: false, evidence: "a lead waits for your approval", next: "Approve or reject it in Agents; the email is a second, separate approval." };
  if (t.status === "cancelled" && /rejected/i.test(t.error ?? "")) return { wf: "leads", state: "completed", verified: false, evidence: "you rejected what it proposed" }; // his decision, not a failure
  if (t.status === "failed" || t.status === "cancelled") return { wf: "leads", state: "failed", verified: false, evidence: `run ${t.status}`, next: "Open the run in Agents to see why." };
  if (t.receipt === "failed") return { wf: "leads", state: "failed", verified: false, evidence: `run finished ${hm(t.created_at)} but its receipt says it failed`, next: "Open the run in Agents: what it claimed didn't check out." };
  if (t.receipt === "partly") return { wf: "leads", state: "completed", verified: false, evidence: `run done ${hm(t.created_at)}, only partly verified`, next: "Open the run in Agents to see what wasn't checked." };
  return { wf: "leads", state: "completed", verified: t.receipt === "verified", evidence: `run done ${hm(t.created_at)}, receipt ${t.receipt ?? "none"}` };
}

const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const LABEL: Record<DailyItem["wf"], string> = { brief: "Brief", clips: "Clips", leads: "Leads" };
const MARK: Record<DailyState, string> = { planned: "later", attempted: "running", completed: "done", waiting: "needs you", failed: "FAILED", uncertain: "unsure", missed: "MISSED", off: "off", idle: "nothing new" };
export const needsAttention = (i: DailyItem) => ["failed", "uncertain", "missed", "waiting"].includes(i.state);

/** CORE's daily_runs tool text: one line per workflow with its evidence and next step. */
export function dailyText(v: DailyView): string {
  return [`Daily runs ${v.day} (states come from ORBIT's own records; "verified" means the record proves it):`,
    ...v.items.map((i) => `- ${LABEL[i.wf]}: ${i.state}${i.state === "completed" ? (i.verified ? ", verified" : ", not verified") : ""} — ${i.evidence}${i.next ? ` → ${i.next}` : ""}`)].join("\n");
}

/** The once-a-day phone digest. Labels and counts only: the ntfy topic may be on the public server, so no names, titles or text. */
export function digestMsg(v: DailyView): { kind: string; title: string; message: string; tags: string[]; priority: 3 | 4; click?: string } {
  const bad = v.items.filter((i) => i.state === "failed" || i.state === "missed" || i.state === "uncertain");
  const message = v.items.map((i) => `${LABEL[i.wf]}: ${MARK[i.state]}${i.state === "completed" && i.verified ? " ✓" : ""}`).join(" · ");
  return { kind: bad.length ? "failed" : "daily", title: bad.length ? `ORBIT daily: ${bad.length} need${bad.length > 1 ? "" : "s"} a look` : "ORBIT daily", message, tags: [bad.length ? "warning" : "sunrise"], priority: bad.length ? 4 : 3 };
}

// tried: a send started (saved before it); failed: ntfy definitely refused it. A try today that didn't definitely fail may have
// reached the phone (timeout, crash, or the "sent" mark failing to save), so it counts as sent: at most one digest a day.
export type DigestState = { sent?: string; tried?: string; failed?: boolean };
const RETRY_MS = 30 * 60_000, STALE_MS = 4 * 3600_000;
/** Due once per local day from `at` (HH:MM, ORBIT_DAILY_DIGEST; empty = 10:30, "off" disables): never twice in a day, a definite
 *  refusal retried at most every 30 min, and at most 4 h after its time (a PC that wakes at 23:40 doesn't send the morning's). */
export function digestDue(at: string | undefined, st: DigestState, day: string, now: number): boolean {
  const t = (at ?? "").trim() || "10:30";
  if (t === "off" || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) return false;
  const slot = slotAt(now, t);
  if (st.sent === day || now < slot || now > slot + STALE_MS) return false;
  const triedToday = !!st.tried && Date.parse(st.tried) >= slotAt(now, "00:00");
  if (triedToday && !st.failed) return false;
  return !triedToday || now - Date.parse(st.tried!) >= RETRY_MS;
}

/** The morning status event: each workflow done, needs-you (his move or a problem), or running (still on its way today). */
export type StatusMark = "done" | "needs-you" | "running";
export function statusOf(v: DailyView): Record<DailyItem["wf"], StatusMark> {
  const mark = (s: DailyState): StatusMark => s === "completed" || s === "idle" ? "done" : s === "planned" || s === "attempted" ? "running" : "needs-you";
  return Object.fromEntries(v.items.map((i) => [i.wf, mark(i.state)])) as Record<DailyItem["wf"], StatusMark>;
}
/** Once per local day, from `at` (ORBIT_DAILY_DIGEST, default 10:30; "off" still emits at 10:30: the event is local, not a push) to midnight. */
export function statusDue(at: string | undefined, lastDay: string | undefined, day: string, now: number): boolean {
  const t = /^([01]?\d|2[0-3]):[0-5]\d$/.test((at ?? "").trim()) ? at!.trim() : "10:30";
  return lastDay !== day && now >= slotAt(now, t);
}
