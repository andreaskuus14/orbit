// OPERATIONS planet (MIX look, reports/hf-refs/operations.png + adv-operations.png): a calm list of jobs with real depth where the
// data exists — a small number strip, a "today" timeline with a now line, per-step timing, a live log and a progress ring.
// Everything here is pure and tested (tests/operations-planet.test.ts): buckets, numbers, the timeline lanes, the step table,
// log lines, routine (automation) wording in EN/ET, history groups, the slim list the API sends while polling, and the copy.
// Never invents data: a step without a time shows "—", a job without a typical length has no "time left".
import type { Lang } from "./i18n-pure.ts";
import { opsStatus, type OpsStatus } from "./ops-status-pure.ts";
import { plainStep, words } from "./progress-pure.ts";
import { plainError } from "./planet-page-pure.ts";
import { nextOccurrences, PREVIEW_TZ } from "./automation-preview-pure.ts";
import type { Schedule } from "./pure.ts";

export const DAY = 86_400_000;
const HOUR = 3_600_000;

export type OpsStep = { step: string; detail?: string; ms?: number; ok?: boolean };
export type OpsTask = {
  id: string; parent_id?: string | null; agent: string; title: string; request?: string; status: string;
  result?: string | null; error?: string | null; trace?: OpsStep[] | null; pending?: unknown;
  created_at: string; started_at?: string | null; finished_at?: string | null;
};

const ms = (s: string | null | undefined) => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : NaN; };
/** When it last moved (finished, started, created). */
export const lastAt = (t: Pick<OpsTask, "created_at" | "started_at" | "finished_at">) => t.finished_at || t.started_at || t.created_at;

/** The planet's own view of one job's state (on top of the shared opsStatus vocabulary). */
export type Kind = "needs" | "working" | "queued" | "failed" | "done" | "stopped";
export function kindOf(t: Pick<OpsTask, "status" | "pending">, o: { stopAll?: boolean; hostOffline?: boolean } = {}): Kind {
  const s: OpsStatus = opsStatus(t.status, { ...o, pending: t.pending });
  return s === "waiting" ? "needs" : s === "running" || s === "checking" ? "working" : s === "queued" || s === "blocked" ? "queued"
    : s === "failed" ? "failed" : s === "complete" ? "done" : "stopped";
}

export type Buckets<T extends OpsTask = OpsTask> = { needs: T[]; working: T[]; queued: T[]; failed: T[]; history: T[] };
/** Top-level jobs into the Now lists (needs → working → queued → failed in the last 24 h) and History (everything finished). */
export function buckets<T extends OpsTask>(tasks: T[], nowMs: number, o: { stopAll?: boolean; hostOffline?: boolean } = {}): Buckets<T> {
  const b: Buckets<T> = { needs: [], working: [], queued: [], failed: [], history: [] };
  for (const t of tasks) {
    if (t.parent_id) continue;
    const k = kindOf(t, o);
    if (k === "needs") b.needs.push(t);
    else if (k === "working") b.working.push(t);
    else if (k === "queued") b.queued.push(t);
    else {
      if (k === "failed" && nowMs - (ms(lastAt(t)) || 0) < DAY) b.failed.push(t);
      b.history.push(t);
    }
  }
  const newest = (a: T, c: T) => (ms(lastAt(c)) || 0) - (ms(lastAt(a)) || 0);
  b.needs.sort(newest); b.failed.sort(newest); b.history.sort(newest);
  b.working.sort((a, c) => (ms(a.started_at ?? a.created_at) || 0) - (ms(c.started_at ?? c.created_at) || 0)); // oldest first: it's been going longest
  b.queued.sort((a, c) => (ms(a.created_at) || 0) - (ms(c.created_at) || 0)); // first in, first out
  return b;
}

/** The number strip: working · needs you · done today · didn't work today (last 24 h). Four numbers, no more. */
export function counts(tasks: OpsTask[], nowMs: number, o: { stopAll?: boolean; hostOffline?: boolean } = {}) {
  const c = { working: 0, needs: 0, done: 0, failed: 0, queued: 0 };
  for (const t of tasks) {
    if (t.parent_id) continue;
    const k = kindOf(t, o), recent = nowMs - (ms(lastAt(t)) || 0) < DAY;
    if (k === "working") c.working++; else if (k === "needs") c.needs++; else if (k === "queued") c.queued++;
    else if (k === "done" && recent) c.done++; else if (k === "failed" && recent) c.failed++;
  }
  return c;
}

