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
import { arcPoints, band, levelAt, lat2y, poseAt, ringDeg, terrarium, tilesFor, toXYZ, EARTH_KM, type Box, type Pose, type Shot, type TileKind, type TownNews, lerpPose, moveMs } from "@/lib/earth-pure";

import type { EarthData } from "@/lib/earth-data-pure";
export type { EarthData };
export type EarthOpts = { tileUrl: (k: TileKind, z: number, x: number, y: number) => string; sunMs?: number; dpr?: number; onTown?: (t: TownNews) => void; home?: { lon: number; lat: number; name: string } };

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

const globeVS = `${LOG} varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const globeFS = `${LOGF} uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun; uniform vec3 uCam; varying vec3 vN; varying vec3 vW; ${GEO}
void main(){ \n#include <logdepthbuf_fragment>\n
  vec2 ll = lonlat(vN); vec2 uv = vec2(ll.x/6.2831853 + .5, 1. - mercV(ll.y));
  vec3 day = texture2D(uDay, uv).rgb; vec3 night = texture2D(uNight, uv).rgb;
  float polar = smoothstep(1.45, 1.52, abs(ll.y)); day = mix(day, vec3(.86,.9,.95), polar);
  float d = dot(vN, uSun), lit = smoothstep(-.12, .2, d);
  vec3 V = normalize(uCam - vW); float rim = pow(1. - max(dot(vN, V), 0.), 5.) * .6;
  vec3 c = day * (0.16 + 1.0*sqrt(max(d, 0.))) * mix(.35, 1., lit) + night * vec3(1.,.78,.45) * 1.6 * (1. - smoothstep(-.2, .08, d));
  vec3 Hh = normalize(uSun + V); float spec = pow(max(dot(vN, Hh), 0.), 140.) * .18 * lit * (1. - smoothstep(.06,.14, (day.r+day.g+day.b)/3.)); // sun glint on the sea
  c += spec * vec3(1.,.95,.85) + rim * vec3(.42,.62,.95) * (.1 + .6*lit);
  gl_FragColor = vec4(c, 1.); \n#include <colorspace_fragment>\n }`;

const cloudFS = `${LOGF} uniform vec3 uSun; uniform float uT; uniform float uFade; varying vec3 vN; varying vec3 vW; ${NOISE}
void main(){ \n#include <logdepthbuf_fragment>\n
  vec3 p = vN*3.2 + vec3(uT*.006, 0., uT*.004); float lat = abs(vN.y);
  float band = .55 + .25*cos(lat*7.5); // storm belts and dry subtropics, roughly
  float f = fbm(p + fbm(p*1.7)*.8); float a = smoothstep(.70 - .08*band, .9, f) * uFade;
  float d = dot(vN, uSun), lit = smoothstep(-.15, .25, d);
  gl_FragColor = vec4(vec3(1.) * (.08 + .95*lit), a*.92); }`;

const atmoVS = `${LOG} varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(normalMatrix*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const atmoFS = `${LOGF} uniform vec3 uSun; uniform vec3 uCam; varying vec3 vN; varying vec3 vW;
void main(){ \n#include <logdepthbuf_fragment>\n vec3 V = normalize(uCam - vW); vec3 N = normalize(vW);
  float k = pow(clamp(.72 + dot(normalize(vN), vec3(0,0,1)) * 0. - dot(N, -V)*0.0 , 0., 1.), 1.);
  float edge = 1. - abs(dot(N, V)); float i = pow(edge, 5.) * 1.6;
  float lit = smoothstep(-.35, .3, dot(N, uSun));
  gl_FragColor = vec4(vec3(.32,.58,1.) * i * (.12 + lit) * k, i * (.1 + lit)); }`;

const terrVS = `${LOG} attribute vec2 uvM; attribute vec2 uvN; varying vec2 vUv; varying vec2 vUvN; varying vec3 vN; varying vec3 vW; varying float vEdge; attribute float edge;
void main(){ vUv = uvM; vUvN = uvN; vN = normalize(normal); vEdge = edge; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz;
  gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const terrFS = `${LOGF} uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun; uniform vec3 uCam; uniform float uOp; uniform float uHaze;
varying vec2 vUv; varying vec2 vUvN; varying vec3 vN; varying vec3 vW; varying float vEdge;
void main(){ \n#include <logdepthbuf_fragment>\n
  vec3 day = texture2D(uDay, vUv).rgb; vec3 night = texture2D(uNight, vUvN).rgb;
  vec3 up = normalize(vW); float sun = dot(up, uSun), lit = smoothstep(-.1, .2, sun);
  float relief = clamp(1. + 4.*dot(normalize(vN) - up, uSun), .55, 1.5);
  vec3 c = day * (0.16 + 1.0*sqrt(max(sun, 0.))) * mix(.35, 1., lit) * relief * 1.12 + night * vec3(1.,.8,.5) * 1.2 * (1. - lit);
  float dist = length(uCam - vW) * 6371.; float haze = 1. - exp(-dist * uHaze);
  c = mix(c, vec3(.62,.72,.86) * mix(.3, .9, lit), haze*.35);
  gl_FragColor = vec4(c, uOp * smoothstep(0., .22, vEdge)); \n#include <colorspace_fragment>\n }`;

const glowFS = `${LOGF} uniform vec3 uColor; uniform float uT; uniform float uOp; varying vec2 vUv;
void main(){ \n#include <logdepthbuf_fragment>\n float flow = fract(vUv.x - uT*.18); float head = pow(smoothstep(.0,.97,flow),6.)*(1.-smoothstep(.97,1.,flow));
  float a = .28 + 1.2*head;
  gl_FragColor = vec4(uColor*1.2, a * uOp * smoothstep(0.,.05,vUv.x) * smoothstep(1.,.95,vUv.x)); }`;
const uvVS = `${LOG} varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); \n#include <logdepthbuf_vertex>\n }`;
const ringFS = `${LOGF} uniform vec3 uColor; uniform float uT; uniform float uOp; uniform float uK; uniform float uN; varying vec2 vUv;
void main(){ \n#include <logdepthbuf_fragment>\n vec2 p = vUv*2.-1.; float r = length(p);
  float ang = atan(p.y,p.x)/6.2831853 + .5; float tick = step(fract(ang*uN), .18) * smoothstep(.03,.0,abs(r-.93)) * step(ang*uN, uN);
  float ring = smoothstep(.025,.0,abs(r-.86))*.9 + smoothstep(.02,.0,abs(r-.62))*.35;
  float core = smoothstep(.07,.0,r); float a = (ring + core + tick) * uOp; if (a < .01) discard;
  gl_FragColor = vec4(uColor, a); }`;
const beamFS = `${LOGF} uniform vec3 uColor; uniform float uOp; uniform float uT; varying vec2 vUv;
void main(){ \n#include <logdepthbuf_fragment>\n float a = pow(1. - vUv.y, 1.6) * uOp; float side = 1. - abs(vUv.x*2.-1.);
  gl_FragColor = vec4(uColor*1.4, a * side); }`;

/* ---------- the scene ---------- */

export function createEarth(host: HTMLElement, o: EarthOpts) {
  const W = () => host.clientWidth || 1280, H = () => host.clientHeight || 720;
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(o.dpr ?? devicePixelRatio ?? 1, 1.5));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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
  composer.addPass(bloom); composer.addPass(dof); composer.addPass(new OutputPass());
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
  const U = { uDay: { value: blank("#0b1b33") as THREE.Texture }, uNight: { value: blank("#000") as THREE.Texture }, uSun: { value: sunV }, uCam: { value: new THREE.Vector3() } };
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.ShaderMaterial({ vertexShader: globeVS, fragmentShader: globeFS, uniforms: U }));
  scene.add(globe);
  const cloudU = { uSun: { value: sunV }, uT: { value: 0 }, uFade: { value: 1 } };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.006, 160, 80), new THREE.ShaderMaterial({ vertexShader: globeVS, fragmentShader: cloudFS, uniforms: cloudU, transparent: true, depthWrite: false }));
  scene.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.045, 128, 64), new THREE.ShaderMaterial({ vertexShader: atmoVS, fragmentShader: atmoFS, uniforms: { uSun: { value: sunV }, uCam: U.uCam }, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(atmo);

  // whole-world day/night maps (z3 = 2048² mercator)
  const world: Box = { w: -180, e: 180, n: 85.05, s: -85.05 };
  const ready = Promise.all([
    mosaic(o, "day", world, 3).then((m) => { U.uDay.value = tex(m.canvas); }),
    mosaic(o, "night", world, 3).then((m) => { U.uNight.value = tex(m.canvas); }),
  ]);

  /* terrain patches */
  type Patch = { mesh: THREE.Mesh; u: { uOp: { value: number } }; lo: number; hi: number };
  const patches: Patch[] = [];
  async function patch(box: Box, zi: number, ze: number, exag: number, lift: number, seg: number, lo: number, hi: number, haze: number) {
    const [day, night, elev] = await Promise.all([mosaic(o, "day", box, zi), mosaic(o, "night", box, Math.min(zi, 8)), mosaic(o, "elev", box, ze)]);
    const eg = elev.canvas.getContext("2d")!, ed = eg.getImageData(0, 0, elev.canvas.width, elev.canvas.height).data, ew = elev.canvas.width, eh = elev.canvas.height;
    const hAt = (lon: number, lat: number) => {
      const px = (((lon + 180) / 360) * 2 ** ze - elev.x0) * 256, py = (lat2y(lat, ze) - elev.y0) * 256;
      const x = Math.max(0, Math.min(ew - 1, Math.round(px))), y = Math.max(0, Math.min(eh - 1, Math.round(py))), i = (y * ew + x) * 4;
      return Math.max(0, terrarium(ed[i], ed[i + 1], ed[i + 2]));
    };
    const uvOf = (m: Mosaic, lon: number, lat: number): [number, number] => [(((lon + 180) / 360) * 2 ** m.z - m.x0) / m.nx, 1 - (lat2y(lat, m.z) - m.y0) / m.ny];
    const n = seg + 1, pos = new Float32Array(n * n * 3), uvM = new Float32Array(n * n * 2), uv2 = new Float32Array(n * n * 2), edge = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const lon = box.w + (box.e - box.w) * (i / seg), lat = box.n - (box.n - box.s) * (j / seg), k = j * n + i;
      pos.set(toXYZ(lon, lat, (hAt(lon, lat) * exag + lift) / (EARTH_KM * 1000)), k * 3);
      uvM.set(uvOf(day, lon, lat), k * 2); uv2.set(uvOf(night, lon, lat), k * 2);
      edge[k] = Math.min(i, j, seg - i, seg - j) / seg;
    }
    const idx: number[] = [];
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uvM", new THREE.BufferAttribute(uvM, 2)); g.setAttribute("uvN", new THREE.BufferAttribute(uv2, 2));
    g.setAttribute("edge", new THREE.BufferAttribute(edge, 1)); g.setIndex(idx); g.computeVertexNormals();
    const nightT = tex(night.canvas); // same box, coarser zoom: its own uv would differ only slightly, so share uvM via a matched mosaic box
    const u = { uDay: { value: tex(day.canvas) as THREE.Texture }, uNight: { value: nightT as THREE.Texture }, uSun: { value: sunV }, uCam: U.uCam, uOp: { value: 0 }, uHaze: { value: haze } };
    const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: terrVS, fragmentShader: terrFS, uniforms: u, transparent: true }));
    mesh.renderOrder = 2 + patches.length;
    scene.add(mesh);
    patches.push({ mesh, u, lo, hi });
  }
  // Estonia (z8 imagery ≈ 600 m/px, z8 elevation) and central Tallinn (z14 imagery ≈ 5 m/px drawn, z12 elevation)
  const terrainReady = ready.then(() => Promise.all([
    patch({ w: 8, e: 38, s: 53, n: 66 }, 6, 5, 3, 0, 160, 30, 9000, 0.0001),
    patch({ w: 21.6, e: 28.4, s: 57.4, n: 59.85 }, 9, 8, 3, 40, 300, 1, 2600, 0.00025),
    patch({ w: 24.55, e: 24.98, s: 59.36, n: 59.52 }, 14, 12, 3, 140, 256, 0.5, 90, 0.006),
  ]));

  // close-up for any place: a 3D patch built on demand around it (Tallinn's is prebuilt). Keeps at most two.
  const focusCache = new Map<string, Promise<void>>();
  function focusPlace(lon: number, lat: number) {
    const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
    if (Math.abs(lon - 24.76) < 0.15 && Math.abs(lat - 59.44) < 0.06) return Promise.resolve();
    if (!focusCache.has(key)) {
      while (patches.length > 4) { const old = patches.splice(3, 1)[0]; scene.remove(old.mesh); old.mesh.geometry.dispose(); }
      focusCache.set(key, patch({ w: lon - 0.2, e: lon + 0.2, s: lat - 0.08, n: lat + 0.08 }, 14, 12, 3, 140, 200, 0.5, 90, 0.006));
    }
    return focusCache.get(key)!;
  }

  /* story layers */
  const glow: { m: THREE.ShaderMaterial; lo: number; hi: number; base: number }[] = [];
  const layer = new THREE.Group(); scene.add(layer);
  const col = (c: string) => new THREE.Color(c);
  function tangentAt(lon: number, lat: number, h: number) {
    const p = new THREE.Vector3(...toXYZ(lon, lat, h)), nrm = p.clone().normalize();
    return new THREE.Matrix4().lookAt(new THREE.Vector3(), nrm, new THREE.Vector3(0, 1, 0)).setPosition(p);
  }
  const labels: { el: HTMLDivElement; p: THREE.Vector3; lo: number; hi: number; town?: TownNews; pri: number; w: number; h: number }[] = [];
  const hud = document.createElement("div"); hud.className = "earth-hud"; host.appendChild(hud);
  const labelLayer = document.createElement("div"); labelLayer.className = "earth-labels"; hud.appendChild(labelLayer);
  function label(html: string, lon: number, lat: number, h: number, lo: number, hi: number, cls: string, town?: TownNews) {
    const el = document.createElement("div"); el.className = `earth-label ${cls}`; el.innerHTML = html; labelLayer.appendChild(el);
    if (town && o.onTown) { el.style.pointerEvents = "auto"; el.onclick = () => o.onTown!(town); }
    labels.push({ el, p: new THREE.Vector3(...toXYZ(lon, lat, h)), lo, hi, town, pri: labels.length, w: 0, h: 0 });
  }
  const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const esc = (raw: string) => { const s = decode(raw); return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); };
    const cut = (raw: string, n: number) => { const s = decode(raw); return (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s); };

  function setData(d: EarthData) {
    layer.clear(); glow.length = 0; labels.length = 0; labelLayer.innerHTML = "";
    for (const [ri, r] of d.rings.slice(0, 14).entries()) {
      const s = (ringDeg(r.outlets) * Math.PI) / 180 * 2;
      const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: ringFS, uniforms: { uColor: { value: col(ACCENT) }, uT: { value: Math.random() * 3 }, uOp: { value: 1 }, uK: { value: 0 }, uN: { value: Math.min(24, r.outlets) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s, s), m);
      mesh.applyMatrix4(tangentAt(r.lon, r.lat, 0.004));
      layer.add(mesh); glow.push({ m, lo: 700, hi: 1e9, base: 1 });
      if (ri < 5) label(`<b>${esc(r.label)}</b><span>${esc(cut(r.title, 52))}</span><i>${r.outlets} ${r.outlets === 1 ? "outlet" : "outlets"}</i>`, r.lon, r.lat, 0.01, 5000, 1e9, "ring");
    }
    for (const a of d.arcs.slice(0, 8)) {
      const pts = arcPoints(a.from, a.to, 80, 0.22).map((p) => new THREE.Vector3(...p));
      const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: glowFS, uniforms: { uColor: { value: col(ACCENT) }, uT: { value: 0 }, uOp: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      layer.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.0022, 6), m));
      glow.push({ m, lo: 2500, hi: 1e9, base: 1 });
    }
    const max = Math.max(1, ...d.towns.map((t) => t.count));
    for (const t of d.towns.slice(0, 40)) {
      const district = t.kind === "district";
      const hKm = district ? 1.2 + 2.2 * Math.sqrt(t.count / max) : 6 + 40 * Math.sqrt(t.count / max);
      const wKm = district ? 0.14 : 1.6;
      const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: beamFS, uniforms: { uColor: { value: col(ACCENT) }, uOp: { value: 0 }, uT: { value: Math.random() * 6 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const g = new THREE.CylinderGeometry(wKm / EARTH_KM, wKm / EARTH_KM * 0.3, hKm / EARTH_KM, 10, 1, true);
      g.translate(0, hKm / EARTH_KM / 2, 0); g.rotateX(Math.PI / 2); // cylinder along +z, base at the ground
      const beam = new THREE.Mesh(g, m); beam.applyMatrix4(tangentAt(t.lon, t.lat, 0.00003)); layer.add(beam);
      const k = 0.35 + 0.65 * (t.count / max); glow.push(district ? { m, lo: 0.3, hi: 60, base: k } : { m, lo: 25, hi: 3000, base: k });
      const top = t.stories[0];
      if (district) label(`<b>${esc(t.name)}</b><span>${esc(cut(top?.title ?? "", 52))}</span><i>${t.count}</i>`, t.lon, t.lat, (hKm + 0.3) / EARTH_KM, 0.3, 40, "district", t);
      else label(`<b>${esc(t.name)}</b><i>${t.count}</i>`, t.lon, t.lat, (hKm + 2) / EARTH_KM, t.kind === "city" ? 8 : 15, t.kind === "city" ? 2200 : 700, `pin ${t.kind}`, t);
    }
    // source arcs: each outlet of a top town's lead story comes down from the sky into its beam
    for (const t of d.towns.filter((x) => x.kind !== "district").slice(0, 3).concat(d.towns.filter((x) => x.kind === "district").slice(0, 2))) {
      const district = t.kind === "district", top = (district ? 3 : 46) / EARTH_KM, sky = (district ? 9 : 160) / EARTH_KM;
      const srcs = [...new Set(t.stories.map((s) => s.source ?? ""))].slice(0, 5);
      srcs.forEach((_, i) => {
        const ang = (i / Math.max(1, srcs.length)) * Math.PI * 2 + 0.6, spread = district ? 0.06 : 0.9;
        const a = new THREE.Vector3(...toXYZ(t.lon + Math.cos(ang) * spread * 1.8, t.lat + Math.sin(ang) * spread, sky));
        const b = new THREE.Vector3(...toXYZ(t.lon, t.lat, top));
        const mid = a.clone().lerp(b, 0.5).multiplyScalar(1 + sky * 0.15);
        const m = new THREE.ShaderMaterial({ vertexShader: uvVS, fragmentShader: glowFS, uniforms: { uColor: { value: col(ACCENT) }, uT: { value: i * 0.37 }, uOp: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        layer.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 48, (district ? 0.012 : 0.25) / EARTH_KM, 5), m));
        glow.push(district ? { m, lo: 0.3, hi: 40, base: 0.8 } : { m, lo: 30, hi: 900, base: 0.8 });
      });
    }
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
  const credit = document.createElement("div"); credit.className = "earth-credit"; credit.textContent = "Imagery: Sentinel-2 cloudless 2016 by EOX (Copernicus) · NASA Black Marble · AWS Terrain Tiles · GeoNames"; hud.appendChild(credit);
  let cardAt: THREE.Vector3 | null = null;
  const ret = document.createElement("div"); ret.className = "earth-reticle"; ret.innerHTML = "<i></i><i></i><i></i><i></i><b></b>"; hud.appendChild(ret);
  const readout = document.createElement("div"); readout.className = "earth-readout"; hud.appendChild(readout);
  let lastAlt = 0;

  /* camera */
  let pose: Pose = { lon: 18, lat: 38, alt: 16000, tilt: 0, heading: 0 };
  function applyPose(p: Pose) {
    const T = new THREE.Vector3(...toXYZ(p.lon, p.lat)), n = T.clone().normalize();
    const east = new THREE.Vector3(0, 1, 0).cross(n).normalize(), north = n.clone().cross(east);
    const h = (p.heading * Math.PI) / 180, tl = (p.tilt * Math.PI) / 180;
    const fwd = north.clone().multiplyScalar(Math.cos(h)).add(east.clone().multiplyScalar(Math.sin(h)));
    const d = p.alt / EARTH_KM;
    cam.position.copy(T).add(n.clone().multiplyScalar(d * Math.cos(tl))).add(fwd.clone().multiplyScalar(-d * Math.sin(tl)));
    cam.up.copy(fwd.clone().multiplyScalar(Math.cos(tl)).add(n.clone().multiplyScalar(Math.sin(tl))));
    cam.lookAt(T);
    const off = band(p.alt, 3000, 1e9, 1.2) * W() * 0.12; // from orbit, the planet sits right of the lower third
    if (off > 0.5) cam.setViewOffset(W(), H(), -off, 0, W(), H()); else cam.clearViewOffset();
    cam.near = Math.max(1e-7, d * 0.02); cam.far = d + 4; cam.updateProjectionMatrix();
    U.uCam.value.copy(cam.position);
  }

  const v = new THREE.Vector3();
  const names: Record<string, string> = { orbit: "Earth today", country: "Estonia", region: "Estonia, towns and villages", town: "Tallinn" };
  function frame(p: Pose, tMs: number) {
    pose = p; applyPose(p);
    const alt = p.alt, t = tMs / 1000;
    cloudU.uT.value = t; cloudU.uFade.value = band(alt, 900, 1e9, 1.2);
    for (const q of patches) q.u.uOp.value = band(alt, q.lo, q.hi, 0.9);
    dof.uniforms.uAmt.value = 0.3 * band(alt, 0.5, 60, 1.2);
    bloom.strength = 0.45;
    for (const g of glow) { g.m.uniforms.uOp.value = g.base * band(alt, g.lo, g.hi, 0.8); g.m.uniforms.uT.value = t; }
    composer.render();
    const w = W(), h = H();
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const taken: [number, number, number, number][] = [];
    for (const l of labels) {
      const a = band(alt, l.lo, l.hi, 0.6);
      const facing = l.p.dot(cam.position) > l.p.lengthSq() * 0.999999 && l.p.clone().sub(cam.position).dot(fwd) > 0;
      v.copy(l.p).project(cam);
      let on = a > 0.02 && facing && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      if (on) {
        if (!l.w) { l.w = l.el.offsetWidth || 120; l.h = l.el.offsetHeight || 20; }
        const r: [number, number, number, number] = [x - 8, y - 12, x + l.w + 8, y + l.h];
        if (taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) on = false; else taken.push(r);
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
    place.textContent = names[lvl];
    timeline.style.opacity = String(band(alt, 3000, 1e9, 0.8));
    lower.style.opacity = String(band(alt, 3000, 1e9, 0.8));
    nearEl.style.opacity = String(band(alt, 0.5, 30, 0.8));
    const cA = band(alt, 60, 700, 0.6);
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
  el.onwheel = (e) => { e.preventDefault(); path = null; fly = null; pose = { ...pose, alt: Math.max(1.5, Math.min(30000, pose.alt * Math.exp(e.deltaY * 0.0012))), tilt: Math.min(62, Math.max(0, 62 - Math.log2(Math.max(1, pose.alt / 8)) * 6)) }; };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { renderer.setSize(W(), H()); composer.setSize(W(), H()); dof.uniforms.uRes.value.set(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix(); }) : null;
  ro?.observe(host);

  return {
    ready: ready.then(() => terrainReady),
    setData, frame, flyTo, playPath, focusPlace,
    start() { cancelAnimationFrame(raf); t0 = performance.now(); loop(); },
    stop() { cancelAnimationFrame(raf); },
    renderPathAt(p: Shot[], ms: number) { frame(poseAt(p, ms).pose, ms); },
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
.earth-host{position:absolute;inset:0;overflow:hidden;background:#02040a;font-family:var(--font-inter,Inter,system-ui,sans-serif);font-feature-settings:"tnum" 1;color:#eef2f7;--accent:#f2b35e;--ui:#eef2f7;--g:32px}
.earth-hud{position:absolute;inset:0;pointer-events:none}
.earth-labels{position:absolute;inset:0}
.earth-label{position:absolute;left:0;top:0;white-space:nowrap;will-change:transform,opacity;text-shadow:0 1px 3px rgba(0,0,0,.85),0 0 14px rgba(0,0,0,.5)}
.earth-label b{display:block;font-size:13px;font-weight:600;color:var(--ui)}
.earth-label span{display:block;font-size:12px;line-height:1.35;color:rgba(238,242,247,.82);white-space:normal;width:230px}
.earth-label i{font-style:normal;font-size:11px;color:var(--accent)}
.earth-label.ring{margin:-7px 0 0 16px;padding-left:10px;border-left:1px solid var(--accent)}
.earth-label.pin{margin:-8px 0 0 9px;display:flex;gap:6px;align-items:baseline;cursor:pointer}
.earth-label.pin:before{content:"";position:absolute;left:-9px;top:5px;width:5px;height:5px;border-radius:50%;background:var(--accent)}
.earth-label.pin b{font-size:12px;font-weight:500}.earth-label.pin.city b{font-size:14px;font-weight:600}
.earth-label.district{margin:-34px 0 0 10px;padding-left:9px;border-left:1px solid var(--accent);cursor:pointer}
.earth-label.district span{width:210px}
.earth-place{position:absolute;left:var(--g);top:28px;font-size:15px;font-weight:600}
.earth-readout{position:absolute;left:var(--g);top:50px;font:400 11px/1 var(--font-jetbrains,ui-monospace,monospace);color:rgba(238,242,247,.6)}
.earth-timeline{position:absolute;left:var(--g);right:var(--g);bottom:24px;display:grid;grid-template-columns:repeat(7,1fr);gap:16px;border-top:1px solid rgba(238,242,247,.18);padding-top:10px}
.earth-timeline div{min-width:0;font-size:11px;color:rgba(238,242,247,.78)}
.earth-timeline time{display:block;color:var(--accent);margin-bottom:2px}
.earth-timeline span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.earth-lower{position:absolute;left:var(--g);bottom:84px;max-width:620px;text-shadow:0 2px 20px rgba(0,0,0,.7)}
.earth-lower small,.earth-card small{display:block;font-size:12px;color:var(--accent)}
.earth-lower b{display:block;font-family:var(--font-serif,Georgia,serif);font-size:30px;font-weight:400;line-height:1.18;margin-top:6px;letter-spacing:-.01em}
.earth-near{position:absolute;right:var(--g);top:28px;width:272px;padding-top:10px;border-top:1px solid rgba(238,242,247,.35);text-shadow:0 1px 3px rgba(0,0,0,.85)}
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
.earth-credit{position:absolute;right:10px;bottom:4px;font-size:9px;color:rgba(238,242,247,.4)}
`;
