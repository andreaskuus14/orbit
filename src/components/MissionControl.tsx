"use client";
// Mission control ("bridge"): a full-screen overlay opened from the HUD menu or by "mission control" / "bridge"
// (NAV_EVENT {mission}). Esc closes (native <dialog>). Polls existing endpoints every 5 s only while open; never approves
// anything: approvals link to where they are decided. Formatting: lib/mission-pure.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { bridgeApprovals, bridgeStudio, bridgeTasks, countdown, usagePct } from "@/lib/mission-pure";
import { eventLabel } from "@/lib/event-label-pure";
import { clock } from "@/lib/terminal-pure";
import { createClient } from "@/lib/supabase/client";
import { PinnedSkills } from "./PinnedSkills";
import { OpenLoops } from "./OpenLoops";
import type { PanelId } from "@/lib/planets";

const get = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
type Data = { tasks?: unknown; proposals?: unknown; usage?: unknown; studio?: unknown; doctor?: unknown; events?: { type: string; created_at: string }[] };
const o = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Thin horizontal gauge (inline SVG). */
function Bar({ pct, warn }: { pct: number; warn?: boolean }) {
  return (
    <svg className="mc-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
      <rect width="100" height="4" className="mc-bar-bg" />
      <rect width={pct} height="4" className={warn ? "mc-bar-warn" : "mc-bar-fg"} />
    </svg>
  );
}

function Panel({ label, code, children }: { label: string; code: string; children: React.ReactNode }) {
  return (
    <section className="mc-panel" aria-label={label}>
      <header><span>{label}</span><span className="mc-code">{code}</span></header>
      {children}
    </section>
  );
}

