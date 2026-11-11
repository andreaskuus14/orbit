"use client";
// Slow nebula loop behind the 2D home (public/ui/ambient). Muted, decorative; reduced motion gets the still poster only.
import { useEffect, useState } from "react";

export function AmbientLoop() {
  const [still, setStill] = useState(true);
  useEffect(() => { setStill(matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  if (still) return <img className="ambient-loop" src="/ui/ambient/nebula.webp" alt="" aria-hidden="true" decoding="async" />;
  return (
    <video className="ambient-loop" autoPlay muted loop playsInline preload="none" poster="/ui/ambient/nebula.webp" aria-hidden="true">
      <source src="/ui/ambient/nebula.webm" type="video/webm" />
      <source src="/ui/ambient/nebula.mp4" type="video/mp4" />
    </video>
  );
}
