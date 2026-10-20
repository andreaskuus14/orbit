"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/lib/notify-pure";
import { changeStopAll, STOP_ALL_CHANGED } from "./nav-command";
import { RESOLVE_ALERT, type Signal } from "@/lib/interruption-pure";

type Status = { stop: { on: boolean; at: string }; hold: string; limit: { until: number; at: number } | null };
const SEEN_KEY = "orbit.limitSeen";

/** 🛑 Stop-all in the top HUD (with a confirm), the red "Paused" banner while it's on, and a bell note when Claude's usage limit is hit. */
export function StopAll() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seen = useRef<number | null>(null);
  const wasOn = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/stop-all").then((x) => (x.ok ? x.json() : null)).catch(() => null) as Status | null;
    if (!r) return;
    setS(r);
    if (r.stop.on && !wasOn.current) notify({ key: `stop-all:${r.stop.at}`, signal: "stop-all", kind: "system", title: "Stop-all switched on", reason: "Agents and automations are paused until you resume them.", fixLabel: "Open pause controls", nav: { panel: null } });
    if (!r.stop.on) dispatchEvent(new CustomEvent<Signal>(RESOLVE_ALERT, { detail: "stop-all" }));
    wasOn.current = r.stop.on;
    if (!r.limit || r.limit.until <= Date.now()) dispatchEvent(new CustomEvent<Signal>(RESOLVE_ALERT, { detail: "usage-limit" }));
    if (r.limit && r.limit.until > Date.now()) {
      if (seen.current === null) { try { seen.current = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { seen.current = 0; } }
      if (r.limit.at !== seen.current) {
        seen.current = r.limit.at;
        try { localStorage.setItem(SEEN_KEY, String(r.limit.at)); } catch { /* notify again next load: harmless */ }
        notify({ key: `usage-limit:${r.limit.at}`, signal: "usage-limit", nav: { panel: "analytics" }, fixLabel: "See reset time", kind: "system", title: "Claude usage limit reached", body: `Background work (autopilot, goals, suggestions, translations) is paused until ${new Date(r.limit.until).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}. CORE chat still works.` });
      }
    }
  }, []);
  useEffect(() => {
    void load();
    const h = setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    addEventListener(STOP_ALL_CHANGED, refresh);
    return () => { clearInterval(h); removeEventListener(STOP_ALL_CHANGED, refresh); };
  }, [load]);

  async function toggle(on: boolean) {
    if (on && !confirm("Stop everything?\n\nRunning agent tasks, agent teams and goal steps are cancelled, and no automation, scout, autopilot, briefing or suggestion starts until you press Resume. Clip renders already running finish. CORE chat keeps answering.")) return;
    setBusy(true); setErr("");
    try {
      const warning = await changeStopAll(on);
      if (warning) setErr(warning);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't switch Stop-all"); }
    finally { setBusy(false); }
  }

  const on = !!s?.stop.on;
  return (
    <>
      <button className="chip" onClick={() => toggle(!on)} disabled={busy || !s} aria-pressed={on} style={on ? { borderColor: "var(--rose)" } : undefined}
        aria-label={on ? "Stop-all is on. Resume ORBIT" : "Stop all: pause every agent, automation and background job"}
        title={on ? "Stop-all is on: click to resume" : "Stop-all: cancel running agents and pause every automation and background job (asks first)"}>🛑</button>
      {(on || err) && (
        <div role="alert" className="fixed left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-1.5 text-sm"
          style={{ background: "rgba(127, 29, 29, 0.92)", border: "1px solid var(--rose)", color: "#fff", boxShadow: "0 0 18px rgba(251, 113, 133, 0.45)" }}>
          {on ? <span><b>Paused</b> — Stop-all on</span> : null}
          {err && <span>{err}</span>}
          {on && <button className="chip" onClick={() => toggle(false)} disabled={busy} title="Turn Stop-all off: queued work starts again">Resume</button>}
        </div>
      )}
    </>
  );
}
