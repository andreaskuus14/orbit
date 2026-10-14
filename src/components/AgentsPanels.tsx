"use client";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { highlight } from "./Highlight";

type Step = { step: string; detail: string; ms: number; ok: boolean };
type Pending = { tool: string; input: Record<string, unknown>; status: string; note?: string };
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

function Approval({ pending, who, onAct }: { pending: Pending[]; who: string; onAct: (action: "approve" | "reject") => void }) {
  return (
    <div className="card space-y-2 text-sm" style={{ borderColor: "#fbbf24" }}>
      <b>{who} is waiting for your approval</b>
      {pending.filter((p) => p.status === "pending").map((p, i) => (
        <div key={i} className="text-xs">
          <b>{p.tool.replace(/_/g, " ")}</b>: {String(p.input.title ?? p.input.name ?? "")}
          {typeof p.input.content === "string" && <details><summary className="cursor-pointer muted">preview</summary><p className="whitespace-pre-wrap">{p.input.content.slice(0, 2000)}</p></details>}
          {typeof p.input.prompt === "string" && <details><summary className="cursor-pointer muted">what it will do</summary><p className="whitespace-pre-wrap">{p.input.prompt.slice(0, 2000)}</p></details>}
          {typeof p.input.request === "string" && <p className="muted">{p.input.request.slice(0, 300)} → {String(p.input.agent ?? "nova")}</p>}
        </div>
      ))}
      <div className="flex gap-2"><button className="btn" onClick={() => onAct("approve")}>Approve</button><button className="btn danger" onClick={() => onAct("reject")}>Reject</button></div>
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
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => void load(), 2500);
    return () => clearInterval(h);
  }, [active, load]);

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

      {task.pending.some((p) => p.status === "pending") && <Approval pending={task.pending} who={task.agent} onAct={(a) => act(a)} />}
      {children.filter((c) => c.pending.some((p) => p.status === "pending")).map((c) => (
        <Approval key={c.id} pending={c.pending} who={c.agent} onAct={(a) => act(a, c.id)} />
      ))}
      {task.pending.some((p) => p.status !== "pending") && (
        <ul className="muted text-xs">{task.pending.filter((p) => p.status !== "pending").map((p, i) => <li key={i}>{p.tool}: {p.status}{p.note ? ` — ${p.note}` : ""}</li>)}</ul>
      )}

      {task.result && <div className="card"><Markdown text={task.result} openMemory={openMemory} /></div>}
      {task.error && <p className="error">{task.error}</p>}
      {(task.status === "failed" || task.status === "cancelled") && !task.parent_id && <button className="chip" onClick={() => act("retry")}>Retry</button>}
      {task.status === "queued" && <button className="chip" onClick={() => act("cancel")}>Cancel</button>}

      {!!children.length && (
        <div>
          <h3 className="h3">Delegated</h3>
          <ul className="mt-1 space-y-2">
            {children.map((c) => (
              <li key={c.id} className="card text-sm">
                <div><b>{c.agent}</b> · {c.title} · <span style={{ color: STATUS[c.status].color }}>{STATUS[c.status].label}</span></div>
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
  const [tab, setTab] = useState<"tasks" | "automations">("tasks");
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
  useEffect(() => {
    if (!active || open) return;
    const h = setInterval(() => void load(), 3000);
    return () => clearInterval(h);
  }, [active, open, load]);

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
      {(["tasks", "automations"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className="chip" style={tab === t ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setTab(t)}>
          {t === "tasks" ? "Tasks & projects" : "Automations"}
        </button>
      ))}
    </div>
  );
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
  useEffect(() => { void load(); const h = setInterval(() => void load(), 5000); return () => clearInterval(h); }, [load]);
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
type Automation = {
  id: string; name: string; enabled: boolean; trigger: "schedule" | "event"; when: string; agent: string; prompt: string;
  run_count: number; last: Run | null; runs: Run[];
};
type Draft = { name: string; when: "day" | "week" | "hour" | "memory" | "briefing"; time: string; weekday: number; kind: string; agent: string; prompt: string };

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
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EMPTY: Draft = { name: "", when: "day", time: "09:00", weekday: 1, kind: "", agent: "nova", prompt: "" };

function toSpec(d: Draft) {
  const [hour, minute] = d.time.split(":").map(Number);
  if (d.when === "memory") return { name: d.name, trigger: "event", event: "memory.created", kind_filter: d.kind || null, agent: d.agent, prompt: d.prompt };
  if (d.when === "briefing") return { name: d.name, trigger: "event", event: "briefing.ready", agent: d.agent, prompt: d.prompt };
  return { name: d.name, trigger: "schedule", schedule: { every: d.when, hour, minute, weekday: d.weekday }, agent: d.agent, prompt: d.prompt };
}

export function AutomationsView({ agents, onOpenTask }: { agents: { slug: string; name: string }[]; onOpenTask: (id: string) => void }) {
  const [list, setList] = useState<Automation[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ automations: Automation[] }>("/api/automations").then((r) => setList(r.automations)).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); const h = setInterval(() => void load(), 5000); return () => clearInterval(h); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setErr("");
    try { await api("/api/automations", { method: "POST", body: JSON.stringify(toSpec(draft)) }); setDraft(null); void load(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save"); }
  }
  async function act(a: Automation, what: "toggle" | "run" | "delete") {
    setErr("");
    try {
      if (what === "toggle") await api("/api/automations", { method: "PATCH", body: JSON.stringify({ id: a.id, enabled: !a.enabled }) });
      if (what === "run") { const r = await api<{ task: string }>("/api/automations", { method: "POST", body: JSON.stringify({ run: a.id }) }); onOpenTask(r.task); return; }
      if (what === "delete") { if (!confirm(`Delete "${a.name}"? Past runs stay in your tasks.`)) return; await api(`/api/automations?id=${a.id}`, { method: "DELETE" }); }
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  }

  if (draft) {
    const set = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
    return (
      <form onSubmit={save} className="space-y-2">
        <button type="button" className="link" onClick={() => setDraft(null)}>← Automations</button>
        <input className="field w-full" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name" aria-label="Name" maxLength={100} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className="field" value={draft.when} onChange={(e) => set({ when: e.target.value as Draft["when"] })} aria-label="When">
            <option value="day">Every day</option><option value="week">Every week</option><option value="hour">Every hour</option>
            <option value="memory">When I save a memory</option><option value="briefing">When a new briefing is ready</option>
          </select>
          {draft.when === "week" && (
            <select className="field" value={draft.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })} aria-label="Day">
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          )}
          {(draft.when === "day" || draft.when === "week") && <input type="time" className="field" value={draft.time} onChange={(e) => set({ time: e.target.value })} aria-label="Time" />}
          {draft.when === "hour" && <label className="muted">at minute <input type="number" min={0} max={59} className="field w-16" value={Number(draft.time.split(":")[1])} onChange={(e) => set({ time: `00:${String(Math.min(59, Math.max(0, Number(e.target.value)))).padStart(2, "0")}` })} /></label>}
          {draft.when === "memory" && (
            <select className="field" value={draft.kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Kind of memory">
              <option value="">any kind</option><option value="document">documents</option><option value="link">links</option><option value="note">notes</option><option value="idea">ideas</option>
            </select>
          )}
        </div>
        <label className="block text-sm">Who does it
          <select className="field ml-2" value={draft.agent} onChange={(e) => set({ agent: e.target.value })}>
            {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select>
        </label>
        <textarea className="field h-28 w-full" value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="What should happen each time?" aria-label="Instructions" maxLength={4000} />
        <p className="muted text-xs">Runs while ORBIT's server is on (this PC's time). Each run is a normal task you can open; anything that changes your data still asks for approval.</p>
        <button className="btn" disabled={!draft.name.trim() || draft.prompt.trim().length < 5}>Save automation</button>
        {err && <p className="error">{err}</p>}
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <button className="btn" onClick={() => setDraft(EMPTY)}>+ New automation</button>
        {TEMPLATES.map((t) => <button key={t.name} className="chip" onClick={() => setDraft({ ...EMPTY, ...t })}>{t.name}</button>)}
      </div>
      <p className="muted text-xs">Tip: in Task mode you can just say “every Friday at 16:00, summarize my week” and Flow builds it for you.</p>
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="card text-sm" style={a.enabled && a.last?.status === "failed" ? { borderColor: "#f43f5e" } : undefined}>
            <div className="flex items-center justify-between gap-2">
              <b className={a.enabled ? "" : "muted"}>{a.name}</b>
              <span className="flex gap-1.5">
                <button className="chip" onClick={() => act(a, "run")}>Run now</button>
                <button className="chip" onClick={() => act(a, "toggle")}>{a.enabled ? "Pause" : "Resume"}</button>
                <button className="chip" onClick={() => act(a, "delete")} aria-label={`Delete ${a.name}`}>Delete</button>
              </span>
            </div>
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
      {err && <p className="error">{err}</p>}
    </div>
  );
}
