"use client";
// OPERATIONS → Plans: long jobs kept as a plan file (plan-jobs-pure.ts). Each step runs as one ordinary agent task, one per session;
// the list shows the plan, which step is running (with its task) and the progress log. Polls every 10 s while visible.
import { useCallback, useState } from "react";
import { usePoll } from "./use-poll";
import { pollMs } from "@/lib/poll-pure";
import type { PlanJob } from "@/lib/plan-jobs-pure";
import { useT } from "./i18n";

const call = async <T,>(method: string, body?: unknown): Promise<T> => {
  const r = await fetch("/api/plan-jobs", { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j as T;
};
const MARK = { todo: "○", doing: "◐", done: "●", failed: "✕" } as const;

export function PlanJobsView({ agents, onOpenTask }: { agents: { slug: string; name: string; enabled?: boolean }[]; onOpenTask: (id: string) => void }) {
  const { t } = useT();
  const [jobs, setJobs] = useState<PlanJob[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", agent: "nova", goal: "", steps: "", night: true });
  const load = useCallback(() => void call<{ jobs: PlanJob[] }>("GET").then((r) => { setJobs(r.jobs); setErr(""); }, (e: Error) => setErr(e.message)), []);
  usePoll(load, pollMs(10_000));

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setErr("");
    try { await fn(); load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const act = (j: PlanJob, action: "pause" | "resume" | "retry" | "delete") => {
    if (action === "delete" && !confirm(t("plans.deleteConfirm", { name: j.title }))) return;
    void run(() => call("PATCH", { id: j.id, action }));
  };
  const create = (e: React.FormEvent) => { e.preventDefault(); void run(async () => { await call("POST", draft); setDraft({ ...draft, title: "", goal: "", steps: "" }); }); };

  return <div className="space-y-4">
    <p className="muted text-xs">{t("plans.intro")}</p>
    <form onSubmit={create} className="card space-y-2 text-sm" aria-label={t("plans.new")}>
      <input className="field w-full" value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={t("plans.title")} aria-label={t("plans.title")} />
      <textarea className="field w-full" rows={2} value={draft.goal} maxLength={2000} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} placeholder={t("plans.goal")} aria-label={t("plans.goal")} />
      <textarea className="field w-full" rows={4} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} placeholder={t("plans.steps")} aria-label={t("plans.steps")} />
      <div className="flex flex-wrap items-center gap-2">
        <select className="field" value={draft.agent} onChange={(e) => setDraft({ ...draft, agent: e.target.value })} aria-label={t("plans.agent")}>
          {agents.filter((a) => a.enabled !== false).map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.night} onChange={(e) => setDraft({ ...draft, night: e.target.checked })} />{t("plans.night")}</label>
        <button className="btn" disabled={busy || draft.title.trim().length < 3 || !draft.steps.trim()}>{t("plans.create")}</button>
      </div>
    </form>
    {err && <p className="error" role="alert">{err}</p>}
    {jobs && !jobs.length && <p className="muted text-sm">{t("plans.empty")}</p>}
    <ul className="space-y-2">{(jobs ?? []).map((j) => {
      const done = j.steps.filter((s) => s.status === "done").length;
      return <li key={j.id} className="card text-sm">
        <div className="flex items-center justify-between gap-2">
          <b className={j.status === "active" ? "" : "muted"}>{j.title}</b>
          <span className="flex gap-1.5">
            {j.status === "active" && <button className="chip" disabled={busy} onClick={() => act(j, "pause")}>{t("plans.pause")}</button>}
            {j.status === "paused" && <button className="chip" disabled={busy} onClick={() => act(j, "resume")}>{t("plans.resume")}</button>}
            {j.steps.some((s) => s.status === "failed") && <button className="chip" disabled={busy} onClick={() => act(j, "retry")}>{t("plans.retry")}</button>}
            <button className="chip" disabled={busy} onClick={() => act(j, "delete")} aria-label={`${t("plans.delete")}: ${j.title}`}>{t("plans.delete")}</button>
          </span>
        </div>
        <div className="muted text-xs">{t(`plans.status.${j.status}`)} · {done}/{j.steps.length} · {j.agent}{j.night ? ` · ${t("plans.nightOnly")}` : ""}</div>
        <ol className="mt-1 space-y-0.5 text-xs">{j.steps.map((s) => <li key={s.id} data-status={s.status}>
          <span aria-label={t(`plans.step.${s.status}`)}>{MARK[s.status]}</span> {s.text}
          {s.task && <> · <button className="link" onClick={() => onOpenTask(s.task!)}>{t("plans.task")}</button></>}
          {s.note && <span className={s.status === "failed" ? "error" : "muted"}> · {s.note}</span>}
        </li>)}</ol>
        {!!j.progress.length && <details className="mt-1 text-xs"><summary className="cursor-pointer muted">{t("plans.progress")}</summary>
          <ul>{j.progress.slice().reverse().map((p, i) => <li key={i} className="muted">{p}</li>)}</ul></details>}
      </li>;
    })}</ul>
  </div>;
}
