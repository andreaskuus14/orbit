"use client";
import { useMemo } from "react";
import type { Task } from "./AgentsPanels";
import { useT } from "./i18n";
import { OpsStatus } from "./OpsStatus";
import { lastProgress } from "@/lib/ops-status-pure";
import { INBOX_BUCKETS, inboxBucket, inboxView, type InboxFilter, type InboxSort } from "@/lib/operations-inbox-pure";

export type InboxState = { query: string; agent: string; filter: InboxFilter; sort: InboxSort; limit: number };
export const INITIAL_INBOX: InboxState = { query: "", agent: "", filter: "all", sort: "priority", limit: 12 };
const COPY = {
  en: { title: "Work inbox", scope: "Counts and search cover loaded tasks, not all history.", loaded: "loaded", all: "All work", attention: "Needs you", failed: "Failed / inspect", active: "In progress", done: "Finished", cancelled: "Cancelled", search: "Search loaded tasks", searchHint: "Title, request, result or error…", agent: "Agent", allAgents: "All agents", project: "Project", allProjects: "All projects", sort: "Order", priority: "Attention first", recent: "Latest progress", refresh: "Refresh", refreshing: "Refreshing…", clear: "Clear filters", empty: "No tasks loaded yet. Create a task below to get started.", noMatches: "No tasks match these filters.", loading: "Loading work…", more: "Show more", showing: "Showing", of: "of", open: "Open task", review: "Review", inspect: "Inspect result", follow: "Follow progress", result: "Open result", cancelledAction: "View details", warning: "Some information could not be refreshed. Existing rows may be out of date.", untitled: "Untitled task" },
  et: { title: "Tööde ülevaade", scope: "Arvud ja otsing hõlmavad laaditud ülesandeid, mitte kogu ajalugu.", loaded: "laaditud", all: "Kõik tööd", attention: "Vajab sind", failed: "Viga / kontrolli", active: "Töös", done: "Valmis", cancelled: "Tühistatud", search: "Otsi laaditud ülesandeid", searchHint: "Pealkiri, juhis, tulemus või viga…", agent: "Agent", allAgents: "Kõik agendid", project: "Projekt", allProjects: "Kõik projektid", sort: "Järjestus", priority: "Tähelepanu vajavad ees", recent: "Viimati edenenud", refresh: "Värskenda", refreshing: "Värskendan…", clear: "Tühjenda filtrid", empty: "Ülesandeid pole veel laaditud. Alustamiseks loo allpool ülesanne.", noMatches: "Nende filtritega ülesandeid ei leitud.", loading: "Laadin töid…", more: "Näita rohkem", showing: "Näitan", of: "/", open: "Ava ülesanne", review: "Vaata üle", inspect: "Kontrolli tulemust", follow: "Jälgi edenemist", result: "Ava tulemus", cancelledAction: "Vaata üksikasju", warning: "Osa andmeid ei saanud värskendada. Olemasolevad read võivad olla aegunud.", untitled: "Pealkirjata ülesanne" },
};

