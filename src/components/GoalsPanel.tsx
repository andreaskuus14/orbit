"use client";
import { useCallback, useEffect, useState } from "react";
import { StatusPill, api, usePoll } from "./AgentMission";
import { TwinCard } from "./TwinCard";
import { CourtPanel } from "./CourtPanel";
import { move } from "@/lib/mission-pure";
import { linePath, toPoints } from "@/lib/chart-pure";
import type { Goal, MetricKind, StepDraft } from "@/lib/goals-pure";
import { daily, forecast, type Forecast } from "@/lib/forecast-pure";
import { EVIDENCE, EVIDENCE_KINDS, type EvidenceKind } from "@/lib/goal-autopilot-pure";
import type { GoalTrack } from "@/lib/goal-autopilot";
import { DreamsList } from "./DreamsList";
import { useT } from "./i18n";

// 🎯 GOALS in the Agents Station: list, new-goal form, goal detail (plan editor, step timeline, metric sparkline, learned, log).
// Polling GET /api/goals is itself one of the events that advances a goal (there is no schedule). Goal text and results are untrusted:
// rendered as React text only.

type Roster = { slug: string; name: string; color: string }[];
export type GoalView = Goal & { id: string; createdAt: string; updatedAt: string; progress: { now: number | null; target: number | null; pct: number | null }; runsLeft: number; track?: GoalTrack };
type Edit = StepDraft & { key: number };
let nextKey = 1;
const METRICS: { kind: MetricKind; label: string }[] = [
  { kind: "none", label: "No metric" }, { kind: "steps", label: "Checklist (plan steps done)" },
  { kind: "youtube_subscribers", label: "YouTube subscribers (STUDIO)" }, { kind: "manual", label: "A number I enter" },
];
const EDITABLE = ["draft", "approved", "waiting", "paused", "blocked"];
const post = (body: object) => api<GoalView | { ok: true }>("/api/goals", { method: "POST", body: JSON.stringify(body) });

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <p className="muted text-xs">{values.length ? `One sample: ${values[0]}` : "No samples yet."}</p>;
  const box = { x0: 2, x1: 198, y0: 4, y1: 36 }, lo = Math.min(...values), hi = Math.max(...values);
  return (
    <svg viewBox="0 0 200 40" className="h-10 w-full" role="img" aria-label={`Metric from ${values[0]} to ${values[values.length - 1]} over ${values.length} samples`}>
      <path d={linePath(toPoints(values, box, hi, lo), box)} fill="none" stroke="var(--cyan)" strokeWidth={1.5} />
    </svg>
  );
}

/** History line + shaded p10–p90 cone from the last reading to the deadline + dashed target line. */
function Fan({ g, f }: { g: GoalView; f: Forecast }) {
  const pts = daily(g.metric.samples), p = f.projected, target = g.metric.target;
  if (!p || !g.deadline || target === undefined || pts.length < 2) return null;
  const t0 = pts[0].t, t1 = Date.parse(`${g.deadline}T00:00:00Z`) + 86_400_000, last = pts[pts.length - 1];
  const ys = [...pts.map((q) => q.v), p.p10, p.p90, target], lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const X = (t: number) => +(2 + (196 * (t - t0)) / (t1 - t0 || 1)).toFixed(1), Y = (v: number) => +(56 - (52 * (v - lo)) / span).toFixed(1);
  return (
    <svg viewBox="0 0 200 60" className="h-16 w-full" role="img" aria-label={`Forecast: ${Math.round(p.p10)} to ${Math.round(p.p90)} by ${g.deadline}, target ${target}`}>
      <polygon points={`${X(last.t)},${Y(last.v)} ${X(t1)},${Y(p.p90)} ${X(t1)},${Y(p.p10)}`} fill="var(--cyan)" opacity={0.18} />
      <line x1={X(last.t)} y1={Y(last.v)} x2={X(t1)} y2={Y(p.p50)} stroke="var(--cyan)" strokeWidth={1} strokeDasharray="3 2" />
      <line x1={2} x2={198} y1={Y(target)} y2={Y(target)} stroke={f.onTrack ? "#4ade80" : "#fbbf24"} strokeWidth={1} strokeDasharray="2 3" />
      <polyline points={pts.map((q) => `${X(q.t)},${Y(q.v)}`).join(" ")} fill="none" stroke="var(--cyan)" strokeWidth={1.5} />
    </svg>
  );
}

