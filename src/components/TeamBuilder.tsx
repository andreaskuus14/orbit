"use client";
import { useState } from "react";
import { useT } from "./i18n";
import { StatusPill, api } from "./AgentMission";
import type { ChainView } from "@/lib/chains-pure";
import { checkTeam, move } from "@/lib/mission-pure";
import { askConfirm } from "./ui/Dialog";

// AGENT TEAMS: build a 2-5 step chain (each step gets the previous result as data) and watch recent chains.
// The station owns the /api/chains polling (it also draws the hand-off beams); this panel only renders + acts.

type Roster = { slug: string; name: string; color: string }[];
type Step = { id: number; agent: string; request: string };
let nextId = 1;
const blank = (agent: string): Step => ({ id: nextId++, agent, request: "" });

export default function TeamBuilder({ agents, chains, error, onChanged, onOpenTask }: { agents: Roster; chains: ChainView[] | null; error?: string; onChanged: () => void; onOpenTask?: (id: string) => void }) {
  const { t } = useT();
  const first = agents[0]?.slug ?? "nova";
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState<Step[]>(() => [blank(first), blank(agents[1]?.slug ?? first)]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const name = (slug: string) => agents.find((a) => a.slug === slug)?.name ?? slug;
  const color = (slug: string) => agents.find((a) => a.slug === slug)?.color;
  const set = (id: number, patch: Partial<Step>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOk("");
    const draft = checkTeam(goal, steps, agents.map((a) => a.slug));
    if (typeof draft === "string") { setErr(draft); return; }
    setBusy(true);
    try {
      await api<{ chainId: string }>("/api/chains", { method: "POST", body: JSON.stringify(draft) });
      setOk(`Team started: ${draft.steps.map((s) => name(s.agent)).join(" → ")}`);
      setGoal(""); setSteps([blank(first), blank(agents[1]?.slug ?? first)]);
      onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not start the team"); }
    finally { setBusy(false); }
  }
  async function cancel(c: ChainView) {
    if (!(await askConfirm(`Cancel the team "${c.goal}"? The running step stops and later steps won't start.`))) return;
    setErr(""); setBusy(true);
    try { await api("/api/chains", { method: "POST", body: JSON.stringify({ action: "cancel", chainId: c.chainId }) }); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not cancel"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={start} className="space-y-2" aria-label={t("tmb.build")}>
        <label className="hud-title block text-[0.7rem]" htmlFor="team-goal"><span className="uppercase">{t("tmb.goal")}</span></label>
        <input id="team-goal" className="field w-full" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder={t("tmb.goalPh")} />
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.id} className="card space-y-1.5" style={{ borderLeft: `3px solid ${color(s.agent) ?? "var(--line)"}` }}>
              <div className="flex items-center gap-1.5">
                <span className="muted text-xs">{t("tmb.step", { n: i + 1 })}</span>
                <select className="field min-w-0 flex-1 !py-1 text-xs" value={s.agent} onChange={(e) => set(s.id, { agent: e.target.value })} aria-label={t("tmb.stepAgent", { n: i + 1 })}>
                  {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                </select>
                <button type="button" className="chip !px-2" disabled={i === 0} onClick={() => setSteps((x) => move(x, i, -1))} aria-label={t("tmb.up", { n: i + 1 })}>↑</button>
                <button type="button" className="chip !px-2" disabled={i === steps.length - 1} onClick={() => setSteps((x) => move(x, i, 1))} aria-label={t("tmb.down", { n: i + 1 })}>↓</button>
                <button type="button" className="chip !px-2" disabled={steps.length <= 2} onClick={() => setSteps((x) => x.filter((y) => y.id !== s.id))} aria-label={t("tmb.rm", { n: i + 1 })}>✕</button>
              </div>
              <textarea className="field min-h-[3.5rem] w-full text-xs" value={s.request} onChange={(e) => set(s.id, { request: e.target.value })} maxLength={2000}
                aria-label={t("tmb.req", { n: i + 1 })} placeholder={i ? t("tmb.reqNext", { name: name(s.agent) }) : t("tmb.reqFirst", { name: name(s.agent) })} />
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="chip" disabled={steps.length >= 5} onClick={() => setSteps((x) => [...x, blank(first)])}>{t("tmb.add")}</button>
          <button className="btn" disabled={busy || !agents.length}>{t("tmb.start")}</button>
        </div>
        {ok && <p className="text-xs" role="status" style={{ color: "var(--mint)" }}>{ok}</p>}
      </form>

      <section aria-label={t("tmb.recent")}>
        <div className="hud-title uppercase">{t("tmb.recent")}</div>
        {!chains ? <p className="muted text-xs">{error ? "" : t("tmb.loading")}</p> : !chains.length ? <p className="muted text-xs">{t("tmb.none")}</p> : (
          <ul className="mt-1 space-y-2 text-xs">
            {chains.map((c) => (
              <li key={c.chainId} className="card space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words font-medium">{c.goal}</p>
                  <StatusPill status={c.status} />
                </div>
                <ol className="space-y-1">
                  {c.steps.map((s) => (
                    <li key={s.index}>
                      <details>
                        <summary className="flex cursor-pointer items-center justify-between gap-2">
                          <span className="min-w-0 truncate"><b style={{ color: color(s.agent) }}>{s.index + 1}. {name(s.agent)}</b> <span className="muted">{s.request}</span></span>
                          <StatusPill status={s.status} />
                        </summary>
                        <div className="mt-1 space-y-1 pl-3">
                          {s.request && <p className="muted whitespace-pre-wrap break-words">{s.request}</p>}
                          {s.result && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{s.result}</p>}
                          {s.error && <p className="error break-words">{s.error}</p>}
                          {!s.result && !s.error && <p className="muted">{t("tmb.noResult")}</p>}
                          {s.status === "awaiting_approval" && s.taskId && onOpenTask && <button className="link" style={{ color: "#fbbf24" }} onClick={() => onOpenTask(s.taskId!)}>{t("tmb.needs")}</button>}
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
                {(c.status === "running" || c.status === "waiting") && <button className="chip" disabled={busy} onClick={() => void cancel(c)}>{t("tmb.cancel")}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {(err || error) && <p className="error" role="alert">{err || error}</p>}
    </div>
  );
}
