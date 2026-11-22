"use client";
// Streaming that feels smooth (feat/ui-motion): a pacer that spreads network bursts over a few frames (paceReveal), and a
// fade for the words that just arrived. The fade uses CSS Custom Highlights (::highlight(sf-0..2) in motion.css): ranges over
// React's own text nodes, so the DOM is never changed and the final answer can't jump. Code blocks don't fade (they are read
// as a whole). Without the Highlight API, or with reduced motion / motion off, text simply appears as before.
import { useEffect, useRef, type RefObject } from "react";
import { FADE_TIERS, fadeTier, paceReveal } from "@/lib/ui-motion-pure";
import { motionActive } from "./motion";

type HL = { new (...r: Range[]): unknown };
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const api = () => {
  const H = (globalThis as { Highlight?: HL }).Highlight;
  const reg = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  return H && reg ? { H, reg } : null;
};

/** Pacer: push() the full text so far; onShow gets a growing prefix each frame. flush() shows everything at once. */
export function createPacer(onShow: (text: string) => void, enabled = motionActive()) {
  let full = "", shown = 0, raf = 0, last = 0;
  const frame = (t: number) => {
    raf = 0;
    const dt = last ? t - last : 16;
    last = t;
    shown += paceReveal(full.length - shown, dt);
    onShow(full.slice(0, shown));
    if (shown < full.length) raf = requestAnimationFrame(frame); else last = 0;
  };
  return {
    push(text: string) {
      full = text;
      if (text.length < shown) shown = text.length; // a reset
      if (!enabled) { shown = text.length; if (!raf) raf = requestAnimationFrame(() => { raf = 0; onShow(full); }); return; }
      if (!raf) raf = requestAnimationFrame(frame);
    },
    flush() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; shown = full.length; },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}

/** Fade in the text added to `ref` since the last render while `active`. */
export function useStreamFade(ref: RefObject<HTMLElement | null>, text: string, active: boolean) {
  const seen = useRef(0);
  const segs = useRef<{ range: Range; t: number }[]>([]);
  const raf = useRef(0);
  useEffect(() => () => { cancelAnimationFrame(raf.current); const a = api(); if (a) for (let i = 0; i < FADE_TIERS; i++) a.reg.delete(`sf-${i}`); }, []);
  useEffect(() => {
    const el = ref.current, a = api();
    if (!el || !a || !active || !motionActive() || matchMedia("(prefers-reduced-motion: reduce)").matches) { seen.current = el?.textContent?.length ?? 0; return; }
    // Walk text nodes in order; everything after the previously seen length is new.
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    const t = performance.now();
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const len = n.nodeValue?.length ?? 0, start = Math.max(0, seen.current - pos);
      if (start < len && !n.parentElement?.closest("pre")) { const r = document.createRange(); r.setStart(n, start); r.setEnd(n, len); segs.current.push({ range: r, t }); }
      pos += len;
    }
    seen.current = pos;
    const paint = () => {
      const now = performance.now(), tiers: Range[][] = Array.from({ length: FADE_TIERS }, () => []);
      segs.current = segs.current.filter((s) => { const k = fadeTier(now - s.t); if (k === null) return false; tiers[k].push(s.range); return true; });
      tiers.forEach((r, i) => a.reg.set(`sf-${i}`, new a.H(...r)));
      raf.current = segs.current.length ? requestAnimationFrame(paint) : 0;
    };
    if (!raf.current) raf.current = requestAnimationFrame(paint);
  }, [text, active, ref]);
  useEffect(() => { if (!active) { seen.current = 0; segs.current = []; } }, [active]);
}
