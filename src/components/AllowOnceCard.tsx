"use client";
// Owner-only "Allow once" on a CORE egress refusal (allow-once-pure): the click grants exactly that call, one time, for 10 minutes.
import { useEffect, useState } from "react";
import { useT } from "./i18n";

export function AllowOnceCard({ id, tool, journal, onRetry }: { id: string; tool: string; journal: boolean; onRetry: () => void }) {
  const { t } = useT();
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  const [view, setView] = useState<{ destination: string; args: string } | null>(null);
  // exactly what a click approves: the server's stored input for this card (the grant is hashed from that same input)
  useEffect(() => { fetch(`/api/core/allow-once?id=${encodeURIComponent(id)}`).then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok) setView(j); else setState(j.error ?? `HTTP ${r.status}`); }).catch((e) => setState(String(e))); }, [id]);
  async function allow() {
    setState("busy");
    try {
      const r = await fetch("/api/core/allow-once", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const j = await r.json().catch(() => ({})) as { error?: string };
      setState(r.ok ? "done" : j.error ?? `HTTP ${r.status}`);
    } catch (e) { setState(String(e)); }
  }
  return (
    <section className="card mt-2 space-y-1 text-xs" role="group" aria-label={t("once.title", { tool })}>
      <b>{t("once.title", { tool })}</b>
      {view && <p>{t("once.dest")} <b className="break-all">{view.destination}</b></p>}
      {journal && <p className="error" role="alert">{t("once.journal")}</p>}
      {view && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.65rem]" aria-label={t("once.args")}>{view.args}</pre>}
      {state === "done" ? <div className="flex flex-wrap items-center gap-2"><span className="ok">{t("once.done")}</span><button type="button" className="chip" onClick={onRetry}>{t("once.retry")}</button></div>
        : <div className="flex flex-wrap items-center gap-2"><button type="button" className="chip" disabled={state === "busy" || !view} onClick={() => void allow()}>{t("once.allow")}</button>
          {state !== "idle" && state !== "busy" && <span className="error">{state}</span>}</div>}
    </section>
  );
}
