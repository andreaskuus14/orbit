"use client";
import { useCallback, useState } from "react";
import { api, usePoll } from "./AgentMission";
import { canDo, stepVerified, type OwnerAction } from "@/lib/missions-pure";
import { timeAgo } from "@/lib/mission-pure";
import { evidenceLine } from "@/lib/mission-checks-pure";
import { useT } from "./i18n";
import { OpsStatus } from "./OpsStatus";
import { MissionBriefForm } from "./MissionBriefForm";
import type { MissionView } from "@/lib/missions";

// MISSIONS: CORE's multi-step jobs. State, the one next action, steps, receipts (what ORBIT verified) and the plain-language log.
// Approvals are not here: an action waiting for approval is approved in the step's task, as before. Text is untrusted: React text only.

const ACTIONS: OwnerAction[] = ["pause", "resume", "retry", "accept", "cancel"];

export default function MissionsPanel({ visible, onOpenTask }: { visible: boolean; onOpenTask?: (id: string) => void }) {
  const [list, setList] = useState<MissionView[] | null>(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const { t } = useT();
  const load = useCallback(() => { api<{ missions: MissionView[] }>("/api/missions").then((r) => { setList(r.missions); setErr(""); }, (e) => setErr(e.message)); }, []);
  usePoll(load, 5_000, visible);
  const act = (id: string, action: OwnerAction) => api("/api/missions", { method: "POST", body: JSON.stringify({ id, action }) }).then(load, (e) => setErr(e.message));

  return (
    <div className="space-y-2 text-xs">
      <p className="muted">Ask CORE for work that needs several steps and it becomes a mission here. It keeps going in the background and after restarts.</p>
      {creating
        ? <MissionBriefForm onCreated={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
        : <button type="button" className="chip" onClick={() => setCreating(true)}>{t("mission.brief.new")}</button>}
      {err && <p role="alert" style={{ color: "#fb7185" }}>{err}</p>}
      {!list ? <p className="muted">{err ? "" : "Loading…"}</p> : !list.length ? <p className="muted">No missions yet.</p> : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id} className="card space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">{m.doc.objective}</p>
                <span className="shrink-0"><OpsStatus raw={m.status} label={m.label} at={m.doc.log?.at(-1)?.at} /></span>
              </div>
              <p><span className="muted">Next: </span>{m.next}</p>
              {m.doc.acceptance && <p><span className="muted">{t("mission.doneWhen")}</span>{m.doc.acceptance}{m.doc.verified !== undefined && <span style={{ color: m.doc.verified ? "var(--mint)" : "#fb7185" }}> — {t(m.doc.verified ? "mission.verified" : "mission.notVerified")}</span>}</p>}
              {m.doc.artifact && <p><span className="muted">{t("mission.report")}</span><span className="num">{m.doc.artifact.slug}/{m.doc.artifact.path}</span>{m.doc.next && <> · <span className="muted">{t("mission.then")}</span>{m.doc.next}</>}</p>}
              {m.doc.metrics && (
                <p className="muted">
                  {t("mission.run", { mode: m.doc.contract?.mode ?? "", n: m.doc.metrics.interventions })}{m.doc.metrics.minutes !== undefined && t("mission.minutes", { n: m.doc.metrics.minutes })}{m.doc.metrics.accepted !== undefined && t(m.doc.metrics.accepted ? "mission.accepted" : "mission.notAccepted")}
                  {t("mission.byHand")}<input type="number" min={0} max={1440} aria-label={t("mission.byHandLabel")} className="w-14 bg-transparent" defaultValue={m.doc.metrics.humanMinutes ?? ""}
                    onBlur={(e) => e.target.value !== "" && api("/api/missions", { method: "POST", body: JSON.stringify({ id: m.id, action: "baseline", minutes: Number(e.target.value) }) }).then(load, (er) => setErr(er.message))} />
                </p>
              )}
              {m.doc.evidence && <p className="muted text-[11px]">{evidenceLine(m.doc.evidence)}</p>}
              {m.doc.effort && <details><summary className="cursor-pointer muted">{t("mission.effort", { n: m.doc.effort.minutes })}</summary><ul className="mt-1 list-disc pl-4">{m.doc.effort.stops.map((x) => <li key={x}>{x}</li>)}</ul></details>}
              {!!m.doc.checks?.length && (
                <details><summary className="cursor-pointer">{t("mission.checks", { ok: m.doc.checks.filter((c) => c.ok).length, n: m.doc.checks.length })}</summary>
                  <ul className="mt-1 space-y-0.5">{m.doc.checks.map((c, i) => <li key={i}><span style={{ color: c.ok ? "var(--mint)" : "#fb7185" }}>{t(c.ok ? "mission.passed" : "mission.failed")}</span> <span className="muted">{t("mission.step", { n: c.step + 1 })}</span> {c.what}</li>)}</ul>
                </details>
              )}
              {m.doc.constraints.length > 0 && <p className="muted">Constraints: {m.doc.constraints.join("; ")}</p>}
              {m.chain && (
                <ol className="space-y-0.5">
                  {m.chain.steps.map((s) => (
                    <li key={s.index} className="flex justify-between gap-2">
                      <button type="button" className="min-w-0 truncate text-left underline-offset-2 hover:underline" disabled={!s.taskId} onClick={() => s.taskId && onOpenTask?.(s.taskId)}>
                        {s.index + 1}. {s.agent}: {s.request.split("\n")[0]}
                      </button>
                      <span className="muted shrink-0">{s.status === "done" ? (stepVerified(m.doc.receipts, s.index) ? "verified" : "done · not verified") : s.status.replace("_", " ")}</span>
                    </li>
                  ))}
                </ol>
              )}
              {m.doc.brief && (
                <details>
                  <summary className="cursor-pointer">{t("mission.brief.title")}</summary>
                  <dl className="mt-1 space-y-1 break-words">
                    {m.doc.brief.output && <div><dt className="muted">{t("mission.brief.output")}</dt><dd className="whitespace-pre-wrap">{m.doc.brief.output}</dd></div>}
                    {m.doc.brief.evidence && <div><dt className="muted">{t("mission.brief.evidence")}</dt><dd className="whitespace-pre-wrap">{m.doc.brief.evidence}</dd></div>}
                    {m.doc.brief.approvalPoints && <div><dt className="muted">{t("mission.brief.approvals")}</dt><dd className="whitespace-pre-wrap">{m.doc.brief.approvalPoints}<p className="muted">{t("mission.brief.approvalsHint")}</p></dd></div>}
                  </dl>
                </details>
              )}
              {m.doc.receipts.length > 0 && (
                <details><summary className="cursor-pointer">Receipts ({m.doc.receipts.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {m.doc.receipts.map((r) => <li key={`${r.kind}:${r.ref}`}><span className="num">{r.kind} {r.path ?? r.ref}</span> <span className="muted">— step {r.step + 1}, {r.check}</span></li>)}
                  </ul>
                </details>
              )}
              <details><summary className="cursor-pointer">History</summary>
                <ul className="mt-1 space-y-0.5">{m.doc.log.slice(-12).map((l, i) => <li key={i}><span className="muted">{timeAgo(l.at)}</span> {l.text}</li>)}</ul>
              </details>
              <div className="flex flex-wrap gap-1.5">
                {ACTIONS.filter((a) => canDo(a, m.status) && (a !== "accept" || !!m.doc.hold)).map((a) => <button key={a} type="button" className="chip" onClick={() => act(m.id, a)}>{a[0].toUpperCase() + a.slice(1)}</button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
