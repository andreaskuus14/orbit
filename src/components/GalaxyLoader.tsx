"use client";
// Shown while the galaxy's 3D chunk downloads and its first frame compiles. No three.js import: it must render instantly.
import { useEffect, useState } from "react";
import { useScramble } from "./useScramble";

export function GalaxyLoader({ done = false }: { done?: boolean }) {
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setCycle((c) => c + 1), 2400); // re-decrypt while we wait
    return () => clearInterval(t);
  }, [done]);
  const text = useScramble("ALIGNING THE STARS", 900, cycle);
  return (
    <div className={`galaxy-loader${done ? " done" : ""}`} role="status" aria-live="polite" aria-hidden={done || undefined}>
      <div className="galaxy-loader-orb" aria-hidden="true"><i /><i /><i /></div>
      <span className="sr-only">{done ? "" : "Aligning the stars…"}</span>
      <span className="galaxy-loader-code" aria-hidden="true">{done ? "" : text}</span>
    </div>
  );
}