/** The header line: "2 working · 1 needs you · 6 done today" (≤ ~40 chars), or the idle sentence. */
export function statusText(c: ReturnType<typeof counts>, lang: Lang): string {
  const w = OPS_COPY[lang];
  const parts = [c.working && w.nWorking(c.working), c.needs && w.nNeeds(c.needs), c.done && w.nDone(c.done)].filter(Boolean) as string[];
  return parts.join(" · ") || w.idle;
}

/* ---------- Timeline: today's jobs as bars on lanes, with a now line ---------- */

export type Lane = { id: string; title: string; kind: Kind; from: number; to: number; open: boolean };
/** Jobs that touched the window [now - spanH, now + aheadH] as bars in 0..1 (from/to). A job still going runs to the now line
 *  (open: true). Newest at the bottom, at most `max` lanes; finished bars keep their real start and end. */
export function lanes(tasks: OpsTask[], nowMs: number, o: { spanH?: number; aheadH?: number; max?: number; stopAll?: boolean } = {}): { lanes: Lane[]; now: number; start: number; end: number; ticks: { at: number; t: number }[] } {
  const spanH = o.spanH ?? 6, aheadH = o.aheadH ?? 0.5, max = o.max ?? 8;
  const start = nowMs - spanH * HOUR, end = nowMs + aheadH * HOUR, span = end - start;
  const pos = (t: number) => Math.min(1, Math.max(0, (t - start) / span));
  const out: Lane[] = [];
  for (const t of tasks) {
    if (t.parent_id) continue;
    const k = kindOf(t, { stopAll: o.stopAll });
    const a = ms(t.started_at) || ms(t.created_at);
    if (!Number.isFinite(a)) continue;
    const open = k === "working" || k === "needs" || k === "queued";
    const b = open ? nowMs : ms(t.finished_at) || a;
    if (b < start || a > end) continue;
    out.push({ id: t.id, title: t.title, kind: k, from: pos(a), to: Math.max(pos(b), pos(a) + 0.006), open });
  }
  out.sort((x, y) => x.from - y.from);
  const ticks: { at: number; t: number }[] = [];
  for (let h = Math.ceil(start / HOUR) * HOUR; h <= end; h += HOUR) ticks.push({ at: pos(h), t: h });
  return { lanes: out.slice(-max), now: pos(nowMs), start, end, ticks };
}

/* ---------- One job: steps, timing, log, ring ---------- */

const SKIP = /^(fallback|route|sdk)$/;
export type StepRow = { n: number; label: string; at: number | null; ms: number | null; state: "done" | "now" | "failed" | "next" };
/** The job's trace as a plain step table: start time (from started_at + the steps before it), length, state. A running job
 *  gets one "now" row after its finished steps; a failed step reads "failed". Times are only shown when the data has them. */
export function stepRows(t: OpsTask, lang: Lang, nowMs: number): StepRow[] {
  const trace = (Array.isArray(t.trace) ? t.trace : []).filter((s) => s && typeof s.step === "string" && !SKIP.test(s.step));
  const k = kindOf(t);
  let clock = ms(t.started_at);
  const rows: StepRow[] = trace.map((s, i) => {
    const at = Number.isFinite(clock) ? clock : null, len = typeof s.ms === "number" && s.ms >= 0 ? s.ms : null;
    if (at !== null && len !== null) clock = at + len;
    return { n: i + 1, label: plainStep(s.step, lang), at, ms: len, state: s.ok === false ? "failed" : "done" };
  });
  if (k === "working") rows.push({ n: rows.length + 1, label: OPS_COPY[lang].nextStep, at: Number.isFinite(clock) ? Math.min(clock, nowMs) : null, ms: null, state: "now" });
  if (k === "queued") rows.push({ n: 1, label: words(lang).start, at: null, ms: null, state: "next" });
  return rows;
}

