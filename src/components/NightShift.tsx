"use client";
// Night shift UI: "While you slept" (top of the morning card) and the "Tonight" queue (Agents station tab). Server: src/lib/night.ts.
// Approve/reject buttons call the existing approval routes (/api/tasks/:id, /api/goals): nothing here can send, publish or spend.
import { useCallback, useEffect, useState } from "react";
import { api } from "./AgentMission";
import { stoppedText, type NightItem, type NightReport, type NightSettings, type TonightItem } from "@/lib/night-pure";
import { LEARN_KINDS } from "@/lib/night-learn-pure";
import { diffText, nightDiffLine, whyText } from "@/lib/night-plan-pure";
import type { NavTarget } from "@/lib/nav-pure";
import { useT } from "./i18n";

type Nav = (t: NavTarget) => void;

export function WhileYouSlept({ report, onOpenTask, onOpenGoal, nav }: { report: NightReport; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void; nav: Nav }) {
  const { t, tn, lang } = useT();
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
      setGone((g) => ({ ...g, [key(i)]: t(approve ? "common.approved" : "common.rejected") }));
    } catch (e) { setErr(e instanceof Error ? e.message : t("common.failed")); }
  };
  const copy = (s: string) => { void navigator.clipboard?.writeText(s).catch(() => {}); };
  const end = report.endedAt ? new Date(report.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const row = (i: NightItem, icon: string) => <><button className="text-left" onClick={() => open(i)} disabled={!i.open}>{icon} {i.label}</button>{meta(i)}</>;
  const meta = (i: NightItem) => { // night shift 2.0: why it was picked, and what changed (before → after)
    const x = [i.pick && t("nightplan.whyTonight", { x: whyText(i.pick, lang) }), diffText(i.diff, lang)].filter(Boolean).join(" · ");
    return x ? <span className="block text-xs">{x}</span> : null;
  };
  const diffLine = nightDiffLine([...report.done, ...report.approvals, ...report.failed], lang);
  return (
    <div aria-label={t("night.slept")}>
      <b>🌙 {t("night.slept")}</b>{" "}
      <span className="muted text-xs">{report.running ? t("night.working") : tn("night.calls", report.calls, { min: report.minutes }) + (end ? t("night.doneAt", { t: end }) : "")}</span>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      {report.why && <p className="muted text-xs">{t("night.why", { why: report.why })}</p>}
      {diffLine && <p className="muted text-xs">{diffLine}</p>}
      <ul className="since-list muted grid gap-1">
        {report.approvals.map((i) => (
          <li key={key(i)}>
            {row(i, "✋")}
            {gone[key(i)] ? <span className="text-xs"> · {gone[key(i)]}</span> : (
              <span className="ml-1 inline-flex gap-1">
                {i.open && "task" in i.open && <><button className="chip" onClick={() => void act(i, true)}>{t("common.approve")}</button><button className="chip" onClick={() => void act(i, false)}>{t("common.reject")}</button></>}
                {i.open && "goal" in i.open && i.open.stepId && <button className="chip" onClick={() => void act(i, true)}>{t("night.okStep")}</button>}
              </span>
            )}
            {i.draft && (
              <details className="text-xs"><summary>{t("night.draft")}</summary>
                <p className="whitespace-pre-wrap">{i.draft}</p><button className="chip" onClick={() => copy(i.draft!)}>{t("common.copy")}</button>
              </details>
            )}
          </li>
        ))}
        {report.done.map((i) => <li key={key(i)}>{row(i, "✓")}</li>)}
        {report.failed.map((i) => <li key={key(i)} className="warn">{row(i, "⚠")}{i.why && <span className="text-xs"> · {i.why}</span>}</li>)}
        {report.company && <li className="text-xs">{report.company}</li>}
        {report.invoices && <li className={/overdue/.test(report.invoices) ? "warn" : "text-xs"}>{t("night.invoices", { x: report.invoices })}</li>}
        {report.stopped && <li className="text-xs">{stoppedText(report.stopped, lang)}{report.deferred ? t("night.deferred", { n: report.deferred }) : ""}</li>}
      </ul>
    </div>
  );
}

type View = { settings: NightSettings; tonight: TonightItem[]; running: boolean };

export function TonightPanel() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => api<View>("/api/night").then(setV, (e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const post = async (body: object) => {
    setErr("");
    try { setV(await api<View>("/api/night", { method: "POST", body: JSON.stringify(body) })); return true; }
    catch (e) { setErr(e instanceof Error ? e.message : t("common.failed")); return false; }
  };
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (text.trim() && (await post({ action: "add", text }))) setText(""); };
  const s = v?.settings;
  return (
    <section className="grid gap-2 text-sm" aria-label={t("night.aria")}>
      <p className="muted text-xs">
        {s ? (s.enabled ? t("night.runs", { from: s.from, until: s.until, tz: s.tz, calls: s.maxCalls, min: s.maxMinutes }) : t("night.off")) : t("common.loading")}
        {v?.running && t("night.workingNow")}
      </p>
      {s && <label className="muted flex items-center gap-2 text-xs"><input type="checkbox" checked={s.enabled} onChange={(e) => void post({ action: "settings", enabled: e.target.checked })} /> {t("night.enable")}</label>}
      {s && (
        <details className="muted text-xs"><summary>{t("night.learnTitle")}</summary>
          {LEARN_KINDS.map((k) => (
            <label key={k} className="flex items-center justify-between gap-2">{t(`night.noun.${k}`)}
              <select className="field" value={s.pin?.[k] ?? "auto"} onChange={(e) => void post({ action: "settings", pin: { [k]: e.target.value } })}>
                <option value="auto">{t("night.learn")}</option><option value="on">{t("night.always")}</option><option value="off">{t("night.never")}</option>
              </select>
            </label>
          ))}
        </details>
      )}
      <form onSubmit={add} className="flex gap-1.5">
        <input className="field flex-1" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={t("night.addPh")} aria-label={t("night.addAria")} />
        <button className="chip" disabled={!text.trim()}>{t("common.add")}</button>
      </form>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      <ul className="grid gap-1">
        {v?.tonight.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-2">
            <span className="truncate">🌙 {it.text} <span className="muted text-xs">· {it.agent}{it.by === "core" ? t("night.viaCore") : ""}</span></span>
            <button className="chip" onClick={() => void post({ action: "remove", id: it.id })} aria-label={t("night.removeAria", { text: it.text })}>{t("common.remove")}</button>
          </li>
        ))}
        {v && !v.tonight.length && <li className="muted text-xs">{t("night.empty")}</li>}
      </ul>
    </section>
  );
}
