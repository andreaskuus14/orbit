"use client";
// Decorative cursor ring (unseen.co-style): a hairline circle that trails the pointer with the house glide, grows and is
// pulled toward hovered buttons and planets, and names the planet in tiny mono. The native cursor stays visible.
// Mouse/pen only (pointer: fine), never under reduced motion. The loop sleeps once the ring has settled.
import { useEffect, useRef, useState } from "react";
import { expDamp } from "@/lib/smooth-damp-pure";
import { magnet } from "@/lib/motion-pure";
import { cursorTarget } from "./cursor-bus";

const HOT = "button:not(:disabled), a[href], [role=button], [role=tab], summary, select, label[for], input[type=checkbox], input[type=radio]";
const TAU = 0.12, REST = 22;

export function CursorRing() {
  const [on, setOn] = useState(false);
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const fine = matchMedia("(pointer: fine)"), still = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setOn(fine.matches && !still.matches);
    update();
    fine.addEventListener("change", update); still.addEventListener("change", update);
    return () => { fine.removeEventListener("change", update); still.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    const el = ring.current, lab = label.current;
    if (!on || !el || !lab) return;
    const s = { px: 0, py: 0, x: 0, y: 0, size: REST, a: 0, inside: false, primed: false, hot: null as Element | null, raf: 0, last: 0, text: "", w: -1 };
    const pull = { x: 0, y: 0 };
    const frame = (now: number) => {
      const dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 1 / 60;
      s.last = now;
      let tx = s.px, ty = s.py, size = REST, text = "";
      const planet = now - cursorTarget.at < 120; // the galaxy writes it every frame while a planet is hovered
      if (planet) {
        magnet(s.px, s.py, cursorTarget.x, cursorTarget.y, 0.35, 28, pull);
        tx = pull.x; ty = pull.y; text = cursorTarget.label;
        size = Math.min(96, Math.max(36, cursorTarget.r * 2 + 16));
      } else if (s.hot?.isConnected) {
        const r = s.hot.getBoundingClientRect();
        magnet(s.px, s.py, r.left + r.width / 2, r.top + r.height / 2, 0.22, 10, pull);
        tx = pull.x; ty = pull.y;
        size = Math.min(64, Math.max(34, Math.min(r.width, r.height) + 12));
      }
      s.x = expDamp(s.x, tx, TAU, dt); s.y = expDamp(s.y, ty, TAU, dt);
      s.size = expDamp(s.size, size, 0.15, dt);
      s.a = expDamp(s.a, s.inside ? 1 : 0, 0.15, dt);
      if (Math.abs(s.size - s.w) > 0.05) { s.w = s.size; el.style.width = el.style.height = `${s.size.toFixed(2)}px`; }
      el.style.transform = `translate3d(${(s.x - s.size / 2).toFixed(2)}px, ${(s.y - s.size / 2).toFixed(2)}px, 0)`;
      el.style.opacity = s.a.toFixed(3);
      if (text !== s.text) { s.text = text; lab.textContent = text; }
      const settled = !planet && Math.abs(s.x - tx) < 0.05 && Math.abs(s.y - ty) < 0.05 && Math.abs(s.size - size) < 0.05 && Math.abs(s.a - (s.inside ? 1 : 0)) < 0.002;
      s.raf = settled ? 0 : requestAnimationFrame(frame);
      if (settled) s.last = 0;
    };
    const kick = () => { if (!s.raf) s.raf = requestAnimationFrame(frame); };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      s.px = e.clientX; s.py = e.clientY; s.inside = true;
      if (!s.primed) { s.primed = true; s.x = s.px; s.y = s.py; } // first sight: appear under the pointer, don't fly in from 0,0
      s.hot = e.target instanceof Element ? e.target.closest(HOT) : null;
      kick();
    };
    const leave = (e: PointerEvent) => { if (!e.relatedTarget) { s.inside = false; kick(); } };
    addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", leave);
    return () => {
      removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", leave);
      cancelAnimationFrame(s.raf);
    };
  }, [on]);

  if (!on) return null;
  return <div ref={ring} className="cursor-ring" aria-hidden><span ref={label} className="cursor-ring-label" /></div>;
}
