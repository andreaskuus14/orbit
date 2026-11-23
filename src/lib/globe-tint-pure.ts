// The INTELLIGENCE globe's news tint, done in the shader instead of repainting the 4096×2048 map.
// Repainting on every time-window switch, search or Clear cost a 30+ ms paint, a synchronous canvas snapshot
// (createImageBitmap reads the whole canvas back) and a 32 MB texture upload with mipmaps: the >50 ms frames.
// Now the map is painted once; a country-id texture (one byte per pixel) and a 256-entry colour table say what to tint.

/** The pick map's check byte: a blend of two ids at a shared border almost never also blends into the right check value. */
export const checkByte = (n: number) => (n * 167 + 89) & 255;

/** One byte per pixel from the RGBA pick map (w pixels wide): country index + 1, or 0 for sea.
 *  Land pixels at least half covered keep their country (a coast pixel's colour is one id over transparent); pixels
 *  where two countries blend (a wrong check byte) take a neighbour's id, so the tint runs on under shared borders
 *  like the painted wash did under the border line. */
export function idBytes(pick: ArrayLike<number>, countries: number, w: number): Uint8Array {
  const n = pick.length >> 2, out = new Uint8Array(n), mixed: number[] = [];
  for (let p = 0, i = 0; i < n; i++, p += 4) {
    if (pick[p + 3] < 128) continue;
    const id = pick[p] + (pick[p + 1] << 8);
    if (id >= 1 && id <= countries && id <= 255 && pick[p + 2] === checkByte(id)) out[i] = id; else mixed.push(i);
  }
  for (let pass = 0; pass < 3 && mixed.length; pass++) { // borders are 1-2 px wide: a few passes fill them
    const fill: [number, number][] = [];
    for (const i of mixed) {
      const x = i % w, id = (x > 0 && out[i - 1]) || (x < w - 1 && out[i + 1]) || out[i - w] || out[i + w] || 0;
      if (id) fill.push([i, id]);
    }
    for (const [i, id] of fill) out[i] = id;
    mixed.splice(0, mixed.length, ...mixed.filter((i) => !out[i]));
  }
  return out;
}

const hex = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Colour table for the shader, RGBA bytes × 256: entry id (country index + 1) holds the tint colour (sRGB, as painted)
 *  and its opacity, 0.22 + 0.13·√(stories / most stories), the same wash the canvas painted; untinted entries are 0. */
export function tintTable(stories: Map<string, number>, indexOf: (name: string) => number | undefined, colorOf: (name: string) => string, out: Uint8Array = new Uint8Array(1024)) {
  out.fill(0);
  const max = Math.max(1, ...stories.values());
  for (const [name, n] of stories) {
    const i = indexOf(name);
    if (i === undefined || i < 0 || i > 254 || !(n > 0)) continue;
    const [r, g, b] = hex(colorOf(name)), o = (i + 1) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
    out[o + 3] = Math.round((0.22 + 0.13 * Math.sqrt(Math.min(n, max) / max)) * 255);
  }
  return out;
}
