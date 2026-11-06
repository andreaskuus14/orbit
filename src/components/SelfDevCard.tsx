"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import { releaseStage, taskStage, type Stage } from "@/lib/selfdev-pure";

// DEV → Doctor: what ORBIT's self-development loop is doing, from the supervisor's and builder's own state files.
// Shows only recorded state; the four claims (implemented / tested / deployed / verified after deployment) are kept apart.

type Check = { name: string; ok: boolean; detail?: string };
type Task = { id: string; step: string; outcome?: string; why: string; cand: { title: string; source: string; acceptance: string[] }; costUsd: number; checks: Check[]; files?: { path: string; added: number; removed: number }[]; evidence: string[]; summary?: string; startedAt: string };
type Release = { id: string; step: string; reason?: string; pr?: string; sub: { title: string; why: string; commit: string; costUsd: number; checks: Check[] }; diffStat?: { files: number; lines: number }; probes: string[]; rollbacks: number; updatedAt: string };
type Status = {
  installed: { supervisor: boolean; builder: boolean };
  supervisor: null | { stopped: boolean; paused: boolean; halted: string | null; blocked: string | null; released: { id: string; commit: string } | null; retained: { id: string }[];
    current: Release | null; history: Release[]; queued: string[]; day: { releases: number; costUsd: number }; audit: { ok: boolean; count: number } };
  builder: null | { task: Task | null; history: Task[]; decisions: { at: string; decision: string }[]; day: { costUsd: number } | null };
};

const TONE: Record<Stage, string> = { selected: "muted", implemented: "", tested: "", ci: "", deployed: "text-amber-300", verified: "text-emerald-300", rolledBack: "text-amber-300", rejected: "muted", halted: "text-red-300", failed: "text-red-300", noChange: "muted" };

function Badge({ stage }: { stage: Stage }) {
  const { t } = useT();
  return <span className={`shrink-0 rounded border border-white/15 px-1 font-mono text-[10px] ${TONE[stage]}`}>{t(`selfdev.stage.${stage}` as Parameters<typeof t>[0])}</span>;
}

function Checks({ checks }: { checks: Check[] }) {
  return <ul className="mt-1 text-[11px]">{checks.map((c) => <li key={c.name}><span aria-hidden>{c.ok ? "✓" : "✗"}</span> {c.name}{c.detail ? <span className="muted"> · {c.detail.slice(0, 160)}</span> : null}</li>)}</ul>;
}

function Diff({ id }: { id: string }) {
  const { t } = useT();
  const [text, setText] = useState<string | null>(null);
  if (text == null) return <button className="chip mt-1" onClick={() => void fetch(`/api/selfdev?diff=${encodeURIComponent(id)}`).then((r) => r.text()).then(setText)}>{t("selfdev.diff")}</button>;
  return (
    <div>
      <button className="chip mt-1" onClick={() => setText(null)}>{t("selfdev.hideDiff")}</button>
      <pre className="mt-1 max-h-72 overflow-auto rounded bg-black/40 p-2 text-[10px] leading-tight">
        {text.split("\n").map((l, i) => <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "text-emerald-300" : l.startsWith("-") && !l.startsWith("---") ? "text-red-300" : l.startsWith("@@") ? "text-sky-300" : ""}>{l || " "}</div>)}
      </pre>
    </div>
  );
}

