// The alien script: one writing system for the CORE's rings and the UI. Every glyph is a broken circle (Arrival) with a
// seal dot floating in its gap, a radial tick out (Stargate chevron), and by its 12-bit code some of: an inward tick,
// an inner arc, inner dots (Forerunner). Angles live on a 16-step compass, so the whole script shares one rhythm.
// The same rules are written twice: strokes() for SVG/canvas, SCRIPT_GLSL as an SDF for shaders. Keep them in step.
// No DOM, no three.js: runs under node --test.

export const STEPS = 16;
const S = (Math.PI * 2) / STEPS;
export const TICK_OUT = 1.42, TICK_IN = 0.3, INNER_R = 0.58, DOT_IN = 0.36;

export type Stroke =
  | { k: "arc"; a0: number; a1: number; r: number } // ccw from step a0 to step a1, radius r
  | { k: "line"; x0: number; y0: number; x1: number; y1: number }
  | { k: "dot"; x: number; y: number };

const dir = (step: number, r = 1) => [Math.cos(step * S) * r, Math.sin(step * S) * r] as const;
const tick = (step: number, r0: number, r1: number): Stroke => { const [x0, y0] = dir(step, r0), [x1, y1] = dir(step, r1); return { k: "line", x0, y0, x1, y1 }; };

/** Code bits: 0-3 gap step, 4 wide gap, 5-7 outer tick, 8-9 inner tick, 10 inner arc, 11 inner dots.
 *  A glyph with no inner tick and no dots always gets the inner arc: an empty bowl would read as a Latin C or O. */
export function strokes(code: number): Stroke[] {
  const c = code & 4095, g = c & 15, gw = (c >> 4) & 1 ? 2 : 1, t1 = (c >> 5) & 7, t2 = (c >> 8) & 3;
  const out: Stroke[] = [{ k: "arc", a0: g + gw, a1: g + STEPS - gw, r: 1 }];
  const [sx, sy] = dir(g);
  out.push({ k: "dot", x: sx, y: sy });                                  // the seal: always in the gap
  out.push(tick(g + 5 + t1, 1, TICK_OUT));                               // outer tick, never in the gap
  if (t2) out.push(tick(g + 3 + ((t1 + t2 * 5) % 11), 1, TICK_IN));      // inner tick
  if ((c >> 10) & 1 || (!t2 && !((c >> 11) & 1))) { const m = g + 5 + 2 * (t1 & 3); out.push({ k: "arc", a0: m - 2.5, a1: m + 2.5, r: INNER_R }); }
  if ((c >> 11) & 1) { const [x, y] = dir(g + 8, DOT_IN); out.push({ k: "dot", x, y }); if (!t2) { const [u, v] = dir(g + 8, -DOT_IN * 0.2); out.push({ k: "dot", x: u, y: v }); } }
  return out;
}

/** One character → its glyph code. A bijection on 12 bits of the code point (odd multiply, xor-shift), so A..Z and
 *  0..9 never share a glyph; letters fold to upper case. Spaces return -1 (a gap in the line). */
export function codeOf(ch: string): number {
  if (/\s/.test(ch)) return -1;
  let h = ((ch.toUpperCase().codePointAt(0) ?? 0) * 1597 + 233) & 4095;
  h ^= h >> 6; h = (h * 2765 + 1371) & 4095; h ^= h >> 5;
  return h;
}

/** A string, read as the alien script: one glyph code per character (-1 for spaces). Stable for the same string. */
export const encode = (text: string): number[] => Array.from(text, codeOf);

/** An id or serial as n glyphs (no spaces), stable per id: for decorative serials that don't spell a word. */
export function idGlyphs(id: string, n: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; out.push((h >>> 7) & 4095); }
  return out;
}

const f = (x: number) => (Math.round(x * 100) / 100).toString();

