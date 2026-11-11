"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { doctorShareText, headlineOf, type Report, type Status } from "@/lib/doctor-pure";
import type { BootResult } from "@/lib/doctor-boot-pure";
import { builderText, type Issue } from "@/lib/health-pure";
import { builderBrief, type Improve } from "@/lib/self-improve-pure";
import type { Trend } from "@/lib/self-eval-pure";
import type { Outcomes, Rate, WeekOutcomes } from "@/lib/outcome-metrics-pure";
import type { systemHealthView } from "@/lib/system-health";
import { incidentTitle, type SvcState } from "@/lib/system-health-pure";
import { capNone, capRow, capTitle, type Missing } from "@/lib/capability-pure";
import type { PatchResult } from "@/lib/self-improve-patch-pure";
import { stoppedText } from "@/lib/night-pure";
import { speakChunk, speechSettings, stop as stopSpeech } from "./voice/speak";
import { useDialogFocus } from "./useDialogFocus";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-pure";

const COLOR: Record<Status, string> = { ok: "var(--mint)", warn: "var(--amber)", fail: "var(--rose)" };
const WORD: Record<Status, Key> = { ok: "doc.ok", warn: "doc.warn", fail: "doc.fail" };
const ISSUE_COLOR: Record<Issue["status"], string> = { new: "var(--rose)", regressed: "var(--rose)", ongoing: "var(--amber)", resolved: "var(--mint)" };
const ISSUE_WORD: Record<Issue["status"], Key> = { new: "health.new", regressed: "health.back", ongoing: "health.ongoing", resolved: "sys.state.resolved" };
type Health = { lastRun: string | null; issues: Issue[] };
type System = Awaited<ReturnType<typeof systemHealthView>>;
const SVC: Record<SvcState, Status> = { ok: "ok", down: "fail", off: "warn" };
const SVC_WORD: Record<SvcState, Key> = { ok: "doc.ok", down: "sys.svc.down", off: "sys.svc.off" };
const GBS = (b: number | null) => (b == null ? "?" : `${(b / 1024 ** 3).toFixed(1)} GB`);
const when = (t: string | number | null) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never");
const of = (b: { used: number; cap: number | null; pct: number | null }, unit: string) => `${b.used}${b.cap ? ` / ${b.cap}` : ""} ${unit}${b.pct != null ? ` (${b.pct}%)` : ""}`;
const KIND_WORD = { task: "sys.kind.task", mission: "sys.kind.mission", night: "sys.kind.night", clip: "sys.kind.clip" } as const;

