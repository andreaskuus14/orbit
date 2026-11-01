"use client";
import { useEffect, useState } from "react";
import { emptyDesk, type Desk } from "@/lib/project-desk-pure";
import { linkToHash } from "@/lib/deeplink-pure";
import { useT } from "./i18n";

type Project = { id: string; name: string; status: string };
type Task = { id: string; title: string; status: string };
async function api<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`); return j;
}

/** First shared desk: canonical OPERATIONS project, local references/notes, existing task queue. No model calls on open. */
export function ProjectDesk({ project, onSelect, disabled = false }: { project: string; onSelect: (id: string) => void; disabled?: boolean }) {
  const { t } = useT();
  const [projects, setProjects] = useState<Project[]>([]), [name, setName] = useState("");
  const [desk, setDesk] = useState<Desk>(emptyDesk), [saved, setSaved] = useState<Desk>(emptyDesk);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]), [request, setRequest] = useState("");
  const [title, setTitle] = useState(""), [url, setUrl] = useState("");
  const dirty = JSON.stringify(desk) !== JSON.stringify(saved) || !!title || !!url;
  const endpoint = `/api/projects/desk?project=${encodeURIComponent(project)}`;
  useEffect(() => {
    if (!dirty && !request) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", warn); return () => removeEventListener("beforeunload", warn);
  }, [dirty, request]);
  useEffect(() => {
    let alive = true;
    api<{ projects: Project[] }>("/api/projects").then((j) => { if (alive) setProjects(j.projects); }, (e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!project) return;
    let alive = true;
    api<{ desk: Desk }>(endpoint).then((j) => { if (alive) { setDesk(j.desk); setSaved(j.desk); setLoaded(true); } }, (e) => { if (alive) setError(e.message); });
    api<{ tasks: Task[] }>(`/api/tasks?project=${encodeURIComponent(project)}`).then((j) => { if (alive) setTasks(j.tasks); }, (e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [project, endpoint]);
  async function create() {
    setBusy(true); setError("");
    try { const j = await api<{ project: Project }>("/api/projects", { name: name.trim() }); onSelect(j.project.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try { const j = await api<{ desk: Desk }>(endpoint, desk); setDesk(j.desk); setSaved(j.desk); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError("");
    try { const j = await api<{ desk: Desk }>(endpoint); setDesk(j.desk); setSaved(j.desk); setLoaded(true); setTitle(""); setUrl(""); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function task() {
    setBusy(true); setError("");
    try { const j = await api<{ task: Task }>("/api/tasks", { request: request.trim(), project_id: project, agent: "nova" }); setTasks((ts) => [j.task, ...ts]); setRequest(""); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <details open className="card space-y-2" aria-label={t("desk.title")}>
    <summary className="cursor-pointer font-semibold">{projects.find((p) => p.id === project)?.name ?? t("desk.title")}</summary>
    <label className="block text-xs">{t("desk.project")}
      <select className="field mt-1 w-full" value={project} disabled={disabled || busy || dirty || !!request} onChange={(e) => onSelect(e.target.value)}>
        <option value="">{t("desk.unassigned")}</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <input className="field min-w-0 flex-1" aria-label={t("desk.new")} placeholder={t("desk.new")} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      <button className="chip" disabled={disabled || busy || dirty || !!request || !name.trim()}>{t("desk.create")}</button>
    </form>
    {project ? <>
      <p className="muted text-xs">{t("desk.help")}</p>
      <label className="block text-xs">{t("desk.notes")}<textarea className="field mt-1 w-full" rows={3} maxLength={6000} disabled={!loaded || busy} value={desk.notes} onChange={(e) => setDesk({ ...desk, notes: e.target.value })} /></label>
      <ul className="space-y-1 text-xs">{desk.references.map((r, i) => <li key={r.url} className="flex items-baseline justify-between gap-2">
        <a className="link break-all" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
        <button className="chip" disabled={busy} aria-label={t("desk.remove", { title: r.title })} onClick={() => setDesk({ ...desk, references: desk.references.filter((_, n) => n !== i) })}>{t("common.remove")}</button>
      </li>)}</ul>
      <form className="space-y-1" onSubmit={(e) => {
        e.preventDefault(); let u: URL;
        try { u = new URL(url); } catch { setError(t("desk.badLink")); return; }
        if (!/^https?:$/.test(u.protocol) || u.username || u.password) { setError(t("desk.badLink")); return; }
        if (!desk.references.some((r) => r.url === u.href)) setDesk({ ...desk, references: [...desk.references, { title: title.trim(), url: u.href }] });
        setTitle(""); setUrl("");
      }}>
        <input className="field w-full" aria-label={t("desk.refTitle")} placeholder={t("desk.refTitle")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required disabled={!loaded || busy} />
        <input className="field w-full" type="url" aria-label={t("desk.refUrl")} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} required disabled={!loaded || busy} />
        <button className="chip" disabled={!loaded || busy || desk.references.length >= 50}>{t("desk.addRef")}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={!loaded || busy || JSON.stringify(desk) === JSON.stringify(saved)} onClick={() => void save()}>{t("desk.save")}</button>
        <button className="chip" disabled={busy} onClick={() => void reload()}>{t("desk.reload")}</button>
      </div>
      {dirty && <p className="muted text-xs" role="status">{t("desk.unsaved")}</p>}
      <h3 className="font-semibold text-xs">{t("desk.tasks")}</h3>
      <ul className="space-y-1 text-xs">{tasks.slice(0, 12).map((task) => <li key={task.id}><a className="link" href={linkToHash({ planet: "operations", kind: "task", id: task.id })}>{task.title}</a> <span className="muted">· {task.status}</span></li>)}</ul>
      {!tasks.length && <p className="muted text-xs">{t("desk.noTasks")}</p>}
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void task(); }}>
        <input className="field min-w-0 flex-1" aria-label={t("desk.task")} placeholder={t("desk.task")} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={8000} />
        <button className="chip" disabled={busy || !loaded || !request.trim()}>{t("desk.startTask")}</button>
      </form>
    </> : <p className="muted text-xs">{t("desk.choose")}</p>}
    {error && <p className="error text-xs" role="alert">{error}</p>}
  </details>;
}
