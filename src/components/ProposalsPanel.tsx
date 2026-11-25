"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";

export type Proposal = {
  id: string; title: string; why: string; agent: string; agent_name: string; prompt: string; kind: string;
  status: "pending" | "approved" | "dismissed"; task_id: string | null; created_at: string; decided_at: string | null;
};

async function api<T>(init?: RequestInit): Promise<T> {
  const res = await fetch("/api/proposals", { ...init, headers: { "Content-Type": "application/json" } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

/** Agent suggestions: nothing runs until the user presses Approve. onOpenTask (optional) opens the created task. */
export function ProposalsPanel({ onOpenTask }: { onOpenTask?: (taskId: string) => void }) {
  const { t } = useT();
  const [list, setList] = useState<Proposal[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // proposal id, or "generate"
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ available: boolean; message?: string; proposals: Proposal[] }>();
      setUnavailable(r.available ? null : r.message ?? t("prop.unavail"));
      setList(r.proposals);
    } catch (e) { setErr(e instanceof Error ? e.message : t("prop.loadFail")); setList((l) => l ?? []); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "approve" | "dismiss" | "generate") {
    setBusy(action === "generate" ? "generate" : id); setErr(null); setNote(null);
    try {
      const r = await api<{ created?: Proposal[] }>({ method: "POST", body: JSON.stringify(action === "generate" ? { action } : { id, action }) });
      if (r.created) setNote(r.created.length ? (r.created.length > 1 ? t("prop.newN", { n: r.created.length }) : t("prop.new1")) : t("prop.nothing"));
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : t("prop.failed")); }
    finally { setBusy(null); }
  }

  if (unavailable) return <p className="muted text-sm">{unavailable}</p>;
  if (!list) return <p className="muted text-sm">{t("prop.loading")}</p>;
  const pending = list.filter((p) => p.status === "pending");
  const decided = list.filter((p) => p.status !== "pending").slice(0, 6);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="muted text-xs">{t("prop.help")}</p>
        <button className="btn" onClick={() => act("", "generate")} disabled={busy !== null}>{busy === "generate" ? t("prop.thinking") : t("prop.suggest")}</button>
      </div>
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p.id} className="card space-y-1 text-sm">
            <div className="flex items-start justify-between gap-2">
              <b>{p.title}</b>
              <span className="chip shrink-0">{p.agent_name}</span>
            </div>
            <p className="muted text-xs">{p.why}</p>
            <details className="text-xs"><summary className="cursor-pointer muted">{t("prop.asked")}</summary><p className="mt-1 whitespace-pre-wrap">{p.prompt}</p></details>
            <div className="flex gap-2 pt-1">
              <button className="btn" onClick={() => act(p.id, "approve")} disabled={busy !== null}>{busy === p.id ? t("prop.starting") : t("prop.approve")}</button>
              <button className="chip" onClick={() => act(p.id, "dismiss")} disabled={busy !== null} aria-label={t("prop.dismissL", { x: p.title })}>{t("prop.dismiss")}</button>
            </div>
          </li>
        ))}
        {!pending.length && <li className="muted text-sm">{t("prop.empty")}</li>}
      </ul>
      {decided.length > 0 && (
        <ul className="space-y-1 text-xs">
          {decided.map((p) => (
            <li key={p.id} className="muted">
              {p.status === "approved" ? "✓" : "✕"} {p.title} · {p.agent_name}
              {p.status === "approved" && p.task_id && onOpenTask && <> · <button className="link" onClick={() => onOpenTask(p.task_id!)}>{t("prop.openTask")}</button></>}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="muted text-xs" role="status">{note}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