/** SYSTEM card (roadmap 9.5): services with last success, failed jobs (7 days), storage, models, budgets and incidents. Read-only but for "Got it". */
function SystemCard({ sys, onAck }: { sys: System; onAck: (key: string) => void }) {
  const { t, tn, tx, lang } = useT();
  const open = sys.incidents.filter((i) => i.state !== "resolved");
  return (
    <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("sys.healthAria")}>
      <b>{t("sys.card")}</b>
      <p className="muted text-xs">{open.length ? tn("sys.incidents", open.length) : t("sys.noIncidents")}</p>
      {sys.incidents.length > 0 && <ul className="mt-2 grid gap-1">
        {sys.incidents.map((i) => (
          <li key={i.key + i.opened} className="flex items-baseline justify-between gap-2 text-xs">
            <span><b style={{ color: i.state === "resolved" ? "var(--mint)" : i.state === "ack" ? "var(--amber)" : "var(--rose)" }}>{t(`sys.state.${i.state}`)}</b> {incidentTitle(i, lang)}
              <span className="muted">{t("sys.since", { at: when(i.opened) })}{i.resolvedAt ? t("sys.fixed", { at: when(i.resolvedAt) }) : ""}</span></span>
            {i.state === "open" && <button className="chip shrink-0" onClick={() => onAck(i.key)} aria-label={t("sys.ackAria", { title: incidentTitle(i, lang) })}>{t("sys.gotIt")}</button>}
          </li>))}
      </ul>}
      <h3 className="mt-3 text-xs font-bold">{t("sys.services")}</h3>
      <ul className="grid gap-1">
        {sys.services.map((v) => (
          <li key={v.id} className="text-xs">
            <span className="font-mono text-[10px] tracking-widest" style={{ color: COLOR[SVC[v.state]] }}>{t(SVC_WORD[v.state])}</span> <b>{tx(`svc.${v.id}`, v.label)}</b>
            <span className="muted"> · {v.detail}{t("sys.lastOk", { at: when(v.lastOk) })}</span>
          </li>))}
      </ul>
      <h3 className="mt-3 text-xs font-bold">{t("sys.failed7")}</h3>
      <ul className="grid gap-1">
        {sys.failed.map((f) => (
          <li key={f.kind} className="text-xs"><b>{t(KIND_WORD[f.kind])}: {f.count}</b>
            {f.recent.length > 0 && <span className="muted"> · {f.recent.map((r) => `${r.label} (${when(r.at)})`).join("; ")}</span>}</li>))}
      </ul>
      <h3 className="mt-3 text-xs font-bold">{t("sys.storage")}</h3>
      <ul className="grid gap-1">
        {sys.storage.map((d) => <li key={d.id} className="text-xs"><b style={{ color: COLOR[d.status] }}>{GBS(d.free)}</b> {tx(`disk.${d.id}`, d.label)} <span className="muted break-all">· {d.dir}</span></li>)}
      </ul>
      <h3 className="mt-3 text-xs font-bold">{t("sys.models")}</h3>
      <ul className="grid gap-1 text-xs">
        {sys.models.map((m) => <li key={m.role}><b>{m.role}</b> {m.model}: {t(m.state === "ok" ? "sys.m.ok" : m.state === "failing" ? "sys.m.failing" : m.state === "limited" ? "sys.m.limited" : "sys.m.unused")}
          <span className="muted">{t("sys.mCalls", { n: m.calls7d, at: when(m.lastOk) })}</span></li>)}
        {sys.local && <li><b>local</b> {sys.local} {t("sys.local")}</li>}
        <li><b>{t("sys.claude5h")}</b> {of(sys.usage.h5, t("sys.u.calls"))}{sys.usage.hold ? <span className="muted"> · {sys.usage.hold}</span> : null}</li>
        <li><b>{t("sys.claude7d")}</b> {of(sys.usage.d7, t("sys.u.calls"))}{!sys.usage.d7.cap && <span className="muted">{t("sys.weeklyHint")}</span>}</li>
        {sys.higgsfield && <li><b>{t("sys.hf")}</b> {of(sys.higgsfield, t("sys.u.credits"))}</li>}
        <li><b>{t("sys.night")}</b> {sys.night ? <>{of(sys.night.calls, t("sys.u.calls"))}, {of(sys.night.minutes, "min")} <span className="muted">{t("sys.nightOf", { night: sys.night.night })}{sys.night.stopped ? t("sys.stopped", { why: stoppedText(sys.night.stopped, lang) }) : ""}</span></> : <span className="muted">{t("sys.noRun")}</span>}</li>
      </ul>
    </section>
  );
}

