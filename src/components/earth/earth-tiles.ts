// Shared by the Earth view (earth-scene.ts) and the Classic map (NewsGlobe): world tile mosaics and the cloud GLSL.
import { tilesFor, type Box, type TileKind } from "@/lib/earth-pure";

export function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; });
}

/** Stitches the tiles covering `box` at zoom z into one canvas (Web Mercator, as served). */
export async function mosaic(o: { tileUrl: (k: TileKind, z: number, x: number, y: number) => string }, kind: TileKind, box: Box, z: number) {
  const t = tilesFor(box, z), S = 256;
  const c = document.createElement("canvas"); c.width = t.nx * S; c.height = t.ny * S;
  const g = c.getContext("2d", { willReadFrequently: kind === "elev" })!;
  if (kind === "night") { g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); }
  await Promise.all(Array.from({ length: t.nx * t.ny }, async (_, i) => {
    const x = t.x0 + (i % t.nx), y = t.y0 + Math.floor(i / t.nx), n = 2 ** z;
    const img = await loadImg(o.tileUrl(kind, z, ((x % n) + n) % n, y));
    if (img) g.drawImage(img, (i % t.nx) * S, Math.floor(i / t.nx) * S, S, S);
  }));
  return { canvas: c, z, x0: t.x0, y0: t.y0, nx: t.nx, ny: t.ny, box: t.box };
}

export const NOISE = `
float h3(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<6;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }`;

export const CLOUD = `
float cloudAt(vec3 n, float t){ vec3 p = n*3.0 + vec3(t*.006, 0., t*.004); float lat = abs(n.y);
  float belt = .55 + .3*cos(lat*7.5) - .25*smoothstep(.15,.45,lat)*smoothstep(.7,.45,lat);
  vec3 q = vec3(fbm(p), fbm(p + 5.2), fbm(p + 9.1)); float f = fbm(p*1.6 + q*1.9);
  return smoothstep(.6 - .14*belt, .95, f) * smoothstep(.5,.62,f + .05); }`;
