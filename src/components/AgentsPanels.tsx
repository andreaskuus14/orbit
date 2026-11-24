"use client";
import { OperationsShell } from "./OperationsShell";
import { useCallback, useEffect, useState } from "react";
import { ProposalsPanel } from "./ProposalsPanel";
import { OrbitLog } from "./OrbitLog";
import { useWorldPaused } from "./world-paused";
import type { WriteEvidence } from "@/lib/completion-pure";
import { useT } from "./i18n";
import { Markdown } from "./Markdown";
import { OpsStatus } from "./OpsStatus";
import { lastProgress } from "@/lib/ops-status-pure";
import { askConfirm } from "./ui/Dialog";

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

export { Markdown };

/* ---------- OPERATIONS: the planet (OperationsShell: jobs now / scheduled / history, one job, routines, tools) ---------- */

export function OperationsPanel(props: { focusTask: string | null; onOpen?: (id: string | null) => void; openMemory: (id: string) => void }) {
  return <OperationsShell {...props} />;
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
  useEffect(() => { if (paused) return; void load(); const h = setInterval(() => { if (!document.hidden) void load(); }, 5000), back = () => { if (!document.hidden) void load(); }; document.addEventListener("visibilitychange", back); return () => { clearInterval(h); document.removeEventListener("visibilitychange", back); }; }, [load, paused]);
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
    if (!(await askConfirm(tr("agents.removeConfirm")))) return;
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
