"use client";
// "ORBIT speaks first" (roadmap 8, 2.2): on his first input after ≥ 20 min away, one short line about the most important thing,
// shown through Herald (bell + pop-up) and spoken when the voice speak setting is on. Rules and caps: lib/speak-first-pure.ts.
import { useEffect, useRef, useState } from "react";
import { notify } from "@/lib/notify-pure";
import { HERALD_KEY, parseHerald } from "@/lib/herald-pure";
import { FOCUS_TIMER_KEY, restoreFocusTimer } from "@/lib/focus-timer-pure";
import { incidentTitle } from "@/lib/system-health-pure";
import { localParts } from "@/lib/call-pure";
import { SPEAK_FIRST, SPEAK_FIRST_KEY, decideMoment, parseSpeakFirst, trackApprovals, type SpeakFirstState } from "@/lib/speak-first-pure";
import { CALL_ACTIVE, voiceLevel } from "./voice/bus";
import { speechSettings, speakingOrJustEnded } from "./voice/speak";
import { announce } from "./audio-policy";
import { useT } from "./i18n";

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const load = () => parseSpeakFirst(read(SPEAK_FIRST_KEY));
const save = (s: SpeakFirstState) => { try { localStorage.setItem(SPEAK_FIRST_KEY, JSON.stringify(s)); } catch { /* storage off: caps reset on reload */ } };
type Data = { stopAll: boolean; focus: boolean; inCall: boolean; incidents: { key: string; title: string }[]; approvals: { id: string; title: string }[];
  loopsToday: { key: string; title: string }[]; events: { title: string; start: string; allDay: boolean }[] };
const getData = () => fetch("/api/speak-first", { cache: "no-store" }).then((r) => (r.ok ? r.json() as Promise<Data> : null)).catch(() => null);

export function SpeakFirst() {
  const { lang } = useT();
  const langRef = useRef(lang);
  langRef.current = lang;
  useEffect(() => {
    let last = Date.now(), busy = false, callOn = false;
    const onCall = (e: Event) => { callOn = !!(e as CustomEvent<{ on?: boolean }>).detail?.on; };
    // Approvals have no timestamp: note them at load so "waiting > 2 h" can count from here.
    void getData().then((d) => { if (d) { const st = load(); save({ ...st, seen: trackApprovals(st.seen, d.approvals, Date.now()).seen }); } });
    const check = async (prev: number) => {
      if (!load().on) return; // off: not even a fetch
      const d = await getData();
      if (!d) return;
      const now = Date.now(), st = load(), herald = parseHerald(read(HERALD_KEY), now);
      const { seen, approvals } = trackApprovals(st.seen, d.approvals, now);
      const timer = restoreFocusTimer(read(FOCUS_TIMER_KEY), now).timer;
      let morning: string | null = null;
      try { morning = JSON.parse(read("orbit.morning") || "{}")?.day ?? null; } catch { /* unseen */ } // MorningCard's last shown day
      const r = decideMoment({ ...st, seen }, {
        now, lastInputAt: prev, visible: document.visibilityState === "visible",
        stopAll: d.stopAll, muted: herald.mute || herald.snooze > now, inCall: callOn || d.inCall,
        conversation: voiceLevel.conversation || voiceLevel.listening, focus: d.focus || (timer.phase === "focus" && timer.endAt > now),
        speak: speechSettings().speak,
        incidents: d.incidents.map((i) => ({ key: i.key, title: incidentTitle(i, langRef.current) })),
        events: d.events, approvals, loopsToday: d.loopsToday, briefUnseen: morning !== localParts(now).day,
      }, langRef.current);
      save(r.state);
      if (!r.moment) return;
      notify({ key: `speak-first:${r.moment.key}`, kind: "core", signal: "reminder", title: r.moment.line });
      if (r.moment.voice && !speakingOrJustEnded(2000)) announce(r.moment.line); // waits while THEATER plays
    };
    const onInput = () => {
      const now = Date.now(), prev = last;
      last = now;
      if (busy || now - prev < SPEAK_FIRST.awayMs) return;
      busy = true;
      void check(prev).finally(() => { busy = false; });
    };
    const opts = { capture: true, passive: true };
    const kinds = ["pointerdown", "pointermove", "keydown", "wheel"] as const;
    for (const k of kinds) addEventListener(k, onInput, opts);
    addEventListener(CALL_ACTIVE, onCall);
    return () => { for (const k of kinds) removeEventListener(k, onInput, opts); removeEventListener(CALL_ACTIVE, onCall); };
  }, []);
  return null;
}

/** Settings → Voice: "ORBIT speaks first" (default on). */
export function SpeakFirstToggle() {
  const { t } = useT();
  const [on, setOn] = useState(true);
  useEffect(() => setOn(load().on), []);
  return (
    <label className="voice-row" title={t("sf.hint")}>
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); save({ ...load(), on: e.target.checked }); }} /> {t("sf.toggle")}
    </label>
  );
}
