"use client";
// CORE ignition clip when ORBIT opens (public/ui/wake). Once per session, muted, click/Esc skips, never under reduced motion.
import { useEffect, useState } from "react";

const KEY = "orbit.woke";

export function WakeSequence() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try { if (sessionStorage.getItem(KEY)) return; sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked: still play once for this mount */ }
    setOn(true);
  }, []);
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOn(false); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [on]);
  if (!on) return null;
  const done = () => setOn(false);
  return (
    <div className="wake-sequence" onClick={done} aria-hidden="true">
      <video autoPlay muted playsInline preload="auto" onEnded={done} onError={done}>
        <source src="/ui/wake/core.webm" type="video/webm" />
        <source src="/ui/wake/core.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
