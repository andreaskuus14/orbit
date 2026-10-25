"use client";
// Night shift UI: "While you slept" (top of the morning card) and the "Tonight" queue (Agents station tab). Server: src/lib/night.ts.
// Approve/reject buttons call the existing approval routes (/api/tasks/:id, /api/goals): nothing here can send, publish or spend.
import { useCallback, useEffect, useState } from "react";
import { api } from "./AgentMission";
import { stoppedText, type NightItem, type NightReport, type NightSettings, type TonightItem } from "@/lib/night-pure";
import type { NavTarget } from "@/lib/nav-pure";

type Nav = (t: NavTarget) => void;

export function WhileYouSlept({ report, onOpenTask, onOpenGoal, nav }: { report: NightReport; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void; nav: Nav }) {
  const [gone, setGone] = useState<Record<string, string>>({}); // item key → what happened to it here
  const [err, setErr] = useState("");
  const key = (i: NightItem) => `${i.kind}:${i.ref}`;
  const open = (i: NightItem) => {
    const o = i.open;
    if (!o) return;
    if ("task" in o) onOpenTask(o.task); else if ("goal" in o) onOpenGoal(o.goal);
    else nav(o.panel === "studio" ? { panel: "studio", view: "review" } : { panel: o.panel });
  };
  const act = async (i: NightItem, approve: boolean) => {
    setErr("");
    const o = i.open;
    try {
      if (o && "task" in o) await api(`/api/tasks/${o.task}`, { method: "POST", body: JSON.stringify({ action: approve ? "approve" : "reject" }) });
      else if (o && "goal" in o && o.stepId) await api("/api/goals", { method: "POST", body: JSON.stringify({ action: "ok", id: o.goal, step: o.step, stepId: o.stepId }) });
      setGone((g) => ({ ...g, [key(i)]: approve ? "approved" : "rejected" }));
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't do that"); }
  };
  const copy = (t: string) => { void navigator.clipboard?.writeText(t).catch(() => {}); };
  const end = report.endedAt ? new Date(report.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const row = (i: NightItem, icon: string) => <button className="text-left" onClick={() => open(i)} disabled={!i.open}>{icon} {i.label}</button>;
  return (
    <div aria-label="While you slept">
      <b>🌙 While you slept</b>{" "}
      <span className="muted text-xs">{report.running ? "working now…" : `${report.calls} Claude call${report.calls === 1 ? "" : "s"} · ${report.minutes} min${end ? ` · done ${end}` : ""}`}</span>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      <ul className="since-list muted grid gap-1">
        {report.approvals.map((i) => (
          <li key={key(i)}>
            {row(i, "✋")}
            {gone[key(i)] ? <span className="text-xs"> · {gone[key(i)]}</span> : (
              <span className="ml-1 inline-flex gap-1">
                {i.open && "task" in i.open && <><button className="chip" onClick={() => void act(i, true)}>Approve</button><button className="chip" onClick={() => void act(i, false)}>Reject</button></>}
                {i.open && "goal" in i.open && i.open.stepId && <button className="chip" onClick={() => void act(i, true)}>OK step</button>}
              </span>
            )}
            {i.draft && (
              <details className="text-xs"><summary>Read the draft (not sent)</summary>
                <p className="whitespace-pre-wrap">{i.draft}</p><button className="chip" onClick={() => copy(i.draft!)}>Copy</button>
              </details>
            )}
          </li>
        ))}
        {report.done.map((i) => <li key={key(i)}>{row(i, "✓")}</li>)}
        {report.failed.map((i) => <li key={key(i)} className="warn">{row(i, "⚠")}{i.why && <span className="text-xs"> · {i.why}</span>}</li>)}
        {report.stopped && <li className="text-xs">{stoppedText(report.stopped)}{report.deferred ? ` · ${report.deferred} left for tonight` : ""}</li>}
      </ul>
    </div>
  );
}

type View = { settings: NightSettings; tonight: TonightItem[]; running: boolean };

export function TonightPanel() {
  const [v, setV] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => api<View>("/api/night").then(setV, (e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const post = async (body: object) => {
    setErr("");
    try { setV(await api<View>("/api/night", { method: "POST", body: JSON.stringify(body) })); return true; }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); return false; }
  };
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (text.trim() && (await post({ action: "add", text }))) setText(""); };
  const s = v?.settings;
  return (
    <section className="grid gap-2 text-sm" aria-label="Night shift">
      <p className="muted text-xs">
        {s ? <>Night shift {s.enabled ? `runs ${s.from}-${s.until} (${s.tz}) while you're idle, up to ${s.maxCalls} Claude calls / ${s.maxMinutes} min. Nothing is sent, published or spent: results wait for you in the morning card.` : "is off."}</> : "Loading…"}
        {v?.running && " Working now."}
      </p>
      {s && <label className="muted flex items-center gap-2 text-xs"><input type="checkbox" checked={s.enabled} onChange={(e) => void post({ action: "settings", enabled: e.target.checked })} /> Run the night shift</label>}
      <form onSubmit={add} className="flex gap-1.5">
        <input className="field flex-1" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Look into … tonight" aria-label="Add a task for tonight" />
        <button className="chip" disabled={!text.trim()}>Add</button>
      </form>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      <ul className="grid gap-1">
        {v?.tonight.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2">
            <span className="truncate">🌙 {t.text} <span className="muted text-xs">· {t.agent}{t.by === "core" ? " · via CORE" : ""}</span></span>
            <button className="chip" onClick={() => void post({ action: "remove", id: t.id })} aria-label={`Remove ${t.text}`}>Remove</button>
          </li>
        ))}
        {v && !v.tonight.length && <li className="muted text-xs">Nothing queued. Goal steps, follow-up drafts and Shorts packaging still run on their own.</li>}
      </ul>
    </section>
  );
}