const TRACK_COLOR = { "on-track": "#4ade80", "at-risk": "#fbbf24", behind: "#f87171", done: "#4ade80" } as const;

/** Burn-up: dashed plan line through the weekly checkpoints, solid actual count, both cumulative. */
function BurnUp({ t }: { t: GoalTrack }) {
  const pts = t.burnup;
  if (pts.length < 2) return null;
  const hi = Math.max(1, ...pts.map((p) => Math.max(p.plan, p.actual ?? 0)));
  const X = (k: number) => +(2 + (196 * k) / (pts.length - 1)).toFixed(1), Y = (v: number) => +(56 - (52 * v) / hi).toFixed(1);
  const act = pts.flatMap((p, k) => (p.actual === null ? [] : [`${X(k)},${Y(p.actual)}`])).join(" ");
  return (
    <svg viewBox="0 0 200 60" className="h-16 w-full" role="img" aria-label={`Burn-up: ${t.actual} done, plan ${Math.floor(t.expected)} by today, ${t.track}`}>
      <polyline points={pts.map((p, k) => `${X(k)},${Y(p.plan)}`).join(" ")} fill="none" stroke="var(--line, #888)" strokeWidth={1} strokeDasharray="3 2" />
      <polyline points={act} fill="none" stroke={TRACK_COLOR[t.track]} strokeWidth={1.5} />
    </svg>
  );
}

function Milestones({ g, busy, act }: { g: GoalView; busy: boolean; act: (b: object, c?: string) => Promise<boolean> }) {
  const { t: tr } = useT();
  const [kind, setKind] = useState<EvidenceKind>("shorts");
  const [total, setTotal] = useState("");
  const t = g.track, ap = g.autopilot, id = g.id;
  if (!g.deadline || ["done", "stopped"].includes(g.status) && !ap) return null;
  if (!ap || !t) return (
    <form className="card flex flex-wrap items-end gap-1.5" aria-label={tr("goal.setMilestones")} onSubmit={(e) => { e.preventDefault(); void act({ action: "milestones", id, evidence: kind, total: Number(total) }); }}>
      <span className="hud-title w-full text-[0.7rem]">{tr("goal.milestones").toUpperCase()}</span>
      <label className="min-w-0 flex-1"><span className="muted">{tr("goal.count")}</span><select className="field w-full" value={kind} onChange={(e) => setKind(e.target.value as EvidenceKind)}>{EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{EVIDENCE[k].label}</option>)}</select></label>
      <label className="w-24"><span className="muted">{tr("goal.totalBy", { d: g.deadline })}</span><input className="field w-full" type="number" min={1} required value={total} onChange={(e) => setTotal(e.target.value)} /></label>
      <button className="btn" disabled={busy || !total}>{tr("goal.setBtn")}</button>
    </form>
  );
  const r = t.replan;
  return (
    <section className="card space-y-1" aria-label={tr("goal.milestones")}>
      <div className="flex justify-between"><span className="hud-title text-[0.7rem]">{tr("goal.milestones").toUpperCase()}</span><b style={{ color: TRACK_COLOR[t.track] }}>{t.track}</b></div>
      <p className="muted">{t.actual} / {ap.total} {t.label} · {tr("goal.pace", { plan: Math.floor(t.expected), pace: t.pace })}</p>
      <BurnUp t={t} />
      <ol className="space-y-0.5">{t.checks.map((c) => (
        <li key={c.due} className="flex justify-between gap-2"><span className="min-w-0 break-words">{c.due.slice(5)} · {c.doneWhen}</span>
          <span style={{ color: c.met === true ? "#4ade80" : c.met === false ? "#f87171" : undefined }}>{c.actual}/{c.target} {c.met === true ? "✓" : c.met === false ? "✗" : ""}</span></li>
      ))}</ol>
      {r && (
        <div className="card space-y-1" style={{ borderColor: "#f87171" }} aria-label={tr("goal.replanAria")}>
          <p><b>{tr("goal.replan")}</b> {r.kind === "shift" ? tr("goal.shift", { d: r.deadline }) : r.kind === "cut" ? tr("goal.cut", { n: r.total, label: t.label }) : tr("goal.catchUp", { what: r.step.what })}</p>
          <p className="muted">{r.why}</p>
          <button className="btn" disabled={busy} onClick={() => void act({ action: "replan", id, seen: r })}>{tr("goal.acceptReplan")}</button>
        </div>
      )}
      <button className="chip" disabled={busy} onClick={() => void act({ action: "phrase", id })}>{tr("goal.phrase")}</button>
    </section>
  );
}

