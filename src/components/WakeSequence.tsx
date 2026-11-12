"use client";
// CORE ignition clip when ORBIT opens (public/ui/wake). Once per session, muted, click/Esc skips, never under reduced motion.
import { useEffect, useState } from "react";

const KEY = "orbit.woke";

export function WakeSequence({ skip = false }: { skip?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem(KEY)) return; sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked: still play once for this mount */ }
    if (skip || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setOn(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- decided once, at session start
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOn(false); };
    const cap = setTimeout(() => setOn(false), 4000); // clip is 2.7 s: never let a stalled load hold the screen
    addEventListener("keydown", key);
    return () => { removeEventListener("keydown", key); clearTimeout(cap); };
  }, [on]);
  if (!on) return null;
  const done = () => setOn(false);
  return (
    <div className="wake-sequence" onClick={done} aria-hidden="true">
      <video autoPlay muted playsInline preload="auto" onEnded={done} onError={done}>
        <source src="/ui/wake/core.webm" type="video/webm" />
        <source src="/ui/wake/core.mp4" type="video/mp4" onError={done} />{/* source errors do not bubble to <video> */}
      </video>
    </div>
  );
}
