"use client";
import { useEffect, useRef, useState } from "react";
import { tickAt } from "@/lib/tick-pure";

/** Counts the shown number toward `value` over `dur` ms; jumps straight there with reduced motion. */
export function useTick(value: number, dur = 700) {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    const from = cur.current;
    if (from === value || matchMedia("(prefers-reduced-motion: reduce)").matches) { cur.current = value; setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => { const v = tickAt(from, value, now - t0, dur); cur.current = v; setShown(v); if (v !== value) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return shown;
}
