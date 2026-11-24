"use client";
// OPERATIONS in the planet design language, MIX look (reports/hf-refs/operations.png calm list + adv-operations.png depth):
//   header (status line) → one ask box ("What should ORBIT do?") → four numbers → Now · Scheduled · History.
//   Now: Needs you → Working on it (live step list, time left, Stop) → Didn't work (Try again) → Waiting → a "today" timeline.
//   A job opens in place: progress ring, step table with times, live log, helpers, result, what went wrong + recovery.
//   Everything else (new job with options, routines editor, new AI tools, activity, rules, …) lives in the "…" menu as a Sheet.
// Logic and words: lib/operations-planet-pure.ts (EN + ET). Nothing here approves by itself: Approve sits on the job's own card
// with the exact items shown (AGENTS.md rule 6). Polls the slim list (?lite=1, ETag → 304) only while visible.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Card, Chip, Empty, ErrorState, IconBack, IconCheck, IconChevron, IconPlus, Loading, PlanetShell, Section, Sheet, Toaster, toast, uiSound, type MenuItem } from "./ui";
import "@/app/operations-planet.css";
import { useT } from "./i18n";
import { useWorldPaused } from "./world-paused";
import { useWorldShell } from "./world-shell";
import { useStopAll } from "./OpsStatus";
import { hostOffline } from "@/lib/ops-status-pure";
import { Markdown } from "./Markdown";
import { FailureReport } from "./FailureReport";
import { ActivityView } from "./ActivityView";
import { TimeMachineView } from "./TimeMachineView";
import { TeamStatusView } from "./TeamStatusView";
import { PlanJobsView } from "./PlanJobsView";
import { RulesView } from "./RulesView";
import { LocalAiTools } from "./LocalAi";
import { TerminalView } from "./TerminalView";
import { RedTeamCard } from "./RedTeamCard";
import { SCOUT_CHANGED, SCOUT_TAB_EVENT, takeScoutTab } from "./scout-nav";
import { notifyProjectsChanged } from "@/lib/project-list";
import { pendingSeen } from "@/lib/approval-bind-pure";
import { canRetryTask, taskVerified, type WriteEvidence } from "@/lib/completion-pure";
import { blockedBy, recoveryOptions } from "@/lib/tasks-recovery-pure";
import { copyReceipt, rowReceipt } from "@/lib/receipt-pure";
import { leftText, minutesLeft } from "@/lib/progress-pure";
import { automationDraft, automationSpec, automationCapabilityHint, type AutomationDraft } from "@/lib/automation-edit-pure";
import { BUSINESS_LOOP } from "@/lib/business-loop-pure";
import { FIT_LABEL, type Candidate } from "@/lib/feature-scout-pure";
import type { AutomationSpec } from "@/lib/pure";
import {
  OPS_COPY, buckets, clock, counts, dur, errorLine, historyGroups, historyView, kindOf, lanes, logLines, nextRun, resultLine, ringShare, sheetFromView,
  statusText, stepRows, took, triggerText, type Buckets, routineSave, routineToggle, routineRun, oneAtATime, plainApiError, type HistoryFilter, type Kind, type OpsCopy, type OpsSheet, type OpsTask,
} from "@/lib/operations-planet-pure";
import { askConfirm } from "./ui/Dialog";

type Pending = { tool: string; input: Record<string, unknown>; status: string; note?: string; evidence?: WriteEvidence[] };
export type Job = OpsTask & { project_id: string | null; request: string; result: string | null; error: string | null; trace: { step: string; detail?: string; ms?: number; ok?: boolean }[]; pending: Pending[] };
type Agent = { slug: string; name: string; tools: string[]; enabled?: boolean };
type Project = { id: string; name: string; status: string };
type Run = { id: string; status: string; created_at: string; error: string | null };
type Routine = AutomationSpec & { id: string; enabled: boolean; run_count: number; last: Run | null; runs: Run[] };
type Tab = "now" | "scheduled" | "history";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const post = <T,>(url: string, body: object, method = "POST") => api<T>(url, { method, body: JSON.stringify(body) });

/** The one toast stack: Orbit mounts it; a harness or an older shell without it gets this one. */
function OwnToaster({ label }: { label: string }) {
  const [need, setNeed] = useState(false);
  useEffect(() => { setNeed(!document.querySelector(".pu-toasts")); }, []);
  return need ? <Toaster dismissLabel={label} /> : null;
}

/** Re-render every `ms` (relative times, the now line). Stops while hidden. */
function useNow(ms: number, on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const h = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, ms);
    return () => clearInterval(h);
  }, [ms, on]);
  return now;
}

/** The job list: slim rows, ETag-aware (a 304 keeps the same array, so nothing re-renders), 3 s while something moves, 15 s idle. */
function useJobs(paused: boolean, project: string) {
  const [tasks, setTasks] = useState<Job[] | null>(null);
  const [failed, setFailed] = useState(false);
  const tag = useRef<string | null>(null), seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const url = `/api/tasks?lite=1${project ? `&project=${encodeURIComponent(project)}` : ""}`;
      const r = await fetch(url, { cache: "no-store", headers: tag.current ? { "If-None-Match": tag.current } : {} });
      if (n !== seq.current) return;
      if (r.status === 304) { setFailed(false); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || String(r.status));
      tag.current = r.headers.get("etag");
      setTasks(j.tasks ?? []); setFailed(false);
    } catch { if (n === seq.current) setFailed(true); }
  }, [project]);
  useEffect(() => { tag.current = null; setTasks(null); void load(); }, [load]);
  const active = !!tasks?.some((t) => ["running", "queued", "awaiting_approval"].includes(t.status));
  useEffect(() => {
    if (paused) return;
    const h = setInterval(() => { if (!document.hidden) void load(); }, active ? 3000 : 15_000);
    const back = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(h); document.removeEventListener("visibilitychange", back); };
  }, [active, paused, load]);
  return { tasks, failed, load, setTasks };
}

/** Tells him when a job finishes or fails (toast + sound), and plays the "needs" sound when something new waits for him. */
function useOutcomes(tasks: Job[] | null, w: OpsCopy, open: (id: string) => void) {
  const prev = useRef<Map<string, Kind> | null>(null);
  useEffect(() => {
    if (!tasks) return;
    const now = new Map(tasks.filter((t) => !t.parent_id).map((t) => [t.id, kindOf(t)] as const));
    const was = prev.current;
    prev.current = now;
    if (!was) return;
    let needs = false;
    for (const [id, k] of now) {
      const before = was.get(id), t = tasks.find((x) => x.id === id)!;
      if (before === k || !before) { if (!before && k === "needs") needs = true; continue; }
      if (k === "done" && (before === "working" || before === "queued" || before === "needs")) toast({ id: `job:${id}`, tone: "done", text: `${w.done}: ${t.title}`, action: { label: w.open, onClick: () => open(id) } });
      else if (k === "failed" && before !== "failed") toast({ id: `job:${id}`, tone: "error", text: `${w.failed}: ${t.title}`, action: { label: w.open, onClick: () => open(id) } });
      else if (k === "needs") needs = true;
    }
    if (needs) uiSound("needs");
  }, [tasks, w, open]);
}

const TONE: Record<Kind, string | undefined> = { working: "accent", needs: "warn", queued: undefined, failed: "bad", done: "good", stopped: undefined };

