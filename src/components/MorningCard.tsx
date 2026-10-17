"use client";
// "Good morning" card on the galaxy: shown once per day on the first open after 05:00, or on "good morning" (then read aloud).
// Also the "Since you left" recap: on return after ≥ 3 h away it opens compact (or merges into the morning briefing).
import { useCallback, useEffect, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { NOTIFY_KEY, parseItems } from "@/lib/notify-pure";
import { awaySince, countSince, localDay, shouldAutoShow, sinceEmpty, type Morning, type MorningNav, type MorningSince } from "@/lib/morning-pure";
import { speakChunk, speechSettings } from "./voice/speak";

const KEY = "orbit.morning"; // { day: last auto-shown local day, speak: read it aloud when it auto-shows (speakMorning, default off) }
type Saved = { day?: string; speak?: boolean };
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") ?? {}; } catch { return {}; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: may show again next open */ } };
const SEEN = "orbit.lastSeen"; // ms epoch of the last minute a window was visible (shared across windows)
const lastSeen = () => { try { const v = Number(localStorage.getItem(SEEN)); return v > 0 ? v : null; } catch { return null; } };
const markSeen = (t: number) => { try { localStorage.setItem(SEEN, String(t)); } catch { /* no storage: no recap */ } };
const whatsNewUp = () => !!document.querySelector(".whats-new"); // WHAT'S NEW is on top: it owns Esc, and nothing is read aloud under it
type Req = { current: AbortController | null };
const begin = (r: Req) => { r.current?.abort(); return (r.current = new AbortController()); };
const end = (r: Req, c: AbortController) => { if (r.current === c) r.current = null; };
const notesSince = (from: number) => { try { return countSince(parseItems(localStorage.getItem(NOTIFY_KEY)), from); } catch { return 0; } };
const NAV: Record<MorningNav, NavTarget> = { review: { panel: "studio", view: "review" }, news: { panel: "intelligence" }, tasks: { panel: "operations" }, agents: { panel: "agents" }, life: { panel: "life" } };
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function MorningCard({ home }: { home: boolean }) {
  const [data, setData] = useState<Morning | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [speakMorning, setSpeakMorning] = useState(false);
  const [recap, setRecap] = useState(false); // compact "welcome back" card (no morning sections)
  const [notes, setNotes] = useState(0);
  const openRef = useRef(false);
  openRef.current = open;
  const homeRef = useRef(home);
  homeRef.current = home;
  const ctrl = useRef<AbortController | null>(null); // the one request in flight; a newer show() aborts it


  // from: the away window to merge in. orbit.lastSeen moves forward only once that window was actually fetched, so a failure retries next tick.
  const show = useCallback(async (say: boolean, from: number | null = null) => {
    const c = begin(ctrl);
    setOpen(true); setRecap(false); setErr(""); setData(null); setNotes(from === null ? 0 : notesSince(from));
    try {
      const r = await fetch(`/api/morning${from === null ? "" : `?since=${from}`}`, { signal: c.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't load the briefing");
      if (c.signal.aborted) return;
      if (from !== null) markSeen(Date.now());
      setData(j);
      // One sentence per utterance: Chrome cuts long ones off after ~15 s.
      if (say && speechSettings().speak && !whatsNewUp()) for (const s of (j as Morning).spoken.split(/(?<=[.!?])\s+/)) speakChunk(s);
    } catch (e) { if (!c.signal.aborted) setErr(e instanceof Error ? e.message : "Couldn't load the briefing"); }
    finally { end(ctrl, c); }
  }, []);

  // Recap only opens when something happened, so an empty one never flashes "Gathering…".
  const showRecap = useCallback(async (from: number) => {
    const c = begin(ctrl);
    try {
      const r = await fetch(`/api/morning?since=${from}&recap=1`, { signal: c.signal });
      if (!r.ok) return; // a failed recap stays quiet and keeps the old last-seen, so the next tick retries
      const { since } = (await r.json()) as { since: MorningSince };
      if (c.signal.aborted) return;
      markSeen(Date.now());
      const k = notesSince(from);
      if (sinceEmpty(since, k) || openRef.current) return; // never replace an open briefing
      setData({ since } as Morning); setNotes(k); setErr(""); setRecap(true); setOpen(true);
    } catch { /* offline or aborted: no recap yet */ }
    finally { end(ctrl, c); }
  }, []);

  useEffect(() => {
    setSpeakMorning(!!load().speak);
    // On load, tab focus and every minute while visible (a sleeping laptop wakes with the tab still visible): ORBIT is often left open overnight.
    // Only visible minutes count as "seen", so time with the tab hidden counts as away. Auto-speak only when the card is actually on screen.
    const auto = () => {
      if (document.visibilityState !== "visible") return;
      const now = new Date(), s = load(), from = awaySince(lastSeen(), now.getTime()), morning = shouldAutoShow(s.day ?? null, now);
      if (from === null) { markSeen(now.getTime()); if (!morning) return; }
      else if (ctrl.current || (!morning && !homeRef.current)) return; // fetch in flight, or recap waits for the galaxy (away time keeps accruing)
      if (morning) { save({ ...s, day: localDay(now) }); void show(!!s.speak && homeRef.current, from); }
      else void showRecap(from!);
    };
    auto();
    const tick = setInterval(auto, 60_000);
    const onNav = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.morning) void show(true); };
    addEventListener(NAV_EVENT, onNav);
    document.addEventListener("visibilitychange", auto);
    return () => { clearInterval(tick); removeEventListener(NAV_EVENT, onNav); document.removeEventListener("visibilitychange", auto); };
  }, [show, showRecap]);

  useEffect(() => {
    if (!open || !home) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !whatsNewUp()) setOpen(false); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, home]);

  if (!open || !home) return null;
  const nav = (t: NavTarget) => { setOpen(false); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: t })); };
  const go = (k: MorningNav) => nav(NAV[k]);
  const bell = () => { setOpen(false); try { document.getElementById("notify-menu")?.showPopover(); } catch { /* already open */ } };
  const toggleSpeak = (v: boolean) => { setSpeakMorning(v); save({ ...load(), speak: v }); };
  // Orbit's OPEN_MEMORY_EVENT handler also switches to the MEMORY panel.
  const openMem = (id: string) => { setOpen(false); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id } })); };
  const s = data?.studio, i = data?.intel, a = data?.agents, l = data?.life, rc = data?.recall, sn = data?.since;
  const away = sn ? Math.round((Date.now() - sn.from) / 3_600_000) : 0;
  const sinceBlock = sn && !sinceEmpty(sn, notes) && (
    <div>
      <b>Since you left</b> <span className="muted text-xs">{away < 48 ? `${away} h ago` : `${Math.round(away / 24)} days ago`}</span>
      <ul className="since-list muted grid gap-1">
        {(sn.done > 0 || sn.failed > 0) && <li><button onClick={() => go("tasks")}>🤖 {n(sn.done, "agent task")} finished{sn.failed ? ` · ${sn.failed} failed` : ""}</button></li>}
        {sn.clips > 0 && <li><button onClick={() => go("review")}>🎬 {n(sn.clips, "new clip")} in REVIEW</button></li>}
        {sn.reminders.map((t, k) => <li key={`r${k}`}><button onClick={() => nav({ panel: "life", life: "reminders" })}>⏰ {t}</button></li>)}
        {sn.alerts.map((t, k) => <li key={`a${k}`}><button onClick={() => nav({ panel: "markets" })}>📈 {t}</button></li>)}
        {notes > 0 && <li><button onClick={bell}>🔔 {n(notes, "new notification")}</button></li>}
      </ul>
    </div>
  );
  const best = s?.yesterday.filter((y) => y.views !== null).sort((x, y) => y.views! - x.views!)[0];

  return (
    <section className="glass hud-panel morning-card absolute right-3 top-16 z-20 w-[min(22rem,calc(100vw-1.5rem))] p-4 text-sm" aria-label={recap ? "Since you left" : "Morning briefing"}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="hud-title">{recap ? "WELCOME BACK" : data?.greeting ? data.greeting.toUpperCase() : "GOOD MORNING"}</h2>
        <button className="chip" onClick={() => setOpen(false)} aria-label={recap ? "Dismiss recap" : "Dismiss morning briefing"}>Close</button>
      </div>
      {recap ? sinceBlock : (
      <div aria-live="polite">
      {err && <p className="error" role="alert">{err}</p>}
      {!data && !err && <p className="muted">Gathering your briefing…</p>}
      {data && (
        <div className="grid gap-3">
          {sinceBlock}
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
      )}
    </section>
  );
}
