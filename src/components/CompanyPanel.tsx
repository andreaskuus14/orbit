"use client";
import { useCallback, useState } from "react";
import { StatusPill, api, usePoll } from "./AgentMission";
import { COMPANY, planCompany, type OrgSeat } from "@/lib/company-pure";
import type { ChainView } from "@/lib/chains-pure";
import type { CompanyTonight } from "@/lib/night-pure";

// AGENTS → Company: the built-in agents as a small company. The CEO (a planner in code, no Claude call) turns one goal into a chain of
// roles; each step hands its result forward and anything outward stops in the normal approvals queue (open the step to approve).

type View = { seats: OrgSeat[]; chains: ChainView[]; tonight: CompanyTonight[] };
const ago = (iso: string) => { const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60_000); return m < 60 ? `${Math.floor(m)}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

export default function CompanyPanel({ names, visible, onOpenTask }: { names: Record<string, string>; visible: boolean; onOpenTask?: (id: string) => void }) {
  const [v, setV] = useState<View | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => { api<View>("/api/company").then(setV).catch((e) => setMsg(e.message)); }, []);
  const live = v?.chains.some((c) => c.status === "running") ?? false;
  usePoll(load, live ? 5_000 : 30_000, visible);
  const plan = goal.trim().length >= 3 ? planCompany(goal) : null;
  const who = (agent: string) => names[agent] ?? agent;

  async function start(e: React.FormEvent, tonight = false) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try { await api("/api/company", { method: "POST", body: JSON.stringify({ goal, ...(tonight ? { tonight } : {}) }) }); setGoal(""); load(); }
    catch (e2) { setMsg(e2 instanceof Error ? e2.message : "Could not start"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={start} className="space-y-1.5" aria-label="Give the company a goal">
        <input className="field w-full" value={goal} maxLength={291} onChange={(e) => setGoal(e.target.value)} placeholder="One goal, e.g. research Roblox pet sim trends and write a plan" aria-label="Goal" />
        {plan && <p className="muted text-xs">{typeof plan === "string" ? plan : `CEO plan: ${plan.roles.slice(1).map((r) => COMPANY[r].title).join(" → ")} · at most ${plan.steps.reduce((n, s) => n + (s.calls ?? 0), 0)} Claude calls`}</p>}
        <div className="flex gap-1">
          <button className="chip" disabled={busy || !plan || typeof plan === "string"}>{busy ? "Starting…" : "Start"}</button>
          <button type="button" className="chip" disabled={busy || !plan || typeof plan === "string"} onClick={(e) => void start(e, true)}
            title="The night shift starts it and runs its steps within tonight's budget">🌙 Tonight</button>
        </div>
        <p className="muted text-xs">Nothing is sent, published or bought: saves and automations wait for your approval on the step.</p>
      </form>
      {msg && <p className="error text-xs" role="alert">{msg}</p>}
      {v && <>
        {v.tonight.length > 0 && <ul className="space-y-1" aria-label="Queued for tonight">
          {v.tonight.map((t) => (
            <li key={t.id} className="card text-xs flex justify-between gap-2"><span className="truncate">🌙 {t.goal}</span>
              <button className="chip" onClick={() => void api(`/api/company?tonight=${encodeURIComponent(t.id)}`, { method: "DELETE" }).then(load, (e) => setMsg(e.message))}
                aria-label={`Remove "${t.goal}" from tonight`}>Remove</button></li>
          ))}
        </ul>}
        <ul className="space-y-1" aria-label="Org chart">
          {v.seats.map((s) => (
            <li key={s.role} className="card text-xs space-y-0.5" style={s.role === "ceo" ? undefined : { marginLeft: "0.75rem" }}>
              <div className="flex justify-between gap-2">
                <span><b>{s.title}</b> · {who(s.agent)}{s.calls ? <span className="muted"> · ≤{s.calls} calls/step</span> : null}</span>
                <span title="Monthly agent scorecard grade">{s.grade ?? <span className="muted">no grade</span>} · {s.done} done</span>
              </div>
              {s.last ? <p className="muted truncate" title={s.last.output || s.last.title}>{ago(s.last.at)} · {s.last.status.replace("_", " ")} · {s.last.title}{s.last.output ? ` — ${s.last.output}` : ""}</p> : <p className="muted">No work yet</p>}
            </li>
          ))}
        </ul>
        {v.chains.length > 0 && <ul className="space-y-1.5" aria-label="Recent company runs">
          {v.chains.map((c) => (
            <li key={c.chainId} className="card text-xs space-y-1">
              <div className="flex justify-between gap-2"><span className="truncate">{c.goal.replace(/^Company: /, "")}</span><StatusPill status={c.status} /></div>
              <div className="flex flex-wrap gap-1">{c.steps.map((st) => (
                <button key={st.index} className="chip" disabled={!st.taskId || !onOpenTask} onClick={() => st.taskId && onOpenTask?.(st.taskId)}
                  aria-label={`Step ${st.index + 1}, ${who(st.agent)}: ${st.status.replace("_", " ")}`}>{who(st.agent)} · {st.status === "awaiting_approval" ? "needs approval" : st.status}</button>
              ))}</div>
            </li>
          ))}
        </ul>}
      </>}
    </div>
  );
}
