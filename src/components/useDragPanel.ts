"use client";
// daedalOS-style floating panels: drag by the header (mouse/pen only), the panel glides after the pointer with the house
// damp and settles without overshoot; the spot is saved per panel; double-click the header to send it home.
// Uses the CSS `translate` property, so the panels' own transform animations (open/close) keep working underneath.
// Touch and coarse pointers never drag and never get a saved offset: phone layouts stay as designed.
import { useCallback, useEffect, useRef } from "react";
import { expDamp } from "@/lib/smooth-damp-pure";
import { clampDrag } from "@/lib/motion-pure";

const SKIP = "button, a, input, select, textarea, [contenteditable], [role=button]";
const keyOf = (id: string) => `orbit.panel.${id}`;

/** id = storage key for this panel (null: not draggable right now). Spread `handle` on the header. */
export function useDragPanel<T extends HTMLElement>(id: string | null) {
  const ref = useRef<T>(null);
  const st = useRef({ x: 0, y: 0, tx: 0, ty: 0, raf: 0, last: 0, still: false, drag: null as null | { sx: number; sy: number; ox: number; oy: number },
    box: { left: 0, top: 0, width: 0, height: 0 }, out: { x: 0, y: 0 } });

  const paint = useCallback(() => {
    const el = ref.current, s = st.current;
    if (el) el.style.translate = Math.abs(s.x) < 0.01 && Math.abs(s.y) < 0.01 ? "" : `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`;
  }, []);
  const frame = useCallback((now: number) => {
    const s = st.current, dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 1 / 60, tau = s.drag ? 0.05 : 0.14;
    s.last = now;
    s.x = s.still ? s.tx : expDamp(s.x, s.tx, tau, dt); s.y = s.still ? s.ty : expDamp(s.y, s.ty, tau, dt);
    if (Math.abs(s.x - s.tx) < 0.05 && Math.abs(s.y - s.ty) < 0.05) { s.x = s.tx; s.y = s.ty; }
    paint();
    s.raf = s.x === s.tx && s.y === s.ty && !s.drag ? 0 : requestAnimationFrame(frame);
    if (!s.raf) s.last = 0;
  }, [paint]);
  const kick = useCallback(() => { const s = st.current; if (!s.raf) s.raf = requestAnimationFrame(frame); }, [frame]);
  const measure = useCallback(() => { // the panel's natural box: its rect minus the current offset
    const el = ref.current, s = st.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    s.box.left = r.left - s.x; s.box.top = r.top - s.y; s.box.width = r.width; s.box.height = r.height;
    return true;
  }, []);
  const clampTo = useCallback((x: number, y: number) => {
    const s = st.current;
    clampDrag(x, y, s.box, innerWidth, innerHeight, 64, s.out);
    s.tx = s.out.x; s.ty = s.out.y;
  }, []);

  useEffect(() => { // (re)load the saved spot when the panel changes; snap there, no glide on open
    const s = st.current;
    s.still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    s.x = s.y = s.tx = s.ty = 0; s.drag = null;
    paint();
    if (!id || !matchMedia("(pointer: fine)").matches) return;
    try {
      const v = JSON.parse(localStorage.getItem(keyOf(id)) ?? "null") as { x?: unknown; y?: unknown } | null;
      if (v && typeof v.x === "number" && typeof v.y === "number" && measure()) { clampTo(v.x, v.y); s.x = s.tx; s.y = s.ty; paint(); }
    } catch { /* storage off or bad value: start home */ }
    const resize = () => { if (measure()) { clampTo(s.tx, s.ty); kick(); } };
    addEventListener("resize", resize);
    return () => { removeEventListener("resize", resize); cancelAnimationFrame(s.raf); s.raf = 0; };
  }, [id, paint, measure, clampTo, kick]);

  const save = () => {
    const s = st.current;
    try { if (id) { if (s.tx || s.ty) localStorage.setItem(keyOf(id), JSON.stringify({ x: Math.round(s.tx), y: Math.round(s.ty) })); else localStorage.removeItem(keyOf(id)); } } catch { /* storage off */ }
  };
  const handle = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!id || e.pointerType === "touch" || e.button !== 0 || (e.target as Element).closest(SKIP) || !measure()) return;
      const s = st.current;
      s.drag = { sx: e.clientX, sy: e.clientY, ox: s.tx, oy: s.ty };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault(); // no text selection while dragging
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = st.current.drag;
      if (!d) return;
      clampTo(d.ox + e.clientX - d.sx, d.oy + e.clientY - d.sy);
      kick();
    },
    onPointerUp: () => { const s = st.current; if (!s.drag) return; s.drag = null; save(); kick(); },
    onPointerCancel: () => { const s = st.current; if (!s.drag) return; s.drag = null; save(); kick(); },
    onDoubleClick: (e: React.MouseEvent<HTMLElement>) => {
      if (!id || (e.target as Element).closest(SKIP)) return;
      const s = st.current; s.tx = 0; s.ty = 0; save(); kick();
    },
  };
  return { ref, handle };
}
