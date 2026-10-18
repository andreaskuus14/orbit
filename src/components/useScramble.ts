"use client";
import { useEffect, useState } from "react";
import { scramble } from "@/lib/cinematic-pure";

/** Decrypt-style reveal of `text` over `ms`, replayed whenever text or `replay` changes. Reduced motion: plain text. */
export function useScramble(text: string, ms = 520, replay = 0) {
  const [out, setOut] = useState(() => scramble(text, 0, 1));
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setOut(text); return; }
    let raf = 0, f = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = (now - t0) / ms;
      setOut(scramble(text, p, ++f)); // a new seed each frame: the unlocked glyphs flicker
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms, replay]);
  return out;
}
