// INTELLIGENCE → "Planet Earth" (feat/earth-globe): the three.js scene, with no React, so the app and the headless motion test
// (scripts/earth-motion.mjs) draw the same frames. A photoreal Earth (Sentinel-2 cloudless day map, Black Marble city lights,
// moving clouds, atmosphere rim), story rings sized by outlets, light arcs between countries that share a story, then real
// terrain patches (Estonia, Tallinn) with satellite imagery, town news beams and labels anchored to places.
// Pure maths: src/lib/earth-pure.ts. Tiles come through tileUrl() (the app: /api/earth/tile, cached on disk).
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { x2lon, y2lat, arcPoints, band, levelAt, lat2y, poseAt, ringDeg, terrarium, tilesFor, toXYZ, EARTH_KM, type Box, type Pose, type Shot, type TileKind, type TownNews, lerpPose, moveMs, clampAlt, zoneFade, type Rect } from "@/lib/earth-pure";

import type { EarthData } from "@/lib/earth-data-pure";
import { BUILDINGS_MAX_ALT, BZ, TOTAL as MAX_BUILDINGS, extrude, tilesAround, type Building } from "@/lib/earth-buildings-pure";
import { LIGHT_GLSL } from "@/lib/earth-light-pure";
import { GROUND_PX, GROUND_TILES, drawGround, groundFade, withOpenSea, type Ctx, type Ground } from "@/lib/earth-ground-pure";
export type { EarthData };
export type EarthOpts = { tileUrl: (k: TileKind, z: number, x: number, y: number) => string; sunMs?: number; dpr?: number; onTown?: (t: TownNews) => void; rightInset?: () => number; buildingsUrl?: (x: number, y: number) => string; home?: { lon: number; lat: number; name: string } };

const ACCENT = "#f2b35e"; // the one warm news accent; UI text is cool white
const LOG = `#include <common>\n#include <logdepthbuf_pars_vertex>\n`;
const LOGF = `#include <logdepthbuf_pars_fragment>\n`;