/** A small progress ring (SVG, crisp at any DPR). */
function Ring({ share, size = 20, label, kind }: { share: number; size?: number; label?: string; kind: Kind }) {
  const r = size / 2 - 2, c = 2 * Math.PI * r;
  return (
    <svg className="ops-ring" data-kind={kind} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ops-ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ops-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - share)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

export function OperationsShell({ focusTask, onOpen, openMemory }: { focusTask: string | null; onOpen?: (id: string | null) => void; openMemory: (id: string) => void }) {
  const { t, lang } = useT();
  const w = OPS_COPY[lang];
  const world = useWorldShell();
  const paused = useWorldPaused();
  const stop = useStopAll(), off = hostOffline(stop.host);
  const [open, setOpen] = useState<string | null>(focusTask);
  const [tab, setTab] = useState<Tab>("now");
  const [sheet, setSheet] = useState<OpsSheet | null>(null);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [project, setProject] = useState("");
  const { tasks, failed, load, setTasks } = useJobs(paused || !!open, project);
  const now = useNow(15_000, !paused);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const loadMeta = useCallback(() => {
    void api<{ agents: Agent[] }>("/api/agents").then((r) => setAgents(r.agents ?? []), () => {});
    void api<{ projects: Project[] }>("/api/projects").then((r) => setProjects(r.projects ?? []), () => {});
  }, []);
  useEffect(loadMeta, [loadMeta]);
  useEffect(() => { setOpen(focusTask); }, [focusTask]);
  useEffect(() => { onOpen?.(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- the open job is the URL's record
  // Deep links (#o=operations&v=scout) and the galaxy's scout moon open the matching sheet or tab.
  useEffect(() => {
    const v = new URLSearchParams(location.hash.slice(1)).get("v");
    const s = sheetFromView(v);
    if (s.sheet) setSheet(s.sheet); if (s.tab) setTab(s.tab);
    const go = () => { if (takeScoutTab()) { setOpen(null); setSheet("scout"); } };
    go();
    addEventListener(SCOUT_TAB_EVENT, go);
    return () => removeEventListener(SCOUT_TAB_EVENT, go);
  }, []);
  useOutcomes(tasks, w, setOpen);

  const o = { stopAll: stop.on, hostOffline: off };
  const b = useMemo(() => buckets(tasks ?? [], now, o), [tasks, now, stop.on, off]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(() => counts(tasks ?? [], now, o), [tasks, now, stop.on, off]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async (request: string, extra: { agent?: string; project_id?: string } = {}) => {
    try {
      const { task } = await post<{ task: Job }>("/api/tasks", { request, lang, ...extra });
      setTasks((ts) => (ts ? [task, ...ts.filter((x) => x.id !== task.id)] : [task]));
      setTab("now");
      toast({ id: `job:${task.id}`, text: `${w.started}: ${task.title}`, action: { label: w.open, onClick: () => setOpen(task.id) } });
      void load();
      return true;
    } catch (e) { toast({ tone: "error", text: plainApiError(e instanceof Error ? e.message : "", w.startFailed) }); return false; }
  };
  const act = async (id: string, action: string, body: object = {}) => {
    try { await post(`/api/tasks/${id}`, { ...body, action }); void load(); return true; }
    catch (e) { toast({ tone: "error", text: plainApiError(e instanceof Error ? e.message : "", action === "cancel" ? w.stopFailed : w.actFailed) }); return false; }
  };

  const menu: MenuItem[] = [
    { label: w.mNewJob, onSelect: () => setSheet("job") },
    { label: w.newRoutine, onSelect: () => { setEditing(null); setSheet("routine"); } },
    { label: w.mScout, onSelect: () => setSheet("scout") },
    "separator",
    { label: w.mActivity, onSelect: () => setSheet("activity") },
    { label: w.mTime, onSelect: () => setSheet("time") },
    { label: w.mPlans, onSelect: () => setSheet("plans") },
    { label: w.mRules, onSelect: () => setSheet("rules") },
    { label: w.mProjects, onSelect: () => setSheet("projects") },
    { label: w.mTeam, onSelect: () => setSheet("team") },
    { label: w.mLocal, onSelect: () => setSheet("localai") },
    { label: w.mTerminal, onSelect: () => setSheet("terminal") },
    { label: w.mSafety, onSelect: () => setSheet("safety") },
    "separator",
    { label: w.mRefresh, onSelect: () => { void load(); loadMeta(); } },
  ];
  const sheetTitle: Record<OpsSheet, string> = { job: w.mNewJob, routine: editing ? editing.name : w.newRoutine, scout: w.mScout, activity: w.mActivity, time: w.mTime, plans: w.mPlans, rules: w.mRules,
    team: w.mTeam, projects: w.mProjects, localai: w.mLocal, terminal: w.mTerminal, safety: w.mSafety };
  const closeSheet = () => { setSheet(null); setEditing(null); };
  const sheetBody = (s: OpsSheet): ReactNode => {
    const legacy = (n: ReactNode) => <div className="ops-legacy">{n}</div>;
    const openJob = (id: string) => { closeSheet(); setOpen(id); };
    switch (s) {
      case "job": return <NewJob w={w} agents={agents} projects={projects} onStart={async (r, x) => { if (await start(r, x)) closeSheet(); }} />;
      case "routine": return <RoutineForm w={w} agents={agents} routine={editing} onDone={() => { closeSheet(); setTab("scheduled"); }} />;
      case "scout": return <ScoutSheet w={w} onOpenTask={openJob} />;
      case "projects": return <Projects w={w} projects={projects} current={project} onFilter={(id) => { setProject(id); closeSheet(); }} onChanged={loadMeta} />;
      case "activity": return legacy(<ActivityView onOpenTask={openJob} />);
      case "time": return legacy(<TimeMachineView onOpenTask={openJob} />);
      case "plans": return legacy(<PlanJobsView agents={agents as never} onOpenTask={openJob} />);
      case "rules": return legacy(<RulesView onOpenTask={openJob} />);
      case "team": return legacy(<TeamStatusView />);
      case "localai": return legacy(<LocalAiTools />);
      case "terminal": return legacy(<TerminalView />);
      case "safety": return legacy(<RedTeamCard />);
    }
  };
  const status = stop.on ? w.held : off ? w.offline : tasks ? statusText(c, lang) : w.loading;

  return (
    <>
      <PlanetShell planet="operations" className="ops" title={w.title} status={<span aria-live="polite">{status}</span>} menu={menu} menuLabel={w.menu}
        onClose={world?.onClose} closeLabel={w.close}
        ask={open ? undefined : { label: w.askLabel, placeholder: w.askPh, sendLabel: w.send, suggestions: w.sugg as string[], onSubmit: (v) => { void start(v); } }}
        sheet={<Sheet open={!!sheet} title={sheet ? sheetTitle[sheet] : ""} onClose={closeSheet} closeLabel={w.cancel}>{sheet ? sheetBody(sheet) : null}</Sheet>}>
        {open ? <JobDetail id={open} w={w} onBack={() => { setOpen(null); void load(); }} openMemory={openMemory} act={act} paused={paused} stopAll={stop.on} hostOff={off} />
          : <>
            <Strip w={w} c={c} loading={!tasks} />
            <Tabs w={w} tab={tab} onTab={setTab} counts={{ now: c.working + c.needs + c.queued, scheduled: null, history: null }} />
            {project && <div className="ops-filter"><Chip pressed onClick={() => setProject("")}>{projects.find((p) => p.id === project)?.name ?? w.mProjects} ✕</Chip></div>}
            <div role="tabpanel" id={`ops-panel-${tab}`} aria-labelledby={`ops-tab-${tab}`} className="ops-panel">
              {tab === "now" && (failed && !tasks ? <ErrorState title={w.loadFailed} text={w.loadFailedText} retryLabel={w.tryAgain} onRetry={() => void load()} />
                : !tasks ? <Loading rows={4} label={w.loading} />
                : <NowView w={w} b={b} all={tasks} now={now} lang={lang} onOpen={setOpen} act={act} stopAll={stop.on} />)}
              {tab === "scheduled" && <Scheduled w={w} lang={lang} onOpenTask={setOpen} onEdit={(r) => { setEditing(r); setSheet("routine"); }} onNew={() => { setEditing(null); setSheet("routine"); }} paused={paused} />}
              {tab === "history" && (!tasks ? <Loading rows={5} label={w.loading} /> : <History w={w} lang={lang} items={b.history} now={now} onOpen={setOpen} />)}
            </div>
          </>}
      </PlanetShell>
      <OwnToaster label={t("common.close")} />
    </>
  );
}

/* ---------- the number strip ---------- */
function Strip({ w, c, loading }: { w: OpsCopy; c: ReturnType<typeof counts>; loading: boolean }) {
  const items: [string, number, Kind][] = [[w.kWorking, c.working, "working"], [w.kNeeds, c.needs, "needs"], [w.kDone, c.done, "done"], [w.kFailed, c.failed, "failed"]];
  return (
    <dl className="ops-strip" aria-busy={loading || undefined}>
      {items.map(([label, n, k]) => (
        <div key={k} className="ops-stat" data-kind={k} data-zero={n === 0 ? "" : undefined}>
          <dt>{label}</dt><dd className="pu-num">{loading ? "–" : n}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- tabs (arrow keys move, Home/End) ---------- */
function Tabs({ w, tab, onTab, counts: n }: { w: OpsCopy; tab: Tab; onTab: (t: Tab) => void; counts: Record<Tab, number | null> }) {
  const ids: Tab[] = ["now", "scheduled", "history"];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: React.KeyboardEvent, i: number) => {
    const j = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : e.key === "Home" ? 0 : e.key === "End" ? 2 : -1;
    if (j < 0) return;
    e.preventDefault(); onTab(ids[j]); refs.current[j]?.focus();
  };
  return (
    <div className="ops-tabs" role="tablist" aria-label={w.tabsLabel}>
      {ids.map((id, i) => (
        <button key={id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`ops-tab-${id}`} aria-controls={`ops-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
          className="ops-tab" onClick={() => onTab(id)} onKeyDown={(e) => key(e, i)}>
          {w.tabs[id]}{n[id] ? <span className="ops-tab-n pu-num">{n[id]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------- Now ---------- */
function NowView({ w, b, all, now, lang, onOpen, act, stopAll }: {
  w: OpsCopy; b: Buckets<Job>; all: Job[]; now: number; lang: "en" | "et"; onOpen: (id: string) => void; act: (id: string, a: string, body?: object) => Promise<boolean>; stopAll: boolean;
}) {
  const [shut, setShut] = useState<Set<string>>(new Set()); // the first working job starts open; he can fold any
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, a: string) => { setBusy(`${a}:${id}`); const ok = await act(id, a); setBusy(null); if (ok) toast({ id: `job:${id}`, text: a === "cancel" ? w.stopped : w.retrying }); };
  const nothing = !b.needs.length && !b.working.length && !b.queued.length && !b.failed.length;
  const tl = useMemo(() => lanes(all as OpsTask[], now, { stopAll }), [all, now, stopAll]);
  return (
    <>
      {b.needs.length > 0 && <Section id="ops-needs" title={w.sNeeds} count={b.needs.length}>
        <ul className="pu-list ops-cards">{b.needs.map((t) => (
          <Card key={t.id} as="li" tone="needs" title={t.title} sub={pendingLine(t, w)}
            actions={<Button size="sm" variant="primary" onClick={() => onOpen(t.id)}>{w.review}</Button>} />
        ))}</ul>
      </Section>}
      {b.working.length > 0 && <Section id="ops-working" title={w.sWorking} count={b.working.length}>
        <ul className="pu-list">{b.working.map((t, i) => {
          const expanded = opened.has(t.id) || (i === 0 && !shut.has(t.id));
          const toggle = () => { if (expanded) { setShut((s) => new Set(s).add(t.id)); setOpened((s) => { const n = new Set(s); n.delete(t.id); return n; }); } else { setOpened((s) => new Set(s).add(t.id)); setShut((s) => { const n = new Set(s); n.delete(t.id); return n; }); } };
          return <WorkingRow key={t.id} t={t} w={w} lang={lang} now={now} expanded={expanded} onToggle={toggle} onOpen={() => onOpen(t.id)}
            stop={<Button size="sm" variant="ghost" busy={busy === `cancel:${t.id}`} onClick={() => void run(t.id, "cancel")} aria-label={`${w.stop}: ${t.title}`}>{w.stop}</Button>} />;
        })}</ul>
      </Section>}
      {b.failed.length > 0 && <Section id="ops-failed" title={w.sFailed} count={b.failed.length}>
        <ul className="pu-list">{b.failed.slice(0, 5).map((t) => (
          <JobRow key={t.id} t={t} kind="failed" title={t.title} sub={errorLine(t, lang)} onOpen={() => onOpen(t.id)}
            action={canRetryTask((t.pending ?? []) as Pending[]) ? <Button size="sm" busy={busy === `retry:${t.id}`} onClick={() => void run(t.id, "retry")} aria-label={`${w.retry}: ${t.title}`}>{w.retry}</Button> : undefined} />
        ))}</ul>
      </Section>}
      {b.queued.length > 0 && <Section id="ops-queued" title={w.sQueued} count={b.queued.length}>
        <ul className="pu-list">{b.queued.map((t) => (
          <JobRow key={t.id} t={t} kind="queued" title={t.title} sub={stopAll ? w.held : w.waitingFor(dur(now - (Date.parse(t.created_at) || now), lang))} onOpen={() => onOpen(t.id)}
            action={<Button size="sm" variant="ghost" busy={busy === `cancel:${t.id}`} onClick={() => void run(t.id, "cancel")} aria-label={`${w.stop}: ${t.title}`}>{w.stop}</Button>} />
        ))}</ul>
      </Section>}
      {nothing && <Empty title={w.emptyNow} text={w.emptyNowText} />}
      {tl.lanes.length > 0 && <Timeline w={w} lang={lang} tl={tl} onOpen={onOpen} />}
    </>
  );
}

function pendingLine(t: Job, w: OpsCopy): string {
  const p = (t.pending ?? []).find((x) => x.status === "pending");
  const what = p ? String(p.input?.title ?? p.input?.name ?? p.tool.replace(/_/g, " ")) : "";
  return what ? `${w.waitsYou(t.agent[0].toUpperCase() + t.agent.slice(1))} · ${what}` : w.waitsYou(t.agent[0].toUpperCase() + t.agent.slice(1));
}

/** One list row: whole left part opens the job, one trailing action (never nested buttons). */
function JobRow({ t, kind, title, sub, onOpen, action, meta }: { t: Job; kind: Kind; title: string; sub?: string; onOpen: () => void; action?: ReactNode; meta?: string }) {
  return (
    <li className="ops-row" data-kind={kind}>
      <button type="button" className="ops-row-main" onClick={onOpen}>
        <span className="pu-dot" data-tone={TONE[kind]} aria-hidden="true" />
        <span className="ops-row-text"><span className="pu-row-title">{title}</span>{sub && <span className="pu-row-sub">{sub}</span>}</span>
        {meta && <span className="ops-row-meta pu-num">{meta}</span>}
        <span className="sr-only">{t.status}</span>
      </button>
      {action && <span className="ops-row-act">{action}</span>}
    </li>
  );
}

function WorkingRow({ t, w, lang, now, expanded, onToggle, onOpen, stop }: { t: Job; w: OpsCopy; lang: "en" | "et"; now: number; expanded: boolean; onToggle: () => void; onOpen: () => void; stop: ReactNode }) {
  const rows = stepRows(t, lang, now), cur = [...rows].reverse().find((r) => r.state === "done" || r.state === "failed");
  const share = ringShare(t), ran = took(t, now);
  const steps = rows.filter((r, i) => i === 0 || r.state !== rows[i - 1].state || r.label !== rows[i - 1].label); // same step twice in a row reads once
  const shown = steps.slice(-6);
  const left = leftText(minutesLeft(t.started_at, now, null), lang);
  const id = useId();
  return (
    <li className="ops-work" data-open={expanded ? "" : undefined}>
      <div className="ops-work-head">
        <button type="button" className="ops-disclose" aria-expanded={expanded} aria-controls={id} onClick={onToggle} aria-label={t.title}><IconChevron /></button>
        <button type="button" className="ops-row-main" onClick={onOpen}>
          <Ring share={share} kind="working" />
          <span className="ops-row-text">
            <span className="pu-row-title">{t.title}</span>
            <span className="pu-row-sub"><span className="pu-dot" data-tone="accent" data-live="" aria-hidden="true" /> {cur?.label ?? w.working}{left ? ` · ${left}` : ran !== null ? ` · ${w.since(dur(ran, lang))}` : ""}</span>
          </span>
        </button>
        <span className="ops-row-act">{stop}</span>
      </div>
      <div className="pu-bar ops-work-bar" aria-hidden="true"><i style={{ ["--p" as string]: String(share) }} /></div>
      {expanded && <ol className="ops-steps" id={id} aria-label={w.steps}>
        {shown.length < steps.length && <li data-state="next" className="ops-steps-more"><span /><span /><span className="ops-step-label">{w.earlierSteps(steps.length - shown.length)}</span></li>}
        {shown.map((r) => (
          <li key={r.n} data-state={r.state}>
            <span className="ops-step-mark" aria-hidden="true">{r.state === "done" ? <IconCheck /> : r.state === "failed" ? "✕" : null}</span>
            <span className="ops-step-time pu-num">{r.at ? clock(r.at, lang) : "–"}</span>
            <span className="ops-step-label">{r.label}</span>
            <span className="sr-only">{r.state === "done" ? w.stDone : r.state === "now" ? w.stNow : r.state === "failed" ? w.stFailed : w.stNext}</span>
          </li>
        ))}
      </ol>}
    </li>
  );
}

/* ---------- Today timeline: lanes with a now line ---------- */
function Timeline({ w, lang, tl, onOpen }: { w: OpsCopy; lang: "en" | "et"; tl: ReturnType<typeof lanes>; onOpen: (id: string) => void }) {
  return (
    <Section id="ops-today" title={w.timeline}>
      <figure className="ops-tl" aria-label={w.timelineLabel}>
        <div className="ops-tl-ticks" aria-hidden="true">{tl.ticks.map((x) => <span key={x.t} style={{ left: `${x.at * 100}%` }}>{clock(x.t, lang)}</span>)}</div>
        <div className="ops-tl-lanes" style={{ ["--n" as string]: tl.lanes.length }}>
          {tl.ticks.map((x) => <i key={x.t} className="ops-tl-grid" style={{ left: `${x.at * 100}%` }} aria-hidden="true" />)}
          {tl.lanes.map((l) => (
            <button key={l.id} type="button" className="ops-tl-bar" data-kind={l.kind} data-open={l.open ? "" : undefined} style={{ left: `${l.from * 100}%`, width: `${(l.to - l.from) * 100}%` }}
              onClick={() => onOpen(l.id)} title={l.title} aria-label={`${l.title}: ${({ working: w.working, needs: w.needsYou, queued: w.queued, failed: w.failed, done: w.done, stopped: w.stoppedK } as Record<Kind, string>)[l.kind]}`} />
          ))}
          <span className="ops-tl-now" style={{ left: `${tl.now * 100}%` }} aria-hidden="true"><b>{w.nowLine}</b></span>
        </div>
      </figure>
    </Section>
  );
}

/* ---------- Scheduled (routines) ---------- */
function Scheduled({ w, lang, onOpenTask, onEdit, onNew, paused }: { w: OpsCopy; lang: "en" | "et"; onOpenTask: (id: string) => void; onEdit: (r: Routine) => void; onNew: () => void; paused: boolean }) {
  const [list, setList] = useState<Routine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<{ automations: Routine[] }>("/api/automations").then((r) => { setList(r.automations ?? []); setFailed(false); }, () => setFailed(true)), []);
  useEffect(() => {
    if (paused) return;
    void load();
    const h = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => clearInterval(h);
  }, [load, paused]);
  const now = new Date();
  const once = useMemo(oneAtATime, []);
  const act = (a: Routine, what: "toggle" | "run" | "delete") => once(`${what}:${a.id}`, async () => {
    if (what === "delete" && !(await askConfirm(w.delConfirm(a.name)))) return;
    setBusy(`${what}:${a.id}`);
    try {
      if (what === "toggle") { const r = routineToggle(a); setList((l) => l?.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x)) ?? l); await post("/api/automations", r.body, r.method); uiSound(a.enabled ? "toggleOff" : "toggleOn"); }
      if (what === "run") { const q = routineRun(a), r = await post<{ task: string }>("/api/automations", q.body, q.method); toast({ text: `${w.ranNow}: ${a.name}`, action: { label: w.open, onClick: () => onOpenTask(r.task) } }); }
      if (what === "delete") { await api(`/api/automations?id=${encodeURIComponent(a.id)}`, { method: "DELETE" }); toast({ text: `${w.deleted}: ${a.name}` }); }
      await load();
    } catch (e) { toast({ tone: "error", text: plainApiError(e instanceof Error ? e.message : "", w.routineFailed) }); void load(); }
    finally { setBusy(null); }
  });
  if (failed && !list) return <ErrorState title={w.loadFailed} text={w.loadFailedText} retryLabel={w.tryAgain} onRetry={() => void load()} />;
  if (!list) return <Loading rows={3} label={w.loading} />;
  return (
    <Section id="ops-routines" title={w.sRoutines} count={list.length} action={<Button size="sm" variant="ghost" icon={<IconPlus />} onClick={onNew}>{w.newRoutine}</Button>}>
      {!list.length ? <Empty title={w.emptyRoutines} text={w.emptyRoutinesText} action={<Button size="sm" variant="primary" onClick={onNew}>{w.newRoutine}</Button>} />
        : <ul className="pu-list">{list.map((a) => {
          const next = nextRun(a, lang, now), last = a.last, lk = last ? kindOf(last) : null;
          return (
            <li key={a.id} className="ops-routine" data-off={a.enabled ? undefined : ""}>
              <button type="button" className="ops-row-main" onClick={() => onEdit(a)}>
                <span className="pu-dot" data-tone={!a.enabled ? undefined : lk === "failed" ? "bad" : "accent"} aria-hidden="true" />
                <span className="ops-row-text">
                  <span className="pu-row-title">{a.name}</span>
                  <span className="pu-row-sub">{triggerText(a, lang)}{a.enabled ? next ? ` · ${w.next(next)}` : "" : ` · ${w.paused}`}{last && lk === "failed" ? ` · ${w.failed}` : ""}</span>
                </span>
              </button>
              <span className="ops-row-act">
                <Button size="sm" variant="ghost" busy={busy === `run:${a.id}`} onClick={() => void act(a, "run")} aria-label={`${w.runNow}: ${a.name}`}>{w.runNow}</Button>
                <button type="button" role="switch" aria-checked={a.enabled} className="ops-switch" aria-label={`${a.enabled ? w.pause : w.resume}: ${a.name}`} onClick={() => void act(a, "toggle")} disabled={busy === `toggle:${a.id}`}><i /></button>
              </span>
            </li>
          );
        })}</ul>}
    </Section>
  );
}

/* ---------- History ---------- */
function History({ w, lang, items, now, onOpen }: { w: OpsCopy; lang: "en" | "et"; items: Job[]; now: number; onOpen: (id: string) => void }) {
  const [q, setQ] = useState(""), [f, setF] = useState<HistoryFilter>("all"), [limit, setLimit] = useState(20);
  const view = useMemo(() => historyView(items, q, f), [items, q, f]);
  const groups = useMemo(() => historyGroups(view.slice(0, limit), lang, now), [view, limit, lang, now]);
  const filters: [HistoryFilter, string][] = [["all", w.fAll], ["done", w.fDone], ["failed", w.fFailed], ["stopped", w.fStopped]];
  return (
    <>
      <div className="ops-hfilter">
        <input type="search" className="ops-search" placeholder={w.searchPh} aria-label={w.search} value={q} maxLength={120} onChange={(e) => { setQ(e.target.value); setLimit(20); }} />
        <div className="pu-chips" role="group" aria-label={w.tStatus}>{filters.map(([k, label]) => <Chip key={k} pressed={f === k} onClick={() => { setF(k); setLimit(20); }}>{label}</Chip>)}</div>
      </div>
      {!view.length ? <Empty title={items.length ? w.noMatch : w.emptyHistory} />
        : groups.map((g) => (
          <Section key={g.label} title={g.label} count={g.items.length}>
            <ul className="pu-list">{g.items.map((t) => {
              const k = kindOf(t);
              return <JobRow key={t.id} t={t} kind={k} title={t.title} onOpen={() => onOpen(t.id)} meta={clock(t.finished_at ?? t.created_at, lang)}
                sub={k === "failed" ? errorLine(t, lang) : `${t.agent[0].toUpperCase()}${t.agent.slice(1)} · ${k === "stopped" ? w.stoppedK : w.ran(dur(took(t, now), lang))}`} />;
            })}</ul>
          </Section>
        ))}
      {view.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + 30)}>{w.more}</Button>}
    </>
  );
}

/* ---------- one job ---------- */
function JobDetail({ id, w, onBack, openMemory, act, paused, stopAll, hostOff }: {
  id: string; w: OpsCopy; onBack: () => void; openMemory: (id: string) => void; act: (id: string, a: string, body?: object) => Promise<boolean>; paused: boolean; stopAll: boolean; hostOff: boolean;
}) {
  const { lang } = useT();
  const [data, setData] = useState<{ task: Job; children: Job[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLOListElement>(null), root = useRef<HTMLDivElement>(null);
  const load = useCallback(() => api<{ task: Job; children: Job[] }>(`/api/tasks/${encodeURIComponent(id)}`).then((d) => { setData(d); setMissing(false); }, () => setMissing(true)), [id]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const active = !!data && [data.task, ...data.children].some((x) => ["running", "queued", "awaiting_approval"].includes(x.status));
  useEffect(() => {
    if (!active || paused) return;
    const h = setInterval(() => { if (!document.hidden) void load(); }, 2500);
    return () => clearInterval(h);
  }, [active, paused, load]);
  const now = useNow(5000, active && !paused);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, [id]);
  useEffect(() => { const el = logRef.current; if (follow && el) el.scrollTop = el.scrollHeight; }, [data, follow]);
  useEffect(() => { // Esc goes back to the list (one Esc does one thing: the world stays open)
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".pu-sheet, .pu-menu") && root.current?.closest(".pu-shell")?.contains(document.activeElement)) { e.preventDefault(); onBack(); } };
    addEventListener("keydown", k, true); return () => removeEventListener("keydown", k, true);
  }, [onBack]);
  const doAct = async (target: string, a: string, body: object = {}, done?: string) => { setBusy(`${a}:${target}`); const ok = await act(target, a, body); if (ok) { await load(); if (done) toast({ id: `job:${target}`, text: done, tone: a === "approve" ? "done" : undefined }); } setBusy(null); };

  const back = <button type="button" className="ops-back" onClick={onBack}><IconBack />{w.back}</button>;
  if (missing && !data) return <div className="ops-detail" ref={root} tabIndex={-1}>{back}<ErrorState title={w.missing} text={w.missingText} retryLabel={w.tryAgain} onRetry={() => void load()} /></div>;
  if (!data) return <div className="ops-detail" ref={root} tabIndex={-1}>{back}<Loading rows={4} label={w.loading} /></div>;
  const { task, children } = data, all = [task, ...children];
  const k = kindOf(task, { stopAll, hostOffline: hostOff });
  const rows = stepRows(task, lang, now), log = logLines(task, lang), share = ringShare(task), ran = took(task, now);
  const verified = taskVerified(task.status, all.flatMap((x) => x.pending ?? []));
  const word = k === "done" ? (verified ? w.checked : w.done) : k === "working" ? (stopAll ? w.held : w.working) : k === "needs" ? w.needsYou : k === "queued" ? (stopAll ? w.held : w.queued) : k === "failed" ? w.failed : w.stoppedK;
  const evidence = all.flatMap((x) => (x.pending ?? []).flatMap((p) => p.evidence ?? []));
  const waiting = blockedBy(task, children);
  const failedSteps = all.filter((x) => x.status === "failed" || x.status === "cancelled");
  const wholeOk = canRetryTask(all.flatMap((x) => x.pending ?? []));
  const asking = all.filter((x) => (x.pending ?? []).some((p) => p.status === "pending") && !["done", "failed", "cancelled"].includes(x.status));
  const agentName = (s: string) => s[0].toUpperCase() + s.slice(1);
  return (
    <div className="ops-detail" ref={root} tabIndex={-1} aria-labelledby="ops-job-title">
      {back}
      <header className="ops-job-head">
        <div className="ops-job-text">
          <h3 className="ops-job-title" id="ops-job-title">{task.title}</h3>
          <p className="ops-job-meta"><span className="ops-badge" data-kind={k}>{word}</span> {w.by(agentName(task.agent))} · {w.startedAt(clock(task.started_at ?? task.created_at, lang))}{ran !== null ? ` · ${k === "working" ? w.running(dur(ran, lang)) : w.ran(dur(ran, lang))}` : ""}</p>
          {!!waiting.length && <p className="ops-job-meta" role="status">{w.blockedBy(waiting.map((x) => `${agentName(x.agent)} · ${x.title}`).join("; "))}</p>}
        </div>
        <div className="ops-job-ring"><Ring share={share} size={64} kind={k} label={w.ring(Math.round(share * 100))} /><span className="pu-num" aria-hidden="true">{Math.round(share * 100)}%</span></div>
      </header>
      <div className="ops-job-actions">
        {(k === "working" || k === "queued") && <Button variant="danger" size="sm" busy={busy === `cancel:${task.id}`} onClick={() => void doAct(task.id, "cancel", {}, w.stopped)}>{w.stop}</Button>}
        {(k === "failed" || k === "stopped") && wholeOk && !task.parent_id && <Button variant="primary" size="sm" busy={busy === `retry:${task.id}`} onClick={() => void doAct(task.id, "retry", {}, w.retrying)}>{w.retry}</Button>}
      </div>

      {asking.map((x) => <Approval key={x.id} t={x} w={w} busy={busy} onAct={(a) => void doAct(x.id, a, a === "approve" ? { seen: pendingSeen(x.pending) } : {}, a === "approve" ? w.approved : w.rejected)} />)}

      {task.result && <Section id="ops-result" title={w.result}><div className="ops-result"><Markdown text={task.result} openMemory={openMemory} /></div></Section>}
      {evidence.length > 0 && <Section id="ops-evidence" title={w.checkedTitle}><ul className="pu-list">{evidence.map((e, i) => (
        <li key={i} className="ops-row"><span className="ops-row-main" data-static=""><span className="pu-dot" data-tone="good" aria-hidden="true" /><span className="ops-row-text"><span className="pu-row-title">{e.kind === "file" ? e.path ?? e.id : e.kind}</span></span></span>
          <span className="ops-row-act">{e.kind === "memory" ? <Button size="sm" variant="ghost" onClick={() => openMemory(e.id)}>{w.openMemory}</Button>
            : e.kind === "file" ? <a className="pu-btn" data-variant="ghost" data-size="sm" href={`/api/workspace?ws=${encodeURIComponent(e.id)}&file=${encodeURIComponent(e.path ?? "")}&open=1`} target="_blank" rel="noopener noreferrer"><span>{w.openFile}</span></a> : null}</span></li>
      ))}</ul></Section>}

      {(task.error || failedSteps.length > 0) && (
        <Section id="ops-issues" title={w.issues}>
          <div className="pu-state" data-kind="error">
            <p className="pu-state-title">{errorLine(task.error ? task : failedSteps[0] ?? task, lang)}</p>
            {failedSteps.map((x) => <Recover key={x.id} t={x} w={w} wholeOk={wholeOk} label={x === task ? null : `${agentName(x.agent)} · ${x.title}`} busy={busy} onAct={(a, body) => void doAct(x.id, a, body, a === "abandon" ? w.stoppedK : w.retrying)} />)}
            <p className="pu-state-text">{w.recoverHint}</p>
          </div>
          {(task.status === "failed" || children.some((x) => x.status === "failed")) && <div className="ops-legacy"><FailureReport input={{ kind: children.length ? "mission" : "task", id: task.id, status: task.status, relatedIds: [task.parent_id ?? "", ...children.map((x) => x.id)],
            error: [task.error, ...children.map((x) => x.error)].filter(Boolean).join("\n") || null, trace: [...task.trace, ...children.flatMap((x) => x.trace)], request: task.request, answer: task.result ?? "" }} /></div>}
        </Section>
      )}

      {rows.length > 0 && <Section id="ops-steps" title={w.steps} count={rows.filter((r) => r.state === "done").length}>
        <table className="ops-table">
          <thead><tr><th scope="col">#</th><th scope="col">{w.colStep}</th><th scope="col">{w.colTime}</th><th scope="col">{w.colTook}</th><th scope="col">{w.colState}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.n} data-state={r.state}>
              <td className="pu-num">{r.n}</td><td>{r.label}</td><td className="pu-num">{r.at ? clock(r.at, lang, true) : "—"}</td><td className="pu-num">{dur(r.ms, lang)}</td>
              <td><span className="ops-state" data-state={r.state}>{r.state === "done" ? w.stDone : r.state === "now" ? w.stNow : r.state === "failed" ? w.stFailed : w.stNext}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>}

      <Section id="ops-log" title={w.log} action={<label className="ops-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {w.autoScroll}</label>}>
        {log.length ? <ol className="ops-log" ref={logRef} aria-live={k === "working" ? "polite" : "off"} tabIndex={0} aria-label={w.log}>
          {log.map((l, i) => <li key={i} data-level={l.level}><time className="pu-num">{l.at ? clock(l.at, lang, true) : "--:--:--"}</time><span>{l.text}</span></li>)}
        </ol> : <p className="pu-state-text">{w.noLog}</p>}
      </Section>

      {children.length > 0 && <Section id="ops-helpers" title={w.helpers} count={children.length}>
        <ul className="pu-list">{children.map((x) => {
          const ck = kindOf(x);
          return <JobRow key={x.id} t={x} kind={ck} title={`${agentName(x.agent)} · ${x.title}`} sub={ck === "failed" ? errorLine(x, lang) : x.result ? resultLine(x.result) : undefined} onOpen={() => {}}
            action={ck === "working" ? <Button size="sm" variant="ghost" busy={busy === `cancel:${x.id}`} onClick={() => void doAct(x.id, "cancel", {}, w.stopped)}>{w.stop}</Button> : undefined} />;
        })}</ul>
      </Section>}

      <details className="ops-more">
        <summary>{w.request}</summary>
        <p className="ops-request">{task.request}</p>
      </details>
      <div className="ops-job-tools">
        <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(copyReceipt(task as never, rowReceipt(task as never), location.origin)).then(() => toast({ text: w.copied }), () => {}); }}>{w.copyReceipt}</Button>
        <a className="pu-btn" data-variant="ghost" data-size="sm" href={`/api/tasks/${task.id}/trace`} download><span>{w.trace}</span></a>
        {k === "done" && !task.parent_id && !task.title.startsWith("Team: ") && <SaveRecipe t={task} w={w} />}
      </div>
    </div>
  );
}

function Approval({ t, w, busy, onAct }: { t: Job; w: OpsCopy; busy: string | null; onAct: (a: "approve" | "reject") => void }) {
  const ready = t.status === "awaiting_approval", who = t.agent[0].toUpperCase() + t.agent.slice(1);
  return (
    <Card tone="needs" title={ready ? w.waitsYou(who) : w.asksLater(who)}
      actions={ready ? <><Button size="sm" busy={busy === `reject:${t.id}`} onClick={() => onAct("reject")}>{w.reject}</Button><Button size="sm" variant="primary" busy={busy === `approve:${t.id}`} onClick={() => onAct("approve")}>{w.approve}</Button></> : undefined}>
      <ul className="ops-pending">{(t.pending ?? []).filter((p) => p.status === "pending").map((p, i) => (
        <li key={i}>
          <b>{String(p.input.title ?? p.input.name ?? p.tool.replace(/_/g, " "))}</b>
          {typeof p.input.content === "string" && <details><summary>{w.preview}</summary><p className="ops-request">{p.input.content.slice(0, 2000)}</p></details>}
          {typeof p.input.prompt === "string" && <details><summary>{w.whatItDoes}</summary><p className="ops-request">{p.input.prompt.slice(0, 2000)}</p></details>}
          {typeof p.input.request === "string" && <p className="ops-note">{p.input.request.slice(0, 300)}</p>}
        </li>
      ))}</ul>
      {!ready && <p className="pu-live" aria-live="polite">{w.stillWorking}</p>}
    </Card>
  );
}

function Recover({ t, w, wholeOk, label, busy, onAct }: { t: Job; w: OpsCopy; wholeOk: boolean; label: string | null; busy: string | null; onAct: (a: string, body?: object) => void }) {
  const [input, setInput] = useState<string | null>(null);
  const opts = recoveryOptions({ ...t, parent_id: t.parent_id ?? null }, t.pending ?? [], wholeOk);
  if (!opts.length) return null;
  const b = (a: string) => busy === `${a}:${t.id}`;
  return (
    <div className="ops-recover">
      {label && <p className="pu-row-title">{label}</p>}
      <div className="ops-btns">
        {opts.includes("retry_step") && <Button size="sm" busy={b("retry_step")} onClick={() => onAct("retry_step")}>{w.rStep}</Button>}
        {opts.includes("resume") && <Button size="sm" busy={b("resume")} onClick={() => onAct("resume")}>{w.rResume}</Button>}
        {opts.includes("replace_input") && input === null && <Button size="sm" onClick={() => setInput(t.request)}>{w.rReplace}</Button>}
        {opts.includes("abandon") && <Button size="sm" variant="ghost" busy={b("abandon")} onClick={() => onAct("abandon")}>{w.rAbandon}</Button>}
      </div>
      {input !== null && <form className="ops-form" onSubmit={(e) => { e.preventDefault(); onAct("replace_input", { request: input }); setInput(null); }}>
        <textarea className="ops-input" rows={4} aria-label={w.rReplace} value={input} maxLength={4000} onChange={(e) => setInput(e.target.value)} />
        <div className="ops-btns"><Button size="sm" onClick={() => setInput(null)}>{w.cancel}</Button><Button size="sm" type="submit" variant="primary" disabled={input.trim().length < 5}>{w.rRerun}</Button></div>
      </form>}
    </div>
  );
}

function SaveRecipe({ t, w }: { t: Job; w: OpsCopy }) {
  const [busy, setBusy] = useState(false);
  return <Button size="sm" variant="ghost" busy={busy} onClick={async () => {
    setBusy(true);
    try { await post("/api/recipes", { action: "add", name: t.title.replace(/^⚙\s*/, "").slice(0, 60), agent: t.agent, request: t.request }); toast({ tone: "done", text: w.recipeSaved }); }
    catch { toast({ tone: "error", text: w.actFailed }); } finally { setBusy(false); }
  }}>{w.saveRecipe}</Button>;
}

/* ---------- sheets ---------- */
function NewJob({ w, agents, projects, onStart }: { w: OpsCopy; agents: Agent[]; projects: Project[]; onStart: (r: string, x: { agent?: string; project_id?: string }) => Promise<void> }) {
  const [text, setText] = useState(""), [agent, setAgent] = useState("nova"), [proj, setProj] = useState(""), [busy, setBusy] = useState(false);
  return (
    <form className="ops-form" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; setBusy(true); await onStart(text.trim(), { agent, ...(proj ? { project_id: proj } : {}) }); setBusy(false); }}>
      <label className="ops-label">{w.jobWhat}<textarea className="ops-input" rows={5} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} /></label>
      <label className="ops-label">{w.jobWho}<select className="ops-input" value={agent} onChange={(e) => setAgent(e.target.value)}>
        {(agents.length ? agents : [{ slug: "nova", name: "Nova", tools: [] }]).filter((a) => a.enabled !== false).map((a) => <option key={a.slug} value={a.slug}>{a.slug === "nova" ? w.novaHint : a.name}</option>)}
      </select></label>
      <label className="ops-label">{w.jobProject}<select className="ops-input" value={proj} onChange={(e) => setProj(e.target.value)}>
        <option value="">{w.noProject}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <div className="ops-btns"><Button type="submit" variant="primary" busy={busy} disabled={!text.trim()}>{w.start}</Button></div>
    </form>
  );
}

const EMPTY: AutomationDraft = { name: "", when: "day", time: "09:00", weekday: 1, kind: "", agent: "nova", prompt: "" };
const TEMPLATES: { key: "weekly" | "docs" | "watch" | "ideas" | "biz"; d: Partial<AutomationDraft> & { prompt: string } }[] = [
  { key: "weekly", d: { when: "week", weekday: 0, time: "18:00", agent: "nova", prompt: "Review my projects and open tasks (list_tasks) and what I saved this week. Suggest my top 3 priorities for next week, with a reason for each." } },
  { key: "docs", d: { when: "memory", kind: "document", agent: "echo", prompt: "Summarize the document I just uploaded in 5 bullets, list its key facts and how it connects to my other memories. Propose saving the summary." } },
  { key: "watch", d: { when: "day", time: "08:00", agent: "sentinel", prompt: "Check the latest news on the Strait of Hormuz shipping attacks, the war in Ukraine and global markets. Report only significant changes since yesterday, rated High/Medium/Low, with sources." } },
  { key: "ideas", d: { when: "day", time: "17:00", agent: "forge", prompt: "Using today's news briefings in my memory, write 3 YouTube video ideas for a Roblox/gaming channel: title, hook, and why it's timely now. Cite the stories." } },
  { key: "biz", d: { ...BUSINESS_LOOP } }, // off until he saves it; every send stays his own approval click
];

function RoutineForm({ w, agents, routine, onDone }: { w: OpsCopy; agents: Agent[]; routine: Routine | null; onDone: () => void }) {
  const [d, setD] = useState<AutomationDraft>(() => (routine ? automationDraft(routine) : EMPTY));
  const [busy, setBusy] = useState<string | null>(null);
  const set = (p: Partial<AutomationDraft>) => setD((x) => ({ ...x, ...p }));
  const avail = agents.filter((a) => a.enabled !== false), chosen = avail.find((a) => a.slug === d.agent);
  const ok = !!d.name.trim() && d.prompt.trim().length >= 5 && (!agents.length || !!chosen);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (!ok || busy) return;
    setBusy("save");
    try { const r = routineSave(routine?.id ?? null, automationSpec(d)); await post("/api/automations", r.body, r.method); toast({ tone: "done", text: `${w.saved}: ${d.name}` }); onDone(); }
    catch (e2) { toast({ tone: "error", text: plainApiError(e2 instanceof Error ? e2.message : "", w.routineFailed) }); }
    finally { setBusy(null); }
  };
  const del = async () => {
    if (!routine || !(await askConfirm(w.delConfirm(routine.name)))) return;
    setBusy("del");
    try { await api(`/api/automations?id=${encodeURIComponent(routine.id)}`, { method: "DELETE" }); toast({ text: `${w.deleted}: ${routine.name}` }); onDone(); }
    catch { toast({ tone: "error", text: w.routineFailed }); } finally { setBusy(null); }
  };
  return (
    <form className="ops-form" onSubmit={save} aria-label={routine ? w.edit : w.newRoutine}>
      {!routine && <div className="ops-label"><span>{w.templates}</span><div className="pu-chips">{TEMPLATES.map((x) => <Chip key={x.key} onClick={() => setD({ ...EMPTY, ...x.d, name: w.tpl[x.key] })}>{w.tpl[x.key]}</Chip>)}</div></div>}
      <label className="ops-label">{w.fName}<input className="ops-input" required maxLength={100} value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <div className="ops-grid">
        <label className="ops-label">{w.fWhen}<select className="ops-input" value={d.when} onChange={(e) => set({ when: e.target.value as AutomationDraft["when"] })}>
          <option value="day">{w.wDay}</option><option value="week">{w.wWeek}</option><option value="hour">{w.wHour}</option><option value="memory">{w.wMemory}</option><option value="briefing">{w.wBriefing}</option>
        </select></label>
        {d.when === "week" && <label className="ops-label">{w.fDay}<select className="ops-input" value={d.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
          {OPS_COPY.en.days.map((_, i) => <option key={i} value={i}>{new Date(Date.UTC(2026, 10, 22 + i)).toLocaleDateString(w === OPS_COPY.et ? "et-EE" : "en-GB", { weekday: "long", timeZone: "UTC" })}</option>)}
        </select></label>}
        {(d.when === "day" || d.when === "week") && <label className="ops-label">{w.fTime}<input className="ops-input pu-num" type="time" required value={d.time} onChange={(e) => set({ time: e.target.value })} /></label>}
        {d.when === "hour" && <label className="ops-label">{w.fMinute}<input className="ops-input pu-num" type="number" min={0} max={59} required value={Number(d.time.split(":")[1])} onChange={(e) => set({ time: `00:${e.target.value.padStart(2, "0")}` })} /></label>}
        {d.when === "memory" && <label className="ops-label">{w.fKind}<select className="ops-input" value={d.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="">{w.anyKind}</option>{["document", "link", "note", "idea"].map((k) => <option key={k} value={k}>{w.kinds[k]}</option>)}
          {d.kind && !["document", "link", "note", "idea"].includes(d.kind) && <option value={d.kind}>{d.kind}</option>}
        </select></label>}
      </div>
      <label className="ops-label">{w.fWho}<select className="ops-input" value={d.agent} onChange={(e) => set({ agent: e.target.value })}>
        {!chosen && <option value={d.agent} disabled>{d.agent}</option>}
        {avail.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
      </select></label>
      {chosen && <p className="ops-note" role="status">{automationCapabilityHint(chosen, d.prompt)}</p>}
      <label className="ops-label">{w.fWhat}<textarea className="ops-input" rows={5} required minLength={5} maxLength={4000} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} /></label>
      <p className="ops-note">{w.fNote}</p>
      {!ok && (d.name || d.prompt) && <p className="ops-note" role="status">{w.nameNeeded}</p>}
      <div className="ops-btns">
        {routine && <Button variant="danger" size="sm" busy={busy === "del"} onClick={() => void del()}>{w.del}</Button>}
        <span style={{ flex: 1 }} />
        <Button type="submit" variant="primary" busy={busy === "save"} disabled={!ok}>{routine ? w.saveChanges : w.save}</Button>
      </div>
    </form>
  );
}

function Projects({ w, projects, current, onFilter, onChanged }: { w: OpsCopy; projects: Project[]; current: string; onFilter: (id: string) => void; onChanged: () => void }) {
  const [name, setName] = useState(""), [busy, setBusy] = useState(false);
  const change = async (p: Project, status: string) => { try { await post("/api/projects", { id: p.id, status }, "PATCH"); notifyProjectsChanged(); onChanged(); } catch { toast({ tone: "error", text: w.actFailed }); } };
  return (
    <div className="ops-form">
      <ul className="pu-list">
        <li className="ops-row"><button type="button" className="ops-row-main" aria-current={!current || undefined} onClick={() => onFilter("")}><span className="ops-row-text"><span className="pu-row-title">{w.allProjects}</span></span></button></li>
        {projects.map((p) => (
          <li key={p.id} className="ops-row">
            <button type="button" className="ops-row-main" aria-current={current === p.id || undefined} onClick={() => onFilter(p.id)}><span className="ops-row-text"><span className="pu-row-title">{p.name}</span></span></button>
            <span className="ops-row-act"><select className="ops-input ops-input-sm" value={p.status} aria-label={`${w.tStatus}: ${p.name}`} onChange={(e) => void change(p, e.target.value)}>
              <option value="active">{w.pActive}</option><option value="paused">{w.pPaused}</option><option value="done">{w.pDone}</option>
            </select></span>
          </li>
        ))}
      </ul>
      <form className="ops-inline" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; setBusy(true); try { await post("/api/projects", { name }); setName(""); notifyProjectsChanged(); onChanged(); } catch { toast({ tone: "error", text: w.actFailed }); } finally { setBusy(false); } }}>
        <input className="ops-input" placeholder={w.projNew} aria-label={w.projNew} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" busy={busy} disabled={!name.trim()}>{w.add}</Button>
      </form>
    </div>
  );
}

type Board = { candidates: Candidate[]; lastOk: string | null; lastError: string | null; busy: boolean; off: boolean };
function ScoutSheet({ w, onOpenTask }: { w: OpsCopy; onOpenTask: (id: string) => void }) {
  const { lang } = useT();
  const [b, setB] = useState<Board | null>(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState(""), [openKey, setOpenKey] = useState<string | null>(null);
  const load = useCallback(() => api<Board>("/api/scout").then((j) => { setB(j); setFailed(false); }, () => setFailed(true)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!b?.busy) return; const h = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => clearInterval(h); }, [b?.busy, load]);
  const send = async (body: object) => { const r = await post<{ taskId?: string }>("/api/scout", body); dispatchEvent(new CustomEvent(SCOUT_CHANGED)); return r; };
  const act = async (c: Candidate, action: string) => {
    setBusy(`${action}:${c.key}`);
    try { const r = await send({ action, key: c.key }); await load(); if (r.taskId && action === "prototype") onOpenTask(r.taskId); }
    catch { toast({ tone: "error", text: w.scoutFailed }); } finally { setBusy(""); }
  };
  const expand = (c: Candidate) => { const on = openKey !== c.key; setOpenKey(on ? c.key : null); if (on && c.status === "new") void send({ action: "open", key: c.key }).then(load, () => {}); };
  if (failed && !b) return <ErrorState title={w.scoutFailed} retryLabel={w.tryAgain} onRetry={() => void load()} />;
  if (!b) return <Loading rows={3} label={w.loading} />;
  const ready = b.candidates.filter((c) => c.ready), watch = b.candidates.filter((c) => !c.ready);
  const item = (c: Candidate) => (
    <li key={c.key} className="ops-scout" data-open={openKey === c.key ? "" : undefined}>
      <button type="button" className="ops-row-main" aria-expanded={openKey === c.key} onClick={() => expand(c)}>
        <span className="pu-dot" data-tone={c.status === "new" ? "accent" : undefined} aria-hidden="true" />
        <span className="ops-row-text"><span className="pu-row-title">{c.name}{c.status === "new" && <span className="ops-new">{w.scoutNew}</span>}</span><span className="pu-row-sub">{c.improves || c.areaLabel}</span></span>
        <span className="ops-row-meta pu-num">{c.score}</span>
      </button>
      {openKey === c.key && <div className="ops-scout-body">
        {c.why && <p className="ops-note">{c.why}</p>}
        <dl className="ops-dl"><dt>{w.scoutLicence}</dt><dd>{c.licenseLabel.slice(0, 80)}</dd><dt>{w.scoutSize}</dt><dd>{FIT_LABEL[c.fit]}{c.vramGb ? ` · ${c.vramGb} GB` : ""}</dd></dl>
        <div className="ops-btns">
          <a className="pu-btn" data-size="sm" href={/^https:\/\//i.test(c.url) ? c.url : "#"} target="_blank" rel="noreferrer noopener"><span>{w.scoutSource}</span></a>
          <Button size="sm" variant="ghost" busy={busy === `dismiss:${c.key}`} onClick={() => void act(c, "dismiss")}>{w.scoutDismiss}</Button>
          <span style={{ flex: 1 }} />
          {c.taskId ? <Button size="sm" onClick={() => onOpenTask(c.taskId!)}>{w.scoutTrying}</Button>
            : c.ready && <Button size="sm" variant="primary" title={w.scoutTryHelp} busy={busy === `prototype:${c.key}`} onClick={() => void act(c, "prototype")}>{w.scoutTry}</Button>}
        </div>
      </div>}
    </li>
  );
  return (
    <div className="ops-form">
      <p className="ops-note">{w.scoutIntro}</p>
      {b.off && <p className="pu-state-text">{w.scoutOff}</p>}
      <div className="ops-inline">
        <Button size="sm" busy={busy === "run" || b.busy} disabled={b.off} onClick={async () => { setBusy("run"); try { await send({ action: "run" }); setTimeout(() => void load(), 800); } catch { toast({ tone: "error", text: w.scoutFailed }); } finally { setBusy(""); } }}>{b.busy ? w.scoutChecking : w.scoutCheck}</Button>
        <span className="pu-row-sub">{w.scoutLast(b.lastOk ? `${new Date(b.lastOk).toLocaleDateString(lang === "et" ? "et-EE" : "en-GB", { day: "numeric", month: "short" })} ${clock(b.lastOk, lang)}` : w.scoutNever)}</span>
      </div>
      {b.lastError && <p className="pu-state-text" role="alert">{w.scoutFailed}</p>}
      {!b.candidates.length && <Empty title={w.scoutEmpty} text={w.scoutEmptyText} />}
      {ready.length > 0 && <Section title={w.scoutReady} count={ready.length}><ul className="pu-list">{ready.map(item)}</ul></Section>}
      {watch.length > 0 && <Section title={w.scoutWatch} count={watch.length}><ul className="pu-list">{watch.map(item)}</ul></Section>}
    </div>
  );
}