/** "3.8 s", "2 min 41 s", "1 h 4 min"; "—" when unknown. */
export function dur(v: number | null | undefined, lang: Lang): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return "—";
  const h = lang === "et" ? "t" : "h";
  if (v < 10_000) return `${(Math.round(v / 100) / 10).toLocaleString(lang === "et" ? "et-EE" : "en-GB")} s`;
  const s = Math.round(v / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} ${h} ${m % 60} min`;
}
/** Clock time in Tallinn (the owner's clock), 24 h: "15:18". */
export const clock = (t: number | string | null | undefined, lang: Lang, seconds = false) => {
  const v = typeof t === "number" ? t : ms(t ?? "");
  if (!Number.isFinite(v)) return "—";
  return new Date(v).toLocaleTimeString(lang === "et" ? "et-EE" : "en-GB", { timeZone: PREVIEW_TZ, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
};

export type LogLine = { at: number | null; level: "info" | "warn"; text: string };
/** The live log: one line per trace step, oldest first (time, plain step, its detail in plain words). Tool names and raw
 *  errors never show; the detail is cut to one line. */
export function logLines(t: OpsTask, lang: Lang, max = 60): LogLine[] {
  const rows = stepRows(t, lang, Date.now());
  const trace = (Array.isArray(t.trace) ? t.trace : []).filter((s) => s && typeof s.step === "string" && !SKIP.test(s.step));
  const out: LogLine[] = trace.map((s, i) => {
    const detail = typeof s.detail === "string" ? plainError(s.detail, lang).replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (m) => plainStep(m, lang).toLowerCase()).replace(/[.。]$/, "") : "";
    return { at: rows[i]?.at ?? null, level: s.ok === false ? "warn" : "info", text: detail && detail !== rows[i].label ? `${rows[i].label}: ${detail}` : rows[i].label };
  });
  return out.slice(-max);
}

/** Share done for the ring, 0..1: finished steps over finished + 1 (the one it's on); done = 1; nothing known = 0. */
export function ringShare(t: OpsTask): number {
  const k = kindOf(t);
  if (k === "done") return 1;
  const n = (Array.isArray(t.trace) ? t.trace : []).filter((s) => s && typeof s.step === "string" && !SKIP.test(s.step) && s.ok !== false).length;
  if (k === "queued" || !n) return 0;
  return Math.min(0.95, n / (n + 1));
}
/** How long it has run (or ran). */
export function took(t: OpsTask, nowMs: number): number | null {
  const a = ms(t.started_at) || ms(t.created_at), b = t.finished_at ? ms(t.finished_at) : nowMs;
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}
/** One line for a job's error: plain words, no stack, no path, no internal names. */
export const errorLine = (t: Pick<OpsTask, "error">, lang: Lang) => (t.error ? plainError(t.error, lang) : OPS_COPY[lang].failedPlain);
/** First line of the result, Markdown stripped. */
export const resultLine = (s: string | null | undefined, max = 140) => (s ?? "").replace(/[#*_`>]/g, "").split(/\n+/).map((l) => l.trim()).find(Boolean)?.slice(0, max) ?? "";

/* ---------- History ---------- */

