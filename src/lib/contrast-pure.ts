// WCAG 2.x contrast for CSS colour tokens: parse #rgb/#rrggbb/rgb()/rgba(), alpha-composite layers, relative luminance, ratio.
export type RGBA = [number, number, number, number];

export function parseColor(s: string): RGBA {
  const v = s.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (fn) return [+fn[1], +fn[2], +fn[3], fn[4] === undefined ? 1 : +fn[4]];
  throw new Error(`unsupported colour: ${s}`);
}

/** Paint `top` (may be translucent) over an opaque `under`. */
export function over(top: RGBA, under: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]: RGBA) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** Contrast ratio of text `fg` on an opaque `bg` (a translucent fg is composited onto bg first). */
export function contrast(fg: RGBA, bg: RGBA): number {
  const f = luminance(fg[3] < 1 ? over(fg, bg) : fg), b = luminance(bg);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}
