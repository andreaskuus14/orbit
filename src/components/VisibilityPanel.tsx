"use client";
import { useCallback, useEffect, useState } from "react";
import { latest, type Target } from "@/lib/visibility-pure";

// BUSINESS → AI visibility: does Claude know your shop/game/channel, and what does the web say? One click per check.
type Data = { targets: Target[]; busy: string | null };
async function call(body?: object): Promise<Data> {
  const r = await fetch("/api/visibility", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const LABEL = { claude: "Claude knows it", web: "On the web" } as const;

export default function VisibilityPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const run = useCallback(async (key: string, body: object) => {
    setBusy(key); setErr("");
    try { setD(await call(body)); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(""); }
  }, []);
  useEffect(() => { call().then(setD, (e: Error) => setErr(e.message)); }, []);
  return (
    <section className="card space-y-2" aria-labelledby="vis-title">
      <h3 id="vis-title" className="font-semibold">AI visibility</h3>
      <p className="muted text-xs">Does Claude know your shop, game or channel, and how does the web describe it? Each check uses your Claude plan.</p>
      <form className="flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await run("add", { action: "add", name })) setName(""); }}>
        <input className="field flex-1" aria-label="Name to track" placeholder="e.g. Fam_ClipsWW" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!!busy || !name.trim()}>Track</button>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
      <ul className="space-y-2">{d?.targets.map((t) => (
        <li key={t.name} className="rounded-md border border-white/10 p-2 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <b className="min-w-0 break-all">{t.name}</b>
            <span className="flex gap-1">
              <button type="button" className="chip" disabled={!!busy} onClick={() => void run(`check:${t.name}`, { action: "check", name: t.name })}>
                {busy === `check:${t.name}` ? "Checking… (1–2 min)" : "Check now"}</button>
              <button type="button" className="chip" disabled={!!busy} onClick={() => void run(`rm:${t.name}`, { action: "remove", name: t.name })} aria-label={`Stop tracking ${t.name}`}>✕</button>
            </span>
          </div>
          {(["claude", "web"] as const).map((src) => { const { now, changed } = latest(t, src); return (
            <p key={src} className="text-xs"><span className="muted">{LABEL[src]}:</span>{" "}
              {!now ? <span className="muted">not checked yet</span> : now.mentioned ? <>✓ {now.description || "mentioned"}</> : <>✗ not mentioned</>}
              {now && <span className="muted"> · {new Date(now.at).toLocaleDateString()}</span>}{changed && <b> · changed</b>}</p>); })}
        </li>))}</ul>
    </section>
  );
}
