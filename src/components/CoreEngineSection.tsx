"use client";
import { useEffect, useState } from "react";

const OPTIONS = [
  { id: "cli", label: "JSON loop", detail: "Default. CORE's own tool loop around claude -p." },
  { id: "mcp", label: "Native (MCP)", detail: "Claude Code's own tool loop drives ORBIT's tools. Same approvals, privacy checks, Stop-all, receipts and Activity." },
  { id: "sdk", label: "Agent SDK", detail: "Prototype. Licensing note in docs/AGENT-SDK.md." },
] as const;

/** Profile → CORE engine: which engine answers the next CORE message (core-engine.ts). */
export function CoreEngineSection() {
  const [v, setV] = useState<{ engine: string; fallback: string } | null>(null);
  const [err, setErr] = useState("");
  const call = async (init?: RequestInit) => {
    setErr("");
    const r = await fetch("/api/core/engine", init).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) setV(j); else setErr(j?.error ?? "Couldn't load the CORE engine");
  };
  useEffect(() => { void call(); }, []);
  const pick = (engine: string | null) => void call({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine }) });
  return (
    <section className="space-y-2" aria-labelledby="engine-title">
      <h3 id="engine-title" className="text-sm font-semibold">CORE engine</h3>
      <p className="muted text-sm">Active: <b>{OPTIONS.find((o) => o.id === v?.engine)?.label ?? "…"}</b>. A change applies from your next CORE message.</p>
      <div role="radiogroup" aria-labelledby="engine-title" className="space-y-1">
        {OPTIONS.map((o) => (
          <button key={o.id} role="radio" aria-checked={v?.engine === o.id} className={`${v?.engine === o.id ? "btn" : "chip"} w-full text-left`} onClick={() => pick(o.id)} disabled={!v}>
            {o.label}<span className="muted block text-xs">{o.detail}</span>
          </button>
        ))}
      </div>
      {v && v.engine !== v.fallback && <button className="btn text-xs" onClick={() => pick(null)}>Back to the default ({OPTIONS.find((o) => o.id === v.fallback)?.label})</button>}
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
    </section>
  );
}
