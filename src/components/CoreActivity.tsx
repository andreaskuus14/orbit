"use client";
import { useEffect, useState } from "react";
import { useT } from "./i18n";
import { SITE_LABEL_KEYS } from "@/lib/site-pipeline-pure";
import { coreRunPhase, fmtMs, liveSummary, type LiveRow } from "@/lib/core-live-pure";
import type { Key } from "@/lib/i18n-pure";

const SHOWN = 6; // running: the newest steps; older ones fold into "N earlier"

/** CORE's live work view: one line per step (newest at bottom) with its key detail and time; each line expands to its result.
 *  running: the turn is in progress (since = client start time); otherwise a collapsed "12 steps · 1m 40s" summary under the answer. */
export function CoreActivity({ rows, running, streaming = false, since = 0, totalMs = 0, taskId, projectName, route }: { rows: LiveRow[]; running: boolean; streaming?: boolean; since?: number; totalMs?: number; taskId?: string | null; projectName?: string; route?: "fast" | "smart" | "deep" | null }) {
  const { t, tn, lang } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!running) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [running]);
  const label = (r: LiveRow) => (r.key ? t(r.key as Key, r.vars) : SITE_LABEL_KEYS[r.label] ? t(SITE_LABEL_KEYS[r.label]) : r.label.replace(/…$/, ""));
  const elapsed = Math.max(0, now - since);
  const line = (r: LiveRow) => {
    const ms = r.ms ?? (running ? Math.max(0, elapsed - r.at) : undefined);
    const head = <>
      <span className={r.ok === undefined && running ? "activity-orbit" : "core-step-mark"} aria-hidden="true">{r.ok === undefined ? (running ? "" : "·") : r.ok ? "✓" : "✗"}</span>
      <span className="core-step-label">{label(r)}{r.detail && <span className="muted"> · {r.detail}</span>}{r.ok === false && <span className="muted"> · {t("live.failed")}</span>}</span>
      {ms !== undefined && <span className="core-step-ms muted">{fmtMs(ms)}</span>}
    </>;
    return <li key={r.id}>{r.result || (r.detail && r.detail.length > 40)
      ? <details><summary className="core-step">{head}</summary><p className="core-step-more muted">{[r.detail, r.result].filter(Boolean).join(" → ")}</p></details>
      : <div className="core-step">{head}</div>}</li>;
  };

  if (!running) {
    if (!rows.length) return null;
    const s = liveSummary(rows, totalMs);
    return <details className="core-activity core-activity-done mt-2"><summary>{tn("live.steps", s.n, { time: s.time })}</summary><ol>{rows.map(line)}</ol></details>;
  }
  const older = rows.slice(0, -SHOWN), recent = rows.slice(-SHOWN);
  const current = streaming ? t("live.writing") : rows.length ? label(rows.at(-1)!) : t("live.connecting");
  const phase = coreRunPhase(rows, streaming, taskId);
  const labels = lang === "et"
    ? { project: "Projekt", fast: "Kiire mudel", smart: "Põhimudel", deep: "Süvamudel", background: "Taustatöö", tool: "Tööriist töös", answering: "Vastab", working: "Valmistab vastust" }
    : { project: "Project", fast: "Fast model", smart: "Main model", deep: "Deep model", background: "Working in background", tool: "Using a tool", answering: "Answering", working: "Preparing an answer" };
  return <div className="core-activity" aria-label={t("live.aria")}>
    <p className="core-activity-hint break-words" role="status">
      {labels[phase]}{route && <> · {labels[route]}</>}{projectName && <> · {labels.project} <b>{projectName}</b></>}
    </p>
    {older.length > 0 && <details><summary>{t("live.earlier", { n: older.length })}</summary><ol>{older.map(line)}</ol></details>}
    <ol>{recent.map(line)}{streaming && <li><div className="core-step"><span className="activity-orbit" aria-hidden="true" /><span className="core-step-label">{t("live.writing")}</span></div></li>}</ol>
    <p className="sr-only" role="status">{current}</p>
    {taskId && <p className="core-activity-hint">{t("live.background")} <a href={`#o=operations&k=task&id=${taskId}`}>{t("live.openOps")}</a></p>}
    <p className="core-activity-hint muted">{fmtMs(elapsed)}</p>
    <SlowHint current={current} />
  </div>;
}

function SlowHint({ current }: { current: string }) {
  const { t } = useT();
  const [slow, setSlow] = useState<string | null>(null);
  useEffect(() => { setSlow(null); const timer = setTimeout(() => setSlow(current), 8000); return () => clearTimeout(timer); }, [current]);
  return slow === current ? <p className="core-activity-hint">{t("core.slow", { what: current })}</p> : null;
}