export function OperationsInbox({ tasks, agents, projects, project, onProject, state, onChange, loading, error, onRefresh, onOpen }: {
  tasks: Task[]; agents: { slug: string; name: string }[]; projects: { id: string; name: string }[];
  project: string; onProject: (id: string) => void; state: InboxState; onChange: (next: InboxState) => void;
  loading: boolean; error: string; onRefresh: () => void; onOpen: (id: string) => void;
}) {
  const { lang } = useT(), text = COPY[lang];
  const view = useMemo(() => inboxView(tasks, state.query, state.agent, state.filter, state.sort), [tasks, state]);
  const availableAgents = [...new Set(tasks.map((t) => t.agent))].sort();
  const change = (patch: Partial<InboxState>) => onChange({ ...state, limit: 12, ...patch });
  const filtered = !!state.query || !!state.agent || state.filter !== "all" || !!project;
  const clear = () => { onChange({ ...INITIAL_INBOX, sort: state.sort }); onProject(""); };

  return <section className="min-w-0 space-y-3" aria-label={text.title}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="h3">{text.title}</h3><p className="muted text-xs">{tasks.length} {text.loaded} · {text.scope}</p></div>
      <button type="button" className="chip" onClick={onRefresh} disabled={loading}>{loading ? text.refreshing : text.refresh}</button>
    </div>
    {error && <div role="alert" className="card space-y-1 border-rose-400/40 text-xs"><p>{text.warning}</p><p className="error break-words">{error}</p></div>}
    <div className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-3" role="group" aria-label={text.title}>
      {(["all", ...INBOX_BUCKETS] as const).map((key) => <button key={key} type="button" className="card min-w-0 p-2.5 text-left" aria-pressed={state.filter === key}
        style={state.filter === key ? { borderColor: "var(--cyan)", background: "rgba(34,211,238,.08)" } : undefined} onClick={() => change({ filter: key })}>
        <span className="block text-xs">{text[key]}</span><strong className="num block text-xl">{key === "all" ? view.total : view.counts[key]}</strong>
      </button>)}
    </div>
    <label className="block space-y-1 text-xs"><span>{text.search}</span><input type="search" className="field w-full" placeholder={text.searchHint} maxLength={200} value={state.query} onChange={(e) => change({ query: e.target.value })} /></label>
    <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
      <label className="min-w-0 space-y-1 text-xs"><span>{text.project}</span><select className="field w-full" value={project} onChange={(e) => { change({}); onProject(e.target.value); }}>
        <option value="">{text.allProjects}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        {project && !projects.some((p) => p.id === project) && <option value={project}>{project}</option>}
      </select></label>
      <label className="min-w-0 space-y-1 text-xs"><span>{text.agent}</span><select className="field w-full" value={state.agent} onChange={(e) => change({ agent: e.target.value })}>
        <option value="">{text.allAgents}</option>{[...new Set([...availableAgents, ...(state.agent ? [state.agent] : [])])].map((slug) => <option key={slug} value={slug}>{agents.find((a) => a.slug === slug)?.name ?? slug}</option>)}
      </select></label>
      <label className="min-w-0 space-y-1 text-xs"><span>{text.sort}</span><select className="field w-full" value={state.sort} onChange={(e) => change({ sort: e.target.value as InboxSort })}>
        <option value="priority">{text.priority}</option><option value="recent">{text.recent}</option>
      </select></label>
      {filtered && <button type="button" className="chip self-end justify-self-start" onClick={clear}>{text.clear}</button>}
    </div>
    <p role="status" aria-live="polite" className="muted text-xs">{loading && !tasks.length ? text.loading : `${text.showing} ${Math.min(view.rows.length, state.limit)} ${text.of} ${view.rows.length}`}</p>
    <ul className="space-y-2">
      {view.rows.slice(0, state.limit).map((task) => {
        const bucket = inboxBucket(task), hint = bucket === "attention" ? text.review : bucket === "failed" ? text.inspect : bucket === "active" ? text.follow : bucket === "done" ? text.result : text.cancelledAction;
        const preview = task.error || task.result || task.request;
        return <li key={task.id}><button type="button" className="card w-full min-w-0 space-y-2 text-left" onClick={() => onOpen(task.id)} aria-label={`${text.open}: ${task.title || text.untitled}`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><strong className="min-w-0 break-words text-sm">{task.title || text.untitled}</strong><span className="text-xs text-cyan-200">{hint} →</span></div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs"><OpsStatus raw={task.status} pending={task.pending} at={lastProgress(task.finished_at, task.started_at, task.created_at)} /><span className="muted">{agents.find((a) => a.slug === task.agent)?.name ?? task.agent}</span>
            {task.project_id && <span className="muted">· {projects.find((p) => p.id === task.project_id)?.name ?? task.project_id}</span>}
          </div>
          {preview && <p className={`line-clamp-2 break-words text-xs ${task.error ? "error" : "muted"}`}>{preview}</p>}
        </button></li>;
      })}
    </ul>
    {!loading && !view.rows.length && !error && <div className="card space-y-2 text-sm"><p>{tasks.length || filtered ? text.noMatches : text.empty}</p>{filtered && <button type="button" className="chip" onClick={clear}>{text.clear}</button>}</div>}
    {view.rows.length > state.limit && <button type="button" className="chip" onClick={() => onChange({ ...state, limit: state.limit + 20 })}>{text.more}</button>}
  </section>;
}
