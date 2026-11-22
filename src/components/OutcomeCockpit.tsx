"use client";
// ORBIT Outcome Engine — Project Cockpit: one live cross-planet plan + one Review Desk with honest verification gates
// and explicit Rule 6 owner-click approvals. Pure rules: src/lib/outcome-cockpit-pure.ts.
import { useCallback, useEffect, useState } from "react";
import {
  distillOutcomeToSkill,
  healableSteps,
  pickRunnerKind,
  readySteps,
  type OutcomeProject,
  type OutcomeRunState,
  type OutcomeTemplateId,
  type ReviewDeskSummary,
} from "@/lib/outcome-cockpit-pure";
import type { ObjectionVerdict, PlanDebate } from "@/lib/outcome-debate-pure";
import type { Key } from "@/lib/i18n-pure";
import { useT } from "./i18n";

type ProjectRow = OutcomeProject & { summary: ReviewDeskSummary };

const STATUS_TONE: Record<ReviewDeskSummary["status"], string> = {
  active: "border-cyan-400/40 text-cyan-200",
  verifying: "border-sky-400/40 text-sky-200",
  needs_fix: "border-amber-400/50 text-amber-200",
  waiting_approval: "border-amber-400/60 text-amber-100",
  blocked: "border-rose-400/60 text-rose-200",
  verified: "border-emerald-400/60 text-emerald-200",
};

const RUN_TONE: Record<OutcomeRunState, string> = {
  queued: "border-white/20 bg-white/5 text-white/75",
  running: "border-cyan-400/40 bg-cyan-500/15 text-cyan-200",
  done: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
  failed: "border-rose-400/50 bg-rose-500/15 text-rose-200",
  blocked: "border-amber-400/50 bg-amber-500/15 text-amber-200",
};

const STARTERS: readonly Exclude<OutcomeTemplateId, "custom">[] = ["roblox-update", "week-of-shorts", "client-shop"];

