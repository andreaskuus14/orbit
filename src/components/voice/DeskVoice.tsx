"use client";
import { useEffect, useState } from "react";

// The background "Hey Orbit" listener (tools/voice, jarvis.ts): its toggle in Voice settings, and the card for level-3 PC actions
// waiting for the owner's click (pc-policy-pure). Polls only while the tab is visible.
type DeskState = { on: boolean; peripheral: boolean; everySec: number; envOff: boolean; helper: boolean };

export function DeskVoiceToggle() {
  const [s, setS] = useState<DeskState | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch("/api/voice/desk-settings").then((r) => (r.ok ? r.json() : null)).then(setS, () => setS(null)); }, []);
  const save = async (patch: Partial<DeskState>) => {
    setErr("");
    const r = await fetch("/api/voice/desk-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (r.ok) setS(await r.json()); else setErr("Couldn't save");
  };
  if (!s) return null;
  return (
    <label className="voice-col">Background &ldquo;Hey Orbit&rdquo; (any window)
      <label className="voice-row"><input type="checkbox" checked={s.on} disabled={s.envOff} onChange={(e) => void save({ on: e.target.checked })} /> Listen in the background on this PC</label>
      {s.on && <label className="voice-row"><input type="checkbox" checked={s.peripheral} onChange={(e) => void save({ peripheral: e.target.checked })} /> Peripheral: note the app + window title every {s.everySec} s (no screenshots) so ORBIT can offer help</label>}
      <span className="muted text-[10px]">{s.envOff ? "Off by ORBIT_WAKE=0 in .env.local." : !s.helper ? "The helper isn't running: run tools\\voice\\setup.ps1 once, then tools\\voice\\start.ps1." : "Helper running. Audio stays on this PC; only words after “Hey Orbit” reach CORE. LIFE, password managers and banking windows are never captured."}</span>
      {err && <span className="text-red-400 text-[10px]" role="alert">{err}</span>}
    </label>
  );
}

type Pending = { id: string; summary: string; click: boolean; at: number };

export function PcConfirm() {
  const [items, setItems] = useState<Pending[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const j = await fetch("/api/pc").then((r) => (r.ok ? r.json() : null), () => null) as { pending?: Pending[] } | null;
      if (!stop && j?.pending) setItems(j.pending);
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  const answer = async (id: string, allow: boolean) => {
    const r = await fetch("/api/pc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, allow }) });
    const j = await r.json().catch(() => ({})) as { text?: string };
    setMsg(j.text ?? ""); setItems((xs) => xs.filter((x) => x.id !== id));
    setTimeout(() => setMsg(""), 6000);
  };
  if (!items.length && !msg) return null;
  return (
    <div className="glass fixed bottom-4 right-4 z-50 max-w-sm p-3 text-xs" role="alertdialog" aria-label="ORBIT wants to act on your PC">
      {items.map((p) => (
        <div key={p.id} className="mb-2">
          <div className="font-semibold">ORBIT wants to {p.summary}</div>
          <div className="mt-1 flex gap-2">
            <button type="button" className="chip" onClick={() => void answer(p.id, true)}>Allow once</button>
            <button type="button" className="chip" onClick={() => void answer(p.id, false)}>Deny</button>
          </div>
        </div>
      ))}
      {msg && <div className="muted">{msg}</div>}
    </div>
  );
}
