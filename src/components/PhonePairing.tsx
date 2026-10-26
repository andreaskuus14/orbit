"use client";
import { useCallback, useEffect, useState } from "react";

type View = { problem: string; pair: { code: string; expiresAt: number } | null; devices: { id: string; name: string; createdAt: string; lastSeen: string | null }[];
  shortcuts?: { id: string; name: string; action: string; createdAt: string; lastSeen: string | null }[]; token?: string };
const KINDS: [string, string][] = [["status", "Status"], ["call", "Call me"], ["stop", "Stop-all ON"], ["approve", "Approve next"], ["ask", "Ask CORE"]];

/** Profile: pair the phone remote (/remote) with a 2-minute code, and revoke paired phones. Setup: docs/PHONE.md. */
export function PhonePairing() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [kind, setKind] = useState("status");
  const [token, setToken] = useState(""); // shown once, right after it's made
  const call = useCallback(async (body?: object) => {
    setErr("");
    const r = await fetch("/api/remote/owner", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) { setV(j); setToken(j.token ?? ""); } else setErr(j?.error ?? "Couldn't load phone pairing");
  }, []);
  useEffect(() => { void call(); }, [call]);
  useEffect(() => {
    if (!v?.pair) return;
    const h = setInterval(() => { setNow(Date.now()); if (Date.now() >= v.pair!.expiresAt) void call(); }, 1000);
    return () => clearInterval(h);
  }, [v?.pair, call]);
  const left = v?.pair ? Math.max(0, Math.ceil((v.pair.expiresAt - now) / 1000)) : 0;
  return (
    <section className="space-y-3" aria-labelledby="phone-title">
      <h3 id="phone-title" className="text-sm font-semibold">Phone remote</h3>
      <p className="muted text-sm">Approvals, Stop-all, Studio queue and CORE from your phone over Tailscale. On the phone open <b>/remote</b> on your Tailscale address (docs/PHONE.md).</p>
      {v?.problem ? <p className="error text-sm">{v.problem}</p> : (
        <div className="flex items-center gap-3">
          <button className="btn" onClick={() => void call({ action: "pair" })}>Pair phone</button>
          {v?.pair && left > 0 && <span className="text-2xl font-semibold tracking-[0.3em]" aria-live="polite">{v.pair.code} <span className="muted text-xs tracking-normal">{left}s</span></span>}
        </div>
      )}
      {v?.devices.length ? (
        <ul className="space-y-1">
          {v.devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{d.name} <span className="muted text-xs">paired {d.createdAt.slice(0, 10)}{d.lastSeen ? `, last used ${new Date(d.lastSeen).toLocaleString()}` : ""}</span></span>
              <button className="chip" onClick={() => confirm(`Revoke ${d.name}? It stops working at once.`) && void call({ action: "revoke", id: d.id })}>Revoke</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted text-xs">No phones paired.</p>}
      {!v?.problem && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Shortcuts &amp; Watch</h4>
          <p className="muted text-xs">One token per Shortcut, each allowed one action. Recipes: docs/PHONE.md "Shortcuts &amp; Watch".</p>
          <div className="flex items-center gap-2">
            <select className="field py-1" aria-label="Shortcut action" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="btn" onClick={() => void call({ action: "shortcut", kind, name: KINDS.find(([k]) => k === kind)?.[1] })}>New token</button>
          </div>
          {token && (
            <div className="space-y-1">
              <p className="text-xs">Copy it into the Shortcut's Authorization header now: it isn't shown again.</p>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all select-all">Bearer {token}</code>
                <button className="chip" onClick={() => void navigator.clipboard?.writeText(`Bearer ${token}`)}>Copy</button>
              </div>
            </div>
          )}
          {v?.shortcuts?.length ? (
            <ul className="space-y-1">
              {v.shortcuts.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{s.name} <span className="muted text-xs">made {s.createdAt.slice(0, 10)}{s.lastSeen ? `, last used ${new Date(s.lastSeen).toLocaleString()}` : ""}</span></span>
                  <button className="chip" onClick={() => confirm(`Revoke the ${s.name} token? That Shortcut stops working at once.`) && void call({ action: "revokeShortcut", id: s.id })}>Revoke</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted text-xs">No Shortcut tokens.</p>}
        </div>
      )}
      {err && <p className="error text-sm" role="alert">{err}</p>}
    </section>
  );
}