export function MissionControl() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Data>({});
  const [now, setNow] = useState(() => Date.now());
  const sb = useMemo(() => createClient(), []);

  useEffect(() => {
    const onNav = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.mission && !ref.current?.open) { ref.current?.showModal(); setOpen(true); } };
    addEventListener(NAV_EVENT, onNav);
    return () => removeEventListener(NAV_EVENT, onNav);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = async (first: boolean) => {
      const [tasks, proposals, usage, studio, doctor, ev] = await Promise.all([get("/api/tasks"), get("/api/proposals"), get("/api/usage-meter"), get("/api/studio/clips"),
        first ? get("/api/doctor?boot=1") : null, // this boot's cached self-test: no heavy checks re-run
        sb.from("events").select("type, created_at").order("created_at", { ascending: false }).limit(14).then((r) => r.data ?? null, () => null)]);
      if (alive) setD((p) => ({ tasks, proposals, usage, studio, doctor: doctor ?? p.doctor, events: ev ?? p.events }));
    };
    void poll(true);
    const h = setInterval(() => { if (!document.hidden) void poll(false); }, 5000), t = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(h); clearInterval(t); };
  }, [open, sb]);

  const close = () => ref.current?.close();
  const go = (panel: PanelId) => { close(); dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel } })); };

  const tasks = bridgeTasks(d.tasks, now), waiting = bridgeApprovals(d.tasks, d.proposals), studio = bridgeStudio(d.studio, now);
  const u = o(d.usage), h5 = o(u.h5), d7 = o(u.d7), set = o(u.settings), lvl = o(u.level), limit = o(u.limit);
  const callPct = usagePct(num(h5.calls), num(set.calls5h)), tokPct = usagePct(num(h5.tokens), num(set.tokens5h));
  const rep = o(o(d.doctor).report), checks = (Array.isArray(rep.checks) ? rep.checks : []).map(o);
  const bad = checks.filter((c) => c.status !== "ok");

  return (
    <dialog ref={ref} className="mc" aria-label="Mission control" onClose={() => setOpen(false)}>
      {open && <>
        <div className="mc-top">
          <span className="mc-title">MISSION CONTROL</span>
          <span className="mc-code">{clock(now)} · POLL 5S</span>
          <button className="chip" onClick={close} autoFocus aria-label="Close mission control (Esc)">ESC</button>
        </div>
        <div className="mc-grid">
          <Panel label="Agent tasks" code={`${tasks.length} RUNNING`}>
            {tasks.length ? <ul>{tasks.map((t) => (
              <li key={t.id}><div className="mc-row"><b>{t.agent.toUpperCase() || "AGENT"}</b><span className="mc-num">T+{t.elapsed}</span></div>
                <div className="mc-sub">{t.title}</div><div className="mc-sub mc-dim">▸ {t.step} · <span className="mc-num">{t.steps}</span> steps</div></li>))}</ul>
              : <p className="mc-dim">No agent is running.</p>}
          </Panel>

          <Panel label="Approvals waiting" code={`${waiting.length} PENDING`}>
            <div className="mc-big mc-num" data-hot={waiting.length > 0 || undefined}>{String(waiting.length).padStart(2, "0")}</div>
            {waiting.length > 0 && <ul>{waiting.slice(0, 6).map((w) => <li key={w.where + w.id} className="mc-sub">{w.title}</li>)}</ul>}
            <div className="mc-actions">
              {waiting.some((w) => w.where === "operations") && <button className="chip" onClick={() => go("operations")}>Review tasks in OPERATIONS</button>}
              {waiting.some((w) => w.where === "agents") && <button className="chip" onClick={() => go("agents")}>Review proposals in AGENTS</button>}
            </div>
          </Panel>

          <Panel label="Claude usage" code="5H WINDOW">
            {u.h5 ? <>
              <div className="mc-row"><span className="mc-label">CALLS</span><span className="mc-num">{num(h5.calls)} / {num(set.calls5h)} · {callPct}%</span></div>
              <Bar pct={callPct} warn={lvl.heavy === true} />
              {num(set.tokens5h) > 0 && <><div className="mc-row"><span className="mc-label">TOKENS</span><span className="mc-num">{num(h5.tokens).toLocaleString("en-US")} / {num(set.tokens5h).toLocaleString("en-US")} · {tokPct}%</span></div><Bar pct={tokPct} warn={lvl.heavy === true} /></>}
              <div className="mc-row"><span className="mc-label">7 DAYS</span><span className="mc-num">{num(d7.calls)} calls · {num(d7.tokens).toLocaleString("en-US")} tok</span></div>
              {typeof limit.until === "number" && <div className="mc-row mc-warn"><span className="mc-label">LIMIT RESET</span><span className="mc-num">{countdown(new Date(limit.until).toISOString(), now)}</span></div>}
              {typeof u.hold === "string" && u.hold && <p className="mc-sub mc-warn">{u.hold}</p>}
            </> : <p className="mc-dim">Usage meter unavailable.</p>}
          </Panel>

          <Panel label="Studio" code={`${studio.jobs.length} RENDERING`}>
            {studio.jobs.length ? <ul>{studio.jobs.map((j) => (
              <li key={j.id}><div className="mc-row"><span className="mc-sub">{j.name}</span><span className="mc-num">{j.pct}%</span></div><Bar pct={j.pct} /><div className="mc-sub mc-dim">▸ {j.step}</div></li>))}</ul>
              : <p className="mc-dim">No jobs rendering.</p>}
            <div className="mc-row"><span className="mc-label">NEXT SHORT</span><span className="mc-num">{studio.next ? countdown(studio.next.at, now) : "—"}</span></div>
            {studio.next && <div className="mc-sub mc-dim">{studio.next.title} · {studio.scheduled} scheduled</div>}
          </Panel>

          <Panel label="System health" code={`BOOT ${typeof rep.at === "string" ? clock(rep.at) : "--:--:--"}`}>
            {rep.status ? <>
              <div className="mc-row"><span className="mc-label">STATUS</span><span className={`mc-num mc-st-${String(rep.status)}`}>{String(rep.status).toUpperCase()}</span></div>
              <div className="mc-sub">{String(rep.headline ?? "")}</div>
              <div className="mc-row"><span className="mc-label">CHECKS</span><span className="mc-num">{checks.length - bad.length}/{checks.length} OK</span></div>
              {bad.length > 0 && <ul>{bad.slice(0, 5).map((c) => <li key={String(c.id)} className={`mc-sub mc-st-${String(c.status)}`}>{String(c.label ?? c.id)}: {String(c.detail ?? "")}</li>)}</ul>}
            </> : <p className="mc-dim">Self-test not ready.</p>}
          </Panel>

          <Panel label="Pinned skills" code="CORE"><PinnedSkills onRun={close} tasks={d.tasks} /></Panel>

          <OpenLoops go={go} />

          <Panel label="Event log" code="TAIL">
            <ol className="mc-log" aria-live="off">
              {(d.events ?? []).map((e, i) => { const l = eventLabel(e.type); return <li key={i}><span className="mc-num mc-dim">{clock(e.created_at)}</span> {l.label}</li>; })}
              {!d.events?.length && <li className="mc-dim">Nothing yet.</li>}
            </ol>
          </Panel>
        </div>
        <p className="mc-foot mc-dim">SKILLS RUN IN CORE WITH THE EXISTING APPROVAL RULES</p>
      </>}
    </dialog>
  );
}
