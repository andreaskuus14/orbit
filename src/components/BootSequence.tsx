"use client";
// First 3D load of a session: HUD brackets draw in, "ORBITAL // CORE ONLINE" decrypts, then it all fades and hands over to the galaxy.
// Once per browser session; skipped with reduced motion. Pure CSS + useScramble: nothing here waits on three.js.
import { useEffect, useState } from "react";
import { useScramble } from "./useScramble";

const KEY = "orbit.booted", MS = 2600;

export function BootSequence({ reduced }: { reduced: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let seen = true;
    try { seen = sessionStorage.getItem(KEY) === "1"; sessionStorage.setItem(KEY, "1"); } catch { /* storage off: play it */ seen = false; }
    if (seen || reduced) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), MS);
    return () => clearTimeout(t);
  }, [reduced]);
  const title = useScramble("ORBITAL // CORE ONLINE", 1100, on ? 1 : 0);
  const sub = useScramble(new Date().getHours() < 12 ? "GOOD MORNING" : new Date().getHours() < 18 ? "GOOD AFTERNOON" : "GOOD EVENING", 900, on ? 1 : 0);
  if (!on) return null;
  return (
    <div className="boot" aria-hidden="true">
      <svg className="boot-frame" viewBox="0 0 100 100" preserveAspectRatio="none">
        {["M2,14 V2 H14", "M86,2 H98 V14", "M98,86 V98 H86", "M14,98 H2 V86"].map((d) => <path key={d} d={d} pathLength={1} />)}
      </svg>
      <div className="boot-text"><span className="boot-title">{title}</span><span className="boot-sub">{sub}</span></div>
    </div>
  );
}
