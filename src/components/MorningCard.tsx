"use client";
// "Good morning" card on the galaxy: shown once per day on the first open after 05:00, or on "good morning" (then read aloud).
// Also the "Since you left" recap: on return after ≥ 3 h away it opens compact (or merges into the morning briefing).
import { useCallback, useEffect, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { NOTIFY_KEY, parseItems } from "@/lib/notify-pure";
import { awaySince, countSince, localDay, shouldAutoShow, sinceEmpty, sinceSpoken, type Morning, type MorningSince } from "@/lib/morning-pure";
import dynamic from "next/dynamic";
import { speakChunk, speechSettings } from "./voice/speak";

const KEY = "orbit.morning"; // { day: last auto-shown local day, speak: read it aloud when it auto-shows (speakMorning, default off) }
type Saved = { day?: string; speak?: boolean };
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") ?? {}; } catch { return {}; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: may show again next open */ } };
const SEEN = "orbit.lastSeen"; // ms epoch of the last minute a window was visible (shared across windows)
const lastSeen = () => { try { const v = Number(localStorage.getItem(SEEN)); return v > 0 ? v : null; } catch { return null; } };
const markSeen = (t: number) => { try { localStorage.setItem(SEEN, String(t)); } catch { /* no storage: no recap */ } };
const whatsNewUp = () => !!document.querySelector(".whats-new, .morning-brief"); // WHAT'S NEW or the morning brief is on top: it owns Esc, and nothing is read aloud under it
type Req = { current: AbortController | null };
const begin = (r: Req) => { r.current?.abort(); return (r.current = new AbortController()); };
const end = (r: Req, c: AbortController) => { if (r.current === c) r.current = null; };
const notesSince = (from: number) => { try { return countSince(parseItems(localStorage.getItem(NOTIFY_KEY)), from); } catch { return 0; } };
// The card itself (cards, night report with night-pure/goals-pure) loads only when it opens.
const MorningCardBody = dynamic(() => import("./MorningCardBody"), { ssr: false });

export function MorningCard({ home, onOpenTask, onOpenGoal }: { home: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
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
      // Said aloud only with "read the briefing aloud" on, like the morning card.
      if (load().speak && speechSettings().speak && !whatsNewUp()) for (const line of sinceSpoken(since, k).split(/(?<=[.!?])\s+/)) if (line) speakChunk(line);
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
  const toggleSpeak = (v: boolean) => { setSpeakMorning(v); save({ ...load(), speak: v }); };
  return <MorningCardBody data={data} err={err} recap={recap} notes={notes} speakMorning={speakMorning} onSpeak={toggleSpeak}
    close={() => setOpen(false)} onOpenTask={onOpenTask} onOpenGoal={onOpenGoal} />;
}
