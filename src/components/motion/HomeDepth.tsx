"use client";
// Home depth (feat/ui-motion): one soft key light, a vignette and a few pixels of pointer parallax on the light, the home card and
// the input. Calm: the parallax eases with a gentle spring and stops when the pointer stops (no loop while idle). Decorative,
// so it never takes pointer events; reduced motion keeps the light and drops the movement (motion.css).
import { useEffect, type RefObject } from "react";
import { springStep, SPRING } from "@/lib/ui-motion-pure";

export function HomeDepth({ shell, dim = false }: { shell: RefObject<HTMLElement | null>; dim?: boolean }) {
  useEffect(() => {
    const el = shell.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0, raf = 0, last = 0;
    const frame = (t: number) => {
      const dt = last ? (t - last) / 1000 : 1 / 60;
      last = t;
      [x, vx] = springStep(x, vx, tx, dt, SPRING.gentle);
      [y, vy] = springStep(y, vy, ty, dt, SPRING.gentle);
      el.style.setProperty("--px", x.toFixed(4));
      el.style.setProperty("--py", y.toFixed(4));
      raf = Math.abs(x - tx) + Math.abs(y - ty) + Math.abs(vx) + Math.abs(vy) > 1e-3 ? requestAnimationFrame(frame) : (last = 0, 0);
    };
    const move = (e: PointerEvent) => {
      tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    addEventListener("pointermove", move, { passive: true });
    return () => { removeEventListener("pointermove", move); cancelAnimationFrame(raf); el.style.removeProperty("--px"); el.style.removeProperty("--py"); };
  }, [shell]);
  return <div className="home-depth" data-dim={dim || undefined} aria-hidden="true"><i className="hd-light" /><i className="hd-vignette" /></div>;
}