/** Tallinn day key "2026-11-23". */
const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: PREVIEW_TZ });
export function historyGroups<T extends OpsTask>(tasks: T[], lang: Lang, nowMs: number): { label: string; items: T[] }[] {
  const w = OPS_COPY[lang], today = dayKey(nowMs), yday = dayKey(nowMs - DAY);
  const groups = new Map<string, T[]>();
  for (const t of tasks) {
    const v = ms(lastAt(t)); const k = Number.isFinite(v) ? dayKey(v) : "?";
    const label = k === today ? w.today : k === yday ? w.yesterday : k === "?" ? w.earlier
      : new Date(v).toLocaleDateString(lang === "et" ? "et-EE" : "en-GB", { timeZone: PREVIEW_TZ, weekday: "long", day: "numeric", month: "long" });
    groups.set(label, [...(groups.get(label) ?? []), t]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}
export type HistoryFilter = "all" | "done" | "failed" | "stopped";
export function historyView<T extends OpsTask>(tasks: T[], q: string, f: HistoryFilter): T[] {
  const s = q.trim().toLowerCase();
  return tasks.filter((t) => (f === "all" || kindOf(t) === f) && (!s || `${t.title} ${t.agent} ${t.error ?? ""}`.toLowerCase().includes(s)));
}

/* ---------- Routines (automations) ---------- */

export type Routine = { id: string; name: string; enabled: boolean; trigger: "schedule" | "event"; schedule: Schedule | null; event: string | null; kind_filter: string | null; agent: string;
  last: { id: string; status: string; created_at: string; error: string | null } | null };
const pad = (n: number | undefined) => String(n ?? 0).padStart(2, "0");
/** "Every day at 08:00" / "Iga päev kell 08:00", in his language (the API's `when` is English only). */
export function triggerText(a: Pick<Routine, "trigger" | "schedule" | "event" | "kind_filter">, lang: Lang): string {
  const w = OPS_COPY[lang];
  if (a.trigger === "event") return a.event === "briefing.ready" ? w.onBriefing : w.onSave(a.kind_filter ? w.kinds[a.kind_filter as keyof typeof w.kinds] ?? a.kind_filter : "");
  const s = a.schedule ?? { every: "day" as const };
  const t = `${pad(s.hour)}:${pad(s.minute)}`;
  if (s.every === "hour") return w.everyHour(pad(s.minute));
  if (s.every === "day") return w.everyDay(t);
  return w.everyWeek(w.days[s.weekday ?? 0], t);
}
/** Next run as "Today 17:00" / "Mon 18:00"; null for paused or event routines. */
export function nextRun(a: Pick<Routine, "enabled" | "trigger" | "schedule">, lang: Lang, now: Date): string | null {
  if (!a.enabled || a.trigger !== "schedule" || !a.schedule) return null;
  const n = nextOccurrences(a.schedule, now, 1)[0];
  if (!n) return null;
  const w = OPS_COPY[lang], d = dayKey(n.getTime());
  const when = d === dayKey(now.getTime()) ? w.today : d === dayKey(now.getTime() + DAY) ? w.tomorrow
    : n.toLocaleDateString(lang === "et" ? "et-EE" : "en-GB", { timeZone: PREVIEW_TZ, weekday: "short" });
  return `${when} ${clock(n.getTime(), lang)}`;
}

/* ---------- API: the slim list for polling ---------- */

/** What the list needs while polling: step names/times/ok (not each step's detail), the first 400 characters of the result and
 *  request. The full row comes from /api/tasks/:id when a job is opened. Cuts a typical poll by ~5×. */
export function slimTask<T extends { trace?: unknown; result?: string | null; request?: string | null; error?: string | null }>(t: T): T {
  const trace = Array.isArray(t.trace) ? (t.trace as OpsStep[]).map((s) => ({ step: s?.step, ms: s?.ms, ok: s?.ok })) : t.trace;
  return { ...t, trace, result: t.result ? t.result.slice(0, 400) : t.result ?? null, request: t.request ? t.request.slice(0, 400) : t.request ?? "", error: t.error ? t.error.slice(0, 400) : t.error ?? null };
}
/** A weak ETag for a list: changes when any row's state, step count, result or finish time changes. FNV-1a over the fields. */
export function listTag(rows: { id: string; status: string; trace?: unknown; pending?: unknown; finished_at?: string | null; started_at?: string | null; title?: string; result?: string | null; error?: string | null }[]): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } };
  for (const r of rows) feed(`${r.id}|${r.status}|${Array.isArray(r.trace) ? r.trace.length : 0}|${JSON.stringify(r.pending ?? null).length}|${r.started_at ?? ""}|${r.finished_at ?? ""}|${r.title ?? ""}|${(r.result ?? "").length}|${(r.error ?? "").length};`);
  return `W/"${rows.length}-${h.toString(36)}"`;
}

/* ---------- Copy (EN + ET, same keys: the type makes ET complete) ---------- */