export function SelfDevCard() {
  const { t } = useT();
  const [s, setS] = useState<Status | null>(null);
  const [sent, setSent] = useState("");
  const load = useCallback(() => void fetch("/api/selfdev").then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => {}), []);
  useEffect(() => { load(); const i = setInterval(() => { if (!document.hidden) load(); }, 10_000); return () => clearInterval(i); }, [load]);
  const send = async (action: "pause" | "stop" | "restore") => {
    const r = await fetch("/api/selfdev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    setSent(r.ok ? t("selfdev.sent", { action }) : j.error ?? `HTTP ${r.status}`);
    load();
  };
  if (!s) return null;
  const sup = s.supervisor, b = s.builder;
  const installed = s.installed.supervisor || s.installed.builder;
  const state = !sup ? null : sup.stopped ? t("selfdev.stopped") : sup.halted ? t("selfdev.halted", { why: sup.halted }) : sup.paused ? t("selfdev.paused") : sup.blocked ? t("selfdev.waiting", { why: sup.blocked }) : t("selfdev.running");
  const task = b?.task;
  return (
    <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("selfdev.title")}>
      <b>{t("selfdev.title")}</b>
      {!installed ? <p className="muted text-xs">{t("selfdev.notInstalled")}</p> : (
        <>
          <p className={`text-xs ${sup?.stopped || sup?.halted ? "text-red-300" : ""}`}>{state ?? t("selfdev.noSupervisor")}</p>
          {sup?.released && <p className="muted text-[11px]">{t("selfdev.live", { id: sup.released.id, commit: sup.released.commit.slice(0, 7) })}</p>}
          <p className="muted text-[11px]">{t("selfdev.spend", { usd: (b?.day?.costUsd ?? 0).toFixed(2), n: sup?.day.releases ?? 0 })}</p>
          {sup && <p className="muted text-[11px]">{t("selfdev.audit", { n: sup.audit.count, state: t(sup.audit.ok ? "selfdev.auditOk" : "selfdev.auditBroken") })}</p>}

          <div className="mt-2 rounded border border-white/10 p-2">
            {task ? (
              <>
                <div className="flex items-start justify-between gap-2"><span>{t("selfdev.now", { title: task.cand.title })}</span><Badge stage={taskStage(task.step, task.outcome)} /></div>
                <p className="muted text-[11px]">{t("selfdev.why", { why: task.why.slice(0, 300) })}</p>
                <ul className="muted text-[11px]">{task.cand.acceptance.map((a) => <li key={a}>□ {a}</li>)}</ul>
                {task.files && <p className="font-mono text-[10px]">{task.files.map((f) => `${f.path} +${f.added}/−${f.removed}`).join(" · ")}</p>}
                {!!task.checks.length && <Checks checks={task.checks} />}
              </>
            ) : <p className="muted text-xs">{t("selfdev.idle")}</p>}
            {b?.decisions[0] && <p className="muted mt-1 text-[11px]">{t("selfdev.decision", { d: b.decisions[0].decision.slice(0, 240) })}</p>}
          </div>

          {sup && (sup.current || sup.history.length > 0) && <p className="mt-2 text-xs font-semibold">{t("selfdev.releases")}</p>}
          {sup && [sup.current, ...sup.history].filter((r): r is Release => !!r).slice(0, 10).map((r) => (
            <div key={r.id} className="mt-1 rounded border border-white/10 p-2 text-xs">
              <div className="flex items-start justify-between gap-2"><span>{r.sub.title}</span><Badge stage={releaseStage(r.step)} /></div>
              <p className="muted text-[11px]">{r.sub.commit.slice(0, 7)}{r.diffStat ? ` · ${r.diffStat.files} files, ${r.diffStat.lines} lines` : ""} · {t("selfdev.cost", { usd: r.sub.costUsd.toFixed(2) })} · {new Date(r.updatedAt).toLocaleString()}
                {r.pr ? <> · <a className="underline" href={r.pr} target="_blank" rel="noreferrer">PR</a></> : null}</p>
              {r.reason && <p className="text-[11px] text-amber-200">{r.reason.slice(0, 300)}</p>}
              <Checks checks={r.sub.checks} />
              {!!r.probes.length && <details className="text-[11px]"><summary>{t("selfdev.probes")}</summary><ul>{r.probes.map((p) => <li key={p} className="font-mono">{p}</li>)}</ul></details>}
              {r.diffStat && <Diff id={r.id} />}
            </div>
          ))}

          {b && b.history.length > 0 && <p className="mt-2 text-xs font-semibold">{t("selfdev.tasks")}</p>}
          {b?.history.slice(0, 8).map((x) => (
            <div key={x.id} className="mt-1 text-[11px]">
              <div className="flex items-start justify-between gap-2"><span>{x.cand.title}</span><Badge stage={taskStage(x.step, x.outcome)} /></div>
              <p className="muted">{x.outcome} · {t("selfdev.cost", { usd: x.costUsd.toFixed(2) })}</p>
              {x.evidence.some((e) => e.endsWith(".png")) && (
                <details><summary>{t("selfdev.evidence")}</summary>
                  {x.evidence.filter((e) => e.endsWith(".png")).map((e) => { const f = e.split(/[\\/]/).pop()!; return <img key={e} alt={f} className="mt-1 max-w-full rounded" src={`/api/selfdev?task=${encodeURIComponent(x.id)}&shot=${encodeURIComponent(f)}`} />; })}
                </details>
              )}
            </div>
          ))}

          {sup && (
            <div className="mt-2 flex flex-wrap gap-1">
              <button className="chip" onClick={() => void send("pause")} disabled={sup.paused}>{t("selfdev.pause")}</button>
              <button className="chip text-red-300" onClick={() => void send("stop")} disabled={sup.stopped}>{t("selfdev.stop")}</button>
              <button className="chip" onClick={() => void send("restore")} disabled={sup.retained.length < 2 || !!sup.current}>{t("selfdev.restore")}</button>
            </div>
          )}
          {sent && <p className="muted text-[11px]" role="status">{sent}</p>}
          <p className="muted text-[10px]">{t("selfdev.ownerOnly")}</p>
        </>
      )}
    </section>
  );
}
