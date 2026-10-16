"use client";
// "Good morning" card on the galaxy: shown once per day on the first open after 05:00, or on "good morning" (then read aloud).
import { useCallback, useEffect, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { localDay, shouldAutoShow, type Morning, type MorningNav } from "@/lib/morning-pure";
import { speakChunk, speechSettings } from "./voice/speak";

const KEY = "orbit.morning"; // { day: last auto-shown local day, speak: read it aloud when it auto-shows (speakMorning, default off) }
type Saved = { day?: string; speak?: boolean };
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") ?? {}; } catch { return {}; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: may show again next open */ } };
const NAV: Record<MorningNav, NavTarget> = { review: { panel: "studio", view: "review" }, news: { panel: "intelligence" }, tasks: { panel: "operations" }, agents: { panel: "agents" }, life: { panel: "life" } };
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function MorningCard({ home }: { home: boolean }) {
  const [data, setData] = useState<Morning | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [speakMorning, setSpeakMorning] = useState(false);
  const homeRef = useRef(home);
  homeRef.current = home;

  const show = useCallback(async (say: boolean) => {
    setOpen(true); setErr("");
    try {
      const r = await fetch("/api/morning");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't load the briefing");
      setData(j);
      // One sentence per utterance: Chrome cuts long ones off after ~15 s.
      if (say && speechSettings().speak) for (const s of (j as Morning).spoken.split(/(?<=[.!?])\s+/)) speakChunk(s);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load the briefing"); }
  }, []);

  useEffect(() => {
    setSpeakMorning(!!load().speak);
    // Also on tab focus: ORBIT is often left open overnight. Auto-speak only when the card is actually on screen.
    const auto = () => {
      const s = load();
      if (document.visibilityState === "visible" && shouldAutoShow(s.day ?? null, new Date())) { save({ ...s, day: localDay(new Date()) }); void show(!!s.speak && homeRef.current); }
    };
    auto();
    const onNav = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.morning) void show(true); };
    addEventListener(NAV_EVENT, onNav);
    document.addEventListener("visibilitychange", auto);
    return () => { removeEventListener(NAV_EVENT, onNav); document.removeEventListener("visibilitychange", auto); };
  }, [show]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !home) return null;
  const go = (k: MorningNav) => { setOpen(false); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: NAV[k] })); };
  const toggleSpeak = (v: boolean) => { setSpeakMorning(v); save({ ...load(), speak: v }); };
  // Orbit's OPEN_MEMORY_EVENT handler also switches to the MEMORY panel.
  const openMem = (id: string) => { setOpen(false); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id } })); };
  const s = data?.studio, i = data?.intel, a = data?.agents, l = data?.life, rc = data?.recall;
  const best = s?.yesterday.filter((y) => y.views !== null).sort((x, y) => y.views! - x.views!)[0];

  return (
    <section className="glass hud-panel absolute right-3 top-16 z-20 w-[min(22rem,calc(100vw-1.5rem))] p-4 text-sm" aria-label="Morning briefing">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="hud-title">{data ? data.greeting.toUpperCase() : "GOOD MORNING"}</h2>
        <button className="chip" onClick={() => setOpen(false)} aria-label="Dismiss morning briefing">Close</button>
      </div>
      <div aria-live="polite">
      {err && <p className="error" role="alert">{err}</p>}
      {!data && !err && <p className="muted">Gathering your briefing…</p>}
      {data && (
        <div className="grid gap-3">
          {s && (
            <div>
              <b>Studio</b>
              <p className="muted">{n(s.ready, "clip")} to review · {s.today.length ? `${s.today.length} live today (${s.today.join(", ")})` : "nothing live today"}</p>
              {s.yesterday.length > 0 && <p className="muted">Yesterday: {s.yesterday.length} went live{best ? `, best “${best.title}” ${best.views!.toLocaleString()} views` : ""}</p>}
              {s.pausedUntil && <p className="warn">YouTube downloads paused until {s.pausedUntil}</p>}
              {s.scout && <p className="muted">{s.scout}</p>}
            </div>
          )}
          {i && (
            <div>
              <b>Intelligence</b> <span className="muted text-xs">{i.title}</span>
              {i.headlines.length ? <ul className="muted list-disc pl-4">{i.headlines.map((h) => <li key={h}>{h}</li>)}</ul> : <p className="muted">No headlines in the last briefing.</p>}
            </div>
          )}
          {a && (
            <div>
              <b>Agents</b>
              <p className="muted">{n(a.done.length, "task")} finished overnight{a.failed ? ` · ${a.failed} failed` : ""} · {n(a.proposals.length, "proposal")} waiting</p>
            </div>
          )}
          {l && (
            <div>
              <b>Life</b>
              <p className="muted">{l.habits ? `${l.done}/${l.habits} habits done today` : "No habits scheduled today"}{l.next ? ` · reminder ${l.next.at}: ${l.next.text}` : ""}</p>
            </div>
          )}
          {rc && rc.length > 0 && (
            <div>
              <b>From your memory</b>
              <ul className="muted grid gap-1">{rc.map((m) => <li key={m.id}><button className="text-left underline" onClick={() => openMem(m.id)}>{m.title}</button> <span className="text-xs">· {m.label}</span></li>)}</ul>
            </div>
          )}
          <p><b>Next:</b> {data.suggestion.nav ? <button className="underline" onClick={() => go(data.suggestion.nav!)}>{data.suggestion.text}</button> : data.suggestion.text}</p>
          <div className="flex flex-wrap gap-2">
            {s && <button className="chip" onClick={() => go("review")}>Review clips</button>}
            {i && <button className="chip" onClick={() => go("news")}>Open news</button>}
            {a && <button className="chip" onClick={() => go("tasks")}>Open tasks</button>}
            {l && <button className="chip" onClick={() => go("life")}>Open life</button>}
          </div>
          <label className="muted flex items-center gap-2 text-xs"><input type="checkbox" checked={speakMorning} onChange={(e) => toggleSpeak(e.target.checked)} /> Read it aloud each morning</label>
        </div>
      )}
      </div>
    </section>
  );
}