export default function GoalsPanel({ agents, visible, onOpenTask, focusId }: { agents: Roster; visible: boolean; onOpenTask?: (id: string) => void; focusId?: string | null }) {
  const { t: tr } = useT();
  const [goals, setGoals] = useState<GoalView[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (focusId) setOpen(focusId); }, [focusId]);
  const [creating, setCreating] = useState(false);
  const [court, setCourt] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<{ goals: GoalView[] }>("/api/goals").then((r) => { setGoals(r.goals); setErr(""); }).catch((e) => setErr(e.message)); }, []);
  const live = (goals ?? []).some((g) => g.status === "running" || g.planning);
  usePoll(load, live ? 5_000 : 30_000, visible);
  const name = (slug: string) => agents.find((a) => a.slug === slug)?.name ?? slug;
  const color = (slug: string) => agents.find((a) => a.slug === slug)?.color;

  async function act(body: object, confirmText?: string): Promise<boolean> {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true); setErr("");
    try { await post(body); load(); return true; } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); return false; } finally { setBusy(false); }
  }

  const g = goals?.find((x) => x.id === open);
  if (court) return <CourtPanel onBack={() => setCourt(false)} />;
  if (creating) return <NewGoal agents={agents} onDone={(id) => { setCreating(false); if (id) setOpen(id); load(); }} />;
  if (g) return <Detail key={g.id} g={g} busy={busy} err={err} act={act} name={name} color={color} agents={agents} onBack={() => setOpen(null)} onOpenTask={onOpenTask} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="muted text-xs">{tr("goal.intro")}</p>
        <span className="flex shrink-0 gap-1.5"><button className="chip" onClick={() => setCourt(true)} title={tr("goal.courtTitle")}>⚖ {tr("goal.decide")}</button><button className="btn" onClick={() => setCreating(true)}>+ {tr("goal.new")}</button></span>
      </div>
      {!goals ? <p className="muted text-xs">{err ? "" : tr("common.loading")}</p> : !goals.length ? <p className="muted text-xs">{tr("goal.none")}</p> : (
        <ul className="space-y-2 text-xs">
          {goals.map((x) => (
            <li key={x.id}>
              <button className="card w-full space-y-1 text-left" onClick={() => setOpen(x.id)} aria-label={`${x.title}, ${x.status}`}>
                <span className="flex items-start justify-between gap-2"><b className="min-w-0 break-words">{x.title}</b><StatusPill status={x.status} /></span>
                <span className="muted block">{tr("goal.steps", { done: x.steps.filter((s) => s.status === "done").length, n: x.steps.length })}{x.progress.now !== null ? ` · ${x.progress.now}${x.progress.target !== null ? ` / ${x.progress.target}` : ""}` : ""}{x.waitingFor ? tr("goal.waitingShort", { who: x.waitingFor }) : ""}{x.track ? ` · ${x.track.track}` : ""}{x.planning ? tr("goal.draftingShort") : ""}</span>
                {x.progress.pct !== null && <span className="block h-1 rounded bg-white/10"><span className="block h-1 rounded" style={{ width: `${x.progress.pct}%`, background: "var(--cyan)" }} /></span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <DreamsList onGoal={load} />
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

function NewGoal({ agents, onDone }: { agents: Roster; onDone: (id?: string) => void }) {
  const { t: tr } = useT();
  const [f, setF] = useState({ title: "", why: "", kind: "none" as MetricKind, target: "", how: "", deadline: "", runsPerDay: 4, callsPerStep: 8 });
  const [picked, setPicked] = useState<string[]>(() => agents.filter((a) => ["atlas", "forge", "nova"].includes(a.slug)).map((a) => a.slug));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const r = await api<GoalView>("/api/goals", { method: "POST", body: JSON.stringify({ title: f.title, why: f.why, deadline: f.deadline || undefined, agents: picked,
        metric: { kind: f.kind, how: f.how, target: f.target === "" ? undefined : Number(f.target) }, budget: { runsPerDay: f.runsPerDay, callsPerStep: f.callsPerStep } }) });
      onDone(r.id);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not create the goal"); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-2 text-xs" aria-label={tr("goal.new")}>
      <button type="button" className="chip" onClick={() => onDone()}>{tr("goal.back")}</button>
      <label className="block"><span className="hud-title text-[0.7rem]">{tr("goal.goal").toUpperCase()}</span><input className="field w-full" required maxLength={200} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={tr("goal.titlePh")} /></label>
      <label className="block"><span className="hud-title text-[0.7rem]">{tr("goal.why").toUpperCase()}</span><textarea className="field min-h-[3rem] w-full" maxLength={1000} value={f.why} onChange={(e) => set({ why: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="muted">{tr("goal.metricLbl")}</span>
          <select className="field w-full" value={f.kind} onChange={(e) => set({ kind: e.target.value as MetricKind })}>{METRICS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}</select></label>
        <label className="block"><span className="muted">{tr("goal.target")}</span><input className="field w-full" type="number" disabled={f.kind === "none" || f.kind === "steps"} value={f.target} onChange={(e) => set({ target: e.target.value })} /></label>
      </div>
      {f.kind !== "none" && <label className="block"><span className="muted">{tr("goal.how")}</span><input className="field w-full" maxLength={200} value={f.how} onChange={(e) => set({ how: e.target.value })} /></label>}
      <label className="block"><span className="muted">{tr("goal.deadlineOpt")}</span><input className="field w-full" type="date" value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} /></label>
      <fieldset className="card"><legend className="muted px-1">{tr("goal.agents")}</legend>
        <div className="flex flex-wrap gap-2">{agents.map((a) => (
          <label key={a.slug} className="flex items-center gap-1"><input type="checkbox" checked={picked.includes(a.slug)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.slug] : p.filter((x) => x !== a.slug)))} /><span style={{ color: a.color }}>{a.name}</span></label>
        ))}</div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="muted">{tr("goal.runsDay")}</span><input className="field w-full" type="number" min={1} max={20} value={f.runsPerDay} onChange={(e) => set({ runsPerDay: Number(e.target.value) })} /></label>
        <label className="block"><span className="muted">{tr("goal.callsStep")}</span><input className="field w-full" type="number" min={2} max={12} value={f.callsPerStep} onChange={(e) => set({ callsPerStep: Number(e.target.value) })} /></label>
      </div>
      <button className="btn" disabled={busy || !picked.length}>{tr(busy ? "goal.creating" : "goal.create")}</button>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

function Detail({ g, busy, err, act, name, color, agents, onBack, onOpenTask }: {
  g: GoalView; busy: boolean; err: string; act: (b: object, c?: string) => Promise<boolean>; name: (s: string) => string; color: (s: string) => string | undefined;
  agents: Roster; onBack: () => void; onOpenTask?: (id: string) => void;
}) {
  const { t: tr } = useT();
  const pending = g.steps.filter((s) => s.status === "pending");
  const [edit, setEdit] = useState<Edit[] | null>(null);
  const [baseIds, setBaseIds] = useState<string[]>([]); // pending step ids when editing started: the server refuses a save over a moved plan
  const allowed = agents.filter((a) => g.agents.includes(a.slug));
  const next = g.steps.findIndex((s) => s.status !== "done");
  const [val, setVal] = useState("");
  const startEdit = () => {
    setBaseIds(pending.map((s) => s.id));
    setEdit(pending.map((s) => ({ what: s.what, agent: s.agent, expected: s.expected, needsApproval: s.needsApproval, key: nextKey++ })));
  };
  const setE = (k: number, p: Partial<Edit>) => setEdit((x) => x && x.map((y) => (y.key === k ? { ...y, ...p } : y)));
  const id = g.id;

  return (
    <div className="space-y-3 text-xs">
      <button className="chip" onClick={onBack}>{tr("goal.back")}</button>
      <div className="flex items-start justify-between gap-2"><h3 className="break-words text-sm font-semibold">🎯 {g.title}</h3><StatusPill status={g.status} /></div>
      {g.why && <p className="muted break-words">{g.why}</p>}
      <p className="muted">{g.deadline ? `${tr("goal.deadline", { d: g.deadline })}${g.deadline < new Date().toISOString().slice(0, 10) && g.status !== "done" ? tr("goal.passed") : ""} · ` : ""}{tr("goal.budget", { left: g.runsLeft, max: g.budget.runsPerDay, calls: g.budget.callsPerStep })}</p>
      {g.waitingFor && <p style={{ color: "#fbbf24" }}>{tr("goal.waiting", { who: g.waitingFor })}</p>}
      {g.blocker && <p className="error break-words">{tr("goal.blocker")} {g.blocker}</p>}
      {g.planning && <p className="muted" role="status">{tr("goal.drafting")}</p>}
      {g.planError && <p className="error break-words">{g.planError}</p>}
      {g.status === "draft" && !g.planning && g.steps.length >= 3 && <TwinCard decision={{ kind: "goal-plan", ref: id, title: g.title, detail: [g.why, ...g.steps.map((s, i) => `${i + 1}. ${s.what}`)].filter(Boolean).join("\n") }} />}

      <div className="flex flex-wrap gap-1.5">
        {g.status === "draft" && !edit && <button className="btn" disabled={busy || g.steps.length < 3} onClick={() => void act({ action: "approve", id, stepIds: g.steps.map((s) => s.id) })}>{tr("goal.approvePlan")}</button>}
        {g.status === "draft" && <button className="chip" disabled={busy || !!g.planning} onClick={() => void act({ action: "redraft", id })}>{tr("goal.redraft")}</button>}
        {["approved", "waiting", "blocked"].includes(g.status) && <button className="btn" disabled={busy} onClick={() => void act({ action: "continue", id })}>{tr("goal.continue")}</button>}
        {["approved", "running", "waiting", "blocked"].includes(g.status) && <button className="chip" disabled={busy} onClick={() => void act({ action: "pause", id })}>{tr("rules.pause")}</button>}
        {g.status === "paused" && <button className="btn" disabled={busy} onClick={() => void act({ action: "resume", id })}>{tr("stop.resume")}</button>}
        {!["done", "stopped"].includes(g.status) && <button className="chip" disabled={busy} onClick={() => void act({ action: "stop", id }, tr("goal.stopConfirm"))}>{tr("core.stop")}</button>}
        {["draft", "done", "stopped"].includes(g.status) && <button className="chip" disabled={busy} onClick={() => void act({ action: "delete", id }, tr("goal.deleteConfirm")).then((ok) => ok && onBack())}>{tr("rules.delete")}</button>}
      </div>

      {g.metric.kind !== "none" && (
        <section className="card space-y-1" aria-label={tr("goal.metric")}>
          <div className="flex justify-between"><span className="hud-title text-[0.7rem]">{tr("goal.metric").toUpperCase()}</span><span>{g.progress.now ?? "–"}{g.progress.target !== null ? ` / ${g.progress.target}` : ""}{g.progress.pct !== null ? ` (${g.progress.pct}%)` : ""}</span></div>
          {g.metric.how && <p className="muted break-words">{g.metric.how}</p>}
          {g.metric.kind !== "steps" && (() => {
            const f = forecast(g.metric.samples, g.metric.target, g.deadline);
            return <>{f.projected && g.deadline ? <Fan g={g} f={f} /> : <Spark values={g.metric.samples.map((s) => s.value)} />}<p className="muted text-xs">{f.summary}</p></>;
          })()}
          {g.metric.kind === "manual" && <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void act({ action: "metric", id, value: Number(val) }).then((ok) => ok && setVal("")); }}>
            <input className="field min-w-0 flex-1 !py-1" type="number" value={val} onChange={(e) => setVal(e.target.value)} aria-label={tr("goal.newValue")} /><button className="chip" disabled={busy || val === ""}>{tr("goal.record")}</button></form>}
        </section>
      )}

      <Milestones g={g} busy={busy} act={act} />

      {g.proposal && (
        <section className="card space-y-1" style={{ borderColor: "#fbbf24" }} aria-label={tr("goal.proposalAria")}>
          <p><b>{tr("goal.proposal")}</b> {g.proposal.reason}</p>
          <ol className="list-decimal pl-5">{g.proposal.steps.map((s, k) => <li key={k}><b style={{ color: color(s.agent) }}>{name(s.agent)}</b> {s.what}{s.needsApproval ? tr("goal.needsOk") : ""}</li>)}</ol>
          <div className="flex gap-1.5"><button className="btn" disabled={busy} onClick={() => void act({ action: "proposal", id, accept: true })}>{tr("goal.apply")}</button><button className="chip" disabled={busy} onClick={() => void act({ action: "proposal", id, accept: false })}>{tr("goal.keep")}</button></div>
        </section>
      )}

      <section aria-label={tr("goal.plan")}>
        <div className="flex items-center justify-between"><span className="hud-title">{tr("goal.plan").toUpperCase()}</span>
          {EDITABLE.includes(g.status) && !edit && <button className="chip" onClick={startEdit}>{tr("goal.editSteps")}</button>}</div>
        {edit ? (
          <div className="mt-1 space-y-2">
            {edit.map((s, i) => (
              <div key={s.key} className="card space-y-1" style={{ borderLeft: `3px solid ${color(s.agent) ?? "var(--line)"}` }}>
                <div className="flex items-center gap-1">
                  <select className="field min-w-0 flex-1 !py-1" value={s.agent} onChange={(e) => setE(s.key, { agent: e.target.value })} aria-label={tr("goal.stepAgent", { n: i + 1 })}>{allowed.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select>
                  <button className="chip !px-2" disabled={i === 0} onClick={() => setEdit((x) => x && move(x, i, -1))} aria-label={tr("goal.stepUp", { n: i + 1 })}>↑</button>
                  <button className="chip !px-2" disabled={i === edit.length - 1} onClick={() => setEdit((x) => x && move(x, i, 1))} aria-label={tr("goal.stepDown", { n: i + 1 })}>↓</button>
                  <button className="chip !px-2" onClick={() => setEdit((x) => x && x.filter((y) => y.key !== s.key))} aria-label={tr("goal.stepRemove", { n: i + 1 })}>✕</button>
                </div>
                <textarea className="field w-full" maxLength={500} value={s.what} onChange={(e) => setE(s.key, { what: e.target.value })} aria-label={tr("goal.stepWhat", { n: i + 1 })} />
                <input className="field w-full" maxLength={300} value={s.expected} onChange={(e) => setE(s.key, { expected: e.target.value })} placeholder={tr("goal.expectedPh")} aria-label={tr("goal.stepExpected", { n: i + 1 })} />
                <label className="flex items-center gap-1"><input type="checkbox" checked={s.needsApproval} onChange={(e) => setE(s.key, { needsApproval: e.target.checked })} /> {tr("goal.waitOk")}</label>
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              <button className="chip" onClick={() => setEdit((x) => x && [...x, { what: "", agent: allowed[0]?.slug ?? "nova", expected: "", needsApproval: false, key: nextKey++ }])}>+ {tr("goal.addStep")}</button>
              <button className="btn" disabled={busy} onClick={() => void act({ action: "edit", id, steps: edit, baseIds }).then((ok) => ok && setEdit(null))}>{tr("goal.saveSteps")}</button>
              <button className="chip" onClick={() => setEdit(null)}>{tr("common.cancel")}</button>
            </div>
            <p className="muted">{tr("goal.risky")}</p>
          </div>
        ) : !g.steps.length ? <p className="muted">{tr(g.planning ? "goal.draftingDots" : "goal.noSteps")}</p> : (
          <ol className="mt-1 space-y-1">
            {g.steps.map((s, i) => (
              <li key={s.id}>
                <details open={i === next}>
                  <summary className="flex cursor-pointer items-center justify-between gap-2">
                    <span className="min-w-0 truncate"><b style={{ color: color(s.agent) }}>{i + 1}. {name(s.agent)}</b> {s.what}{s.needsApproval ? " ⚠" : ""}</span>
                    <StatusPill status={s.status === "waiting" ? "awaiting_approval" : s.status} />
                  </summary>
                  <div className="mt-1 space-y-1 pl-3">
                    <p className="muted whitespace-pre-wrap break-words">{s.what}{s.expected ? `\n${tr("goal.expected", { e: s.expected })}` : ""}</p>
                    {s.result && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words">{s.result}</p>}
                    {s.reflection && <p className="break-words"><b>{tr("goal.reflection")}{s.moved ? tr("goal.moved", { m: s.moved }) : ""}:</b> {s.reflection}</p>}
                    {s.error && <p className="error break-words">{s.error}</p>}
                    {i === next && s.status === "pending" && s.needsApproval && !s.ok && ["approved", "waiting", "paused"].includes(g.status) &&
                      <button className="btn" disabled={busy} onClick={() => void act({ action: "ok", id, step: i, stepId: s.id })}>{tr("goal.okRun")}</button>}
                    {s.status === "waiting" && s.taskId && onOpenTask && <button className="link" style={{ color: "#fbbf24" }} onClick={() => onOpenTask(s.taskId!)}>{tr("goal.needsApproval")}</button>}
                    {s.taskId && s.status !== "waiting" && onOpenTask && <button className="link" onClick={() => onOpenTask(s.taskId!)}>{tr("goal.openTask")}</button>}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>

      {g.learned.length > 0 && <section aria-label={tr("goal.learned")}><div className="hud-title">{tr("goal.learned").toUpperCase()}</div><ul className="list-disc pl-5">{g.learned.map((l, k) => <li key={k} className="break-words">{l}</li>)}</ul></section>}
      <section aria-label={tr("goal.timeline")}><div className="hud-title">{tr("goal.timeline").toUpperCase()}</div>
        <ul className="muted space-y-0.5">{[...g.log].reverse().slice(0, 15).map((e, k) => <li key={k}>{e.at.slice(5, 16).replace("T", " ")} · {e.text}</li>)}</ul></section>
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
