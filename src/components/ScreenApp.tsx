"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pair } from "./RemoteApp";
import { mmss, type ScreenView } from "@/lib/screen-pure";

// /screen: read-only mission control for a tablet or second monitor (roadmap 3). Polls /api/remote/screen every 30 s,
// keeps the display awake, never sends a command. Dark, big type, laid out for a landscape iPad.
const REFRESH_MS = 30_000;
const KIND: Record<string, string> = { clip: "Clip", spend: "Spend", send: "Email", nego: "Reply", task: "Task" };

export function ScreenApp() {
  const [view, setView] = useState<(ScreenView & { at: number }) | null>(null);
  const [paired, setPaired] = useState<boolean | null>(null);
  const [off, setOff] = useState("");
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const shown = useRef(false); // once the dashboard has drawn, a 503 is a hiccup on the PC, not "remote is off"

  const load = useCallback(async () => {
    const r = await fetch("/api/remote/screen", { cache: "no-store" }).catch(() => null);
    if (!r) return setErr("Can't reach ORBIT: is the PC on and Tailscale connected?");
    if (r.status === 401) return setPaired(false);
    const j = await r.json().catch(() => null);
    if (r.status === 503 && !shown.current) { setOff(j?.error ?? "Remote is off"); return setPaired(false); }
    if (!r.ok) return setErr(j?.error ?? `Failed (${r.status})`);
    shown.current = true; setPaired(true); setErr(""); setView(j);
  }, []);

  useEffect(() => {
    void load();
    const h = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(h);
  }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => { // wake lock: re-taken whenever the page becomes visible again (the OS drops it when hidden)
    let lock: { release: () => Promise<void> } | null = null;
    const take = async () => {
      if (document.visibilityState !== "visible") return;
      try { lock = await (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* not allowed: the display may sleep */ }
    };
    void take();
    document.addEventListener("visibilitychange", take);
    return () => { document.removeEventListener("visibilitychange", take); void lock?.release().catch(() => {}); };
  }, []);

  if (paired === false) return <main className="mx-auto max-w-lg space-y-4 p-6"><h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>ORBIT SECOND SCREEN</h1><Pair off={off} screen onPaired={() => void load()} /></main>;
  if (!view) return <main className="grid min-h-dvh place-items-center text-xl muted">{err || "Connecting…"}</main>;

  const clock = new Date(now);
  const stale = now - view.at > REFRESH_MS * 3;
  return (
    <main className="min-h-dvh p-6" style={{ background: "var(--bg)", color: "var(--ink)", fontSize: "clamp(16px, 1.6vw, 22px)" }}>
      <header className="mb-5 flex items-center gap-5">
        <Orbit on={!view.stop} busy={view.agents.some((a) => a.status === "running")} />
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-widest" style={{ fontFamily: "var(--font-display)" }}>ORBIT · MISSION CONTROL</h1>
          <p className="muted" role="status">{view.stop ? "Stop-all is ON: ORBIT is paused" : `${view.agents.filter((a) => a.status === "running").length} running · ${view.approvals.length} waiting for you`}{stale && " · not updating, check the PC"}{err && ` · ${err}`}</p>
        </div>
        <div className="text-right" style={{ fontFamily: "var(--font-mono)" }}>
          <div className="text-6xl font-semibold tabular-nums">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          <div className="muted">{clock.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
      </header>

      <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <Card title="Today">
          {!view.brief ? <p className="muted">Brief is off.</p> : <>
            <p className="mb-2 text-xl">{view.brief.greeting}</p>
            {view.brief.items.length ? <ul className="space-y-2">{view.brief.items.map((i, k) => <li key={k}>{i.title}</li>)}</ul> : <p className="muted">Nothing needs you today.</p>}
          </>}
        </Card>
        <Card title="Agents now">
          {view.agents.length ? <ul className="space-y-2">{view.agents.map((a) => (
            <li key={a.id}><span style={{ color: a.status === "running" ? "var(--mint)" : "var(--muted)" }}>{a.status === "running" ? "●" : "○"}</span> <b className="uppercase">{a.step ?? a.agent}</b> {a.title}</li>
          ))}</ul> : <p className="muted">All quiet.</p>}
        </Card>
        <Card title={`Waiting for you (${view.approvals.length})`}>
          {view.approvals.length ? <ul className="space-y-2">{view.approvals.map((a, k) => <li key={k}><span className="muted">{KIND[a.kind] ?? a.kind}</span> {a.title}</li>)}</ul> : <p className="muted">Nothing to approve.</p>}
        </Card>
        <Card title="Night shift">
          {!view.night ? <p className="muted">No data.</p> : !view.night.enabled ? <p className="muted">Off.</p> : <>
            <p>{view.night.running ? "Working now" : `Window ${view.night.window}`} · {view.night.queued} queued for tonight</p>
            {(view.night.done || view.night.toApprove || view.night.failed) ? <p className="mt-2 text-xl">{view.night.done} done · {view.night.toApprove} to approve{view.night.failed ? ` · ${view.night.failed} failed` : ""}</p> : null}
            {view.night.stopped && <p className="muted mt-1">{view.night.stopped}</p>}
          </>}
        </Card>
        {view.focus && view.focus.endAt > now && (
          <Card title={view.focus.phase === "focus" ? "Focus" : "Break"}>
            <div className="text-6xl font-semibold tabular-nums" style={{ fontFamily: "var(--font-mono)", color: view.focus.phase === "focus" ? "var(--amber)" : "var(--mint)" }}>{mmss(view.focus.endAt - now)}</div>
          </Card>
        )}
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: "1.25rem" }}>
      <h2 className="muted mb-3 text-sm uppercase tracking-widest" style={{ fontFamily: "var(--font-display)" }}>{title}</h2>
      {children}
    </section>
  );
}

/** Galaxy-style status mark: a core with two orbits; the moon circles while agents run, the core turns rose on Stop-all. */
function Orbit({ on, busy }: { on: boolean; busy: boolean }) {
  const core = on ? "var(--cyan)" : "var(--rose)";
  return (
    <svg width="84" height="84" viewBox="-42 -42 84 84" aria-hidden="true">
      <circle r="38" fill="none" stroke="var(--line)" />
      <ellipse rx="30" ry="12" fill="none" stroke="var(--line-strong)" transform="rotate(-20)" />
      <circle r="9" fill={core} style={{ filter: `drop-shadow(0 0 8px ${core})` }} />
      <style>{"@keyframes orbit-moon{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.orbit-moon{animation:none!important}}"}</style>
      <g className="orbit-moon" style={busy && on ? { animation: "orbit-moon 6s linear infinite", transformOrigin: "0 0" } : undefined}>
        <circle cx="38" cy="0" r="4" fill="var(--violet)" />
      </g>
    </svg>
  );
}
