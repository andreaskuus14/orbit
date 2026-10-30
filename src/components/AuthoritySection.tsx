"use client";
import { useCallback, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import { MODES, MODE_TEXT, grantLive, type AuthorityState, type Grant, type Mode } from "@/lib/authority-pure";
import { changeStopAll } from "./nav-command";

type View = AuthorityState & { policyVersion: string; stopAll: boolean };

const limitText = (g: Grant) => [
  g.limits.count !== undefined && `${g.used.count}/${g.limits.count} actions`,
  g.limits.money !== undefined && `${g.used.money}/${g.limits.money} money`,
  g.limits.calls !== undefined && `${g.used.calls}/${g.limits.calls} calls`,
].filter(Boolean).join(" · ") || "no limits";

const state = (g: Grant) => g.revoked ? "revoked" : g.paused ? "paused" : grantLive(g, Date.now()) ? "active" : "inactive (expired or older policy)";

/** Profile → Authority: standing grants with their limits, pause/revoke, workflow modes and Stop-all. Changes apply at the next action. */
export function AuthoritySection() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ workflow: "", actions: "", count: "" });
  const call = useCallback(async (body?: object) => {
    setErr("");
    const r = await fetch("/api/authority", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) setV(j); else setErr(j?.error ?? "Couldn't load Authority");
  }, []);
  const poll = useCallback(() => void call(), [call]);
  usePoll(poll, pollMs(30_000));

  async function stopAll() {
    if (!confirm("Stop everything? Running work stops and nothing runs on its own until you resume on the PC.")) return;
    try { await changeStopAll(true); await call(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't stop"); }
  }
  function addGrant() {
    void call({ action: "grant", workflow: form.workflow, actions: form.actions.split(",").map((a) => a.trim()).filter(Boolean), limits: form.count ? { count: Number(form.count) } : {} });
  }

  return (
    <section className="space-y-3" aria-labelledby="authority-title">
      <h3 id="authority-title" className="text-sm font-semibold">Authority</h3>
      <p className="muted text-sm">What ORBIT may do on its own without asking again. Grants cover only reversible changes inside ORBIT; sending, spending, publishing and signing always wait for your click on the exact version. Pause or revoke applies from the next action.</p>
      <button className="btn w-full py-3 text-base" onClick={() => void stopAll()} disabled={v?.stopAll}>{v?.stopAll ? "Stop-all is on" : "Stop all"}</button>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      <ul className="space-y-2" aria-label="Standing grants">
        {v?.grants.length === 0 && <li className="muted text-sm">No standing grants. Everything works as before.</li>}
        {v?.grants.map((g) => (
          <li key={g.id} className="rounded border border-white/10 p-2 text-sm">
            <div><b>{g.workflow}</b> · {state(g)}</div>
            <div className="muted text-xs">{g.actions.join(", ")} · {limitText(g)}{g.destinations.length ? ` · to ${g.destinations.join(", ")}` : ""}{g.expiresAt ? ` · until ${g.expiresAt.slice(0, 10)}` : ""}</div>
            {!g.revoked && <div className="mt-1 flex gap-2">
              <button className="chip" onClick={() => void call({ action: "pause", id: g.id, on: !g.paused })}>{g.paused ? "Resume" : "Pause"}</button>
              <button className="chip" onClick={() => confirm(`Revoke the grant for ${g.workflow}?`) && void call({ action: "revoke", id: g.id })}>Revoke</button>
            </div>}
          </li>
        ))}
      </ul>
      <div className="space-y-1" aria-label="Workflow modes">
        {Object.entries(v?.modes ?? {}).map(([w, m]) => (
          <label key={w} className="flex items-center justify-between gap-2 text-sm">{w}
            <select value={m} onChange={(e) => void call({ action: "mode", workflow: w, mode: e.target.value === "" ? null : e.target.value })}>
              {MODES.filter((x) => x !== "operate").map((x: Mode) => <option key={x} value={x}>{MODE_TEXT[x]}</option>)}
              <option value="">No mode (as before)</option>
            </select>
          </label>
        ))}
      </div>
      <details className="text-sm">
        <summary>Add a grant</summary>
        <div className="mt-2 space-y-2">
          <label className="block">Workflow<input className="field w-full" placeholder="workflow, e.g. rule:<id> or automation:<id>" value={form.workflow} onChange={(e) => setForm({ ...form, workflow: e.target.value })} /></label>
          <label className="block">Actions<input className="field w-full" placeholder="actions, e.g. rules.run" value={form.actions} onChange={(e) => setForm({ ...form, actions: e.target.value })} /></label>
          <label className="block">Max actions<input className="field w-full" type="number" min={0} placeholder="max actions (optional)" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} /></label>
          <div className="flex gap-2">
            <button className="chip" onClick={addGrant}>Add grant</button>
            <button className="chip" onClick={() => void call({ action: "mode", workflow: form.workflow, mode: "prepare" })}>Set Prepare mode</button>
            <button className="chip" onClick={() => void call({ action: "mode", workflow: form.workflow, mode: "hold" })}>Hold</button>
          </div>
        </div>
      </details>
      <p className="muted text-xs">Policy version {v?.policyVersion}. Operate mode (outward actions) is not available.</p>
    </section>
  );
}
