"use client";
// Masked text reveal: each word rises into view through its own clip, staggered. CSS only (.mask-word in globals.css);
// remount it (key) to replay. Screen readers get the plain text once.
// `decode`: inside the rising line the letters also decode: they cycle alien → mono glyphs and lock in left to right
// with a seeded stagger, each with a short flash. The glyph is drawn over its (transparent) real letter, so the line
// never changes width. Reduced motion: the final text at once.
import { useLayoutEffect, useRef } from "react";
import { glyphFor, isDecodable, lockTimes, textSeed } from "@/lib/decode-pure";

type Decode = { ms?: number; delay?: number };

export function MaskText({ text, decode }: { text: string; decode?: boolean | Decode }) {
  const words = text.split(/\s+/).filter(Boolean);
  const d = decode ? (decode === true ? {} : decode) : null, ms = d?.ms ?? 750, delay = d?.delay ?? 0;
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { // layout effect: glyphs are in place before the first paint, no flash of the final word
    const root = ref.current;
    if (!d || !root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".dc")), seed = textSeed(text), locks = lockTimes(els.length, ms, seed);
    const open = els.map((el) => isDecodable(el.textContent ?? ""));
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - t0 - delay;
      let left = 0;
      for (let i = 0; i < els.length; i++) {
        if (!open[i]) continue;
        const el = els[i];
        if (t >= locks[i]) { open[i] = false; el.removeAttribute("data-g"); el.classList.add("lk"); continue; }
        left++;
        const g = glyphFor(seed, i, Math.floor((now - t0 + i * 23) / 55), locks[i] - t); // ~18 glyphs/s, out of step per letter
        if (el.dataset.g !== g) el.dataset.g = g;
      }
      if (left) raf = requestAnimationFrame(tick);
    };
    tick(t0);
    return () => { cancelAnimationFrame(raf); for (const el of els) { el.removeAttribute("data-g"); el.classList.remove("lk"); } };
  }, [text, !!d, ms, delay]);
  let k = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden ref={ref}>
        {words.map((w, i) => (
          <span key={i}>{i > 0 && " "}<span className="mask-word"><span style={{ ["--i" as string]: i, ["--d" as string]: `${delay}ms` }}>
            {d ? Array.from(w, (c) => <span key={k++} className="dc">{c}</span>) : w}
          </span></span></span>
        ))}
      </span>
    </>
  );
}
