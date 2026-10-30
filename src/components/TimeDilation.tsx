"use client";
// Time dilation: pick a block (25/50/90 min) and one goal. While it runs the HUD chip is a quiet ring with the time left,
// the galaxy slows (Galaxy's Dilation), bell notices wait (notify-pure holdNotify) and the server holds pushes and calls.
// At the end: "while you were focused", then the held notices are released. Rules: lib/dilation-pure.ts; API: /api/focus.
import { useEffect, useRef, useState } from "react";
import { FOCUS_BLOCKS, GOAL_MAX, isFocusActive, ringLeft, type Focus, type FocusBlock, type FocusSummary } from "@/lib/dilation-pure";
import { holdNotify, notify, type NotifyDetail } from "@/lib/notify-pure";
import { useDialogFocus } from "./useDialogFocus";
import type { PushKind } from "@/lib/remote-push-pure";

type Span = { startAt: number; endAt: number } | null;
const PUSH_NAME: Partial<Record<PushKind, string>> = {
  clip: "clip review pushes", spend: "spend quote pushes", send: "email draft pushes", scheduled: "Short scheduled pushes", published: "Short published pushes",
  night: "night-shift report push", deal: "deal pushes", auto: "auto action pushes",
};
const R = 9, C = 2 * Math.PI * R;

export function TimeDilation({ onSpan }: { onSpan: (s: Span) => void }) {
  const [focus, setFocus] = useState<Focus | null>(null);
  const [summary, setSummary] = useState<FocusSummary | null>(null);
  const [held, setHeld] = useState<NotifyDetail[]>([]);
  const [minutes, setMinutes] = useState<FocusBlock>(50);
  const [goal, setGoal] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const apply = (b: { focus: Focus | null; summary: FocusSummary | null } | null) => {
    if (!b) return;
    setFocus(b.focus); setSummary(b.summary);
    const on = isFocusActive(b.focus, Date.now());
    const back = holdNotify(on);
    if (back.length && b.summary) setHeld((h) => [...h, ...back]);
    else back.forEach(notify); // no summary to show (read in another window): release now
    onSpan(on && b.focus ? { startAt: b.focus.startAt, endAt: b.focus.endAt } : null);
  };
  const call = async (body?: object) => {
    if (!body && busy.current) return; // a poll may skip; his clicks never do
    busy.current = true;
    try {
      const r = await fetch("/api/focus", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
      const b = await r.json().catch(() => null);
      if (!r.ok) setError(b?.error ?? "Couldn't reach ORBIT"); else { setError(""); apply(b); }
    } catch { setError("Couldn't reach ORBIT"); } finally { busy.current = false; }
  };

  // State on load and every minute (another window may start or end a block); a 1 s tick only while one runs.
  useEffect(() => { void call(); const t = setInterval(() => { if (!document.hidden) void call(); }, 60_000); return () => { clearInterval(t); holdNotify(false).forEach(notify); onSpan(null); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus) return;
    const t = setInterval(() => { const n = Date.now(); setNow(n); if (n >= focus.endAt) void call(); }, 1000);
    return () => clearInterval(t);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { void call({ action: "dismiss" }); held.forEach(notify); setHeld([]); }; // the summary is read: release the notices
  const sumRef = useRef<HTMLElement>(null);
  useDialogFocus(sumRef, !!summary, close);
  const ring = focus ? ringLeft(focus, now) : null;

  return (
    <>
      {focus && ring ? (
        <button className="chip dilation-ring" popoverTarget="dilation-menu" aria-label={`Focus: ${ring.label} left. ${focus.goal}`} title={`Focus: ${focus.goal}`}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
            <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
            <circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - ring.frac)} transform="rotate(-90 11 11)" />
          </svg>
          <span className="tabular-nums text-xs">{ring.label}</span>
        </button>
      ) : (
        <button className="chip" popoverTarget="dilation-menu" aria-label="Time dilation: start a focus block" title="Time dilation: focus on one goal; ORBIT holds everything that isn't urgent">⧗</button>
      )}
      <div id="dilation-menu" popover="auto" className="glass hud-menu" style={{ width: "min(20rem, calc(100vw - 2rem))" }} aria-label="Time dilation">
        <strong className="px-2 py-1 text-xs tracking-[0.15em]">TIME DILATION</strong>
        {focus ? (
          <div className="flex flex-col gap-2 px-2 py-1 text-sm">
            <p>{focus.goal}</p>
            <p className="muted text-xs">{ring?.label} left of {focus.minutes} min. Pushes, calls and notices wait unless urgent; agents keep working.</p>
            <button className="chip self-start" popoverTarget="dilation-menu" popoverTargetAction="hide" onClick={() => void call({ action: "end" })}>End now</button>
          </div>
        ) : (
          <form className="flex flex-col gap-2 px-2 py-1 text-sm" onSubmit={(e) => { e.preventDefault(); void call({ action: "start", minutes, goal }); }}>
            <div className="flex gap-1" role="group" aria-label="Block length">
              {FOCUS_BLOCKS.map((m) => <button key={m} type="button" className="chip" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m} min</button>)}
            </div>
            <label className="flex flex-col gap-1 text-xs">One goal
              <input className="field w-full" value={goal} maxLength={GOAL_MAX} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Finish the shop UI" required />
            </label>
            <button className="chip self-start" type="submit" disabled={!goal.trim()}>Start</button>
          </form>
        )}
        {error && <p className="px-2 pb-1 text-xs text-rose-300" role="alert">{error}</p>}
      </div>
      {summary && (
        <section ref={sumRef} tabIndex={-1} className="glass hud-panel fixed left-1/2 top-20 z-30 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 p-4 text-sm" role="dialog" aria-labelledby="dilation-sum">
          <h2 id="dilation-sum" className="text-xs tracking-[0.15em]">WHILE YOU WERE FOCUSED</h2>
          <p className="mt-1">{summary.actual} min on “{summary.goal}”</p>
          <h3 className="muted mt-3 text-xs">Agents</h3>
          {summary.work.length ? <ul>{summary.work.map((w) => <li key={w.label}>{w.n} {w.label}</li>)}</ul> : <p className="muted">Nothing new finished.</p>}
          <h3 className="muted mt-3 text-xs">Held for you</h3>
          {summary.held.length || held.length ? <ul>
            {summary.held.map((h) => <li key={h.tag}>{h.n} {PUSH_NAME[h.tag] ?? `${h.tag} pushes`}</li>)}
            {held.length > 0 && <li>{held.length} notice{held.length > 1 ? "s" : ""} in your bell</li>}
          </ul> : <p className="muted">Nothing was held.</p>}
          <button className="chip mt-3" onClick={close} autoFocus>Release and close</button>
        </section>
      )}
    </>
  );
}
