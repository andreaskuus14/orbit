"use client";
import { useEffect, useState } from "react";
import { emptyDesk, readDeskDraft, type Desk, type ProjectClip } from "@/lib/project-desk-pure";
import { linkToHash } from "@/lib/deeplink-pure";
import { CORE_NEW_CHAT, CORE_PROJECT_REQUEST_KEY } from "@/lib/core-chats-pure";
import { NAV_EVENT } from "@/lib/nav-pure";
import { useT } from "./i18n";

type Project = { id: string; name: string; status: string };
type Task = { id: string; title: string; status: string };
type VaultItem = { id: string; name: string; type: string; version: number };
async function api<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`); return j;
}

/** First shared desk: canonical OPERATIONS project, local references/notes, existing task queue. No model calls on open. */
export function ProjectDesk({ project, onSelect, disabled = false, productions, mode = "arch" }: { project: string; onSelect: (id: string) => void; disabled?: boolean; productions?: ProjectClip[]; mode?: "arch" | "studio" }) {
  const { t } = useT();
  const [projects, setProjects] = useState<Project[]>([]), [name, setName] = useState("");
  const [desk, setDesk] = useState<Desk>(emptyDesk), [saved, setSaved] = useState<Desk>(emptyDesk);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]), [request, setRequest] = useState("");
  const [title, setTitle] = useState(""), [url, setUrl] = useState("");
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [color, setColor] = useState("#c9a24a");
  const [cloudOnly, setCloudOnly] = useState<{ name: string }[]>([]);
  const dirty = JSON.stringify(desk) !== JSON.stringify(saved) || !!title || !!url;
  const endpoint = `/api/projects/desk?project=${encodeURIComponent(project)}`;
  const draftKey = `orbit.project.draft:${project}`;
  useEffect(() => {
    if (!project || !loaded) return;
    try {
      if (dirty || request) sessionStorage.setItem(draftKey, JSON.stringify({ desk, title, url, request })); else sessionStorage.removeItem(draftKey);
    } catch { /* best effort tab recovery; the explicit save and beforeunload warning remain */ }
  }, [project, loaded, dirty, desk, title, url, request, draftKey]);
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
    api<{ desk: Desk }>(endpoint).then((j) => { if (alive) {
      let draft = null;
      try { draft = readDeskDraft(JSON.parse(sessionStorage.getItem(draftKey) ?? "null")); } catch { /* no valid recovery draft */ }
      setDesk(draft?.desk ?? j.desk); setSaved(j.desk);
      if (draft) { setTitle(draft.title); setUrl(draft.url); setRequest(draft.request); if (draft.desk.rev !== j.desk.rev) setError(t("desk.draftStale")); }
      setLoaded(true);
    } }, (e) => { if (alive) setError(e.message); });
    api<{ tasks: Task[] }>(`/api/tasks?project=${encodeURIComponent(project)}`).then((j) => { if (alive) setTasks(j.tasks); }, (e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [project, endpoint]);
  async function loadVault() {
    try { const j = await api<{ files: VaultItem[]; cloudOnly?: { name: string }[] }>("/api/vault"); setVault(j.files); setCloudOnly(j.cloudOnly ?? []); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { if (loaded && desk.files?.length && !vault.length) void loadVault(); }, [loaded, desk.files?.length]); // metadata only; never model input
  async function openCore() {
    setBusy(true); setError("");
    try {
      await api(`/api/projects/core?project=${encodeURIComponent(project)}`, {});
      const list = await api<{ chats: { id: string }[]; map: Record<string, string> }>("/api/core/chats");
      const chatId = list.chats.find((c) => list.map[c.id] === project)?.id;
      const target = { projectId: project, ...(chatId && { chatId }) };
      sessionStorage.setItem(CORE_PROJECT_REQUEST_KEY, JSON.stringify(target));
      dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "core" } }));
      dispatchEvent(new CustomEvent(CORE_NEW_CHAT, { detail: target }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
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
        <option value="">{t(mode === "arch" ? "desk.unassigned" : "ops.noProject")}</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <input className="field min-w-0 flex-1" aria-label={t("desk.new")} placeholder={t("desk.new")} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      <button className="chip" disabled={disabled || busy || dirty || !!request || !name.trim()}>{t("desk.create")}</button>
    </form>
    {project ? <>
      <p className="muted text-xs">{t(mode === "arch" ? "desk.help" : "desk.studioHelp")}</p>
      <button className="chip" disabled={!loaded || busy || dirty || !!request} onClick={() => void openCore()}>{t("desk.openCore")}</button>
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
      <h3 className="font-semibold text-xs">{t("desk.files")}</h3>
      <p className="muted text-xs">{t("desk.fileHelp")}</p>
      <div className="grid grid-cols-2 gap-2">{(desk.files ?? []).map((attached) => {
        const file = vault.find((f) => f.id === attached.id), href = file ? `/api/vault?file=${encodeURIComponent(file.name)}&raw=1` : null;
        return <div key={attached.id} className="rounded border border-white/10 p-2 text-xs">
          {href ? <a className="link break-all" href={href} target="_blank" rel="noopener noreferrer">
            {file?.type === "image" && <img src={href} alt={file.name} className="mb-1 h-24 w-full rounded object-contain" loading="lazy" />}
            {file?.name} · v{file?.version}
          </a> : <span className="muted">{attached.label} · {t("desk.fileMissing")}</span>}
          <button className="chip mt-1" disabled={busy} aria-label={t("desk.remove", { title: file?.name ?? attached.label })} onClick={() => setDesk({ ...desk, files: (desk.files ?? []).filter((f) => f.id !== attached.id) })}>{t("common.remove")}</button>
        </div>;
      })}</div>
      <button className="chip" disabled={!loaded || busy} onClick={() => void loadVault()}>{t("desk.chooseFiles")}</button>
      {(!!vault.length || !!cloudOnly.length) && <select className="field w-full" value="" aria-label={t("desk.chooseFiles")} disabled={!loaded || busy || (desk.files?.length ?? 0) >= 50} onChange={(e) => {
        const f = vault.find((v) => v.id === e.target.value); if (f) setDesk({ ...desk, files: [...(desk.files ?? []), { id: f.id, label: f.name }] });
      }}><option value="">{t("desk.chooseFiles")}</option>{vault.filter((f) => f.id && !desk.files?.some((a) => a.id === f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        {!!cloudOnly.length && <optgroup label={t("desk.cloudOnlyGroup")}>{cloudOnly.map((c) => <option key={`cloud:${c.name}`} value={`cloud:${c.name}`} disabled>{c.name}</option>)}</optgroup>}</select>}
      {!!cloudOnly.length && <p className="muted text-xs">{t("desk.cloudOnlyHelp", { n: cloudOnly.length })}</p>}
      <h3 className="font-semibold text-xs">{t("desk.palette")}</h3>
      <ul className="flex flex-wrap gap-2">{(desk.palette ?? []).map((c) => <li key={c} className="flex items-center gap-1 text-xs">
        <span className="inline-block h-5 w-5 rounded border border-white/30" style={{ background: c }} aria-hidden="true" />{c}
        <button className="chip" disabled={busy} aria-label={t("desk.remove", { title: c })} onClick={() => setDesk({ ...desk, palette: desk.palette?.filter((x) => x !== c) })}>×</button>
      </li>)}</ul>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={t("desk.palette")} value={color} onChange={(e) => setColor(e.target.value)} disabled={!loaded || busy} />
        <button className="chip" disabled={!loaded || busy || (desk.palette?.length ?? 0) >= 12 || desk.palette?.includes(color)} onClick={() => setDesk({ ...desk, palette: [...(desk.palette ?? []), color] })}>{t("desk.addColor")}</button>
      </div>
      {(!!productions || !!desk.productions?.length) && <>
        <h3 className="font-semibold text-xs">{t("desk.clips")}</h3>
        <ul className="space-y-1 text-xs">{(desk.productions ?? []).map((c) => <li key={c.id} className="flex items-baseline justify-between gap-2">
          <a className="link" href={linkToHash({ planet: "studio", view: "review", kind: "review", id: c.id })}>{productions?.find((r) => r.id === c.id)?.title ?? c.title}</a>
          <button className="chip" disabled={busy} aria-label={t("desk.remove", { title: c.title })} onClick={() => setDesk({ ...desk, productions: (desk.productions ?? []).filter((r) => r.id !== c.id) })}>{t("common.remove")}</button>
        </li>)}</ul>
        {productions && <select className="field w-full" value="" aria-label={t("desk.addClip")} disabled={!loaded || busy || (desk.productions?.length ?? 0) >= 50} onChange={(e) => {
          const c = productions.find((r) => r.id === e.target.value); if (c) setDesk({ ...desk, productions: [...(desk.productions ?? []), { id: c.id, title: c.title }] });
        }}><option value="">{t("desk.addClip")}</option>{productions.filter((r) => !desk.productions?.some((c) => c.id === r.id)).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>}
      </>}
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
    </> : <p className="muted text-xs">{t(mode === "arch" ? "desk.choose" : "desk.chooseStudio")}</p>}
    {error && <p className="error text-xs" role="alert">{error}</p>}
  </details>;
}
