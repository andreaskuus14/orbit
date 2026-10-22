// Hologram helpers (StudioWorld / AgentsStation 3D labels): compact numbers and the glyph-scramble step.
// No three.js / DOM, so it runs under node --test.
import { scramble } from "./cinematic-pure.ts";

const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 12400 → "12.4K"; NaN/Infinity → "0". */
export function compactNumber(x: number): string {
  return fmt.format(Number.isFinite(x) ? x : 0);
}

/** Text shown `elapsedMs` into a change: random glyphs that settle into `text` by `ms`. Reduced or done → plain text. */
export function scrambleStep(text: string, elapsedMs: number, ms = 400, seed = 1, reduced = false): string {
  if (reduced || !(ms > 0) || !(elapsedMs < ms)) return text;
  return scramble(text, Math.max(0, elapsedMs) / ms, seed);
}

/** One line for a 3D label: whitespace collapsed, clipped with an ellipsis. */
export function holoLine(s: string, max = 40): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