/** SVG path data for one glyph centred at (cx, cy), circle radius r. Stroke it (round caps): dots are zero-length lines. */
export function glyphPath(code: number, cx = 0, cy = 0, r = 1): string {
  if (code < 0) return "";
  let d = "";
  for (const s of strokes(code)) {
    if (s.k === "arc") {
      const R = s.r * r, [x0, y0] = dir(s.a0, R), [x1, y1] = dir(s.a1, R), large = s.a1 - s.a0 > STEPS / 2 ? 1 : 0;
      d += `M${f(cx + x0)} ${f(cy - y0)}A${f(R)} ${f(R)} 0 ${large} 0 ${f(cx + x1)} ${f(cy - y1)}`; // y up in glyph space, down in SVG: ccw becomes sweep 0
    } else if (s.k === "line") d += `M${f(cx + s.x0 * r)} ${f(cy - s.y0 * r)}L${f(cx + s.x1 * r)} ${f(cy - s.y1 * r)}`;
    else d += `M${f(cx + s.x * r)} ${f(cy - s.y * r)}h0`;
  }
  return d;
}

/** A line of script: glyph pitch 3.2 r (outer ticks reach 1.42 r), spaces a half pitch. Returns path data and size. */
export function linePath(codes: number[], r = 1): { d: string; w: number; h: number } {
  const pitch = r * 3.2, pad = r * TICK_OUT;
  let x = pad, d = "";
  for (const c of codes) {
    if (c < 0) { x += pitch * 0.5; continue; }
    d += glyphPath(c, x, pad, r); x += pitch;
  }
  return { d, w: Math.max(0, x - pitch + pad * 2), h: pad * 2 };
}

/** A whole <svg> as markup, for places that write innerHTML instead of rendering React (the cursor ring). */
export function scriptSvg(text: string, r = 3, stroke = 0.9): string {
  const { d, w, h } = linePath(encode(text), r);
  return `<svg aria-hidden="true" width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"><path d="${d}"/></svg>`;
}

/** The same glyphs as a signed distance in GLSL (ES 3.0: int bit ops). p in glyph units (circle radius 1, y up). */
export const SCRIPT_GLSL = /* glsl */ `
vec2 asDir(float s) { float a = s * ${(S).toFixed(8)}; return vec2(cos(a), sin(a)); }
float asSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float glyphSdf(vec2 p, int c) {
  int gi = c & 15, t1 = (c >> 5) & 7, t2 = (c >> 8) & 3;
  float g = float(gi), gw = ((c >> 4) & 1) == 1 ? 2.0 : 1.0, L = length(p);
  vec2 dg = asDir(g);
  float inGap = step(cos(gw * ${(S).toFixed(8)}), dot(p, dg) / max(L, 1e-4));
  float d = mix(abs(L - 1.0), min(length(p - asDir(g + gw)), length(p - asDir(g - gw))), inGap);
  d = min(d, length(p - dg));
  vec2 o = asDir(g + 5.0 + float(t1));
  d = min(d, asSeg(p, o, o * ${TICK_OUT.toFixed(2)}));
  if (t2 > 0) { vec2 i = asDir(g + 3.0 + float((t1 + t2 * 5) % 11)); d = min(d, asSeg(p, i, i * ${TICK_IN.toFixed(2)})); }
  if (((c >> 10) & 1) == 1 || (t2 == 0 && ((c >> 11) & 1) == 0)) {
    float m = g + 5.0 + 2.0 * float(t1 & 3);
    float inA = step(${Math.cos(2.5 * S).toFixed(8)}, dot(p, asDir(m)) / max(L, 1e-4));
    d = min(d, mix(min(length(p - asDir(m - 2.5) * ${INNER_R}), length(p - asDir(m + 2.5) * ${INNER_R})), abs(L - ${INNER_R}), inA));
  }
  if (((c >> 11) & 1) == 1) {
    vec2 q = asDir(g + 8.0);
    d = min(d, length(p - q * ${DOT_IN.toFixed(2)}));
    if (t2 == 0) d = min(d, length(p + q * ${(DOT_IN * 0.2).toFixed(3)}));
  }
  return d;
}`;