export function OutcomeCockpit() {
  const { t } = useT();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"plan" | "review">("plan");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/outcomes", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { projects?: ProjectRow[] };
      const list = Array.isArray(j.projects) ? j.projects : [];
      setProjects(list);
      setSelectedId((prev) => (prev && list.some((x) => x.id === prev) ? prev : list[0]?.id ?? null));
    } catch { /* quiet on offline */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // while a plan review runs in the background, refresh until it lands
  const reviewing = projects.some((p) => p.debate?.status === "pending");
  useEffect(() => {
    if (!reviewing) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [reviewing, load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { project?: ProjectRow; error?: string };
      if (!r.ok || !j.project) { setErr(j.error || "Failed"); return; }
      setProjects((prev) => {
        const exists = prev.some((p) => p.id === j.project!.id);
        return exists ? prev.map((p) => (p.id === j.project!.id ? j.project! : p)) : [j.project!, ...prev];
      });
      setSelectedId(j.project.id);
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/outcomes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r.ok) {
        setProjects((prev) => {
          const next = prev.filter((p) => p.id !== id);
          setSelectedId((cur) => (cur === id ? next[0]?.id ?? null : cur));
          return next;
        });
      }
    } finally { setBusy(false); }
  };

  const createCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    const text = title.trim();
    setTitle("");
    await act({ action: "create", template: "custom", title: text });
  };

  const current = projects.find((p) => p.id === selectedId) ?? projects[0] ?? null;
  const readyIds = new Set(current ? readySteps(current).map((s) => s.id) : []);
  const linkedSteps = current ? current.steps.filter((s) => Boolean(s.runId)) : [];
  const healableCount = current ? healableSteps(current).length : 0;
  const canDistill = Boolean(current && !current.distilledSkillAt && distillOutcomeToSkill(current));

  const advanceAll = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "advance_background" }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErr(d.error || "Advance failed");
      } else {
        await load();
      }
    } catch {
      setErr("Could not reach ORBIT");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass rounded-2xl p-3.5 text-sm" aria-label={t("oe.title")}>
      <header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="brand text-sm tracking-wide">{t("oe.title")}</h2>
          <p className="muted text-xs">{t("oe.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STARTERS.map((tpl) => (
            <button key={tpl} type="button" className="chip text-xs" disabled={busy} onClick={() => void act({ action: "create", template: tpl })}>
              ＋ {t(`oe.tpl.${tpl}` as Key)}
            </button>
          ))}
        </div>
      </header>

      <form onSubmit={createCustom} className="mb-3 flex gap-2">
        <input
          className="field min-w-0 flex-1 py-1.5 text-xs"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("oe.placeholder")}
          aria-label={t("oe.placeholder")}
          maxLength={120}
        />
        <button type="submit" className="chip shrink-0 text-xs" disabled={busy || title.trim().length < 3}>
          {t("oe.create")}
        </button>
      </form>

      {err && <p className="error mb-2 text-xs" role="alert">{err}</p>}

      {!current && <p className="muted text-xs">{t("oe.empty")}</p>}

      {current && (
        <div className="space-y-3">
          {projects.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip text-xs"
                  style={p.id === current.id ? { borderColor: "var(--cyan)" } : undefined}
                  onClick={() => setSelectedId(p.id)}
                >
                  {p.title} · {p.summary.pct}%
                </button>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="truncate text-sm">{current.title}</strong>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[current.summary.status]}`}>
                    {t(`oe.st.${current.summary.status}` as Key)}
                  </span>
                  <span className="muted font-mono text-[11px]">{current.summary.pct}%</span>
                </div>
                <p className="muted mt-0.5 text-xs">{current.brief}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {current.planets.map((pl) => (
                    <span key={pl} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cyan-200/80">
                      {pl}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {healableCount > 0 && (
                  <button
                    type="button"
                    className="chip text-xs"
                    disabled={busy}
                    onClick={() => void act({ action: "auto_heal", id: current.id })}
                  >
                    ⚡ {t("oe.autoHeal")} ({healableCount})
                  </button>
                )}
                {current.distilledSkillName ? (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-200">
                    ★ {t("oe.distilled", { name: current.distilledSkillName })}
                  </span>
                ) : canDistill ? (
                  <button
                    type="button"
                    className="chip text-xs"
                    disabled={busy}
                    onClick={() => void act({ action: "distill", id: current.id })}
                  >
                    ★ {t("oe.distill")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="chip text-xs"
                  disabled={busy}
                  onClick={() => void advanceAll()}
                >
                  ▶ {t("oe.advanceBg")}
                </button>
                <button
                  type="button"
                  className="chip text-xs"
                  disabled={busy || linkedSteps.length === 0}
                  onClick={() => void act({ action: "sync_runs", id: current.id, autoHeal: true })}
                >
                  ↻ {t("oe.syncLive")}
                </button>
                <button type="button" className="chip text-xs" style={view === "plan" ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setView("plan")}>
                  {t("oe.tabPlan")}
                </button>
                <button type="button" className="chip text-xs" style={view === "review" ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setView("review")}>
                  {t("oe.tabReview")} ({current.summary.checksPassed}/{current.summary.checksTotal})
                </button>
                <button type="button" className="chip text-xs" disabled={busy} onClick={() => void remove(current.id)} aria-label={t("oe.delete")} title={t("oe.delete")}>
                  ×
                </button>
              </div>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${current.summary.pct}%` }} />
            </div>

            {current.blockers.some((b) => !b.resolved) && (
              <div className="mt-2.5 rounded-lg border border-rose-400/40 bg-rose-950/30 p-2 text-xs" role="alert">
                <strong className="text-rose-200">⚠ {t("oe.blockers")}</strong>
                <ul className="mt-1 space-y-1">
                  {current.blockers.filter((b) => !b.resolved).map((b) => (
                    <li key={b.id} className="text-rose-100">{b.message}</li>
                  ))}
                </ul>
              </div>
            )}

            {current.debate && (
              <PlanReview
                debate={current.debate}
                busy={busy}
                onSkip={() => void act({ action: "skip_review", id: current.id })}
                t={t}
              />
            )}

            {view === "plan" ? (
              <div className="mt-3 space-y-3">
                {current.summary.parallelReady > 0 && (
                  <div className="flex items-center justify-between rounded-lg border border-cyan-400/25 bg-cyan-950/20 px-2.5 py-1.5 text-xs">
                    <span>⚡ {t("oe.ready")}: {current.summary.parallelReady}</span>
                    <button type="button" className="chip text-xs" disabled={busy} onClick={() => void act({ action: "run_ready", id: current.id })}>
                      {t("oe.runReady", { n: current.summary.parallelReady })}
                    </button>
                  </div>
                )}

                <ol className="space-y-1.5">
                  {current.steps.map((s) => {
                    const rk = s.runnerKind ?? pickRunnerKind(s);
                    const canRunStep = !s.requiresApproval && (readyIds.has(s.id) || s.status === "needs_fix" || s.status === "blocked");
                    return (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span aria-hidden="true">{s.status === "verified" ? "✓" : s.status === "needs_fix" || s.status === "blocked" ? "✗" : s.status === "running" ? "▸" : s.status === "waiting_approval" ? "⏳" : "○"}</span>
                            <span className="font-medium">{s.title}</span>
                            <span className="muted font-mono text-[10px] uppercase">{s.planet} · {s.agent}</span>
                            {readyIds.has(s.id) && <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-200">{t("oe.ready")}</span>}
                            {s.reused && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200">{t("oe.reused")}</span>}
                            {s.runId && (
                              <span
                                className={`rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${RUN_TONE[s.runState ?? "running"]}`}
                                title={s.runNote || s.runId}
                              >
                                {t(`oe.runner.${rk}` as Key)} #{s.runId.slice(0, 6)} · {t(`oe.runState.${s.runState ?? "running"}` as Key)}
                              </span>
                            )}
                          </div>
                          {(s.note || s.runNote) && <p className="muted mt-0.5 text-[11px]">{s.note || s.runNote}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {canRunStep && (
                            <button
                              type="button"
                              className="chip text-[11px]"
                              disabled={busy}
                              onClick={() => void act({ action: "run_step", id: current.id, stepId: s.id })}
                            >
                              ▶ {t("oe.runStep")}
                            </button>
                          )}
                          {!s.requiresApproval && (s.status === "needs_fix" || s.status === "blocked") && (
                            <button type="button" className="chip text-[11px]" disabled={busy} onClick={() => void act({ action: "retry_fix", id: current.id, stepId: s.id })}>
                              {t("oe.fixRetry")}
                            </button>
                          )}
                          {!s.requiresApproval && s.status !== "verified" && (
                            <>
                              <button type="button" className="chip text-[11px]" disabled={busy} onClick={() => void act({ action: "step", id: current.id, stepId: s.id, status: "verified" })}>
                                {t("oe.verify")}
                              </button>
                              <button type="button" className="chip text-[11px]" disabled={busy} onClick={() => void act({ action: "step", id: current.id, stepId: s.id, status: "verified", reused: true })}>
                                {t("oe.reuse")}
                              </button>
                            </>
                          )}
                          {s.link && <a className="chip text-[11px]" href={s.link}>{t("oe.open")}</a>}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                <div>
                  <h3 className="muted mb-1.5 text-[11px] uppercase tracking-wider">{t("oe.checks")}</h3>
                  <ul className="space-y-1.5">
                    {current.checks.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs">
                        <div className="min-w-0 flex-1">
                          <span>{c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "○"} {c.label}</span>
                          {c.proof && <span className="muted block text-[11px]">{c.proof}</span>}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" className="chip text-[11px]" disabled={busy} onClick={() => void act({ action: "check", id: current.id, checkId: c.id, pass: true, proof: c.label })}>
                            {t("oe.pass")}
                          </button>
                          <button type="button" className="chip text-[11px]" disabled={busy} onClick={() => void act({ action: "check", id: current.id, checkId: c.id, pass: false, proof: c.label })}>
                            {t("oe.fail")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {linkedSteps.length > 0 && (
                  <div>
                    <h3 className="muted mb-1.5 text-[11px] uppercase tracking-wider">{t("oe.liveRunners")}</h3>
                    <ul className="space-y-1.5">
                      {linkedSteps.map((s) => {
                        const rk = s.runnerKind ?? pickRunnerKind(s);
                        const st = s.runState ?? "running";
                        return (
                          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs">
                            <div className="min-w-0 flex-1">
                              <span className="font-medium">{s.title}</span>
                              {s.runNote && <p className="muted text-[11px]">{s.runNote}</p>}
                            </div>
                            <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${RUN_TONE[st]}`}>
                              {t(`oe.runner.${rk}` as Key)} #{s.runId!.slice(0, 6)} · {t(`oe.runState.${st}` as Key)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="muted mb-1.5 text-[11px] uppercase tracking-wider">{t("oe.deliverables")}</h3>
                  <ul className="space-y-1.5">
                    {current.deliverables.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span>{d.verified ? "✓" : "○"}</span>
                            <strong>{d.title}</strong>
                          </div>
                          <p className="muted text-[11px]">{d.summary}</p>
                        </div>
                        {d.href && <a className="chip shrink-0 text-[11px]" href={d.href}>{t("oe.open")}</a>}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="muted mb-1.5 text-[11px] uppercase tracking-wider">{t("oe.approvals")}</h3>
                  {!current.summary.canApprove && current.approvals.some((a) => a.status === "waiting") && (
                    <p className="muted mb-1.5 text-xs">{t("oe.approveLocked")}</p>
                  )}
                  <ul className="space-y-1.5">
                    {current.approvals.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-950/20 px-2.5 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-200">{a.kind}</span>
                            <strong>{a.title}</strong>
                          </div>
                          <p className="muted mt-0.5 text-[11px]">{a.detail}</p>
                        </div>
                        {a.status === "waiting" ? (
                          <div className="flex shrink-0 gap-1.5">
                            <button type="button" className="chip text-xs" disabled={busy || !current.summary.canApprove} onClick={() => void act({ action: "approve", id: current.id, approvalId: a.id })}>
                              {t("oe.approve")}
                            </button>
                            <button type="button" className="chip text-xs" disabled={busy} onClick={() => void act({ action: "reject", id: current.id, approvalId: a.id })}>
                              {t("oe.reject")}
                            </button>
                          </div>
                        ) : (
                          <span className="muted font-mono text-[11px] uppercase">{a.status}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const VERDICT_MARK: Record<ObjectionVerdict, string> = { survived: "✓", dropped: "–", refused: "⛔" };

/** The critic-vs-planner result: what changed the plan, and what was argued away (with the planner's reason). */
function PlanReview({ debate, busy, onSkip, t }: { debate: PlanDebate; busy: boolean; onSkip: () => void; t: ReturnType<typeof useT>["t"] }) {
  if (debate.status === "pending") {
    return (
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-400/30 bg-violet-950/20 px-2.5 py-1.5 text-xs" role="status">
        <span>⚔ {t("oe.reviewPending")}</span>
        <button type="button" className="chip text-[11px]" disabled={busy} onClick={onSkip}>{t("oe.reviewSkip")}</button>
      </div>
    );
  }
  if (debate.status !== "done" || !debate.objections.length) {
    return <p className="muted mt-2.5 text-xs">⚔ {t("oe.reviewTitle")}: {debate.note}</p>;
  }
  const groups: [ObjectionVerdict, string][] = [["survived", t("oe.reviewSurvived")], ["dropped", t("oe.reviewDropped")], ["refused", t("oe.reviewRefused")]];
  return (
    <details className="mt-2.5 rounded-lg border border-violet-400/25 bg-violet-950/15 px-2.5 py-1.5 text-xs">
      <summary className="cursor-pointer">⚔ {t("oe.reviewTitle")}: {debate.note}</summary>
      {groups.map(([verdict, label]) => {
        const items = debate.objections.filter((o) => o.verdict === verdict);
        if (!items.length) return null;
        return (
          <div key={verdict} className="mt-2">
            <h4 className="muted text-[11px] uppercase tracking-wider">{label}</h4>
            <ul className="mt-1 space-y-1">
              {items.map((o) => (
                <li key={o.id}>
                  <span>{VERDICT_MARK[verdict]} <strong className="font-mono text-[10px] uppercase">{o.severity}</strong> {o.claim}</span>
                  <span className="muted block text-[11px]">{o.checkId ? `${t("oe.reviewAdded")}: ${o.fix}` : o.fix}{o.reply ? ` · ${o.reply}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </details>
  );
}
