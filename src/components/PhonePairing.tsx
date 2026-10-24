"use client";
import { useCallback, useEffect, useState } from "react";

type View = { problem: string; pair: { code: string; expiresAt: number } | null; devices: { id: string; name: string; createdAt: string; lastSeen: string | null }[] };

/** Profile: pair the phone remote (/remote) with a 2-minute code, and revoke paired phones. Setup: docs/PHONE.md. */
export function PhonePairing() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const call = useCallback(async (body?: object) => {
    setErr("");
    const r = await fetch("/api/remote/owner", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) setV(j); else setErr(j?.error ?? "Couldn't load phone pairing");
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
      {err && <p className="error text-sm" role="alert">{err}</p>}
    </section>
  );
}
