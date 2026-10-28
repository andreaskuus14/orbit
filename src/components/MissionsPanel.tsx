"use client";
import { useCallback, useState } from "react";
import { api, usePoll } from "./AgentMission";
import { canDo, stepVerified, type OwnerAction } from "@/lib/missions-pure";
import { timeAgo } from "@/lib/mission-pure";
import type { MissionView } from "@/lib/missions";

// MISSIONS: CORE's multi-step jobs. State, the one next action, steps, receipts (what ORBIT verified) and the plain-language log.
// Approvals are not here: an action waiting for approval is approved in the step's task, as before. Text is untrusted: React text only.

const ACTIONS: OwnerAction[] = ["pause", "resume", "retry", "cancel"];
const TONE: Record<string, string> = { completed: "var(--mint)", failed: "#fb7185", "waiting-input": "#fbbf24", "waiting-approval": "#fbbf24", paused: "var(--muted)" };

export default function MissionsPanel({ visible, onOpenTask }: { visible: boolean; onOpenTask?: (id: string) => void }) {
  const [list, setList] = useState<MissionView[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => { api<{ missions: MissionView[] }>("/api/missions").then((r) => { setList(r.missions); setErr(""); }, (e) => setErr(e.message)); }, []);
  usePoll(load, 5_000, visible);
  const act = (id: string, action: OwnerAction) => api("/api/missions", { method: "POST", body: JSON.stringify({ id, action }) }).then(load, (e) => setErr(e.message));

  return (
    <div className="space-y-2 text-xs">
      <p className="muted">Ask CORE for work that needs several steps and it becomes a mission here. It keeps going in the background and after restarts.</p>
      {err && <p role="alert" style={{ color: "#fb7185" }}>{err}</p>}
      {!list ? <p className="muted">{err ? "" : "Loading…"}</p> : !list.length ? <p className="muted">No missions yet.</p> : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id} className="card space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">{m.doc.objective}</p>
                <span className="shrink-0" style={{ color: TONE[m.status] ?? "var(--cyan)" }}>{m.label}</span>
              </div>
              <p><span className="muted">Next: </span>{m.next}</p>
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
                {ACTIONS.filter((a) => canDo(a, m.status)).map((a) => <button key={a} type="button" className="chip" onClick={() => act(m.id, a)}>{a[0].toUpperCase() + a.slice(1)}</button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
