"use client";
// Ambient states over the galaxy (plan #7; targets from ambient-pure.ts): focus dims the edges, alert pulses a red vignette,
// night warms everything. A CSS overlay with 1.2 s transitions: no extra render pass, nothing for the GPU to compile.
import { useEffect, useState } from "react";
import { ambient } from "@/lib/ambient-pure";

export function useAmbient(automationFailing: boolean, pulseFailed: boolean) {
  const [focusRunning, setFocus] = useState(false), [stopAll, setStop] = useState(false), [hour, setHour] = useState(12);
  useEffect(() => {
    const onFocus = (e: Event) => setFocus(!!(e as CustomEvent<{ on: boolean }>).detail?.on);
    const onStop = (e: Event) => setStop(!!(e as CustomEvent<{ on: boolean }>).detail?.on);
    const tick = () => setHour(new Date().getHours());
    tick();
    const t = setInterval(tick, 60_000);
    addEventListener("orbit:focus", onFocus); addEventListener("orbit:stop-all", onStop);
    return () => { clearInterval(t); removeEventListener("orbit:focus", onFocus); removeEventListener("orbit:stop-all", onStop); };
  }, []);
  return ambient({ focusRunning, automationFailing, pulseFailed, stopAll, hour }, Date.now());
}

export function AmbientOverlay({ a }: { a: ReturnType<typeof ambient> }) {
  return (
    <div aria-hidden className={`ambient ambient-${a.mode}`}
      style={{ ["--amb-tint" as string]: a.tint, ["--amb-vig" as string]: String(a.vignette), ["--amb-dim" as string]: String(a.dim) }} />
  );
}