/** HEALTH card: what the night health check found (redacted evidence), with the issue text to hand to a builder. Nothing here changes code. */
function HealthCard({ health }: { health: Health }) {
  const { t } = useT();
  const [copied, setCopied] = useState("");
  const copy = async (i: Issue) => {
    try { await navigator.clipboard.writeText(builderText(i)); setCopied(i.id); } catch { setCopied(""); }
  };
  return (
    <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("health.title")}>
      <b>{t("health.title")}</b>
      <p className="muted text-xs">{health.lastRun ? t("health.nightCheck", { at: new Date(health.lastRun).toLocaleString() }) : t("health.runsAtNight")}
        {t(health.issues.some((i) => i.status !== "resolved") ? "health.copyHint" : "health.none")}</p>
      <ul className="mt-2 grid gap-2">
        {health.issues.map((i) => (
          <li key={i.id} className="rounded-lg border border-white/10 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <b className="text-xs">{i.title}</b>
              <span className="shrink-0 font-mono text-[10px] tracking-widest" style={{ color: ISSUE_COLOR[i.status] }}>{t(ISSUE_WORD[i.status])}</span>
            </div>
            <p className="muted text-[11px]">{t("health.meta", { count: i.count, at: new Date(i.last).toLocaleString(), sev: i.severity })}</p>
            {i.summary && <p className="mt-1 text-xs">{i.summary.summary} <span className="muted">{t("health.likely", { cause: i.summary.cause })}</span></p>}
            <details className="mt-1"><summary className="muted cursor-pointer text-[11px]">{t("health.evidence")}</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">{i.excerpt}</pre></details>
            <button className="chip mt-1" onClick={() => copy(i)} aria-label={t("health.copyAria", { title: i.title })}>{t(copied === i.id ? "common.copied" : "health.copy")}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** MAKE ORBIT BETTER card (C6): this week's ranked improvement tasks with a builder brief to copy, or (§10.6) a drafted patch saved
 *  locally for review. Nothing here changes code: the patch is never applied, committed or pushed. */
function ImproveCard({ improve }: { improve: Improve }) {
  const { t } = useT();
  const [copied, setCopied] = useState("");
  const [patch, setPatch] = useState<Record<string, PatchResult | "busy">>({});
  useEffect(() => { // saved drafts survive a reload; a click made meanwhile wins
    void fetch("/api/self-improve").then((x) => x.json() as Promise<{ drafts?: Record<string, PatchResult> }>)
      .then((r) => setPatch((p) => ({ ...r.drafts, ...p }))).catch(() => {});
  }, []);
  const copy = async (i: number) => {
    try { await navigator.clipboard.writeText(builderBrief(improve.tasks[i], i + 1, improve.week)); setCopied(improve.tasks[i].key); } catch { setCopied(""); }
  };
  const draft = async (key: string) => {
    setPatch((p) => ({ ...p, [key]: "busy" }));
    const r = await fetch("/api/self-improve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) })
      .then((x) => x.json() as Promise<PatchResult>).catch(() => ({ error: "Network error" }));
    setPatch((p) => ({ ...p, [key]: r }));
  };
  const copyHandoff = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(`patch:${key}`); } catch { setCopied(""); }
  };
  return (
    <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("improve.title")}>
      <b>{t("improve.title")}</b>
      <p className="muted text-xs">{t("improve.week", { week: improve.week })}{t(improve.tasks.length ? "improve.ranked" : "improve.none")}</p>
      <ol className="mt-2 grid gap-2">
        {improve.tasks.map((x, i) => (
          <li key={x.key} className="rounded-lg border border-white/10 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <b className="text-xs">{i + 1}. {x.title}</b>
              <span className="muted shrink-0 font-mono text-[10px]">{t("improve.impact", { n: x.impact })}</span>
            </div>
            <p className="mt-1 text-xs">{x.problem}</p>
            <p className="muted text-[11px]">{t("improve.evidence", { list: x.evidence.join(", ") })}</p>
            <button className="chip mt-1" onClick={() => copy(i)} aria-label={t("improve.copyAria", { title: x.title })}>{t(copied === x.key ? "common.copied" : "health.copy")}</button>
            {(() => {
              const p = patch[x.key];
              if (!p || p === "busy") return <button className="chip ml-1 mt-1" disabled={p === "busy"} onClick={() => draft(x.key)} aria-label={t("improve.draftAria", { title: x.title })}
                title={t("improve.draftTitle")}>{t(p === "busy" ? "improve.drafting" : "improve.draft")}</button>;
              if ("error" in p) return <div className="mt-1 text-xs" role="alert"><span style={{ color: "var(--rose)" }}>{p.error}</span>
                {p.problems && <ul className="muted list-disc pl-4 text-[11px]">{p.problems.map((w) => <li key={w}>{w}</li>)}</ul>}</div>;
              return <div className="mt-1 text-xs"><p>{p.rationale}</p><p className="muted text-[11px]">{t("improve.saved", { test: p.test })} <span className="break-all font-mono">{p.file}</span></p>
                <button className="chip mt-1" onClick={() => copyHandoff(x.key, p.handoff)} aria-label={t("improve.handoffAria", { title: x.title })}>{t(copied === `patch:${x.key}` ? "common.copied" : "improve.handoff")}</button></div>;
            })()}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** SELF-EVAL card (roadmap 8 · 1.5): the weekly static scorecard, pass % per category this week vs the mean of the last 4. */
function SelfEvalCard({ ev }: { ev: Trend }) {
  const { t } = useT();
  return (
    <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("selfEval.title")}>
      <b>{t("selfEval.title")}</b>
      <p className="muted text-xs">{t("selfEval.week", { week: ev.now.week, date: ev.now.date })}</p>
      <p className="mt-1 text-xs" style={{ color: ev.redTeamFailures ? "var(--rose)" : "var(--mint)" }} role={ev.redTeamFailures ? "alert" : undefined}>
        <b>{ev.redTeamFailures ? t("selfEval.redFail", { n: ev.redTeamFailures }) : t("selfEval.redOk")}</b></p>
      <table className="mt-1 w-full text-xs">
        <thead><tr><th className="text-left font-normal muted" /><th className="text-right font-normal muted">{t("selfEval.vs")}</th></tr></thead>
        <tbody>{ev.rows.map((r) => (
          <tr key={r.cat}><td>{t(`selfEval.cat.${r.cat}` as Key)}</td>
            <td className="text-right font-mono" style={{ color: r.prev != null && r.pct < r.prev ? "var(--rose)" : undefined }}>{r.pct}% · {r.prev == null ? "–" : `${r.prev}%`}</td></tr>
        ))}</tbody>
      </table>
      {ev.regressions.length > 0 && <p className="mt-1 text-xs" style={{ color: "var(--rose)" }}>{t("selfEval.regressions", { list: ev.regressions.join(", ") })}</p>}
    </section>
  );
}

/** OUTCOMES card (roadmap 48 · 04): this week vs last, simple vs multi-step, every rate with its denominator. */
function OutcomeCard({ o }: { o: { now: WeekOutcomes; prev: WeekOutcomes } }) {
  const { t } = useT();
  const rate = (x: Rate) => (x.of ? `${x.n}/${x.of}` : "–");
  const rows: [Key, (w: Outcomes) => string][] = [["outcome.units", (w) => String(w.units)], ["outcome.correctionFree", (w) => rate(w.correctionFree)],
    ["outcome.medianMin", (w) => (w.medianMin == null ? "–" : String(w.medianMin))], ["outcome.abandoned", (w) => rate(w.abandoned)],
    ["outcome.duplicates", (w) => rate(w.duplicates)], ["outcome.kept", (w) => rate(w.kept)]];
  return (
    <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("outcome.title")}>
      <b>{t("outcome.title")}</b>
      <p className="muted text-xs">{t("outcome.note")}</p>
      {(["simple", "multi"] as const).map((k) => (
        <table key={k} className="mt-1 w-full text-xs">
          <thead><tr><th className="text-left font-normal">{t(`outcome.${k}`)}</th><th className="text-right font-normal muted">{o.now.week}</th><th className="text-right font-normal muted">{o.prev.week}</th></tr></thead>
          <tbody>{rows.map(([label, f]) => <tr key={label}><td>{t(label)}</td><td className="text-right font-mono">{f(o.now[k])}</td><td className="text-right font-mono muted">{f(o.prev[k])}</td></tr>)}</tbody>
        </table>
      ))}
    </section>
  );
}

/** ORBIT doctor: runs /api/doctor and lists each check with what to do. speak = read the result aloud (opened by voice/command). */
export function DoctorPanel({ onClose, speak }: { onClose: () => void; speak?: boolean }) {
  const { t, tx, lang } = useT();
  const [report, setReport] = useState<(Report & { boot?: BootResult | null; health?: Health | null; improve?: Improve | null; system?: System | null; selfEval?: Trend | null; cantDo?: Missing[] | null; outcome?: { now: WeekOutcomes; prev: WeekOutcomes } | null }) | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const spoke = useRef(false);
  const box = useRef<HTMLElement>(null);
  useDialogFocus(box, true, onClose);

  const run = useCallback(async () => {
    setBusy(true); setErr(""); setCopyState("idle");
    try {
      const res = await fetch("/api/doctor", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) throw new Error("ORBIT couldn't confirm your sign-in. Either the database (Supabase) is unreachable or you were signed out. Check your internet, then reload the page and sign in.");
      if (!res.ok) throw new Error(`The check didn't run (error ${res.status}). Restart ORBIT and try again.`);
      const r = (await res.json()) as Report & { boot?: BootResult | null; health?: Health | null; improve?: Improve | null; system?: System | null; selfEval?: Trend | null; cantDo?: Missing[] | null; outcome?: { now: WeekOutcomes; prev: WeekOutcomes } | null };
      setReport(r);
      if (speak && !spoke.current && speechSettings().speak) { spoke.current = true; speakChunk(r.speech); }
    } catch (e) {
      const m = e instanceof Error && e.message !== "Failed to fetch" ? e.message : "ORBIT's server isn't answering. Start ORBIT from the desktop shortcut.";
      setErr(m);
      if (speak && !spoke.current && speechSettings().speak) { spoke.current = true; speakChunk(m); }
    } finally { setBusy(false); }
  }, [speak]);
  useEffect(() => { void run(); }, [run]);
  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(doctorShareText(report));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };
  const ack = async (key: string) => {
    const res = await fetch("/api/doctor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ack: key }) }).catch(() => null);
    // On failure the button just stays (try again); setErr would hide the whole report.
    if (res?.ok) setReport((r) => r?.system ? { ...r, system: { ...r.system, incidents: r.system.incidents.map((i) => (i.key === key && i.state === "open" ? { ...i, state: "ack" as const } : i)) } } : r);
  };
  useEffect(() => () => stopSpeech(), []); // closing the panel stops the read-out

  return (
    <aside ref={box} tabIndex={-1} className="glass drawer" style={{ zIndex: 40 }} role="dialog" aria-label={t("doc.title")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="brand text-base">🩺 {t("doc.title")}</h2>
        <div className="flex gap-2">
          <button className="chip" onClick={run} disabled={busy}>{t(busy ? "doc.checking" : "doc.again")}</button>
          <button className="chip" onClick={onClose} aria-label={t("doc.closeAria")}>{t("common.close")}</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {err ? <p className="error" role="alert">{err}</p>
          : !report ? <p className="muted text-sm">{t("doc.loading")}</p>
          : <>
            <p className="mb-3 text-sm" style={{ color: COLOR[report.status] }}><b>{headlineOf(report.checks, lang)}</b></p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" className="chip" onClick={copyReport} disabled={busy}>{t("doc.copyReport")}</button>
              {copyState === "copied" && <span className="muted text-xs" role="status">{t("common.copied")}</span>}
              {copyState === "error" && <span className="error text-xs" role="alert">{t("doc.copyReportError")}</span>}
            </div>
            {report.cantDo && <section className="mb-3 rounded-lg border border-white/10 p-2 text-sm" aria-label={capTitle(lang)}>
              <b>{capTitle(lang)}</b>
              {!report.cantDo.length ? <p className="muted text-xs">{capNone(lang)}</p> : <ul className="mt-1 grid gap-1">
                {report.cantDo.map((m) => { const r = capRow(m, lang); return <li key={m.id} className="text-xs"><b style={{ color: COLOR.warn }}>{r.label}</b>: {r.why}. <span className="muted">{r.fix}</span></li>; })}
              </ul>}
            </section>}
            <ul className="grid gap-2">
              {report.checks.map((c) => (
                <li key={c.id} className="rounded-lg border border-white/10 p-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <b>{tx(`check.${c.id}`, c.label)}</b>
                    <span className="shrink-0 font-mono text-[10px] tracking-widest" style={{ color: COLOR[c.status] }}>{t(WORD[c.status])}</span>
                  </div>
                  <p className="muted text-xs">{c.detail}</p>
                  {c.fix && c.status !== "ok" && <p className="mt-1 text-xs"><b>{t("doc.whatToDo")}</b> {c.fix}</p>}
                  {c.fix && c.status === "ok" && <p className="muted mt-1 text-[11px]">{c.fix}</p>}
                  {c.retry?.map((r) => <p key={r.key} className="mt-1 flex items-center justify-between gap-2 text-xs"><span>{r.label}</span>
                    <button className="btn shrink-0" onClick={() => void fetch("/api/doctor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry: r.key }) })
                      .then((x) => { if (x.ok) setReport((p) => p && { ...p, checks: p.checks.map((k) => (k.id === c.id ? { ...k, retry: k.retry?.filter((y) => y.key !== r.key) } : k)) }); }, () => {})}>{t("doc.retry")}</button></p>)}
                </li>
              ))}
            </ul>
            {report.boot && <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("doc.selfTest")}>
              <div className="flex items-baseline justify-between gap-2">
                <b>{t("doc.selfTest")}</b>
                <span className="shrink-0 font-mono text-[10px] tracking-widest" style={{ color: COLOR[report.boot.report.status] }}>{t(WORD[report.boot.report.status])}</span>
              </div>
              <p className="muted text-xs">{t("doc.afterRestart", { at: new Date(report.boot.bootId).toLocaleString(), headline: headlineOf(report.boot.report.checks, lang) })}</p>
              {report.boot.scan.crashes.length || report.boot.scan.exits.length ? <>
                <p className="mt-2 text-xs"><b>{t("doc.crashes", { exits: report.boot.scan.exits.length ? ` (${report.boot.scan.exits.join(", ")})` : "" })}</b></p>
                <ul className="mt-1 grid gap-1">
                  {report.boot.scan.crashes.map((c) => <li key={c.id} className="text-xs">{c.what}. <span className="muted">{c.fix}</span></li>)}
                  {!report.boot.scan.crashes.length && <li className="muted text-xs">{t("doc.unknownCause")}</li>}
                </ul>
              </> : <p className="muted mt-1 text-xs">{t("doc.noCrashes")}</p>}
            </section>}
            {report.system && <SystemCard sys={report.system} onAck={ack} />}
            {report.health && <HealthCard health={report.health} />}
            {report.improve && <ImproveCard improve={report.improve} />}
            {report.selfEval && <SelfEvalCard ev={report.selfEval} />}
            {report.outcome && <OutcomeCard o={report.outcome} />}
            <p className="muted mt-3 text-[10px]">{t("doc.checkedIn", { s: (report.ms / 1000).toFixed(1), at: new Date(report.at).toLocaleTimeString() })}</p>
          </>}
      </div>
    </aside>
  );
}
