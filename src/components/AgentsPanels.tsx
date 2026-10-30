"use client";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ProposalsPanel } from "./ProposalsPanel";
import { OrbitLog } from "./OrbitLog";
import { useWorldPaused } from "./world-paused";
import { highlight } from "./Highlight";
import { ActivityView } from "./ActivityView";
import { ResultEvidence } from "./ResultEvidence";
import { AutomationFields } from "./AutomationFields";
import { RulesView } from "./RulesView";
import { automationDraft, automationSpec as toSpec, type AutomationAgent, type AutomationDraft as Draft } from "@/lib/automation-edit-pure";
import type { AutomationSpec } from "@/lib/pure";
import type { WriteEvidence } from "@/lib/completion-pure";
import { canRetryTask, doneLabel, taskVerified } from "@/lib/completion-pure";
import { useT } from "./i18n";
import { FailureReport } from "./FailureReport";
import { OpsStatus } from "./OpsStatus";
import { lastProgress } from "@/lib/ops-status-pure";
import { blockedBy, recoveryOptions } from "@/lib/tasks-recovery-pure";
import { groupTasks } from "@/lib/ops-tasks-pure";
import { PREVIEW_TZ, graceMinutes, lastWith, nextOccurrences } from "@/lib/automation-preview-pure";

type Step = { step: string; detail: string; ms: number; ok: boolean };
type Pending = { tool: string; input: Record<string, unknown>; status: string; note?: string; evidence?: WriteEvidence[] };
export type Task = {
  id: string; parent_id: string | null; project_id: string | null; agent: string; title: string; request: string;
  status: "queued" | "running" | "awaiting_approval" | "done" | "failed" | "cancelled";
  result: string | null; error: string | null; trace: Step[]; pending: Pending[];
  created_at: string; started_at: string | null; finished_at: string | null;
};
type Project = { id: string; name: string; description: string; status: string };
type Agent = {
  slug: string; name: string; role: string; instructions: string; tools: string[]; builtin: boolean; color: string;
  stats: { running: number; done: number; failed: number; calls: number; tokens: number };
};
type ToolInfo = { name: string; description: string; approval: boolean };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
/** The shared status badge (ops-status-pure) for one task, with its last progress time. */
const TaskStatus = ({ t, label }: { t: Pick<Task, "status" | "pending" | "created_at" | "started_at" | "finished_at">; label?: string }) =>
  <OpsStatus raw={t.status} pending={t.pending} at={lastProgress(t.finished_at, t.started_at, t.created_at)} label={label} />;
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

/* ---------- small Markdown renderer for agent output ---------- */