const EN = {
  title: "Operations", menu: "More", close: "Back to galaxy", back: "All jobs",
  askLabel: "Give ORBIT a job", askPh: "What should ORBIT do?", send: "Start",
  sugg: ["Find 5 cafés in Tallinn that need a website", "Summarize what I saved this week", "Check my pet sim for bugs"],
  started: "Started", open: "Open", startFailed: "Couldn't start the job. Nothing was lost — try again.",
  nWorking: (n: number) => `${n} working`, nNeeds: (n: number) => `${n} need${n === 1 ? "s" : ""} you`, nDone: (n: number) => `${n} done today`,
  idle: "Nothing running. Give ORBIT a job.",
  kWorking: "Working", kNeeds: "Needs you", kDone: "Done today", kFailed: "Didn't work",
  tabs: { now: "Now", scheduled: "Scheduled", history: "History" }, tabsLabel: "Jobs",
  sNeeds: "Needs you", sWorking: "Working on it", sQueued: "Waiting to start", sFailed: "Didn't work", sToday: "Today",
  review: "Review", retry: "Try again", stop: "Stop", stopped: "Stopped", retrying: "Starting again", stopFailed: "Couldn't stop it. Try again.", retryFailed: "Couldn't start it again.",
  emptyNow: "Nothing is running", emptyNowText: "Give ORBIT a job above. You'll see every step here while it works.",
  now: "now", left: (s: string) => s, since: (s: string) => `for ${s}`, waitingFor: (s: string) => `waiting ${s}`,
  timeline: "Today", timelineLabel: "Jobs over the last 6 hours", nowLine: "Now",
  // routines
  sRoutines: "Routines", newRoutine: "New routine", emptyRoutines: "No routines yet", emptyRoutinesText: "A routine runs a job for you on a schedule, like a morning brief at 8:00.",
  next: (s: string) => `Next ${s}`, paused: "Paused", lastRun: "Last run", runNow: "Run now", edit: "Edit", pause: "Pause", resume: "Turn on", del: "Delete",
  delConfirm: (n: string) => `Delete the routine “${n}”? Its past jobs stay.`, ranNow: "Started a run", saved: "Saved", deleted: "Deleted", routineFailed: "Couldn't change the routine. Try again.",
  everyDay: (t: string) => `Every day at ${t}`, everyHour: (m: string) => `Every hour at :${m}`, everyWeek: (d: string, t: string) => `Every ${d} at ${t}`,
  onBriefing: "When a new briefing is ready", onSave: (k: string) => (k ? `When you save ${k}` : "When you save a memory"),
  days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  kinds: { document: "a document", link: "a link", note: "a note", idea: "an idea" } as Record<string, string>,
  fName: "Name", fWhen: "When", fDay: "Day", fTime: "Time", fMinute: "Minute", fKind: "Kind", fWho: "Who does it", fWhat: "What to do",
  wDay: "Every day", wWeek: "Every week", wHour: "Every hour", wMemory: "When I save something", wBriefing: "When a briefing is ready", anyKind: "Anything",
  fNote: "Each run is a normal job with the usual approvals. Runs while ORBIT is on, on Tallinn time.", save: "Save", saveChanges: "Save changes", cancel: "Cancel",
  templates: "Start from", nameNeeded: "Give it a name and say what to do (5+ letters).",
  // history
  search: "Search jobs", searchPh: "Search by name or helper", fAll: "All", fDone: "Done", fFailed: "Didn't work", fStopped: "Stopped",
  today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow", earlier: "Earlier", more: "Show more", noMatch: "No jobs match", emptyHistory: "No finished jobs yet",
  // detail
  steps: "Steps", log: "Live log", autoScroll: "Follow", helpers: "Helpers", result: "Result", issues: "What went wrong", request: "What you asked",
  colStep: "Step", colTime: "Time", colTook: "Took", colState: "Status", stDone: "Done", stNow: "Working", stFailed: "Failed", stNext: "Next",
  ran: (s: string) => `Ran ${s}`, running: (s: string) => `Running ${s}`, startedAt: (s: string) => `Started ${s}`, by: (s: string) => `by ${s}`,
  done: "Done", checked: "Done · checked", needsYou: "Needs you", working: "Working", queued: "Waiting to start", failed: "Didn't work", stoppedK: "Stopped", held: "Paused by Stop all", offline: "ORBIT's PC is offline",
  failedPlain: "It didn't finish.", copyReceipt: "Copy summary", copied: "Copied", trace: "Download log", saveRecipe: "Save as recipe", recipeSaved: "Saved as a recipe",
  missing: "This job isn't here any more", missingText: "It may have been deleted, or the link is wrong.", loadFailed: "Couldn't load your jobs", loadFailedText: "Your jobs are safe. Check that ORBIT is running on the PC.", tryAgain: "Try again",
  loading: "Loading your jobs", noLog: "No steps yet.", ring: (p: number) => `${p}% done`,
  // menu / sheets
  mNewJob: "New job with options", mScout: "New AI tools", mActivity: "Activity", mTime: "Time machine", mPlans: "Multi-step jobs", mRules: "Ask-first rules", mTeam: "Team", mProjects: "Projects", mLocal: "AI on this PC", mTerminal: "Terminal", mSafety: "Safety check", mRefresh: "Refresh",
  jobWhat: "What should ORBIT do?", jobWho: "Who starts it", jobProject: "Project", noProject: "No project", novaHint: "Nova (decides and hands out)", start: "Start",
  projNew: "New project name", add: "Add", pActive: "Active", pPaused: "Paused", pDone: "Done", allProjects: "All projects",
  // scout
  scoutIntro: "Every 6 hours ORBIT looks for new open AI models and tools that fit this PC and have a clear licence. It never installs anything.",
  scoutCheck: "Check now", scoutChecking: "Checking…", scoutLast: (s: string) => `Last check ${s}`, scoutNever: "never", scoutReady: "Ready to try", scoutWatch: "Watching",
  scoutEmpty: "Nothing new yet", scoutEmptyText: "New tools show up here after the next check.", scoutOff: "The tool finder is off.", scoutNew: "New",
  scoutImproves: "Makes better", scoutLicence: "Licence", scoutSize: "Fits this PC", scoutSource: "Open source page", scoutTry: "Try it", scoutTrying: "Open the try-out job", scoutDismiss: "Hide",
  recoverHint: "What it already did stays done. Trying a step again won't repeat it.", rStep: "Try this step again", rResume: "Approve this step again", rReplace: "Change what I asked", rRerun: "Run with this", rAbandon: "Give up on it",
  blockedBy: (s: string) => `Waiting for: ${s}`, waitsYou: (w: string) => `${w} is waiting for your OK`, asksLater: (w: string) => `${w} will ask for your OK when it gets there`, preview: "Preview", whatItDoes: "What it will do",
  stillWorking: "Still working. Approve and Reject appear when it's ready.", approve: "Approve", reject: "Reject", approved: "Approved", rejected: "Rejected", actFailed: "That didn't go through. Nothing changed — try again.",
  tpl: { weekly: "Weekly project review", docs: "Summarize new documents", watch: "Morning world watch", ideas: "Daily YouTube ideas", biz: "Find and email new clients" },
  nextStep: "Next step", earlierSteps: (n: number) => `${n} earlier step${n === 1 ? "" : "s"}`, checkedTitle: "Saved and checked", openMemory: "Open note", openFile: "Open file", tStatus: "Status",
  scoutTryHelp: "Starts a job that builds a small test of it. Nothing is installed without your OK.", scoutFailed: "Couldn't reach the tool finder. Try again.",
} as const;
type Copy = { [K in keyof typeof EN]: (typeof EN)[K] extends (...a: infer A) => string ? (...a: A) => string : (typeof EN)[K] extends readonly string[] ? readonly string[] : (typeof EN)[K] extends Record<string, string> ? Record<string, string> : (typeof EN)[K] extends Record<string, unknown> ? { [P in keyof (typeof EN)[K]]: string } : string };
const ET: Copy = {
  title: "Tööd", menu: "Rohkem", close: "Tagasi galaktikasse", back: "Kõik tööd",
  askLabel: "Anna ORBITile töö", askPh: "Mida ORBIT tegema peaks?", send: "Alusta",
  sugg: ["Leia Tallinnas 5 kohvikut, kel on vaja kodulehte", "Tee kokkuvõte, mida sel nädalal salvestasin", "Otsi mu pet simist vigu"],
  started: "Alustatud", open: "Ava", startFailed: "Tööd ei saanud alustada. Midagi ei läinud kaotsi — proovi uuesti.",
  nWorking: (n: number) => `${n} töös`, nNeeds: (n: number) => `${n} vajab sind`, nDone: (n: number) => `täna valmis ${n}`,
  idle: "Midagi ei käi. Anna ORBITile töö.",
  kWorking: "Töös", kNeeds: "Vajab sind", kDone: "Täna valmis", kFailed: "Ei õnnestunud",
  tabs: { now: "Praegu", scheduled: "Ajastatud", history: "Ajalugu" }, tabsLabel: "Tööd",
  sNeeds: "Vajab sind", sWorking: "Töös", sQueued: "Ootab algust", sFailed: "Ei õnnestunud", sToday: "Täna",
  review: "Vaata üle", retry: "Proovi uuesti", stop: "Peata", stopped: "Peatatud", retrying: "Alustan uuesti", stopFailed: "Ei saanud peatada. Proovi uuesti.", retryFailed: "Ei saanud uuesti alustada.",
  emptyNow: "Midagi ei käi", emptyNowText: "Anna ORBITile ülal töö. Siin näed iga sammu, kuni see käib.",
  now: "praegu", left: (s: string) => s, since: (s: string) => `juba ${s}`, waitingFor: (s: string) => `ootab ${s}`,
  timeline: "Täna", timelineLabel: "Tööd viimase 6 tunni jooksul", nowLine: "Praegu",
  sRoutines: "Rutiinid", newRoutine: "Uus rutiin", emptyRoutines: "Rutiine veel pole", emptyRoutinesText: "Rutiin teeb töö sinu eest graafiku järgi, näiteks hommikuse ülevaate kell 8.00.",
  next: (s: string) => `Järgmine ${s}`, paused: "Peatatud", lastRun: "Viimane kord", runNow: "Käivita kohe", edit: "Muuda", pause: "Peata", resume: "Lülita sisse", del: "Kustuta",
  delConfirm: (n: string) => `Kustutan rutiini „${n}”? Varasemad tööd jäävad alles.`, ranNow: "Käivitasin", saved: "Salvestatud", deleted: "Kustutatud", routineFailed: "Rutiini ei saanud muuta. Proovi uuesti.",
  everyDay: (t: string) => `Iga päev kell ${t}`, everyHour: (m: string) => `Iga tund kell :${m}`, everyWeek: (d: string, t: string) => `Igal ${d} kell ${t}`,
  onBriefing: "Kui uus ülevaade on valmis", onSave: (k: string) => (k ? `Kui salvestad ${k}` : "Kui salvestad midagi"),
  days: ["pühapäeval", "esmaspäeval", "teisipäeval", "kolmapäeval", "neljapäeval", "reedel", "laupäeval"],
  kinds: { document: "dokumendi", link: "lingi", note: "märkme", idea: "idee" },
  fName: "Nimi", fWhen: "Millal", fDay: "Päev", fTime: "Kell", fMinute: "Minut", fKind: "Liik", fWho: "Kes teeb", fWhat: "Mida teha",
  wDay: "Iga päev", wWeek: "Iga nädal", wHour: "Iga tund", wMemory: "Kui midagi salvestan", wBriefing: "Kui ülevaade on valmis", anyKind: "Mida iganes",
  fNote: "Iga kord on tavaline töö tavaliste kinnitustega. Käib, kui ORBIT on sees, Tallinna aja järgi.", save: "Salvesta", saveChanges: "Salvesta muudatused", cancel: "Loobu",
  templates: "Alusta mallist", nameNeeded: "Anna nimi ja ütle, mida teha (vähemalt 5 tähte).",
  search: "Otsi töid", searchPh: "Otsi nime või abilise järgi", fAll: "Kõik", fDone: "Valmis", fFailed: "Ei õnnestunud", fStopped: "Peatatud",
  today: "Täna", yesterday: "Eile", tomorrow: "Homme", earlier: "Varem", more: "Näita rohkem", noMatch: "Ühtegi tööd ei leitud", emptyHistory: "Valmis töid veel pole",
  steps: "Sammud", log: "Logi", autoScroll: "Jälgi", helpers: "Abilised", result: "Tulemus", issues: "Mis läks valesti", request: "Mida palusid",
  colStep: "Samm", colTime: "Kell", colTook: "Kestis", colState: "Olek", stDone: "Valmis", stNow: "Töös", stFailed: "Ei õnnestunud", stNext: "Järgmine",
  ran: (s: string) => `Kestis ${s}`, running: (s: string) => `Käib ${s}`, startedAt: (s: string) => `Algas ${s}`, by: (s: string) => `tegi ${s}`,
  done: "Valmis", checked: "Valmis · kontrollitud", needsYou: "Vajab sind", working: "Töös", queued: "Ootab algust", failed: "Ei õnnestunud", stoppedK: "Peatatud", held: "Peatatud (Peata kõik)", offline: "ORBITi arvuti pole võrgus",
  failedPlain: "See ei saanud valmis.", copyReceipt: "Kopeeri kokkuvõte", copied: "Kopeeritud", trace: "Laadi logi alla", saveRecipe: "Salvesta retseptina", recipeSaved: "Salvestatud retseptina",
  missing: "Seda tööd pole enam", missingText: "See võib olla kustutatud või link on vale.", loadFailed: "Töid ei saanud laadida", loadFailedText: "Sinu tööd on alles. Kontrolli, et ORBIT arvutis töötab.", tryAgain: "Proovi uuesti",
  loading: "Laadin töid", noLog: "Samme veel pole.", ring: (p: number) => `${p}% valmis`,
  mNewJob: "Uus töö valikutega", mScout: "Uued AI tööriistad", mActivity: "Tegevus", mTime: "Ajamasin", mPlans: "Mitmeastmelised tööd", mRules: "Küsi-enne reeglid", mTeam: "Tiim", mProjects: "Projektid", mLocal: "AI selles arvutis", mTerminal: "Terminal", mSafety: "Turvakontroll", mRefresh: "Värskenda",
  jobWhat: "Mida ORBIT tegema peaks?", jobWho: "Kes alustab", jobProject: "Projekt", noProject: "Projektita", novaHint: "Nova (otsustab ja jagab välja)", start: "Alusta",
  projNew: "Uue projekti nimi", add: "Lisa", pActive: "Käib", pPaused: "Peatatud", pDone: "Valmis", allProjects: "Kõik projektid",
  scoutIntro: "Iga 6 tunni järel otsib ORBIT uusi avatud AI mudeleid ja tööriistu, mis sobivad sellesse arvutisse ja millel on selge litsents. Midagi ei paigaldata.",
  scoutCheck: "Kontrolli kohe", scoutChecking: "Kontrollin…", scoutLast: (s: string) => `Viimati ${s}`, scoutNever: "mitte kunagi", scoutReady: "Valmis proovimiseks", scoutWatch: "Jälgin",
  scoutEmpty: "Uut veel pole", scoutEmptyText: "Uued tööriistad tulevad siia pärast järgmist kontrolli.", scoutOff: "Tööriistade otsija on väljas.", scoutNew: "Uus",
  scoutImproves: "Parandab", scoutLicence: "Litsents", scoutSize: "Sobib arvutisse", scoutSource: "Ava lähteleht", scoutTry: "Proovi", scoutTrying: "Ava proovitöö", scoutDismiss: "Peida",
  recoverHint: "Mis juba tehtud, jääb tehtuks. Sammu uuesti proovimine seda ei korda.", rStep: "Proovi seda sammu uuesti", rResume: "Kinnita see samm uuesti", rReplace: "Muuda, mida palusin", rRerun: "Käivita sellega", rAbandon: "Loobu sellest",
  blockedBy: (s: string) => `Ootab: ${s}`, waitsYou: (w: string) => `${w} ootab sinu luba`, asksLater: (w: string) => `${w} küsib sinu luba, kui jõuab sinnani`, preview: "Eelvaade", whatItDoes: "Mida see teeb",
  stillWorking: "Töötab veel. „Kinnita” ja „Lükka tagasi” tulevad, kui see on valmis.", approve: "Kinnita", reject: "Lükka tagasi", approved: "Kinnitatud", rejected: "Tagasi lükatud", actFailed: "See ei läinud läbi. Midagi ei muutunud — proovi uuesti.",
  tpl: { weekly: "Nädala projektide ülevaade", docs: "Uute dokumentide kokkuvõte", watch: "Hommikune maailma ülevaade", ideas: "Igapäevased YouTube'i ideed", biz: "Leia uued kliendid ja kirjuta neile" },
  nextStep: "Järgmine samm", earlierSteps: (n: number) => `${n} varasemat sammu`, checkedTitle: "Salvestatud ja kontrollitud", openMemory: "Ava märge", openFile: "Ava fail", tStatus: "Olek",
  scoutTryHelp: "Alustab töö, mis teeb sellest väikese proovi. Midagi ei paigaldata ilma sinu loata.", scoutFailed: "Tööriistade otsijat ei saanud kätte. Proovi uuesti.",
};
export const OPS_COPY: Record<Lang, Copy> = { en: EN as unknown as Copy, et: ET };
export type OpsCopy = Copy;
export const OPS_SHEETS = ["job", "routine", "scout", "activity", "time", "plans", "rules", "team", "projects", "localai", "terminal", "safety"] as const;
export type OpsSheet = (typeof OPS_SHEETS)[number];
/** A deep link's view (#o=operations&v=…) → the sheet it opens; old tab names map to their new place. */
export function sheetFromView(v: string | null | undefined): { sheet?: OpsSheet; tab?: "now" | "scheduled" | "history" } {
  if (!v) return {};
  if (v === "automations" || v === "scheduled" || v === "routines") return { tab: "scheduled" };
  if (v === "history" || v === "tasks") return { tab: v === "tasks" ? "now" : "history" };
  return (OPS_SHEETS as readonly string[]).includes(v) ? { sheet: v as OpsSheet } : {};
}

