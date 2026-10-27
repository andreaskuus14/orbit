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
import { canRetryTask } from "@/lib/completion-pure";
import { useT } from "./i18n";

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
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const STATUS: Record<Task["status"], { label: string; color: string }> = {
  queued: { label: "Queued", color: "var(--muted)" },
  running: { label: "Working…", color: "var(--cyan)" },
  awaiting_approval: { label: "Needs your approval", color: "#fbbf24" },
  done: { label: "Done", color: "#6ee7b7" },
  failed: { label: "Failed", color: "#fb7185" },
  cancelled: { label: "Cancelled", color: "var(--muted)" },
};
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

/* ---------- small Markdown renderer for agent output ---------- */

function inline(text: string, openMemory?: (id: string) => void): ReactNode[] {
  return text.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[m:[0-9a-f-]{36}\]|\*\*[^*]+\*\*|`[^`]+`)/gi).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} className="link" href={safeHref(link[2])} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    const mem = part.match(/^\[m:([0-9a-f-]{36})\]$/i);
    if (mem) return <button key={i} className="chip" onClick={() => openMemory?.(mem[1])}>memory</button>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="hl-strong">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-black/40 px-1">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{highlight(part, i)}</Fragment>;
  });
}

export function Markdown({ text, openMemory }: { text: string; openMemory?: (id: string) => void }) {
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
    if (s.startsWith("### ")) out.push(<h4 key={i} className="mt-3 font-semibold">{inline(s.slice(4), openMemory)}</h4>);
    else if (s.startsWith("## ") || s.startsWith("# ")) out.push(<h3 key={i} className="h3 mt-4">{s.replace(/^#+\s/, "")}</h3>);
    else if (/^([-*]|\d+\.)\s/.test(s)) out.push(<p key={i} className="pl-4">• {inline(s.replace(/^([-*]|\d+\.)\s/, ""), openMemory)}</p>);
    else out.push(<p key={i}>{inline(s, openMemory)}</p>);
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
  const [name, setName] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    try { await api("/api/recipes", { method: "POST", body: JSON.stringify({ action: "add", name, agent: task.agent, request: task.request }) }); setName(null); setMsg({ ok: true, text: "Saved. Run it from Agents → Recipes or say “run recipe " + name + "”." }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save" }); }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {name === null ? <button type="button" className="chip" onClick={() => { setMsg(null); setName(task.title.replace(/^⚙\s*/, "").slice(0, 60)); }}>📋 Save as recipe</button> : (
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input className="field" aria-label="Recipe name" maxLength={60} required value={name} onChange={(e) => setName(e.target.value)} />
          <button className="chip" disabled={!name.trim()}>Save</button>
          <button type="button" className="chip" onClick={() => setName(null)}>Cancel</button>
        </form>)}
      {msg && <span className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
    </div>
  );
}

function TaskView({ id, onBack, openMemory }: { id: string; onBack: () => void; openMemory: (id: string) => void }) {
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

  async function act(action: string, target = id) {
    setErr("");
    try { await api(`/api/tasks/${target}`, { method: "POST", body: JSON.stringify({ action }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }

  if (!data) return <p className="muted">{err || "Loading…"}</p>;
  const { task, children } = data;
  const st = STATUS[task.status];
  return (
    <div className="space-y-3">
      <button className="link" onClick={onBack}>← All tasks</button>
      <div>
        <div className="font-medium">{task.title}</div>
        <div className="text-xs"><span style={{ color: st.color }}>{st.label}</span><span className="muted"> · {task.agent} · {when(task.created_at)}</span></div>
      </div>
      <details className="card text-sm"><summary className="cursor-pointer muted">Request</summary><p className="mt-2 whitespace-pre-wrap">{task.request}</p></details>

      {task.pending.some((p) => p.status === "pending") && task.status !== "done" && task.status !== "failed" && task.status !== "cancelled" && <Approval pending={task.pending} who={task.agent} ready={task.status === "awaiting_approval"} onAct={(a) => act(a)} />}
      {children.filter((c) => c.pending.some((p) => p.status === "pending") && c.status !== "done" && c.status !== "failed" && c.status !== "cancelled").map((c) => (
        <Approval key={c.id} pending={c.pending} who={c.agent} ready={c.status === "awaiting_approval"} onAct={(a) => act(a, c.id)} />
      ))}
      {task.pending.some((p) => p.status !== "pending") && (
        <ul className="muted text-xs">{task.pending.filter((p) => p.status !== "pending").map((p, i) => <li key={i}>{p.tool}: {p.status}{p.note ? ` — ${p.note}` : ""}</li>)}</ul>
      )}

      {task.result && <div className="card"><Markdown text={task.result} openMemory={openMemory} /></div>}
      <ResultEvidence items={[task, ...children].flatMap((t) => t.pending.flatMap((p) => p.evidence ?? []))} openMemory={openMemory} />
      {task.error && <p className="error">{task.error}</p>}
      {(task.status === "failed" || task.status === "cancelled") && !task.parent_id && (canRetryTask([task, ...children].flatMap((t) => t.pending))
        ? <button className="chip" onClick={() => act("retry")}>Retry</button>
        : <p className="muted text-xs">This task has resolved actions. Keep their results and request only the unfinished work in a follow-up.</p>)}
      {(task.status === "queued" || task.status === "running") && <button className="chip" onClick={() => act("cancel")}>Cancel task</button>}
      {task.status === "done" && !task.parent_id && !task.title.startsWith("Team: ") && <SaveRecipe task={task} />}

      {!!children.length && (
        <div>
          <h3 className="h3">Delegated</h3>
          <ul className="mt-1 space-y-2">
            {children.map((c) => (
              <li key={c.id} className="card text-sm">
                <div><b>{c.agent}</b> · {c.title} · <span style={{ color: STATUS[c.status].color }}>{STATUS[c.status].label}</span>
                  {c.status === "running" && <button className="chip ml-2" onClick={() => act("cancel", c.id)}>Cancel</button>}</div>
                {c.result && <details className="mt-1"><summary className="cursor-pointer muted text-xs">result</summary><div className="mt-2"><Markdown text={c.result} openMemory={openMemory} /></div></details>}
                {c.error && <p className="error">{c.error}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details open={task.status === "running"} className="text-xs">
        <summary className="cursor-pointer muted">Execution trace ({task.trace.length} steps)</summary>
        <ul className="mt-1 space-y-0.5">{task.trace.map((s, n) => <li key={n}>{s.ok ? "✓" : "✗"} <b>{s.step}</b> · {s.ms}ms · <span className="muted">{s.detail}</span></li>)}</ul>
      </details>
      {err && <p className="error">{err}</p>}
    </div>
  );
}

/* ---------- OPERATIONS: tasks + projects ---------- */

export function OperationsPanel({ focusTask, openMemory }: { focusTask: string | null; openMemory: (id: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState<string | null>(focusTask);
  const [form, setForm] = useState({ request: "", agent: "nova", project_id: "" });
  const [newProject, setNewProject] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [tab, setTab] = useState<"tasks" | "automations" | "rules" | "activity">("tasks");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, p, a] = await Promise.all([
        api<{ tasks: Task[] }>(`/api/tasks${filter ? `?project=${filter}` : ""}`),
        api<{ projects: Project[] }>("/api/projects"),
        api<{ agents: Agent[] }>("/api/agents"),
      ]);
      setTasks(t.tasks); setProjects(p.projects); setAgents(a.agents);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (focusTask) setOpen(focusTask); }, [focusTask]);
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

  if (open) return <TaskView id={open} onBack={() => { setOpen(null); void load(); }} openMemory={openMemory} />;

  const tabs = (
    <div className="flex gap-1.5" role="tablist">
      {(["tasks", "automations", "rules", "activity"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className="chip" style={tab === t ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setTab(t)}>
          {t === "tasks" ? "Tasks & projects" : t === "automations" ? "Automations" : t === "rules" ? "Rules" : "Activity"}
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
        <h3 className="h3">New task</h3>
        <textarea className="field h-20 w-full" value={form.request} onChange={(e) => setForm({ ...form, request: e.target.value })}
          placeholder="e.g. Research the best ways to grow a Roblox game in 2026 and save a report" aria-label="Task" maxLength={8000} />
        <div className="flex flex-wrap gap-2">
          <select className="field" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })} aria-label="Agent">
            {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}{a.slug === "nova" ? " (decides & delegates)" : ""}</option>)}
          </select>
          <select className="field" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} aria-label="Project">
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn" disabled={!form.request.trim()}>Start</button>
        </div>
        {err && <p className="error">{err}</p>}
      </form>

      <div>
        <div className="flex items-center justify-between"><h3 className="h3">Projects</h3></div>
        <ul className="mt-2 space-y-1.5 text-sm">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <button className={`text-left ${filter === p.id ? "link" : ""}`} onClick={() => setFilter(filter === p.id ? "" : p.id)}>{p.name} <span className="muted text-xs">· {p.status}</span></button>
              <select className="field py-0.5 text-xs" value={p.status} onChange={(e) => setProjectStatus(p, e.target.value)} aria-label={`Status of ${p.name}`}>
                <option value="active">active</option><option value="paused">paused</option><option value="done">done</option>
              </select>
            </li>
          ))}
        </ul>
        <form onSubmit={addProject} className="mt-2 flex gap-2">
          <input className="field flex-1" value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="New project name" aria-label="New project" maxLength={120} />
          <button className="chip">Add</button>
        </form>
      </div>

      <div>
        <h3 className="h3">Tasks{filter ? " in project" : ""}</h3>
        <ul className="mt-2 space-y-2">
          {tasks.map((t) => (
            <li key={t.id}>
              <button className="card w-full text-left" onClick={() => setOpen(t.id)}>
                <div className="font-medium">{t.title}</div>
                <div className="text-xs"><span style={{ color: STATUS[t.status].color }}>{STATUS[t.status].label}</span><span className="muted"> · {t.agent} · {when(t.created_at)}</span></div>
              </button>
            </li>
          ))}
          {!tasks.length && <li className="muted text-sm">No tasks yet. Give one above, or type into the command bar in Task mode.</li>}
        </ul>
      </div>
    </div>
  );
}

/* ---------- AGENTS: the workforce ---------- */

export function AgentsPanel({ onOpenTask }: { onOpenTask: (id: string) => void }) {
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
    if (!confirm("Remove this custom agent? Its past tasks stay.")) return;
    try { await api(`/api/agents?slug=${slug}`, { method: "DELETE" }); setSel(null); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not remove"); }
  }

  const agent = agents.find((a) => a.slug === sel);
  if (agent) {
    return (
      <div className="space-y-3">
        <button className="link" onClick={() => setSel(null)}>← All agents</button>
        <div><b style={{ color: agent.color }}>{agent.name}</b> <span className="muted text-sm">· {agent.role}</span></div>
        <p className="muted text-xs">Tools: {agent.tools.join(", ") || "none"} · {agent.stats.calls} AI calls, {agent.stats.tokens.toLocaleString()} tokens (30 days)</p>
        <details className="text-xs"><summary className="cursor-pointer muted">Instructions</summary><p className="mt-1 whitespace-pre-wrap">{agent.instructions}</p></details>
        <form onSubmit={give} className="flex gap-2">
          <input className="field flex-1" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={`Give ${agent.name} a task`} aria-label={`Task for ${agent.name}`} maxLength={8000} />
          <button className="btn" disabled={!ask.trim()}>Start</button>
        </form>
        {!agent.builtin && <button className="chip" onClick={() => removeAgent(agent.slug)}>Remove agent</button>}
        <h3 className="h3">Task history</h3>
        <ul className="space-y-1.5 text-sm">
          {tasks.map((t) => (
            <li key={t.id}><button className="text-left" onClick={() => onOpenTask(t.id)}>{t.title} <span className="text-xs" style={{ color: STATUS[t.status].color }}>· {STATUS[t.status].label}</span> <span className="muted text-xs">· {when(t.created_at)}</span></button></li>
          ))}
          {!tasks.length && <li className="muted">No tasks yet.</li>}
        </ul>
        {err && <p className="error">{err}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="muted text-sm">Your AI workforce. Each agent has its own instructions and only the tools listed. Anything that changes your data waits for your approval.</p>
      <ProposalsPanel onOpenTask={onOpenTask} />
      <ul className="grid gap-2 sm:grid-cols-2">
        {agents.map((a) => (
          <li key={a.slug}>
            <button className="card h-full w-full text-left" onClick={() => setSel(a.slug)} style={{ borderColor: a.stats.running ? a.color : undefined }}>
              <div className="flex items-center justify-between">
                <b style={{ color: a.color }}>{a.name}</b>
                <span className="text-xs" style={{ color: a.stats.running ? "var(--cyan)" : "var(--muted)" }}>{a.stats.running ? "● working" : "idle"}</span>
              </div>
              <div className="muted text-xs">{a.role}</div>
              <div className="muted mt-1 text-[11px]">{a.stats.done} done · {a.stats.failed} failed · {a.stats.tokens.toLocaleString()} tokens</div>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted text-xs">Flow (automations) arrives with the Automation Studio.</p>
      <OrbitLog />

      {creating ? (
        <form onSubmit={createAgent} className="card space-y-2">
          <h3 className="h3">New custom agent</h3>
          <input className="field w-full" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name (e.g. Roblox Scout)" aria-label="Agent name" maxLength={60} />
          <input className="field w-full" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="One-line role" aria-label="Role" maxLength={200} />
          <textarea className="field h-28 w-full" value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} placeholder="Instructions: what it should do and how it should answer" aria-label="Instructions" maxLength={8000} />
          <fieldset className="space-y-1 text-xs">
            <legend className="muted">Allowed tools</legend>
            {tools.map((t) => (
              <label key={t.name} className="flex items-start gap-2">
                <input type="checkbox" checked={draft.tools.includes(t.name)}
                  onChange={(e) => setDraft({ ...draft, tools: e.target.checked ? [...draft.tools, t.name] : draft.tools.filter((x) => x !== t.name) })} />
                <span><b>{t.name}</b>{t.approval ? " (asks you first)" : ""} — <span className="muted">{t.description}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2"><button className="btn">Create agent</button><button type="button" className="chip" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      ) : (
        <button className="chip" onClick={() => setCreating(true)}>+ Create custom agent</button>
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
    if (what === "delete" && !confirm(`Delete "${a.name}"? Past runs stay in your tasks.`)) return;
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
  const form = draft && <form onSubmit={save} className="mt-3 space-y-2" aria-label={editing ? "Edit automation" : "New automation"}>
    <AutomationFields draft={draft} agents={agents} disabled={busy} onChange={(p) => setDraft({ ...draft, ...p })} />
    {editing && <p className="muted text-xs">Save first, then use Run now to test the saved instructions.</p>}
    <div className="flex gap-2">
      <button className="btn" disabled={busy || !canSave}>{busy ? "Saving…" : editing ? "Save changes" : "Save automation"}</button>
      <button type="button" className="chip" disabled={busy} onClick={cancel}>Cancel</button>
    </div>
  </form>;

  if (draft && !editing) return <div className="space-y-2">{form}{err && <p className="error" role="alert">{err}</p>}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button className="btn" disabled={busy || !!editing} onClick={() => { setErr(""); setDraft(EMPTY); }}>+ New automation</button>
        {TEMPLATES.map((t) => <button key={t.name} className="chip" disabled={busy || !!editing} onClick={() => { setErr(""); setDraft({ ...EMPTY, ...t }); }}>{t.name}</button>)}
      </div>
      <p className="muted text-xs">Tip: in Task mode you can just say “every Friday at 16:00, summarize my week” and Flow builds it for you.</p>
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="card text-sm" style={a.enabled && a.last?.status === "failed" ? { borderColor: "#f43f5e" } : undefined}>
            <div className="flex items-center justify-between gap-2">
              <b className={a.enabled ? "" : "muted"}>{a.name}</b>
              <span className="flex gap-1.5">
                <button className="chip" disabled={busy || !!draft} onClick={() => { setErr(""); setEditing(a.id); setDraft(automationDraft(a)); }} aria-label={`Edit ${a.name}`}>Edit</button>
                <button className="chip" disabled={busy || !!draft} onClick={() => act(a, "run")}>Run now</button>
                <button className="chip" disabled={busy || !!draft} onClick={() => act(a, "toggle")}>{a.enabled ? "Pause" : "Resume"}</button>
                <button className="chip" disabled={busy || !!draft} onClick={() => act(a, "delete")} aria-label={`Delete ${a.name}`}>Delete</button>
              </span>
            </div>
            {editing === a.id && form}
            <div className="muted text-xs">{a.when} → {a.agent} · {a.run_count} runs{a.enabled ? "" : " · paused"}</div>
            {a.last && (
              <div className="mt-1 text-xs">
                Last run: <button className="link" onClick={() => onOpenTask(a.last!.id)}>{STATUS[a.last.status].label}</button>
                <span className="muted"> · {when(a.last.created_at)}</span>
                {a.last.error && <span className="error"> · {a.last.error.slice(0, 120)}</span>}
              </div>
            )}
          </li>
        ))}
        {!list.length && <li className="muted text-sm">No automations yet. Start from a template above.</li>}
      </ul>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
