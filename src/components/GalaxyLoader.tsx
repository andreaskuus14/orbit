"use client";
// Shown while the galaxy's 3D chunk downloads and its first frame compiles. No three.js import: it must render instantly.
// First load of a browser session (lusion.co-style): a 0 → 100 counter with the ORBIT glyph, driven by real milestones
// (page up → 3D chunk mounted → WebGL context → shaders compiled → first frames), then a masked reveal into the intro
// fly-in. Warm loads (same session) and reduced motion get the quiet orb instead.
import { useEffect, useRef, useState } from "react";
import { expDamp } from "@/lib/smooth-damp-pure";
import { useScramble } from "./useScramble";

const KEY = "orbit.preloaded";
const pre = { stage: 0, shown: 0, at: 0, cold: null as boolean | null, done: [] as (() => void)[] };

/** A readiness milestone (0..100, only ever rises). 100 = the galaxy has drawn. */
export function markPreload(v: number) {
  if (v <= pre.stage) return;
  pre.stage = v; pre.at = performance.now();
  if (v >= 100) try { sessionStorage.setItem(KEY, "1"); } catch { /* storage off */ }
}
const finish = () => { pre.shown = 100; pre.done.splice(0).forEach((f) => f()); };
/** True while the cold-load counter is still on screen (the intro flight waits for the reveal). */
export const preloading = () => !!pre.cold && pre.shown < 100;
/** Runs `f` once the counter has revealed the galaxy (at once on a warm load). 10 s cap: never blocks for good. */
export function afterPreload(f: () => void) {
  if (!coldLoad() || pre.shown >= 100) { f(); return () => {}; }
  pre.done.push(f);
  const t = setTimeout(finish, 10_000);
  return () => { clearTimeout(t); const i = pre.done.indexOf(f); if (i >= 0) pre.done.splice(i, 1); };
}
function coldLoad() {
  if (pre.cold === null) {
    try { pre.cold = sessionStorage.getItem(KEY) !== "1" && !matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { pre.cold = false; }
  }
  return pre.cold;
}

export function GalaxyLoader({ done = false }: { done?: boolean }) {
  const [cold, setCold] = useState<boolean | null>(null);
  useEffect(() => { setCold(coldLoad()); }, []);
  return cold === null ? <div className="galaxy-loader" aria-hidden /> : cold ? <Counter done={done} /> : <Quiet done={done} />;
}

function Quiet({ done }: { done: boolean }) {
  const [cycle, setCycle] = useState(0);
  useEffect(() => { if (done) markPreload(100); }, [done]);
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

function Counter({ done }: { done: boolean }) {
  const num = useRef<HTMLSpanElement>(null);
  const [out, setOut] = useState(pre.shown >= 100);
  useEffect(() => { markPreload(done ? 100 : 10); }, [done]);
  useEffect(() => {
    let raf = 0, last = 0, txt = "";
    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      // Between milestones the count creeps (slower and slower) toward the next one, so a long shader compile never reads as a hang.
      const creep = pre.stage >= 100 ? 0 : 14 * (1 - Math.exp(-(now - pre.at) / 2500));
      const goal = Math.min(pre.stage >= 100 ? 100 : 99, pre.stage + creep);
      pre.shown = Math.max(pre.shown, expDamp(pre.shown, goal, pre.stage >= 100 ? 0.12 : 0.3, dt));
      if (pre.stage >= 100 && pre.shown > 99.5) finish();
      const t = String(Math.floor(pre.shown)).padStart(3, "0");
      if (t !== txt && num.current) { txt = t; num.current.textContent = t; }
      if (pre.shown >= 100) { setOut(true); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={`galaxy-loader preloader${out ? " done" : ""}`} role="status" aria-live="polite" aria-hidden={out || undefined}>
      <span className="sr-only">{out ? "" : "Loading the galaxy…"}</span>
      <div className="preloader-row" aria-hidden="true">
        <span className="preloader-mask"><svg className="preloader-glyph" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" /><circle cx="12" cy="12" r="2.2" /><circle cx="20.2" cy="5.6" r="1.2" /></svg></span>
        <span className="preloader-mask"><span className="preloader-word">ORBIT</span></span>
        <span className="preloader-mask"><span ref={num} className="preloader-num">{String(Math.floor(pre.shown)).padStart(3, "0")}</span></span>
      </div>
    </div>
  );
}