function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; });
}
/** Stitches the tiles covering `box` at zoom z into one canvas (Web Mercator, as served). */
async function mosaic(o: EarthOpts, kind: TileKind, box: Box, z: number) {
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
type Mosaic = Awaited<ReturnType<typeof mosaic>>;
const tex = (c: HTMLCanvasElement, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };

/* ---------- shaders ---------- */

const NOISE = `
float h3(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<6;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }`;
// lon/lat of a unit-sphere point (lon 0 at +z, y up) and its Web-Mercator v for a whole-world z-level mosaic
const GEO = `
vec2 lonlat(vec3 p){ return vec2(atan(p.x, p.z), asin(clamp(p.y, -1., 1.))); }
float mercV(float lat){ float l = clamp(lat, -1.4844, 1.4844); return (1. - log(tan(l) + 1./cos(l)) / 3.14159265) / 2.; }`;

const CLOUD = `
float cloudAt(vec3 n, float t){ vec3 p = n*3.0 + vec3(t*.006, 0., t*.004); float lat = abs(n.y);
  float belt = .55 + .3*cos(lat*7.5) - .25*smoothstep(.15,.45,lat)*smoothstep(.7,.45,lat);
  vec3 q = vec3(fbm(p), fbm(p + 5.2), fbm(p + 9.1)); float f = fbm(p*1.6 + q*1.9);
  return smoothstep(.6 - .14*belt, .95, f) * smoothstep(.5,.62,f + .05); }`;
const globeVS = `${LOG} varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const globeFS = `${LOGF} uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uElev; uniform float uT; uniform vec3 uSun; uniform vec3 uCam; varying vec3 vN; varying vec3 vW; ${GEO} ${NOISE} ${CLOUD}
float elevRaw(vec2 uv){ vec3 e = texture2D(uElev, uv).rgb * 255.; return e.r*256. + e.g + e.b/256. - 32768.; }
float elev(vec2 uv){ vec3 e = texture2D(uElev, uv).rgb * 255.; return max(0., e.r*256. + e.g + e.b/256. - 32768.); }
void main(){ \n#include <logdepthbuf_fragment>\n
  vec2 ll = lonlat(vN); vec2 uv = vec2(ll.x/6.2831853 + .5, 1. - mercV(ll.y));
  vec3 day = texture2D(uDay, uv).rgb; vec3 night = texture2D(uNight, uv).rgb;
  float sea = 1. - smoothstep(-40., 0., elevRaw(uv)); day = mix(day, vec3(.012,.035,.075), sea * .85);
  float polar = smoothstep(1.45, 1.52, abs(ll.y)); day = mix(day, vec3(.86,.9,.95), polar);
  vec2 px = vec2(1./2048., 1./2048.);
  float hx = elev(uv + vec2(px.x,0.)) - elev(uv - vec2(px.x,0.)), hy = elev(uv + vec2(0.,px.y)) - elev(uv - vec2(0.,px.y));
  vec3 east = normalize(cross(vec3(0.,1.,0.), vN)), north = cross(vN, east);
  vec3 Nr = normalize(vN - (east*hx + north*hy) * .00006 * cos(ll.y));
  float d = dot(vN, uSun), lit = smoothstep(-.12, .2, d);
  float relief = clamp(.85 + 1.6*(dot(Nr, uSun) - d), .55, 1.35);
  float shadow = 1. - .45 * cloudAt(normalize(vN + uSun*.012), uT) * lit;
  day *= relief * shadow;
  vec3 V = normalize(uCam - vW); float rim = pow(1. - max(dot(vN, V), 0.), 2.5) * .55;
  vec3 c = day * .82 * (0.16 + 1.0*sqrt(max(d, 0.))) * mix(.35, 1., lit) + night * vec3(1.,.78,.45) * 1.6 * (1. - smoothstep(-.2, .08, d));
  vec3 Hh = normalize(uSun + V); float spec = pow(max(dot(vN, Hh), 0.), 140.) * .18 * lit * (1. - smoothstep(.06,.14, (day.r+day.g+day.b)/3.)); // sun glint on the sea
  c += spec * vec3(1.,.95,.85) + rim * vec3(.42,.62,.95) * (.1 + .6*lit);
  gl_FragColor = vec4(c, 1.); }`;

const cloudFS = `${LOGF} uniform vec3 uSun; uniform float uT; uniform float uFade; varying vec3 vN; varying vec3 vW; ${NOISE} ${CLOUD}
void main(){ \n#include <logdepthbuf_fragment>\n
  float a = cloudAt(vN, uT) * uFade;
  float d = dot(vN, uSun), lit = smoothstep(-.15, .25, d);
  gl_FragColor = vec4(vec3(1.) * (.06 + .98*lit) * mix(vec3(1.), vec3(1.,.82,.66), smoothstep(.25,.0,d)*lit), a*.95); }`;

const atmoVS = `${LOG} varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(normalMatrix*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const atmoFS = `${LOGF} uniform vec3 uSun; uniform vec3 uCam; varying vec3 vN; varying vec3 vW;
void main(){ \n#include <logdepthbuf_fragment>\n vec3 V = normalize(uCam - vW); vec3 N = normalize(vW);
  float k = pow(clamp(.72 + dot(normalize(vN), vec3(0,0,1)) * 0. - dot(N, -V)*0.0 , 0., 1.), 1.);
  float edge = 1. - abs(dot(N, V)); float i = pow(max(edge, 0.), 3.2) * 1.5;
  float sd = dot(N, uSun), lit = smoothstep(-.3, .35, sd);
  vec3 sky = mix(vec3(1.,.55,.3), vec3(.35,.62,1.), smoothstep(-.05,.3,sd));
  gl_FragColor = vec4(sky * i * (.05 + 1.2*lit) * k, i * (.05 + lit)); }`;

const terrVS = `${LOG} attribute vec2 uvM; attribute vec2 uvN; varying vec2 vUv; varying vec2 vUvN; varying vec3 vN; varying vec3 vW; varying float vEdge; attribute float edge; attribute float hm; attribute vec2 uvE; varying float vH; varying vec2 vUvE;
void main(){ vH = hm; vUvE = uvE; vUv = uvM; vUvN = uvN; vN = normalize(normal); vEdge = edge; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const terrFS = `${LOGF}${LIGHT_GLSL} uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun; uniform vec3 uCam; uniform float uOp; uniform float uHaze; uniform float uNightK;
varying vec2 vUv; varying vec2 vUvN; varying vec3 vN; varying vec3 vW; varying float vEdge; varying float vH; varying vec2 vUvE; uniform sampler2D uLand; uniform float uLakes; uniform float uStyl; uniform vec2 uTexel;
void main(){ \n#include <logdepthbuf_fragment>\n
  vec4 dayA = texture2D(uDay, vUv); if (dayA.a < .5) discard; // tile not loaded yet: the globe underneath shows instead of black
  vec3 day = dayA.rgb;
  { vec3 bl = (texture2D(uDay, vUv + vec2(uTexel.x, 0.)).rgb + texture2D(uDay, vUv - vec2(uTexel.x, 0.)).rgb + texture2D(uDay, vUv + vec2(0., uTexel.y)).rgb + texture2D(uDay, vUv - vec2(0., uTexel.y)).rgb) * .25;
    day = max(day + (day - bl) * .9 * uStyl, 0.); } // close-ups: unsharp mask on the soft imagery
  vec3 night = texture2D(uNight, vUvN).rgb;
  vec3 up = normalize(vW); float sun = dot(up, uSun), lit = dayK(sun);
  float water = 1. - smoothstep(.35, .65, texture2D(uLand, vUvE).r);
  // big lakes (Ladoga, Onega, Peipus) sit above sea level and read as flat grey in the 2016 mosaic: on the wide Baltic patch, low,
  // grey, unsaturated ground is treated as water too (cities are too small to matter at that scale)
  float mx = max(day.r, max(day.g, day.b)), mn = min(day.r, min(day.g, day.b));
  water = max(water, uLakes * (1. - smoothstep(.04, .09, mx - mn)) * smoothstep(.12, .2, mx) * (1. - smoothstep(25., 60., vH)));
  water = max(water, (1. - uStyl) * smoothstep(.02, .06, day.b - day.r) * (1. - smoothstep(.18, .3, mx)) * (1. - smoothstep(40., 90., vH))); // dark blue in the imagery = a lake // elevation <= 0: clean dark sea instead of the grey, blotchy tile
  vec3 V0 = normalize(uCam - vW); float glint = pow(max(dot(reflect(-uSun, up), V0), 0.), 40.) * .35 * lit;
  day = mix(day, vec3(.004,.012,.03) + glint, water * .95);
  float relief = clamp(1. + 4.*dot(normalize(vN) - up, uSun), .55, 1.5);
  vec3 c = day * (0.32 + 1.1*sqrt(max(sun, 0.))) * mix(.55, 1., lit) * relief * 1.35 * vec3(1.06,1.,.9) + night * vec3(1.,.8,.5) * 0.9 * uNightK * (1. - lit);
  float dist = length(uCam - vW) * 6371.; float haze = 1. - exp(-dist * uHaze);
  c = mix(c, vec3(.36,.46,.6) * mix(.25, .8, lit), haze * .3 * (1. - water)); // thin blue air in the distance, never over the sea
  // city close-ups: 10 m imagery turns to blur, so it fades into a dark map base (a faint hint of the photo, clean water, a fine
  // 250 m grid) that the buildings stand out on
  float lum = dot(c, vec3(.3,.55,.15));
  vec3 P = normalize(vW); vec2 gl = vec2(atan(P.x, P.z) * cos(asin(P.y)), asin(P.y)) * 6371000. / 250.;
  vec2 gw = abs(fract(gl - .5) - .5) / max(fwidth(gl), 1e-4); float grid = (1. - min(min(gw.x, gw.y), 1.)) * (1. - water);
  vec3 photo = mix(vec3(lum), c, .75) * vec3(.82,.9,1.05); photo = (photo - .12) * 1.25 + .12; // cooler, more contrast
  vec3 map = mix(mix(vec3(.025,.032,.045), max(photo, 0.), .5), vec3(.004,.012,.03), water * .9); // ~60% photo, water stays a clean shape
  map += vec3(.25,.55,.75) * grid * .1 * uStyl + vec3(.3,.6,.8) * (1. - smoothstep(.0, .25, abs(water - .5))) * .08 * uStyl; // grid + a thin coastline
  map *= mix(.35, 1., lit); // the map base darkens with the vector ground (Black Marble at ~600 m/px is too coarse to light it: it reads as flat blocks)
  c = mix(c, map, uStyl);
  gl_FragColor = vec4(c, uOp * smoothstep(0., .22, vEdge)); }`;

const glowFS = `${LOGF} uniform vec3 uColor; uniform float uT; uniform float uOp; varying vec2 vUv;
void main(){ \n#include <logdepthbuf_fragment>\n float flow = fract(vUv.x - uT*.18); float head = pow(smoothstep(.0,.97,flow),6.)*(1.-smoothstep(.97,1.,flow));
  float a = .28 + 1.2*head;
  gl_FragColor = vec4(uColor*1.2, a * uOp * smoothstep(0.,.05,vUv.x) * smoothstep(1.,.95,vUv.x)); }`;
const uvVS = `${LOG} varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); \n#include <logdepthbuf_vertex>\n }`;
const ringFS = `${LOGF} uniform vec3 uColor; uniform float uT; uniform float uOp; uniform float uK; uniform float uN; varying vec2 vUv;
void main(){ \n#include <logdepthbuf_fragment>\n vec2 p = vUv*2.-1.; float r = length(p) / (1. + .04*uK*sin(uT*1.6));
  float ang = atan(p.y,p.x)/6.2831853 + .5; float tick = step(fract(ang*uN), .18) * smoothstep(.03,.0,abs(r-.93)) * step(ang*uN, uN);
  float ring = smoothstep(.025,.0,abs(r-.86))*.9 + smoothstep(.02,.0,abs(r-.62))*.35;
  float core = smoothstep(.07,.0,r); float a = (ring + core + tick) * uOp; if (a < .01) discard;
  gl_FragColor = vec4(uColor, a); }`;
const beamFS = `${LOGF} uniform vec3 uColor; uniform float uOp; uniform float uT; varying vec2 vUv;
void main(){ \n#include <logdepthbuf_fragment>\n float a = pow(clamp(1. - vUv.y, 0., 1.), 1.6) * uOp; float side = 1. - abs(vUv.x*2.-1.);
  gl_FragColor = vec4(uColor*1.4, a * side); }`;

const bldVS = `${LOG} attribute float shade; attribute vec3 wall; varying float vS; varying vec3 vWall; varying vec3 vN; varying vec3 vW;
void main(){ vS = shade; vWall = wall; vN = normalize(normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
// OSM buildings, "futuristic real": dark glass-and-concrete facades with a grid of windows (a few lit by day, many at night),
// soft ambient occlusion at the foot, a faint cool line along the roof edge, taller buildings tinted cooler and lighter.
const bldFS = `${LOGF}${LIGHT_GLSL} uniform vec3 uSun; uniform vec3 uCam; uniform float uOp; varying float vS; varying vec3 vWall; varying vec3 vN; varying vec3 vW;
float hb(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){ \n#include <logdepthbuf_fragment>\n
  vec3 up = normalize(vW); float sun = dot(up, uSun), lit = dayK(sun), on = lightsK(sun), dusk = duskK(sun);
  float roof = step(.95, vS), tall = smoothstep(8., 45., vWall.z);
  vec3 N = normalize(vN); float diff = max(dot(N, uSun), 0.);
  vec3 base = mix(vec3(.016,.019,.025), vec3(.022,.03,.042), tall); // linear: about #2a2f38 … #33404f on screen // dark facades; towers a little cooler and lighter
  vec3 sunC = mix(vec3(1.), vec3(1.,.6,.38), dusk); // low sun goes warm
  vec3 c = base * (mix(.25, .6, lit) + (1.6*diff + .4) * lit * sunC) + vec3(.004,.006,.012) * dusk; // blue-hour sky fill
  // windows: 3.2 m floors, 3.4 m bays, on walls only, from the first floor up
  vec2 g = vec2(vWall.x / 3.4, vWall.y / 3.2), f = fract(g), id = floor(g);
  float win = step(.22, f.x) * step(f.x, .78) * step(.3, f.y) * step(f.y, .8) * step(1., id.y) * (1. - roof) * step(vWall.y, vWall.z - 1.);
  vec2 wid = id + vec2(floor(vWall.z), 7.); float r = hb(wid);
  float isOn = step(1. - mix(.08, .55, on), r); // a few by day, about half after dark
  // homes warm (2700 K), offices and towers cooler LED; each window its own brightness
  vec3 wc = mix(vec3(1.,.62,.32), vec3(.78,.86,1.), step(.75 - .5*tall, hb(wid + 3.1))) * (.45 + .55*hb(wid + 9.7));
  vec3 glass = mix(vec3(.012,.018,.028), vec3(.03,.045,.065), lit) * win * (.5 + .5*diff) + vec3(.02,.03,.05) * win * dusk; // glass catches the twilight sky
  c += glass * .6 + wc * win * isOn * mix(.1, .85, on);
  // soft AO at the foot; after dark the street lights wash the lower floors amber
  float foot = smoothstep(0., 6., vWall.y);
  c *= mix(.35, 1., foot);
  c += SODIUM * .012 * on * (1. - roof) * (1. - smoothstep(0., 8., vWall.y));
  c = mix(c, vec3(.03,.034,.04) * (.25 + .5*lit + .3*lit*diff) * sunC, roof * .9);
  float rim = (1. - roof) * smoothstep(vWall.z - 1.2, vWall.z, vWall.y);
  c += vec3(.25,.6,1.) * rim * mix(.12, .35, lit);
  float dist = length(uCam - vW) * 6371.; c = mix(c, vec3(.05,.07,.1) * mix(.15, 1., lit), (1. - exp(-dist * .05)) * .5);
  gl_FragColor = vec4(c, uOp); }`;

// the vector ground (OSM map drawn per z14 tile): a touch of sun shading, the major roads keep their glow at night, distance haze
const gndVS = `${LOG} varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const gndFS = `${LOGF}${LIGHT_GLSL} uniform sampler2D uMap; uniform vec3 uSun; uniform vec3 uCam; uniform float uOp; varying vec2 vUv; varying vec3 vW;
// road light from the map itself: brightness of the drawn roads, read sharp (the lamps on the road) and from blurred mip levels (the
// pool of light around them, and what the water reflects) - no extra texture, no bloom
float roadL(vec3 m){ return smoothstep(.015, .35, max(m.r, max(m.g, m.b))) * (1. - smoothstep(2., 2.6, m.b / max(m.g, 1e-3))); }
void main(){ \n#include <logdepthbuf_fragment>\n
  vec3 m = texture2D(uMap, vUv).rgb; vec3 c = m * m; // the canvas is sRGB: to linear
  vec3 up = normalize(vW); float sun = dot(up, uSun), lit = dayK(sun), on = lightsK(sun), dusk = duskK(sun);
  float bright = max(c.r, max(c.g, c.b));
  float water = smoothstep(1.9, 2.4, c.b / max(c.g, 1e-4)) * (1. - smoothstep(.02, .06, bright)); // the deep-blue fill of sea and lakes
  float road = smoothstep(.02, .3, bright) * (1. - water);
  vec3 b1 = texture2D(uMap, vUv, 3.5).rgb, b2 = texture2D(uMap, vUv, 5.5).rgb;
  float pool = roadL(b1 * b1) * .6 + roadL(b2 * b2) * .4;
  // day: the map as drawn, warm and dimmer at dusk
  vec3 dayC = c * mix(.8, 1.15, lit) * mix(vec3(1.), vec3(1.,.7,.55), dusk * .6);
  // night: dark land under a faint blue sky, the roads turn amber (Black Marble), light pools spill onto the ground around them
  vec3 nightC = c * .18 + vec3(.0015,.0025,.005) + vec3(.008,.012,.024) * dusk;
  nightC = mix(nightC, SODIUM * (.03 + .7 * bright * bright + .25 * bright), road * on) + SODIUM * pool * .09 * on * (1. - water);
  // water: the twilight sky and the city's light, broken by small waves, stronger at a glancing view
  vec3 V = normalize(uCam - vW); float fres = .25 + .75 * pow(1. - max(dot(V, up), 0.), 3.);
  vec2 wp = vW.xz * 6371000.; float wave = .55 + .45 * sin(wp.x * .9 + sin(wp.y * .23) * 3.) * sin(wp.y * 1.3 + sin(wp.x * .17) * 2.);
  vec3 refl = SODIUM * (pool * .35 + .015) * wave * on + vec3(.01,.015,.03) * dusk + vec3(.04,.025,.03) * dusk * lit;
  nightC += refl * fres * water;
  c = mix(nightC, dayC, lit);
  float dist = length(uCam - vW) * 6371.; c = mix(c, vec3(.012,.018,.028) * mix(.3, 1., lit) + SODIUM * .01 * on, (1. - exp(-dist * .06)) * .55);
  gl_FragColor = vec4(c, uOp); }`;

/* ---------- the scene ---------- */

export function createEarth(host: HTMLElement, o: EarthOpts) {
  const W = () => host.clientWidth || 1280, H = () => host.clientHeight || 720;
  const inset = () => o.rightInset?.() ?? 0;
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(o.dpr ?? devicePixelRatio ?? 1, 1.5));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x01030a, 1);
  Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(34, W() / H(), 1e-6, 100);

  // soft bloom: only the bright story light (rings, arcs, beams) passes the threshold, the photo base stays clean
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.5, 0.4, 0.97);
  const dof = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uAmt: { value: 0 }, uRes: { value: new THREE.Vector2(W(), H()) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt; uniform vec2 uRes; varying vec2 vUv;
      void main(){ float k = smoothstep(.18, .5, abs(vUv.y - .52)) * uAmt; vec4 c = vec4(0.); float tot = 0.;
        for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) { vec2 o = vec2(float(i), float(j)) * k * 2.2 / uRes; float w = 1. / (1. + float(i*i + j*j) * .15); c += texture2D(tDiffuse, vUv + o) * w; tot += w; }
        vec4 base = texture2D(tDiffuse, vUv); gl_FragColor = mix(base, c / tot, step(.001, k));
        float vig = smoothstep(1.2, .35, length((vUv - .5) * vec2(1.2, 1.))); gl_FragColor.rgb *= mix(.55, 1., vig); }` });
  // one NaN pixel (a pow() of a tiny negative) gets smeared by bloom into black blocks: clean before bloom
  const clean = new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); bool bad = !(c.r == c.r && c.g == c.g && c.b == c.b && c.a == c.a) || any(greaterThan(abs(c), vec4(1e4))); gl_FragColor = bad ? vec4(0., 0., 0., 1.) : min(c, vec4(64.)); }" });
  composer.addPass(clean); composer.addPass(bloom); composer.addPass(dof); composer.addPass(new OutputPass());
  const sunV = new THREE.Vector3();
  const setSun = (ms: number) => {
    const d = new Date(ms), y0 = Date.UTC(d.getUTCFullYear(), 0, 1), doy = (ms - y0) / 864e5;
    const lat = -23.44 * Math.cos((2 * Math.PI / 365.25) * (doy + 10)), lon = -((d.getUTCHours() + d.getUTCMinutes() / 60) - 12) * 15;
    sunV.set(...toXYZ(lon, lat)).normalize();
  };
  setSun(o.sunMs ?? Date.now());

  // stars
  {
    const n = 2400, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(60); p.set([v.x, v.y, v.z], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb4ff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: .7 })));
  }

  const blank = (c: string) => { const k = document.createElement("canvas"); k.width = k.height = 4; const g = k.getContext("2d")!; g.fillStyle = c; g.fillRect(0, 0, 4, 4); return tex(k); };
  const U = { uDay: { value: blank("#0b1b33") as THREE.Texture }, uNight: { value: blank("#000") as THREE.Texture }, uElev: { value: blank("#800000") as THREE.Texture }, uT: { value: 0 }, uSun: { value: sunV }, uCam: { value: new THREE.Vector3() } };
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.ShaderMaterial({ vertexShader: globeVS, fragmentShader: globeFS, uniforms: U }));
  scene.add(globe);
  const cloudU = { uSun: { value: sunV }, uT: { value: 0 }, uFade: { value: 1 } };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, 160, 80), new THREE.ShaderMaterial({ vertexShader: globeVS, fragmentShader: cloudFS, uniforms: cloudU, transparent: true, depthWrite: false }));
  scene.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 128, 64), new THREE.ShaderMaterial({ vertexShader: atmoVS, fragmentShader: atmoFS, uniforms: { uSun: { value: sunV }, uCam: U.uCam }, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(atmo);

  // whole-world day/night maps (z3 = 2048² mercator)
  const world: Box = { w: -180, e: 180, n: 85.05, s: -85.05 };
  // a 16-tile z2 picture first, so the whole Earth is there at once; the sharp 4096² Sentinel-2 mosaic replaces it
  let sharp = false;
  void mosaic(o, "day", world, 2).then((m) => { if (!sharp) U.uDay.value = tex(m.canvas); host.classList.add("earth-seen"); });
  const ready = Promise.all([
    mosaic(o, "day", world, 4).then((m) => { sharp = true; U.uDay.value = tex(m.canvas); host.classList.add("earth-seen"); }),
    mosaic(o, "night", world, 4).then((m) => { U.uNight.value = tex(m.canvas); }),
    mosaic(o, "elev", world, 3).then((m) => { const t = new THREE.CanvasTexture(m.canvas); t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; U.uElev.value = t; }),
  ]);

  /* terrain patches */
  type Patch = { mesh: THREE.Mesh; u: { uOp: { value: number }; uNightK: { value: number }; uStyl: { value: number } }; lo: number; hi: number; box: Box; ground: (lon: number, lat: number) => number; sea: (lon: number, lat: number) => boolean };
  const patches: Patch[] = [];
  async function patch(box: Box, zi: number, ze: number, exag: number, lift: number, seg: number, lo: number, hi: number, haze: number, lakes = 0) {
    const [day, night, elev] = await Promise.all([mosaic(o, "day", box, zi), mosaic(o, "night", box, Math.min(zi, 8)), mosaic(o, "elev", box, ze)]);
    const eg = elev.canvas.getContext("2d")!, ed = eg.getImageData(0, 0, elev.canvas.width, elev.canvas.height).data, ew = elev.canvas.width, eh = elev.canvas.height;
    const rawAt = (lon: number, lat: number) => {
      const px = (((lon + 180) / 360) * 2 ** ze - elev.x0) * 256, py = (lat2y(lat, ze) - elev.y0) * 256;
      const x = Math.max(0, Math.min(ew - 1, Math.round(px))), y = Math.max(0, Math.min(eh - 1, Math.round(py))), i = (y * ew + x) * 4;
      return terrarium(ed[i], ed[i + 1], ed[i + 2]);
    };
    const hAt = (lon: number, lat: number) => Math.max(0, rawAt(lon, lat));
    const land = document.createElement("canvas"); land.width = ew; land.height = eh;
    { const lg = land.getContext("2d")!, img = lg.createImageData(ew, eh);
      for (let i = 0; i < ew * eh; i++) { const v = terrarium(ed[i * 4], ed[i * 4 + 1], ed[i * 4 + 2]) > -1.5 ? 255 : 0; /* sea = below -1.5 m: flat coastal land near 0 m stays land */ img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
      lg.putImageData(img, 0, 0); }
    const landT = new THREE.CanvasTexture(land); landT.colorSpace = THREE.NoColorSpace;
    const uvOf = (m: Mosaic, lon: number, lat: number): [number, number] => [(((lon + 180) / 360) * 2 ** m.z - m.x0) / m.nx, 1 - (lat2y(lat, m.z) - m.y0) / m.ny];
    const n = seg + 1, pos = new Float32Array(n * n * 3), uvM = new Float32Array(n * n * 2), uv2 = new Float32Array(n * n * 2), edge = new Float32Array(n * n), hm = new Float32Array(n * n), uvE = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const lon = box.w + (box.e - box.w) * (i / seg), lat = box.n - (box.n - box.s) * (j / seg), k = j * n + i;
      const hh = hAt(lon, lat); hm[k] = hh;
      pos.set(toXYZ(lon, lat, (hh * exag + lift) / (EARTH_KM * 1000)), k * 3);
      uvM.set(uvOf(day, lon, lat), k * 2); uv2.set(uvOf(night, lon, lat), k * 2); uvE.set(uvOf(elev, lon, lat), k * 2);
      edge[k] = Math.min(i, j, seg - i, seg - j) / seg;
    }
    const idx: number[] = [];
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uvM", new THREE.BufferAttribute(uvM, 2)); g.setAttribute("uvN", new THREE.BufferAttribute(uv2, 2));
    g.setAttribute("edge", new THREE.BufferAttribute(edge, 1)); g.setAttribute("hm", new THREE.BufferAttribute(hm, 1)); g.setAttribute("uvE", new THREE.BufferAttribute(uvE, 2)); g.setIndex(idx); g.computeVertexNormals();
    const nightT = tex(night.canvas); // same box, coarser zoom: its own uv would differ only slightly, so share uvM via a matched mosaic box
    const u = { uDay: { value: tex(day.canvas) as THREE.Texture }, uNight: { value: nightT as THREE.Texture }, uSun: { value: sunV }, uCam: U.uCam, uOp: { value: 0 }, uHaze: { value: haze }, uNightK: { value: 1 }, uLand: { value: landT as THREE.Texture }, uLakes: { value: lakes }, uStyl: { value: 0 }, uTexel: { value: new THREE.Vector2(1.5 / day.canvas.width, 1.5 / day.canvas.height) } };
    const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: terrVS, fragmentShader: terrFS, uniforms: u, transparent: true }));
    mesh.renderOrder = 2 + patches.length;
    scene.add(mesh);
    patches.push({ mesh, u, lo, hi, box, ground: (lon, lat) => hAt(lon, lat) * exag + lift, sea: (lon, lat) => rawAt(lon, lat) < -1.5 });
  }
  // Estonia (z8 imagery ≈ 600 m/px, z8 elevation) and central Tallinn (z14 imagery ≈ 5 m/px drawn, z12 elevation)
  const terrainReady = ready.then(() => Promise.all([
    patch({ w: 8, e: 38, s: 53, n: 66 }, 6, 7, 3, 0, 200, 30, 3500, 0.0001, 1),
    patch({ w: 21.6, e: 28.4, s: 57.4, n: 59.85 }, 10, 9, 6, 40, 360, 1, 2600, 0.00025),
    patch({ w: 24.45, e: 25.08, s: 59.32, n: 59.55 }, 14, 12, 6, 260, 256, 0.5, 90, 0.004),
  ]));

  // close-up for any place: a 3D patch built on demand around it (Tallinn's is prebuilt). Keeps at most two.
  const focusCache = new Map<string, Promise<void>>();
  function focusPlace(lon: number, lat: number) {
    const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
    if (Math.abs(lon - 24.76) < 0.15 && Math.abs(lat - 59.44) < 0.06) return Promise.resolve();
    if (!focusCache.has(key)) {
      while (patches.length > 4) { const old = patches.splice(3, 1)[0]; scene.remove(old.mesh); old.mesh.geometry.dispose(); }
      focusCache.set(key, patch({ w: lon - 0.3, e: lon + 0.3, s: lat - 0.12, n: lat + 0.12 }, 14, 12, 6, 260, 200, 0.5, 90, 0.004));
    }
    return focusCache.get(key)!;
  }

  /* OSM buildings (city close-ups, below BUILDINGS_MAX_ALT): one merged mesh per z14 tile, standing on the finest terrain patch */
  const bU = { uSun: { value: sunV }, uCam: U.uCam, uOp: { value: 0 } };
  const bMat = new THREE.ShaderMaterial({ vertexShader: bldVS, fragmentShader: bldFS, uniforms: bU, transparent: true }); // always in the transparent pass: the ground (renderOrder 7, no depth test) must draw before them
  const bTiles = new Map<string, { mesh?: THREE.Mesh; ground?: THREE.Mesh; n: number; retry?: number }>();
  const gU = { uSun: { value: sunV }, uCam: U.uCam, uOp: { value: 0 } };
  /** The OSM ground for one tile: a canvas map on a small grid that follows the terrain, drawn after it and before the buildings. */
  function makeGround(x: number, y: number, gr: Ground): THREE.Mesh | undefined {
    if ([...bTiles.values()].filter((t) => t.ground).length >= GROUND_TILES) return;
    const cv = document.createElement("canvas"); cv.width = cv.height = GROUND_PX;
    const lat = y2lat(y + 0.5, BZ);
    if (gr.open) gr = withOpenSea(gr, [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].filter(([a, b]) => seaAt(x2lon(x + a, BZ), y2lat(y + b, BZ))).length >= 3);
    drawGround(cv.getContext("2d")! as unknown as Ctx, gr, GROUND_PX, lat);
    const seg = 16, n = seg + 1, o0 = toXYZ(x2lon(x + 0.5, BZ), lat), pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const lo = x2lon(x + i / seg, BZ), la = y2lat(y + j / seg, BZ), p = toXYZ(lo, la, (groundAt(lo, la) + 2) / (EARTH_KM * 1000)), k = j * n + i;
      pos.set([p[0] - o0[0], p[1] - o0[1], p[2] - o0[2]], k * 3); uv.set([i / seg, 1 - j / seg], k * 2);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
    const t = tex(cv, false); t.onUpdate = () => { cv.width = cv.height = 1; }; // once on the GPU, free the 4 MB canvas
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: gndVS, fragmentShader: gndFS, uniforms: { ...gU, uMap: { value: t } }, transparent: true, depthTest: false, depthWrite: false }));
    m.position.set(...o0); m.renderOrder = 7; scene.add(m);
    return m;
  }
  const dropTile = (t: { mesh?: THREE.Mesh; ground?: THREE.Mesh }) => {
    if (t.mesh) { scene.remove(t.mesh); t.mesh.geometry.dispose(); }
    if (t.ground) { scene.remove(t.ground); t.ground.geometry.dispose(); const mt = t.ground.material as THREE.ShaderMaterial; (mt.uniforms.uMap.value as THREE.Texture).dispose(); mt.dispose(); }
  };
  let bBusy = 0, bLast = 0;
  const finest = (lon: number, lat: number) => {
    let best: Patch | null = null;
    for (const q of patches) if (lon >= q.box.w && lon <= q.box.e && lat >= q.box.s && lat <= q.box.n && (!best || q.box.e - q.box.w < best.box.e - best.box.w)) best = q;
    return best;
  };
  const groundAt = (lon: number, lat: number) => finest(lon, lat)?.ground(lon, lat) ?? 0;
  const seaAt = (lon: number, lat: number) => finest(lon, lat)?.sea(lon, lat) ?? false;
  function addBuildings(key: string, x: number, y: number, bs: Building[], gr?: Ground) {
    const used = [...bTiles.values()].reduce((s, t) => s + (t.mesh ? t.n : 0), 0);
    const ground = gr ? makeGround(x, y, gr) : undefined;
    bs = bs.slice(0, Math.max(0, MAX_BUILDINGS - used));
    if (!bs.length) { bTiles.set(key, { n: 0, ground }); return; }
    const c = { lon: bs[0].r[0][0], lat: bs[0].r[0][1] };
    const ex = extrude(bs, c, groundAt, 1.6); // a little taller than life, like the terrain's exaggeration, so the city reads from above
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(ex.positions, 3)); g.setAttribute("normal", new THREE.BufferAttribute(ex.normals, 3));
    g.setAttribute("shade", new THREE.BufferAttribute(ex.shade, 1)); g.setAttribute("wall", new THREE.BufferAttribute(ex.wall, 3)); g.setIndex(new THREE.BufferAttribute(ex.index, 1));
    const mesh = new THREE.Mesh(g, bMat); mesh.position.set(...ex.origin); mesh.renderOrder = 8; mesh.frustumCulled = true; g.computeBoundingSphere();
    scene.add(mesh); bTiles.set(key, { mesh, ground, n: ex.count });
  }
  const loadBuildings = async (x: number, y: number, key: string) => {
    bBusy++; bTiles.set(key, { n: 0, retry: Infinity });
    try {
      const r = await fetch(o.buildingsUrl!(x, y)); const j = r.ok ? await r.json() : null;
      await terrainReady;
      if (!bTiles.has(key)) return; // dropped meanwhile
      if (!j || j.offline) bTiles.set(key, { n: 0, retry: performance.now() + 10 * 60_000 }); else addBuildings(key, x, y, j.buildings ?? [], j.ground);
    } catch { bTiles.set(key, { n: 0, retry: performance.now() + 10 * 60_000 }); } finally { bBusy--; }
  };
  function updateBuildings(p: Pose) {
    if (!o.buildingsUrl || p.alt > BUILDINGS_MAX_ALT * 1.2) return;
    const now = performance.now();
    if (now - bLast < 400) return; bLast = now;
    const want = tilesAround(p.lon, p.lat, p.alt), keys = new Set(want.map((t) => `${t.x}/${t.y}`));
    for (const t of want) {
      const k = `${t.x}/${t.y}`, have = bTiles.get(k);
      if (bBusy >= 2) break;
      if (!have || (have.retry !== undefined && have.retry < now)) void loadBuildings(t.x, t.y, k);
    }
    if (bTiles.size > keys.size + 12) for (const [k, t] of bTiles) if (!keys.has(k) && t.retry !== Infinity) { dropTile(t); bTiles.delete(k); if (bTiles.size <= keys.size + 6) break; }
  }
  /** For the fixture stills: put a tile's buildings in directly. */
  const putBuildings = async (x: number, y: number, bs: Building[], gr?: Ground) => { await terrainReady; addBuildings(`${x}/${y}`, x, y, bs, gr); };

  /* story layers */
  const glow: { m: THREE.ShaderMaterial; lo: number; hi: number; base: number; pts?: THREE.Vector3[]; ring?: THREE.Mesh }[] = [];
  const circle = (lon: number, lat: number, rKm: number, h: number) => { const d = rKm / 111.32, k = Math.cos((lat * Math.PI) / 180); return [[d / k, 0], [-d / k, 0], [0, d], [0, -d]].map(([x, y]) => new THREE.Vector3(...toXYZ(lon + x, lat + y, h))); };
  const layer = new THREE.Group(); scene.add(layer);
  const col = (c: string) => new THREE.Color(c);
  function tangentAt(lon: number, lat: number, h: number) {
    const p = new THREE.Vector3(...toXYZ(lon, lat, h)), nrm = p.clone().normalize();
    return new THREE.Matrix4().lookAt(nrm, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).setPosition(p);
  }
  const labels: { el: HTMLDivElement; p: THREE.Vector3; lo: number; hi: number; town?: TownNews; pri: number; w: number; h: number; ox: number; oy: number }[] = [];
  const hud = document.createElement("div"); hud.className = "earth-hud"; host.appendChild(hud);
  const scrim = document.createElement("div"); scrim.className = "earth-scrim"; hud.appendChild(scrim);
  const labelLayer = document.createElement("div"); labelLayer.className = "earth-labels"; hud.appendChild(labelLayer);
  function label(html: string, lon: number, lat: number, h: number, lo: number, hi: number, cls: string, town?: TownNews) {
    const el = document.createElement("div"); el.className = `earth-label ${cls}`; el.innerHTML = html; labelLayer.appendChild(el);
    if (town && o.onTown) { el.style.pointerEvents = "auto"; el.onclick = () => o.onTown!(town); }
    labels.push({ el, p: new THREE.Vector3(...toXYZ(lon, lat, h)), lo, hi, town, pri: labels.length, w: 0, h: 0, ox: 0, oy: 0 });
  }
  const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const esc = (raw: string) => { const s = decode(raw); return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); };
    const cut = (raw: string, n: number) => { const s = decode(raw); return (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s); };

  function setData(d: EarthData) {
    layer.clear(); glow.length = 0; labels.length = 0; labelLayer.innerHTML = "";
    for (const [ri, r] of d.rings.slice(0, 14).entries()) {
      const s = (ringDeg(r.outlets) * Math.PI) / 180 * 2;
      const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: ringFS, uniforms: { uColor: { value: col(ACCENT) }, uT: { value: Math.random() * 3 }, uOp: { value: 1 }, uK: { value: Math.min(1, r.outlets / 8) }, uN: { value: Math.min(24, r.outlets) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s, s), m);
      mesh.applyMatrix4(tangentAt(r.lon, r.lat, 0.004));
      layer.add(mesh); glow.push({ m, lo: 2500, hi: 1e9, base: 1, pts: circle(r.lon, r.lat, (ringDeg(r.outlets) * 111.32), 0.004) }); // country rings give way to the town layer
      if (ri < 5) label(`<b>${esc(r.label)}</b><span>${esc(cut(r.title, 52))}</span><i>${r.outlets} ${r.outlets === 1 ? "outlet" : "outlets"}</i>`, r.lon, r.lat, 0.01, 5000, 1e9, "ring");
    }
    for (const a of d.arcs.slice(0, 8)) {
      const pts = arcPoints(a.from, a.to, 80, 0.22).map((p) => new THREE.Vector3(...p));
      const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: glowFS, uniforms: { uColor: { value: col(ACCENT) }, uT: { value: 0 }, uOp: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      layer.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.0022, 6), m));
      glow.push({ m, lo: 2500, hi: 1e9, base: 1 });
    }
    const max = Math.max(1, ...d.towns.map((t) => t.count));
    const ringAt = (lon: number, lat: number, rKm: number, lo: number, hi: number, k: number) => {
      const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: ringFS, uniforms: { uColor: { value: col(ACCENT) }, uT: { value: 0 }, uOp: { value: 0 }, uK: { value: 0.5 }, uN: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const s2 = (rKm * 2) / EARTH_KM, mesh = new THREE.Mesh(new THREE.PlaneGeometry(s2, s2), m);
      mesh.applyMatrix4(tangentAt(lon, lat, 400 / (EARTH_KM * 1000))); layer.add(mesh); glow.push({ m, lo, hi, base: k, pts: circle(lon, lat, rKm, 400 / (EARTH_KM * 1000)), ring: mesh });
    };
    const townsOnly = d.towns.filter((t) => t.kind !== "district");
    townsOnly.slice(0, 30).forEach((t, i) => {
      const k = 0.35 + 0.65 * (t.count / max), hKm = 10 + 45 * Math.sqrt(t.count / max), wKm = 0.12;
      const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: beamFS, uniforms: { uColor: { value: col(ACCENT) }, uOp: { value: 0 }, uT: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const g = new THREE.CylinderGeometry(wKm / EARTH_KM * 0.4, wKm / EARTH_KM, hKm / EARTH_KM, 8, 1, true);
      g.translate(0, hKm / EARTH_KM / 2, 0); g.rotateX(Math.PI / 2);
      const beam = new THREE.Mesh(g, m); beam.applyMatrix4(tangentAt(t.lon, t.lat, 0.00004)); layer.add(beam);
      glow.push({ m, lo: 50, hi: 2500, base: k, pts: Array.from({ length: 9 }, (_, i) => new THREE.Vector3(...toXYZ(t.lon, t.lat, (hKm / EARTH_KM) * (i / 8) ** 2))) });
      ringAt(t.lon, t.lat, 2.2 + 3 * Math.sqrt(t.count / max), 50, 2500, k);
      if (i < 20) label(`<b>${esc(t.name)}</b><i>${t.count}</i>`, t.lon, t.lat, 0.00004, t.kind === "city" ? 50 : 60, t.kind === "city" ? 2200 : 700, `pin ${t.kind}`, t);
    });
    for (const t of d.towns.filter((x) => x.kind === "district").slice(0, 8)) {
      ringAt(t.lon, t.lat, 0.25 + 0.35 * Math.sqrt(t.count / max), 0.5, 60, 1);
      label(`<b>${esc(t.name)}</b><span>${esc(cut(t.stories[0]?.title ?? "", 48))}</span><i>${t.count}</i>`, t.lon, t.lat, 0.00005, 0.5, 60, "district", t);
    }
    // source arcs: each outlet of a top town's lead story comes down from the sky into its beam
    for (const t of d.towns.filter((x) => x.kind !== "district").slice(0, 3).concat(d.towns.filter((x) => x.kind === "district").slice(0, 2))) {
      const district = t.kind === "district", top = (district ? 0.05 : 30) / EARTH_KM, sky = (district ? 14 : 160) / EARTH_KM;
      const srcs = [...new Set(t.stories.map((s) => s.source ?? ""))].slice(0, 5);
      srcs.forEach((_, i) => {
        const ang = (i / Math.max(1, srcs.length)) * Math.PI * 2 + 0.6, spread = district ? 0.06 : 0.9;
        const a = new THREE.Vector3(...toXYZ(t.lon + Math.cos(ang) * spread * 1.8, t.lat + Math.sin(ang) * spread, sky));
        const b = new THREE.Vector3(...toXYZ(t.lon, t.lat, top));
        const mid = a.clone().lerp(b, 0.5).multiplyScalar(1 + sky * 0.15);
        const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: glowFS, uniforms: { uColor: { value: col(ACCENT) }, uT: { value: i * 0.37 }, uOp: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        layer.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, (district ? 0.012 : 0.08) / EARTH_KM, 5), m));
        glow.push({ m, base: 0.8, pts: curve.getPoints(12), ...(district ? { lo: 0.3, hi: 40 } : { lo: 30, hi: 900 }) });
      });
    }
    layer.traverse((x) => { x.renderOrder = 10; }); // story light draws after the (transparent) terrain
    // the timeline of today's stories, and the "Near you" list
    timeline.innerHTML = d.timeline.slice(0, 7).map((s) => `<div><time>${esc(s.time)}</time><span>${esc(cut(s.title, 40))}</span></div>`).join("");
    const home = o.home ?? { lon: 24.7536, lat: 59.437, name: "Tallinn" };
    const near = d.towns.filter((t) => Math.hypot((t.lon - home.lon) * Math.cos(home.lat * Math.PI / 180), t.lat - home.lat) * 111 < 40).slice(0, 6);
    nearEl.innerHTML = `<h4>Near you</h4>` + near.map((t) => `<div><b>${esc(t.name)}</b><span>${esc(cut(t.stories[0]?.title ?? "", 44))}</span><i>${t.count}</i></div>`).join("");
    const big = d.towns.find((t) => t.kind !== "district" && t.name !== home.name) ?? d.towns[0];
    card.innerHTML = big ? `<small>${esc(big.name)} · ${big.count} local stories</small>` + big.stories.slice(0, 3).map((s) => `<p>${esc(cut(s.title, 70))}<em>${esc(s.source ?? "")}</em></p>`).join("") : "";
    if (big) cardAt = new THREE.Vector3(...toXYZ(big.lon, big.lat, 40 / EARTH_KM));
    const lead = d.rings[0];
    lower.innerHTML = lead ? `<small>Most covered · ${lead.outlets} outlets</small><b>${esc(cut(lead.title, 80))}</b>` : "";
  }
  const timeline = document.createElement("div"); timeline.className = "earth-timeline"; hud.appendChild(timeline);
  const nearEl = document.createElement("div"); nearEl.className = "earth-near"; hud.appendChild(nearEl);
  const card = document.createElement("div"); card.className = "earth-card"; hud.appendChild(card);
  const lower = document.createElement("div"); lower.className = "earth-lower"; hud.appendChild(lower);
  const place = document.createElement("div"); place.className = "earth-place"; hud.appendChild(place);
  const credit = document.createElement("div"); credit.className = "earth-credit"; credit.textContent = "Imagery: Sentinel-2 cloudless 2016 by EOX (Copernicus) · NASA Black Marble · AWS Terrain Tiles · GeoNames · Map and buildings © OpenStreetMap contributors"; hud.appendChild(credit);
  let cardAt: THREE.Vector3 | null = null;
  const ret = document.createElement("div"); ret.className = "earth-reticle"; ret.innerHTML = "<i></i><i></i><i></i><i></i><b></b>"; hud.appendChild(ret);
  const readout = document.createElement("div"); readout.className = "earth-readout"; hud.appendChild(readout);
  let lastAlt = 0, regionName: string | null = null;

  /* camera */
  let pose: Pose = { lon: 18, lat: 38, alt: 16000, tilt: 0, heading: 0 };
  function applyPose(p: Pose) {
    const T = new THREE.Vector3(...toXYZ(p.lon, p.lat, p.alt < 80 ? groundAt(p.lon, p.lat) / (EARTH_KM * 1000) : 0)), n = T.clone().normalize(); // aim at the (raised) ground, not below it
    const east = new THREE.Vector3(0, 1, 0).cross(n).normalize(), north = n.clone().cross(east);
    const h = (p.heading * Math.PI) / 180, tl = (p.tilt * Math.PI) / 180;
    const fwd = north.clone().multiplyScalar(Math.cos(h)).add(east.clone().multiplyScalar(Math.sin(h)));
    const d = p.alt / EARTH_KM;
    cam.position.copy(T).add(n.clone().multiplyScalar(d * Math.cos(tl))).add(fwd.clone().multiplyScalar(-d * Math.sin(tl)));
    cam.up.copy(fwd.clone().multiplyScalar(Math.cos(tl)).add(n.clone().multiplyScalar(Math.sin(tl))));
    cam.lookAt(T);
    const off = band(p.alt, 3000, 1e9, 1.2) * W() * 0.12 - inset() / 2; // keep the planet in the free space left of the panel // from orbit, the planet sits right of the lower third
    if (Math.abs(off) > 0.5) cam.setViewOffset(W(), H(), -off, 0, W(), H()); else cam.clearViewOffset();
    cam.near = Math.max(1e-7, d * 0.02); cam.far = d + 4; cam.updateProjectionMatrix();
    U.uCam.value.copy(cam.position);
  }

  const v = new THREE.Vector3();
  const names: Record<string, string> = { orbit: "Earth today", country: "Estonia", region: "Estonia, towns and villages", town: "Tallinn" };
  // HUD text boxes, in host px: rings, beams and labels stay out of them
  const zonesNow = (nearOn: boolean, cardOn: boolean): Rect[] => {
    const b = host.getBoundingClientRect(), out: Rect[] = [];
    const add = (z: HTMLElement, pad: number) => { if (!z.offsetHeight) return; const r = z.getBoundingClientRect(); out.push([r.left - b.left - pad, r.top - b.top - pad, r.right - b.left + pad, r.bottom - b.top + pad]); };
    for (const z of [lower, timeline]) if (+z.style.opacity !== 0) add(z, 8);
    add(place, 10); add(readout, 10);
    if (nearOn) add(nearEl, 14);
    if (cardOn) add(card, 10);
    return out;
  };
  const pv = new THREE.Vector3();
  function screenRect(pts: THREE.Vector3[], fwd: THREE.Vector3): Rect | null {
    let r: Rect | null = null;
    for (const q of pts) {
      if (pv.copy(q).sub(cam.position).dot(fwd) <= 0) continue;
      pv.copy(q).project(cam); const x = ((pv.x + 1) / 2) * W(), y = ((1 - pv.y) / 2) * H();
      r = r ? [Math.min(r[0], x), Math.min(r[1], y), Math.max(r[2], x), Math.max(r[3], y)] : [x, y, x, y];
    }
    return r;
  }
  function frame(p: Pose, tMs: number) {
    p = { ...p, alt: clampAlt(p.alt) };
    pose = p; applyPose(p);
    const alt = p.alt, t = tMs / 1000;
    cloudU.uT.value = t; U.uT.value = t; cloudU.uFade.value = band(alt, 3000, 1e9, 1.0); // gone before the country shot: half-faded clouds read as grey blobs
    for (const q of patches) { q.u.uOp.value = band(alt, q.lo, q.hi, 0.9); q.u.uNightK.value = band(alt, 120, 1e9, 1.5); q.u.uStyl.value = 1 - band(alt, 9, 1e9, 1.4); } // coarse city lights only from high up
    dof.uniforms.uAmt.value = 0.3 * band(alt, 4, 60, 1.2); // no tilt-shift blur on city close-ups: the ground is soft enough
    bU.uOp.value = band(alt, 0.05, BUILDINGS_MAX_ALT, 0.6); bMat.depthWrite = bU.uOp.value > 0.5;
    gU.uOp.value = groundFade(alt);
    for (const t of bTiles.values()) { if (t.mesh) t.mesh.visible = bU.uOp.value > 0.01; if (t.ground) t.ground.visible = gU.uOp.value > 0.01; }
    updateBuildings(p);
    bloom.strength = 0.45;
    const w = W(), h = H();
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    timeline.style.opacity = String(band(alt, 3000, 1e9, 0.8));
    lower.style.opacity = String(band(alt, 3000, 1e9, 0.8));
    const nearA = band(alt, 0.5, 30, 0.8), cA = band(alt, 60, 700, 0.6);
    const zones = zonesNow(nearA > 0.1, cA > 0.1);
    for (const g of glow) {
      let a = g.base * band(alt, g.lo, g.hi, 0.8);
      if (a > 0.005 && g.pts) {
        let r = screenRect(g.pts, fwd);
        if (r && g.ring) { // town/district rings: small base rings at city zoom, never wider than 120 px
          const k = Math.min(1, 120 / Math.max(1, r[2] - r[0])); g.ring.scale.setScalar(k);
          const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, hw = (r[2] - r[0]) * k / 2, hh = (r[3] - r[1]) * k / 2; r = [cx - hw, cy - hh, cx + hw, cy + hh];
        }
        if (r) a *= zoneFade(r, zones);
      }
      g.m.uniforms.uOp.value = a; g.m.uniforms.uT.value = t;
    }
    composer.render();
    const taken: Rect[] = [...zones];
    for (const l of labels) {
      const a = band(alt, l.lo, l.hi, 0.6);
      const facing = l.p.dot(cam.position) > l.p.lengthSq() * 0.999999 && l.p.clone().sub(cam.position).dot(fwd) > 0;
      v.copy(l.p).project(cam);
      let on = a > 0.02 && facing && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      if (on) {
        if (!l.w) { l.w = l.el.offsetWidth || 120; l.h = l.el.offsetHeight || 20; l.ox = l.el.offsetLeft; l.oy = l.el.offsetTop; } // margins shift the box off its pin
        const r: [number, number, number, number] = [x + l.ox - 8, y + l.oy - 4, x + l.ox + l.w + 8, y + l.oy + l.h + 4];
        if (r[2] > w - 8 || r[0] < 8 || r[1] < 70 || r[3] > h - 8) on = false;
        else if (taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) on = false; else taken.push(r);
      }
      l.el.style.opacity = on ? String(a) : "0";
      if (on) l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    const moving = Math.abs(Math.log(alt / (lastAlt || alt))) > 0.004; lastAlt = alt;
    ret.style.opacity = moving ? "0.7" : "0";
    const ns = p.lat >= 0 ? "N" : "S", ew = p.lon >= 0 ? "E" : "W";
    readout.textContent = `${Math.abs(p.lat).toFixed(3)}° ${ns}  ${Math.abs(p.lon).toFixed(3)}° ${ew}   alt ${alt >= 100 ? Math.round(alt).toLocaleString("en") : alt.toFixed(1)} km   tilt ${Math.round(p.tilt)}°`;
    const lvl = levelAt(alt);
    hud.dataset.level = lvl;
    place.textContent = lvl !== "orbit" && regionName ? regionName : names[lvl];
    nearEl.style.opacity = String(nearA);
    card.style.opacity = String(cA);
    if (cardAt && cA > 0) { v.copy(cardAt).project(cam); card.style.transform = `translate(${Math.min(w - 312, Math.max(32, ((v.x + 1) / 2) * w + 24))}px, ${Math.min(h - 220, Math.max(80, ((1 - v.y) / 2) * h - 40))}px)`; }
  }

  /* live use: fly between shots, drag and wheel */
  let fly: { from: Pose; to: Pose; t0: number; ms: number } | null = null, raf = 0, t0 = performance.now(), path: Shot[] | null = null, pathT0 = 0;
  const flyTo = (to: Pose, ms?: number) => { path = null; fly = { from: { ...pose }, to, t0: performance.now(), ms: ms ?? moveMs(pose, to) }; };
  const playPath = (p: Shot[]) => { path = p; pathT0 = performance.now(); fly = null; };
  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    let p = pose;
    if (path) p = poseAt(path, now - pathT0).pose;
    else if (fly) { const k = (now - fly.t0) / fly.ms; p = lerpPose(fly.from, fly.to, Math.min(1, k)); if (k >= 1) fly = null; }
    else if (p.alt > 5000) p = { ...p, lon: p.lon + 0.01 };
    frame(p, now - t0);
  }
  let drag: { x: number; y: number } | null = null;
  const el = renderer.domElement;
  el.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY }; path = null; fly = null; };
  el.onpointermove = (e) => {
    if (!drag) return;
    const k = (pose.alt / EARTH_KM) * 40 / H();
    pose = { ...pose, lon: pose.lon - (e.clientX - drag.x) * k / Math.max(.2, Math.cos(pose.lat * Math.PI / 180)), lat: Math.max(-80, Math.min(80, pose.lat + (e.clientY - drag.y) * k)) };
    drag = { x: e.clientX, y: e.clientY };
  };
  addEventListener("pointerup", () => { drag = null; });
  el.onwheel = (e) => { e.preventDefault(); path = null; fly = null; pose = { ...pose, alt: Math.max(clampAlt(0), Math.min(30000, pose.alt * Math.exp(e.deltaY * 0.0012))), tilt: Math.min(62, Math.max(0, 62 - Math.log2(Math.max(1, pose.alt / 8)) * 6)) }; };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { renderer.setSize(W(), H()); composer.setSize(W(), H()); dof.uniforms.uRes.value.set(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); }) : null;
  ro?.observe(host);

  return {
    ready: ready.then(() => terrainReady),
    setData, frame, flyTo, playPath, focusPlace, putBuildings,
    /** Tiles still loading (for the stills script). */
    loading: () => bBusy,
    /** Puts the sun where it is at a moment (ms since 1970). */
    setSun,
    /** Where the camera is now (EarthView asks for the region's news once it settles). */
    view: () => ({ ...pose }),
    setPlaceName(s: string | null) { regionName = s; },
    start() { cancelAnimationFrame(raf); t0 = performance.now(); loop(); },
    stop() { cancelAnimationFrame(raf); },
    renderPathAt(p: Shot[], ms: number) { frame(poseAt(p, ms).pose, ms); const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); gl.finish(); },
    dispose() {
      cancelAnimationFrame(raf); ro?.disconnect();
      scene.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.ShaderMaterial | undefined; if (mat) { for (const u of Object.values(mat.uniforms ?? {})) (u.value as THREE.Texture)?.isTexture && (u.value as THREE.Texture).dispose(); mat.dispose(); } });
      renderer.dispose(); el.remove(); hud.remove();
    },
  };
}
export type Earth = ReturnType<typeof createEarth>;

/** HUD styles (kept here so the app and the motion test look the same). */
export const EARTH_CSS = `
.earth-host{--pr:0px;position:absolute;inset:0;overflow:hidden;background:#02040a;font-family:var(--font-inter,Inter,system-ui,sans-serif);font-feature-settings:"tnum" 1;color:#eef2f7;--accent:#f2b35e;--ui:#eef2f7;--g:32px}
.earth-hud{position:absolute;inset:0;pointer-events:none}
@media (min-width:900px){.earth-host{--pr:32rem}}
.earth-labels{position:absolute;inset:0}
.earth-scrim{position:absolute;inset:0;background:radial-gradient(120% 70% at 0% 100%,rgba(1,3,8,.78) 0%,rgba(1,3,8,.45) 35%,rgba(1,3,8,0) 62%),linear-gradient(0deg,rgba(1,3,8,.7) 0,rgba(1,3,8,0) 90px),linear-gradient(180deg,rgba(1,3,8,.5) 0,rgba(1,3,8,0) 110px)}
.earth-label{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform,opacity;text-shadow:0 0 2px #000,0 1px 4px rgba(0,0,0,.95),0 0 18px rgba(0,0,0,.7)}
.earth-label b{display:block;font-size:13px;font-weight:600;color:var(--ui)}
.earth-label span{display:block;font-size:12px;line-height:1.35;color:rgba(238,242,247,.82);white-space:normal;width:230px}
.earth-label i{font-style:normal;font-size:11px;color:var(--accent)}
.earth-label.ring{margin:-7px 0 0 16px;padding:4px 10px 5px;border-left:1px solid var(--accent);background:linear-gradient(90deg,rgba(1,3,8,.62),rgba(1,3,8,.35) 70%,rgba(1,3,8,0))}
.earth-label.pin{margin:-8px 0 0 9px;display:flex;gap:6px;align-items:baseline;cursor:pointer}
.earth-label.pin:before{content:"";position:absolute;left:-9px;top:5px;width:5px;height:5px;border-radius:50%;background:var(--accent)}
.earth-label.pin b{font-size:12px;font-weight:500}.earth-label.pin.city b{font-size:14px;font-weight:600}
.earth-label.district{margin:-40px 0 0 12px;padding:2px 10px 2px 8px;background:linear-gradient(90deg,rgba(1,3,8,.62),rgba(1,3,8,.3) 75%,rgba(1,3,8,0));border-left:1px solid var(--accent);cursor:pointer;min-height:30px}
.earth-label.district:before{content:"";position:absolute;left:-12px;top:100%;width:12px;border-top:1px solid var(--accent);transform:rotate(-38deg);transform-origin:100% 0}
.earth-label.district b{font-size:13px;font-weight:600}.earth-label.district span{width:190px;font-size:11.5px;line-height:1.3}.earth-label.district i{display:none}
.earth-host:after{content:"Loading Earth…";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:13px;color:rgba(238,242,247,.6);pointer-events:none;transition:opacity .6s}
.earth-host.earth-seen:after{opacity:0}
.earth-place{position:absolute;left:var(--g);top:28px;font-size:15px;font-weight:600}
.earth-readout{position:absolute;left:var(--g);top:50px;font:400 11px/1 var(--font-jetbrains,ui-monospace,monospace);color:rgba(238,242,247,.6)}
.earth-timeline{position:absolute;left:var(--g);right:calc(var(--pr) + var(--g));bottom:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));grid-auto-rows:0;grid-template-rows:auto;overflow:hidden;gap:16px;border-top:1px solid rgba(238,242,247,.18);padding-top:10px}
.earth-timeline div{min-width:0;font-size:11px;color:rgba(238,242,247,.78)}
.earth-timeline time{display:block;color:var(--accent);margin-bottom:2px}
.earth-timeline span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.earth-lower{position:absolute;left:var(--g);bottom:84px;max-width:620px;text-shadow:0 2px 20px rgba(0,0,0,.7)}
.earth-lower small,.earth-card small{display:block;font-size:12px;color:var(--accent)}
.earth-lower b{display:block;font-family:var(--font-serif,Georgia,serif);font-size:30px;font-weight:400;line-height:1.18;margin-top:6px;letter-spacing:-.01em}
.earth-near{position:absolute;right:calc(var(--pr) + var(--g));top:28px;width:272px;padding:10px 14px 6px;margin-right:-14px;background:linear-gradient(180deg,rgba(1,3,8,.72),rgba(1,3,8,.55));border-top:1px solid rgba(238,242,247,.35);text-shadow:0 1px 3px rgba(0,0,0,.85)}
.earth-near h4{margin:0 0 6px;font-size:13px;font-weight:600}
.earth-near div{display:grid;grid-template-columns:1fr auto;gap:1px 12px;padding:8px 0;border-top:1px solid rgba(238,242,247,.12)}
.earth-near b{font-size:12px;font-weight:600}.earth-near span{grid-column:1;font-size:11px;color:rgba(238,242,247,.74);line-height:1.35}
.earth-near i{grid-row:1/3;grid-column:2;font-style:normal;color:var(--accent);font-size:13px;align-self:start}
.earth-card{position:absolute;left:0;top:0;width:280px;padding:12px 0 0 14px;border-left:1px solid var(--accent);text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 18px rgba(0,0,0,.6)}
.earth-card p{margin:8px 0 0;font-size:13px;line-height:1.35}.earth-card em{display:block;font-style:normal;font-size:11px;color:rgba(238,242,247,.6);margin-top:2px}
.earth-reticle{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;transition:opacity .32s cubic-bezier(.23,1,.32,1)}
.earth-reticle i{position:absolute;width:10px;height:10px;border:1px solid rgba(238,242,247,.8)}
.earth-reticle i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}.earth-reticle i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
.earth-reticle i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}.earth-reticle i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
.earth-reticle b{display:none}
.earth-credit{position:absolute;right:calc(var(--pr) + 10px);bottom:4px;font-size:9px;color:rgba(238,242,247,.4)}

.earth-on .earth-search{position:absolute;z-index:15;left:32px;top:112px;width:300px;display:flex;gap:8px;align-items:center;border-bottom:1px solid rgba(238,242,247,.3)}
.earth-on .earth-search .field{flex:1;background:transparent;border:0;border-radius:0;padding:8px 0;color:#eef2f7;font-size:13px;box-shadow:none;outline:none}
.earth-on .earth-search .field::placeholder{color:rgba(238,242,247,.5)}
.earth-on .earth-search .btn,.earth-on .earth-search .chip{background:transparent;border:0;color:#f2b35e;font-size:12px;padding:6px 0;box-shadow:none}
.earth-on .earth-side{position:absolute;z-index:14;left:32px;top:160px;width:300px;max-height:calc(100dvh - 300px);overflow-y:auto;color:#eef2f7;text-shadow:0 1px 3px rgba(0,0,0,.85)}
.earth-on .earth-side .hud-title{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:#eef2f7!important}
.earth-on .earth-side .glass,.earth-on .earth-side .hud-row{background:transparent;border-color:rgba(238,242,247,.12);box-shadow:none}
`;
