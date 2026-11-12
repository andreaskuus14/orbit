"use client";
// Mouse parallax starfield behind the 2D home. Two CSS star layers moved with transform only; still under reduced motion.
import { useEffect, useRef } from "react";

export function Starfield() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (!el) return;
    let frame = 0, x = 0, y = 0;
    const paint = () => { frame = 0; el.style.setProperty("--px", x.toFixed(3)); el.style.setProperty("--py", y.toFixed(3)); };
    const move = (e: PointerEvent) => {
      if (motion.matches) return;
      x = e.clientX / innerWidth - 0.5; y = e.clientY / innerHeight - 0.5;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const still = () => { if (motion.matches) { x = 0; y = 0; paint(); } };
    addEventListener("pointermove", move, { passive: true });
    motion.addEventListener("change", still);
    return () => { removeEventListener("pointermove", move); motion.removeEventListener("change", still); cancelAnimationFrame(frame); };
  }, []);
  return <div ref={ref} className="starfield" aria-hidden="true"><i className="starfield-far" /><i className="starfield-near" /></div>;
}