/* ---------- Routine requests (the contracts the old Automation Studio kept; tested) ---------- */

/** Save: a new routine POSTs the spec; an edit PATCHes the spec with its id and never touches `enabled` (editing a paused
 *  routine doesn't switch it on). */
export function routineSave<S extends object>(id: string | null, spec: S): { method: "POST" | "PATCH"; body: S & { id?: string } } {
  return id ? { method: "PATCH", body: { id, ...spec } } : { method: "POST", body: { ...spec } };
}
/** Pause / turn on: only `enabled` goes out, so a legacy routine with an old spec can still be toggled. */
export const routineToggle = (a: { id: string; enabled: boolean }) => ({ method: "PATCH" as const, body: { id: a.id, enabled: !a.enabled } });
/** Run now: only the saved id (never unsaved edits). */
export const routineRun = (a: { id: string }) => ({ method: "POST" as const, body: { run: a.id } });
/** A one-at-a-time guard for buttons that start something: a second press before the first finishes is ignored. */
export function oneAtATime() {
  const on = new Set<string>();
  return async <T>(key: string, f: () => Promise<T>): Promise<T | undefined> => {
    if (on.has(key)) return undefined;
    on.add(key);
    try { return await f(); } finally { on.delete(key); }
  };
}
/** An API error message is shown only when it's already plain words (no status codes, stack or internal names). */
export const plainApiError = (msg: string | undefined, fallback: string) => (msg && !/Request failed|\(\d{3}\)|ECONN|ETIMEDOUT|at \S+ \(|\/home\/|\\\\|stack/i.test(msg) && msg.length < 200 ? msg : fallback);