function inline(text: string, openMemory?: (id: string) => void, memLabel = "memory"): ReactNode[] {
  return text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[m:[0-9a-f-]{36}\]|\*\*[^*]+\*\*|`[^`]+`)/gi).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} className="link" href={safeHref(link[2])} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    const mem = part.match(/^\[m:([0-9a-f-]{36})\]$/i);
    if (mem) return <button key={i} className="chip" onClick={() => openMemory?.(mem[1])}>{memLabel}</button>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="hl-strong">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-black/40 px-1">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{highlight(part, i)}</Fragment>;
  });
}

export function Markdown({ text, openMemory }: { text: string; openMemory?: (id: string) => void }) {
  const mem = useT().t("ops.memory");
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t.trim().startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      out.push(<pre key={i} className="overflow-x-auto rounded-lg bg-black/50 p-3 text-xs"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const s = t.trim();
    if (!s) continue;
    if (/^\|.*\|$/.test(s)) { out.push(<p key={i} className="font-mono text-xs">{s}</p>); continue; }
    if (s.startsWith("### ")) out.push(<h4 key={i} className="mt-3 font-semibold">{inline(s.slice(4), openMemory, mem)}</h4>);
    else if (s.startsWith("## ") || s.startsWith("# ")) out.push(<h3 key={i} className="h3 mt-4">{s.replace(/^#+\s/, "")}</h3>);
    else if (/^([-*]|\d+\.)\s/.test(s)) out.push(<p key={i} className="pl-4">• {inline(s.replace(/^([-*]|\d+\.)\s/, ""), openMemory, mem)}</p>);
    else out.push(<p key={i}>{inline(s, openMemory, mem)}</p>);
  }
  return <div className="space-y-2 text-sm leading-relaxed">{out}</div>;
}

/* ---------- task detail ---------- */

// ready: the server only accepts a decision once the task is "awaiting_approval"; while the agent still runs, actions queue up.
function Approval({ pending, who, ready, onAct }: { pending: Pending[]; who: string; ready: boolean; onAct: (action: "approve" | "reject") => void }) {
  const { t } = useT();
  return (
    <div className="card space-y-2 text-sm" style={{ borderColor: "#fbbf24" }}>
      <b>{t(ready ? "approval.waiting" : "approval.later", { who })}</b>
      {pending.filter((p) => p.status === "pending").map((p, i) => (
        <div key={i} className="text-xs">
          <b>{p.tool.replace(/_/g, " ")}</b>: {String(p.input.title ?? p.input.name ?? "")}
          {typeof p.input.content === "string" && <details><summary className="cursor-pointer muted">{t("approval.preview")}</summary><p className="whitespace-pre-wrap">{p.input.content.slice(0, 2000)}</p></details>}
          {typeof p.input.prompt === "string" && <details><summary className="cursor-pointer muted">{t("approval.what")}</summary><p className="whitespace-pre-wrap">{p.input.prompt.slice(0, 2000)}</p></details>}
          {typeof p.input.request === "string" && <p className="muted">{p.input.request.slice(0, 300)} → {String(p.input.agent ?? "nova")}</p>}
        </div>
      ))}
      {ready ? <div className="flex gap-2"><button className="btn" onClick={() => onAct("approve")}>{t("common.approve")}</button><button className="btn danger" onClick={() => onAct("reject")}>{t("common.reject")}</button></div>
        : <p className="muted text-xs" aria-live="polite">{t("approval.working")}</p>}
    </div>
  );
}

/** A finished root task → a named recipe (same agent + request), re-runnable from Agents Station → Recipes. */
function SaveRecipe({ task }: { task: Task }) {
  const { t } = useT();
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    try { await api("/api/recipes", { method: "POST", body: JSON.stringify({ action: "add", name, agent: task.agent, request: task.request }) }); setName(null); setMsg({ ok: true, text: "Saved. Run it from Agents → Recipes or say “run recipe " + name + "”." }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save" }); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {name === null ? <button type="button" className="chip" onClick={() => { setMsg(null); setName(task.title.replace(/^⚙\s*/, "").slice(0, 60)); }}>{t("task.saveRecipe")}</button> : (
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input className="field" aria-label={t("task.recipeName")} maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} />
          <button className="chip" disabled={!name.trim()}>{t("habit.save")}</button>
          <button type="button" className="chip" onClick={() => setName(null)}>{t("common.cancel")}</button>
        </form>)}
      {msg && <span className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
    </div>
  );
}

function TaskView({ id, onBack, openMemory }: { id: string; onBack: () => void; openMemory: (id: string) => void }) {
  const { t } = useT();
  const [data, setData] = useState<{ task: Task; children: Task[] } | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ task: Task; children: Task[] }>(`/api/tasks/${id}`).then(setData).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  // Live progress: poll while the task (or any sub-task) is still working.
  const active = !!data && [data.task, ...data.children].some((t) => t.status === "running" || t.status === "queued");
  const paused = useWorldPaused(); // inside a kept-but-hidden world: no polling
  useEffect(() => {
    if (!active || paused) return;
    const h = setInterval(() => { if (!document.hidden) void load(); }, 2500);
    return () => clearInterval(h);
  }, [active, paused, load]);

  async function act(action: string, target = id, body: object = {}) {
    setErr("");
    try { await api(`/api/tasks/${target}`, { method: "POST", body: JSON.stringify({ ...body, action }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : t("common.failed")); }
  }

  if (!data) return err ? <div role="alert" className="space-y-2"><p>{t("link.missingTask")}</p><p className="muted text-[12px]">{err}</p><button className="chip" onClick={onBack}>{t("link.back")}</button></div>
    : <p className="muted">{t("common.loading")}</p>; // a deleted or mistyped link: say so, never a blank
  const { task, children } = data;
  const all = [task, ...children];
  const stLabel = doneLabel(taskVerified(task.status, all.flatMap((x) => x.pending))); // executed ≠ verified
  const evidence = all.flatMap((x) => x.pending.flatMap((p) => p.evidence ?? []));
  const waiting = blockedBy(task, children);
  const unresolved = all.flatMap((x) => x.pending.filter((p) => ["failed", "uncertain", "rejected", "attempting"].includes(p.status)).map((p) => ({ who: x.agent, p })));
  const failedSteps = all.filter((x) => x.status === "failed" || x.status === "cancelled");
  const wholeOk = canRetryTask(all.flatMap((x) => x.pending));
  // OPS06: deliverables first (result, checked records, unresolved issues + recovery); request, delegation and trace collapsed below.
  return (
    <div className="space-y-3">
      <button className="link" onClick={onBack}>{t("task.back")}</button>
      <div>
        <div className="font-medium">{task.title}</div>
        <div className="text-xs"><TaskStatus t={task} label={stLabel} /><span className="muted"> · {task.agent} · {when(task.created_at)}</span></div>
        {!!waiting.length && <p className="text-xs" role="status">{t("task.blockedBy", { list: waiting.map((c) => `${c.agent} · ${c.title} (${c.status.replace("_", " ")})`).join("; ") })}</p>}
      </div>

      {task.pending.some((p) => p.status === "pending") && task.status !== "done" && task.status !== "failed" && task.status !== "cancelled" && <Approval pending={task.pending} who={task.agent} ready={task.status === "awaiting_approval"} onAct={(a) => act(a)} />}
      {children.filter((c) => c.pending.some((p) => p.status === "pending") && c.status !== "done" && c.status !== "failed" && c.status !== "cancelled").map((c) => (
        <Approval key={c.id} pending={c.pending} who={c.agent} ready={c.status === "awaiting_approval"} onAct={(a) => act(a, c.id)} />
      ))}

      {task.result && <div className="card"><Markdown text={task.result} openMemory={openMemory} /></div>}
      <ResultEvidence items={evidence} openMemory={openMemory} />

      {(task.error || unresolved.length > 0 || failedSteps.length > 0) && (
        <section className="card space-y-2 text-sm" aria-label={t("task.issues")} style={{ borderColor: "#f43f5e" }}>
          <b>{t("task.issues")}</b>
          {task.error && <p className="error">{task.error}</p>}
          {!!unresolved.length && <ul className="text-xs">{unresolved.map(({ who, p }, i) => <li key={i}><b>{who}</b> · {p.tool.replace(/_/g, " ")}: {p.status}{p.note ? ` — ${p.note}` : ""}</li>)}</ul>}
          {failedSteps.map((x) => <Recover key={x.id} task={x} wholeOk={wholeOk} label={x === task ? null : `${x.agent} · ${x.title}`} onAct={(a, body) => act(a, x.id, body)} />)}
          {(task.status === "failed" || children.some((c) => c.status === "failed")) && (
            <FailureReport input={{ kind: children.length ? "mission" : "task", id: task.id, status: task.status, relatedIds: [task.parent_id ?? "", ...children.map((c) => c.id)],
              error: [task.error, ...children.map((c) => c.error)].filter(Boolean).join("\n") || null,
              trace: [...task.trace, ...children.flatMap((c) => c.trace)], request: task.request, answer: task.result ?? "" }} />
          )}
        </section>
      )}
      {(task.status === "queued" || task.status === "running") && <button className="chip" onClick={() => act("cancel")}>{t("task.cancel")}</button>}
      {task.status === "done" && !task.parent_id && !task.title.startsWith("Team: ") && <SaveRecipe task={task} />}

      <details className="card text-sm"><summary className="cursor-pointer muted">{t("task.request")}</summary><p className="mt-2 whitespace-pre-wrap">{task.request}</p></details>
      {task.pending.some((p) => p.status === "approved") && (
        <details className="text-xs"><summary className="cursor-pointer muted">{t("task.actions")}</summary>
          <ul className="muted mt-1">{task.pending.filter((p) => p.status === "approved").map((p, i) => <li key={i}>{p.tool}: {p.status}{p.note ? ` — ${p.note}` : ""}</li>)}</ul>
        </details>
      )}
      {!!children.length && (
        <details open={children.some((c) => c.status === "running" || c.status === "awaiting_approval")}>
          <summary className="cursor-pointer h3">{t("task.delegated")} ({children.length})</summary>
          <ul className="mt-1 space-y-2">
            {children.map((c) => (
              <li key={c.id} className="card text-sm">
                <div><b>{c.agent}</b> · {c.title} · <TaskStatus t={c} label={doneLabel(taskVerified(c.status, c.pending))} />
                  {c.status === "running" && <button className="chip ml-2" onClick={() => act("cancel", c.id)}>{t("common.cancel")}</button>}</div>
                {c.result && <details className="mt-1"><summary className="cursor-pointer muted text-xs">{t("task.result")}</summary><div className="mt-2"><Markdown text={c.result} openMemory={openMemory} /></div></details>}
                {c.error && <p className="error">{c.error}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details open={task.status === "running"} className="text-xs">
        <summary className="cursor-pointer muted">{t("task.trace", { n: task.trace.length })}</summary>
        <ul className="mt-1 space-y-0.5">{task.trace.map((s, n) => <li key={n}>{s.ok ? "✓" : "✗"} <b>{s.step}</b> · {s.ms}ms · <span className="muted">{s.detail}</span></li>)}</ul>
      </details>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** OPS04: recovery at one failed task / chain step. Evidence (result, receipts, trace) is never cleared by these. */
function Recover({ task, wholeOk, label, onAct }: { task: Task; wholeOk: boolean; label: string | null; onAct: (a: string, body?: object) => void }) {
  const { t } = useT();
  const [input, setInput] = useState<string | null>(null);
  const opts = recoveryOptions(task, task.pending, wholeOk);
  if (!opts.length) return task.parent_id ? null : <p className="muted text-xs">{t("task.noRetry")}</p>;
  return (
    <div className="space-y-1.5 text-xs">
      {label && <b>{label}</b>}
      <div className="flex flex-wrap gap-1.5">
        {opts.includes("retry_step") && <button className="chip" onClick={() => onAct("retry_step")}>{t("task.retryStep")}</button>}
        {opts.includes("resume") && <button className="chip" onClick={() => onAct("resume")}>{t("task.resume")}</button>}
        {opts.includes("replace_input") && input === null && <><button className="chip" onClick={() => onAct("retry")}>{t("task.retry")}</button><button className="chip" onClick={() => setInput(task.request)}>{t("task.replaceInput")}</button></>}
        {opts.includes("abandon") && <button className="chip" onClick={() => onAct("abandon")}>{t("task.abandon")}</button>}
      </div>
      {input !== null && <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); onAct("replace_input", { request: input }); setInput(null); }}>
        <textarea className="field w-full" rows={4} aria-label={t("task.replaceInput")} value={input} maxLength={4000} onChange={(e) => setInput(e.target.value)} />
        <div className="flex gap-1.5"><button className="chip" disabled={input.trim().length < 5}>{t("task.rerun")}</button><button type="button" className="chip" onClick={() => setInput(null)}>{t("common.cancel")}</button></div>
      </form>}
      <p className="muted">{t("task.recoverHint")}</p>
    </div>
  );
}

/* ---------- OPERATIONS: tasks + projects ---------- */

export function OperationsPanel({ focusTask, onOpen, openMemory }: { focusTask: string | null; onOpen?: (id: string | null) => void; openMemory: (id: string) => void }) {
  const { t: tr } = useT();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState<string | null>(focusTask);
  const [form, setForm] = useState({ request: "", agent: "nova", project_id: "" });
  const [newProject, setNewProject] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [tab, setTab] = useState<"tasks" | "automations" | "rules" | "activity">("tasks");
  const [shown, setShown] = useState<Record<string, number>>({});
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    // Each list loads on its own: a failing projects/agents call must not hide the tasks.
    const fail = (e: unknown) => setErr(e instanceof Error ? e.message : "Could not load");
    await Promise.all([
      api<{ tasks: Task[] }>(`/api/tasks${filter ? `?project=${filter}` : ""}`).then((r) => setTasks(r.tasks ?? []), fail),
      api<{ projects: Project[] }>("/api/projects").then((r) => setProjects(r.projects ?? []), fail),
      api<{ agents: Agent[] }>("/api/agents").then((r) => setAgents(r.agents ?? []), fail),
    ]);
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setOpen(focusTask); }, [focusTask]); // Back to a link without the task closes it
  useEffect(() => { onOpen?.(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- the open task is the URL's record
  const active = tasks.some((t) => t.status === "running" || t.status === "queued");
  const paused = useWorldPaused();
  useEffect(() => {
    if (!active || open || paused) return;
    const h = setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => clearInterval(h);
  }, [active, open, paused, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const { task } = await api<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, request: "" }); setOpen(task.id);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not create"); }
  }
  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProject.trim()) return;
    try { await api("/api/projects", { method: "POST", body: JSON.stringify({ name: newProject }) }); setNewProject(""); void load(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not create"); }
  }
  async function setProjectStatus(p: Project, status: string) {
    try { await api("/api/projects", { method: "PATCH", body: JSON.stringify({ id: p.id, status }) }); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
  }

  const groups = groupTasks(tasks);
  if (open) return <TaskView id={open} onBack={() => { setOpen(null); void load(); }} openMemory={openMemory} />;

  const tabs = (
    <div className="flex gap-1.5" role="tablist">
      {(["tasks", "automations", "rules", "activity"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className="chip" style={tab === t ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setTab(t)}>
          {tr(`ops.tab.${t}`)}
        </button>
      ))}
    </div>
  );
  if (tab === "activity") return <div className="space-y-4">{tabs}<ActivityView onOpenTask={setOpen} /></div>;
  if (tab === "rules") return <div className="space-y-4">{tabs}<RulesView onOpenTask={setOpen} /></div>;
  if (tab === "automations") return <div className="space-y-4">{tabs}<AutomationsView agents={agents} onOpenTask={setOpen} /></div>;

  return (
    <div className="space-y-5">
      {tabs}
      <form onSubmit={create} className="space-y-2">
        <h3 className="h3">{tr("ops.newTask")}</h3>
        <textarea className="field h-20 w-full" value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })}
          placeholder={tr("ops.taskPh")} aria-label={tr("ops.task")} maxLength={8000} />
        <div className="flex flex-wrap gap-2">
          <select className="field" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })} aria-label={tr("ops.agent")}>
            {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}{a.slug === "nova" ? tr("ops.novaHint") : ""}</option>)}
          </select>
          <select className="field" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} aria-label={tr("ops.project")}>
            <option value="">{tr("ops.noProject")}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn" disabled={!form.request.trim()}>{tr("life.start")}</button>
        </div>
        {err && <p className="error">{err}</p>}
      </form>

      <div>
        <div className="flex items-center justify-between"><h3 className="h3">{tr("ops.projects")}</h3></div>
        <ul className="mt-2 space-y-1.5 text-sm">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <button className={`text-left ${filter === p.id ? "link" : ""}`} onClick={() => setFilter(filter === p.id ? "" : p.id)}>{p.name} <span className="muted text-xs">· {tr(`ops.status.${p.status}` as "ops.status.active")}</span></button>
              <select className="field py-0.5 text-xs" value={p.status} onChange={(e) => setProjectStatus(p, e.target.value)} aria-label={tr("ops.statusOf", { name: p.name })}>
                <option value="active">{tr("ops.status.active")}</option><option value="paused">{tr("ops.status.paused")}</option><option value="done">{tr("ops.status.done")}</option>
              </select>
            </li>
          ))}
        </ul>
        <form onSubmit={addProject} className="mt-2 flex gap-2">
          <input className="field flex-1" value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder={tr("ops.newProjectPh")} aria-label={tr("ops.newProject")} maxLength={120} />
          <button className="chip">{tr("common.add")}</button>
        </form>
      </div>

      <div>
        <h3 className="h3">{tr(filter ? "ops.tasksIn" : "ops.tasks")}</h3>
        {(["attention", "active", "done"] as const).map((k) => groups[k].length > 0 && (
          <div key={k} className="mt-3">
            <h4 className="muted text-xs uppercase">{tr(`ops.group.${k}`)} · {groups[k].length}</h4>
            <ul className="mt-1.5 space-y-2">
              {groups[k].slice(0, shown[k] ?? 10).map((t) => (
                <li key={t.id}>
                  <button className="card w-full text-left" onClick={() => setOpen(t.id)}>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs"><TaskStatus t={t} /><span className="muted"> · {t.agent} · {when(t.created_at)}</span></div>
                  </button>
                </li>
              ))}
            </ul>
            {groups[k].length > (shown[k] ?? 10) && <button className="chip mt-1.5" onClick={() => setShown({ ...shown, [k]: (shown[k] ?? 10) + 20 })}>{tr("ops.showMore")}</button>}
          </div>
        ))}
        {!tasks.length && <p className="muted mt-2 text-sm">{tr("ops.noTasks")}</p>}
      </div>
    </div>
  );
}

/* ---------- AGENTS: the workforce ---------- */

export function AgentsPanel({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { t: tr } = useT();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ask, setAsk] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", role: "", instructions: "", tools: [] as string[] });
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { const r = await api<{ agents: Agent[]; tools: ToolInfo[] }>("/api/agents"); setAgents(r.agents); setTools(r.tools); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  const paused = useWorldPaused();
  useEffect(() => { if (paused) return; void load(); const h = setInterval(() => void load(), 5000); return () => clearInterval(h); }, [load, paused]);
  useEffect(() => {
    if (!sel) return;
    api<{ tasks: Task[] }>(`/api/tasks?agent=${sel}`).then((r) => setTasks(r.tasks)).catch((e) => setErr(e.message));
  }, [sel]);

  async function give(e: React.FormEvent) {
    e.preventDefault();
    if (!sel || !ask.trim()) return;
    try { const { task } = await api<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify({ request: ask, agent: sel }) }); setAsk(""); onOpenTask(task.id); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not create"); }
  }
  async function createAgent(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try { await api("/api/agents", { method: "POST", body: JSON.stringify(draft) }); setCreating(false); setDraft({ name: "", role: "", instructions: "", tools: [] }); void load(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not create"); }
  }
  async function removeAgent(slug: string) {
    if (!confirm(tr("agents.removeConfirm"))) return;
    try { await api(`/api/agents?slug=${slug}`, { method: "DELETE" }); setSel(null); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not remove"); }
  }

  const agent = agents.find((a) => a.slug === sel);
  if (agent) {
    return (
      <div className="space-y-3">
        <button className="link" onClick={() => setSel(null)}>{tr("agents.all")}</button>
        <div><b style={{ color: agent.color }}>{agent.name}</b> <span className="muted text-sm">· {agent.role}</span></div>
        <p className="muted text-xs">{tr("agents.toolsLine", { tools: agent.tools.join(", ") || tr("agents.none"), calls: agent.stats.calls, tokens: agent.stats.tokens.toLocaleString() })}</p>
        <details className="text-xs"><summary className="cursor-pointer muted">{tr("agents.instructions")}</summary><p className="mt-1 whitespace-pre-wrap">{agent.instructions}</p></details>
        <form onSubmit={give} className="flex gap-2">
          <input className="field flex-1" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={tr("agents.givePh", { name: agent.name })} aria-label={tr("agents.taskFor", { name: agent.name })} maxLength={8000} />
          <button className="btn" disabled={!ask.trim()}>{tr("life.start")}</button>
        </form>
        {!agent.builtin && <button className="chip" onClick={() => removeAgent(agent.slug)}>{tr("agents.remove")}</button>}
        <h3 className="h3">{tr("agents.history")}</h3>
        <ul className="space-y-1.5 text-sm">
          {tasks.map((t) => (
            <li key={t.id}><button className="text-left" onClick={() => onOpenTask(t.id)}>{t.title} <span className="text-xs">· <TaskStatus t={t} /></span> <span className="muted text-xs">· {when(t.created_at)}</span></button></li>
          ))}
          {!tasks.length && <li className="muted">{tr("agents.noTasks")}</li>}
        </ul>
        {err && <p className="error">{err}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="muted text-sm">{tr("agents.intro")}</p>
      <ProposalsPanel onOpenTask={onOpenTask} />
      <ul className="grid gap-2 sm:grid-cols-2">
        {agents.map((a) => (
          <li key={a.slug}>
            <button className="card h-full w-full text-left" onClick={() => setSel(a.slug)} style={{ borderColor: a.stats.running ? a.color : undefined }}>
              <div className="flex items-center justify-between">
                <b style={{ color: a.color }}>{a.name}</b>
                <span className="text-xs" style={{ color: a.stats.running ? "var(--cyan)" : "var(--muted)" }}>{tr(a.stats.running ? "agents.working" : "agents.idle")}</span>
              </div>
              <div className="muted text-xs">{a.role}</div>
              <div className="muted mt-1 text-[11px]">{tr("agents.stats", { done: a.stats.done, failed: a.stats.failed, tokens: a.stats.tokens.toLocaleString() })}</div>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted text-xs">{tr("agents.flow")}</p>
      <OrbitLog />

      {creating ? (
        <form onSubmit={createAgent} className="card space-y-2">
          <h3 className="h3">{tr("agents.new")}</h3>
          <input className="field w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={tr("agents.namePh")} aria-label={tr("agents.name")} maxLength={60} />
          <input className="field w-full" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder={tr("agents.rolePh")} aria-label={tr("agents.role")} maxLength={200} />
          <textarea className="field h-28 w-full" value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} placeholder={tr("agents.instrPh")} aria-label={tr("agents.instructions")} maxLength={8000} />
          <fieldset className="space-y-1 text-xs">
            <legend className="muted">{tr("agents.allowed")}</legend>
            {tools.map((t) => (
              <label key={t.name} className="flex items-start gap-2">
                <input type="checkbox" checked={draft.tools.includes(t.name)}
                  onChange={(e) => setDraft({ ...draft, tools: e.target.checked ? [...draft.tools, t.name] : draft.tools.filter((x) => x !== t.name) })} />
                <span><b>{t.name}</b>{t.approval ? tr("agents.asks") : ""} — <span className="muted">{t.description}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2"><button className="btn">{tr("agents.create")}</button><button type="button" className="chip" onClick={() => setCreating(false)}>{tr("common.cancel")}</button></div>
        </form>
      ) : (
        <button className="chip" onClick={() => setCreating(true)}>{tr("agents.createCustom")}</button>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

/* ---------- Automation Studio ---------- */

type Run = { id: string; status: Task["status"]; created_at: string; error: string | null };
type Automation = AutomationSpec & {
  id: string; enabled: boolean; when: string;
  run_count: number; last: Run | null; runs: Run[];
};

const TEMPLATES: (Partial<Draft> & { name: string; prompt: string })[] = [
  { name: "Weekly project review", when: "week", weekday: 0, time: "18:00", agent: "nova",
    prompt: "Review my projects and open tasks (list_tasks) and what I saved this week. Suggest my top 3 priorities for next week, with a reason for each." },
  { name: "Summarize new documents", when: "memory", kind: "document", agent: "echo",
    prompt: "Summarize the document I just uploaded in 5 bullets, list its key facts and how it connects to my other memories. Propose saving the summary." },
  { name: "Morning world watch", when: "day", time: "08:00", agent: "sentinel",
    prompt: "Check the latest news on the Strait of Hormuz shipping attacks, the war in Ukraine and global markets. Report only significant changes since yesterday, rated High/Medium/Low, with sources." },
  { name: "Daily YouTube ideas", when: "day", time: "17:00", agent: "forge",
    prompt: "Using today's news briefings in my memory, write 3 YouTube video ideas for a Roblox/gaming channel: title, hook, and why it's timely now. Cite the stories." },
];
const EMPTY: Draft = { name: "", when: "day", time: "09:00", weekday: 1, kind: "", agent: "nova", prompt: "" };

export function AutomationsView({ agents, onOpenTask }: { agents: AutomationAgent[]; onOpenTask: (id: string) => void }) {
  const { t: tr, tn } = useT();
  const [list, setList] = useState<Automation[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false); // immediate guard, including a second click before React re-renders
  const [err, setErr] = useState("");
  const cancel = () => { setDraft(null); setEditing(null); setErr(""); };
  const load = useCallback(() => api<{ automations: Automation[] }>("/api/automations").then((r) => setList(r.automations)).catch((e) => setErr(e.message)), []);
  const paused = useWorldPaused();
  useEffect(() => { if (paused) return; void load(); const h = setInterval(() => void load(), 5000); return () => clearInterval(h); }, [load, paused]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || locked.current) return;
    locked.current = true; setBusy(true); setErr("");
    try {
      await api("/api/automations", { method: editing ? "PATCH" : "POST", body: JSON.stringify({ ...(editing && { id: editing }), ...toSpec(draft) }) });
      setDraft(null); setEditing(null); await load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save"); }
    finally { locked.current = false; setBusy(false); }
  }
  async function act(a: Automation, what: "toggle" | "run" | "delete") {
    if (locked.current || draft) return;
    if (what === "delete" && !confirm(tr("auto.deleteConfirm", { name: a.name }))) return;
    locked.current = true; setBusy(true); setErr("");
    try {
      if (what === "toggle") await api("/api/automations", { method: "PATCH", body: JSON.stringify({ id: a.id, enabled: !a.enabled }) });
      if (what === "run") {
        const r = await api<{ task: string }>("/api/automations", { method: "POST", body: JSON.stringify({ run: a.id }) });
        onOpenTask(r.task); return;
      }
      if (what === "delete") await api(`/api/automations?id=${a.id}`, { method: "DELETE" });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
    finally { locked.current = false; setBusy(false); }
  }
  const canSave = !!draft?.name.trim() && (draft?.prompt.trim().length ?? 0) >= 5 && agents.some((a) => a.slug === draft?.agent && a.enabled !== false);
  const form = draft && <form onSubmit={save} className="mt-3 space-y-2" aria-label={tr(editing ? "auto.edit" : "auto.new")}>
    <AutomationFields draft={draft} agents={agents} disabled={busy} onChange={(p) => setDraft({ ...draft, ...p })} />
    {editing && <p className="muted text-xs">{tr("auto.saveFirst")}</p>}
    <div className="flex gap-2">
      <button className="btn" disabled={busy || !canSave}>{tr(busy ? "auto.saving" : editing ? "auto.saveChanges" : "auto.save")}</button>
      <button type="button" className="chip" disabled={busy} onClick={cancel}>{tr("common.cancel")}</button>
    </div>
  </form>;

  if (draft && !editing) return <div className="space-y-2">{form}{err && <p className="error" role="alert">{err}</p>}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button className="btn" disabled={busy || !!editing} onClick={() => { setErr(""); setDraft(EMPTY); }}>{tr("auto.newBtn")}</button>
        {TEMPLATES.map((t) => <button key={t.name} className="chip" disabled={busy || !!editing} onClick={() => { setErr(""); setDraft({ ...EMPTY, ...t }); }}>{t.name}</button>)}
      </div>
      <p className="muted text-xs">{tr("auto.tip")}</p>
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="card text-sm" style={a.enabled && a.last?.status === "failed" ? { borderColor: "#f43f5e" } : undefined}>
            <div className="flex items-center justify-between gap-2">
              <b className={a.enabled ? "" : "muted"}>{a.name}</b>
              <span className="flex gap-1.5">
                <button className="chip" disabled={busy || !!draft} onClick={() => { setErr(""); setEditing(a.id); setDraft(automationDraft(a)); }} aria-label={tr("auto.editAria", { name: a.name })}>{tr("auto.editBtn")}</button>
                <button className="chip" disabled={busy || !!draft} onClick={() => act(a, "run")}>{tr("rules.runNow")}</button>
                <button className="chip" disabled={busy || !!draft} onClick={() => act(a, "toggle")}>{tr(a.enabled ? "rules.pause" : "stop.resume")}</button>
                <button className="chip" disabled={busy || !!draft} onClick={() => act(a, "delete")} aria-label={tr("rules.deleteAria", { name: a.name })}>{tr("rules.delete")}</button>
              </span>
            </div>
            {editing === a.id && form}
            <div className="muted text-xs">{a.when} → {a.agent} · {tn("auto.runs", a.run_count)}{a.enabled ? "" : tr("auto.paused")}</div>
            <details className="mt-1 text-xs"><summary className="cursor-pointer muted">{tr("auto.preview")}</summary><AutoPreview a={a} /></details>
            {a.last && (
              <div className="mt-1 text-xs">
                {tr("auto.lastRun")} <button className="link" aria-label={`${tr("auto.lastRun")} ${a.last.status}`} onClick={() => onOpenTask(a.last!.id)}><OpsStatus raw={a.last.status} /></button>
                <span className="muted"> · {when(a.last.created_at)}</span>
                {a.last.error && <span className="error"> · {a.last.error.slice(0, 120)}</span>}
              </div>
            )}
          </li>
        ))}
        {!list.length && <li className="muted text-sm">{tr("auto.empty")}</li>}
      </ul>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** OPS05: what this automation will do and when (Tallinn clock), with its last outcomes. */
function AutoPreview({ a }: { a: Automation }) {
  const { t } = useT();
  const ok = lastWith(a.runs, "done"), bad = lastWith(a.runs, "failed");
  const at = (d: Date | string) => new Date(d).toLocaleString([], { timeZone: PREVIEW_TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <dl className="mt-1 space-y-0.5">
      <div><dt className="inline muted">{t("auto.trigger")} </dt><dd className="inline">{a.when}</dd></div>
      {a.trigger === "schedule" && a.schedule && <>
        <div><dt className="inline muted">{t("auto.tz")} </dt><dd className="inline">{PREVIEW_TZ}</dd></div>
        <div><dt className="inline muted">{t("auto.next")} </dt><dd className="inline">{a.enabled ? nextOccurrences(a.schedule, new Date()).map(at).join(" · ") : t("auto.pausedNone")}</dd></div>
        <div className="muted">{t("auto.dst")} {t("auto.missed", { min: graceMinutes(a.schedule) })}</div>
      </>}
      <div><dt className="inline muted">{t("auto.lastOk")} </dt><dd className="inline">{ok ? at(ok.created_at) : "—"}</dd></div>
      <div><dt className="inline muted">{t("auto.lastFail")} </dt><dd className="inline">{bad ? `${at(bad.created_at)}${bad.error ? ` · ${bad.error.slice(0, 80)}` : ""}` : "—"}</dd></div>
      <div><dt className="inline muted">{t("auto.effects")} </dt><dd className="inline">{t("auto.effectsText", { agent: a.agent })}</dd></div>
    </dl>
  );
}
