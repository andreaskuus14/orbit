"use client";
// STUDIO desktop notifications: polls the clip factory (60 s visible, 5 min hidden), announces new ready clips, failed jobs,
// YouTube-blocked downloads and scheduled Shorts going live. Logic: src/lib/studio-notify.ts. Renders only the permission chip.
import { useEffect, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { parseState, step, type Note, type NotifyState } from "@/lib/studio-notify";
import { speakChunk, speakingOrJustEnded, speechSettings } from "./voice/speak";

const KEY = "orbit.studioNotify";
const load = () => { try { return parseState(localStorage.getItem(KEY)); } catch { return parseState(null); } };
const save = (s: NotifyState) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: may re-announce after a restart */ } };

function show(n: Note) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  let note: Notification;
  try { note = new Notification(n.title, { body: n.body, tag: `orbit-studio-${n.cat}`, icon: "/brand/orbit-mark.png" }); } catch { return; } // Android Chrome: "Illegal constructor"
  const to: NavTarget = { panel: "studio", view: n.cat === "ready" ? "review" : "clips" }; // failures/live aren't in the review queue
  note.onclick = () => { window.focus(); note.close(); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: to })); };
}

export function StudioNotifier() {
  const [ask, setAsk] = useState(false);
  useEffect(() => { setAsk("Notification" in window && Notification.permission === "default"); }, []);

  useEffect(() => {
    let timer = 0, stopped = false, last = 0, busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true; last = Date.now();
      try {
        const state = load(); // fresh each time, so another tab's announcements count as seen
        const r = await fetch("/api/studio/clips");
        if (r.ok && !stopped) {
          const res = step(state, await r.json(), Date.now());
          save(res.state);
          res.notes.forEach(show);
          // Spoken heads-up only when ORBIT is in front, voice answers are on, and nobody's mid-conversation.
          if (res.notes.length && document.hasFocus() && speechSettings().speak && !speakingOrJustEnded(30_000)) res.notes.forEach((n) => speakChunk(n.spoken));
        }
      } catch { /* offline / server restarting: next poll */ }
      busy = false;
      schedule();
    };
    // Due time counts from the last poll, so returning to the tab after >60 s polls at once rather than restarting the wait.
    const schedule = () => { clearTimeout(timer); if (!stopped && !busy) timer = window.setTimeout(poll, Math.max(0, last + (document.visibilityState === "visible" ? 60_000 : 300_000) - Date.now())); };
    void poll();
    document.addEventListener("visibilitychange", schedule);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); };
  }, []);

  if (!ask) return null;
  return <button className="chip hidden sm:inline-flex" title="Desktop alerts when clips are ready, a job fails or a Short goes live"
    onClick={() => void Notification.requestPermission().finally(() => setAsk(Notification.permission === "default"))}>🔔 Enable notifications</button>;
}
