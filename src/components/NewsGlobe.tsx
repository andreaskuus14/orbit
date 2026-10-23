"use client";
import { WarmCompile } from "./WarmCompile";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useGlRecovery } from "./useGlRecovery";
import { worldQuality, type QualityMode } from "@/lib/quality-pure";
import { FrameMark } from "./dev-timing";
import { ZoomRig } from "./ZoomRig";
import { OrbitControls, PerformanceMonitor, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import world from "world-atlas/countries-110m.json";
import { decodeCountries, unwrapRing, type CountryShape } from "@/lib/topo";
import { COUNTRIES as GAZ, displayName, importance, regionOf, REGIONS, type Hotspot } from "@/lib/geo";
import { dedupe } from "@/lib/dashboard";
import CountryDash, { ErrorNote, getJson, safeHref, StoryCard, type Result } from "./CountryDash";
import { countryByName, findCountry, WORLD } from "@/lib/countries-pure";
import { capShare } from "@/lib/local-news-pure";
import { FOLLOWS_EVENT } from "./follow-command";
import { REFRESH_MS } from "@/lib/follows-pure";
import { useAlienEnv } from "./alien/env";

// INTELLIGENCE → World Pulse: a holographic Earth where the news happens.
// Country shapes come from world-atlas; each country in the news gets a cluster of twinkling city-light dots
// placed inside its borders, the busiest are linked by arcs with travelling light, and the selected country
// fades in as a glowing overlay. Data: /api/news/geo (stored articles) and /api/news/search (search + live headlines).

const R = 2;
const TEX_W = 4096, TEX_H = 2048;
const PICK_W = 2048, PICK_H = 1024;
const COUNTRIES: CountryShape[] = decodeCountries(world as never);
const INDEX = new Map(COUNTRIES.map((c, i) => [c.name, i]));
// Countries the 110m atlas has no shape for (Malta, Singapore, island states): a clickable marker instead.
const MARKERS = (WORLD.filter((c) => !INDEX.has(c.name) && c.lat !== undefined) as { name: string; lat: number; lon: number }[])
  .map((m) => ({ ...m, pos: toVec(m.lat, m.lon, R * 1.004) }));
// Every selectable country (atlas shapes + the rest), for the picker.
const PICKABLE = [...new Set([...COUNTRIES.map((c) => c.name).filter((n) => n && n !== "Antarctica"), ...WORLD.map((c) => c.name)])]
  .sort((a, b) => displayName(a).localeCompare(displayName(b)));
const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Lat/lon → point on the sphere, matching three.js SphereGeometry's equirectangular UVs. */
function toVec(lat: number, lon: number, r = R) {
  const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

function tracePaths(g: CanvasRenderingContext2D, c: CountryShape, w: number, h: number) {
  g.beginPath();
  for (const raw of c.rings) {
    const ring = unwrapRing(raw);
    for (const off of [-360, 0, 360]) { // shapes crossing the date line wrap around the seam
      ring.forEach(([lon, lat], i) => {
        const x = ((lon + off + 180) / 360) * w, y = ((90 - lat) / 180) * h;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.closePath();
    }
  }
}

/* ---------- static maps, built once per page ---------- */

const check = (n: number) => (n * 167 + 89) & 255;
let pickCache: Uint8ClampedArray | null = null;
/** Index map: each country filled with its own colour (index + 1); used for clicks, hover and dot placement. */
function pickMap() {
  if (pickCache) return pickCache;
  const c = document.createElement("canvas");
  c.width = PICK_W; c.height = PICK_H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  COUNTRIES.forEach((country, i) => {
    const n = i + 1;
    g.fillStyle = `rgb(${n & 255},${(n >> 8) & 255},${check(n)})`; // blue = non-linear check value
    tracePaths(g, country, PICK_W, PICK_H);
    g.fill("evenodd");
  });
  return (pickCache = g.getImageData(0, 0, PICK_W, PICK_H).data);
}
function countryAt(lat: number, lon: number): number {
  const pick = pickMap();
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180; // wrap across the date line
  const x = Math.min(PICK_W - 1, Math.max(0, Math.floor(((wrapped + 180) / 360) * PICK_W)));
  const y = Math.min(PICK_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * PICK_H)));
  const i = (y * PICK_W + x) * 4;
  // Anti-aliased edges (coastlines, and shared borders that blend two ids) fail the alpha or check-byte test: "none".
  if (pick[i + 3] !== 255) return -1;
  const id = pick[i] + (pick[i + 1] << 8);
  // A blend of two ids almost never also blends into the right check byte, so mixed border pixels read as "none".
  if (pick[i + 2] !== check(id)) return -1;
  return id >= 1 && id <= COUNTRIES.length ? id - 1 : -1;
}
const BBOX = COUNTRIES.map((c) => {
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  for (const ring of c.rings) for (const [lon, lat] of ring) { x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }
  return { w: Math.min(60, x1 - x0), h: y1 - y0 };
});
/** Rough middle of a country's shape (lon wrapped to ±180). */
function centroid(i: number) {
  let sx = 0, sy = 0, n = 0;
  for (const ring of COUNTRIES[i].rings) for (const [lon, lat] of unwrapRing(ring)) { sx += lon; sy += lat; n++; }
  return n ? { lat: sy / n, lon: ((((sx / n) + 180) % 360) + 360) % 360 - 180 } : null;
}
// Every atlas country gets the region of its nearest gazetteer country (so Slovakia counts as Europe); far away → none.
function nearestRegion(m: { lat: number; lon: number }) {
  let best: string | null = null, bd = 25 ** 2;
  for (const g of GAZ) {
    const dl = Math.abs(g.lon - m.lon), dx = Math.min(dl, 360 - dl) * Math.cos((m.lat * Math.PI) / 180), dy = g.lat - m.lat;
    if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = regionOf(g.name); }
  }
  return best;
}
const ATLAS_REGION: (string | null)[] = COUNTRIES.map((c, i) => {
  const own = regionOf(c.name);
  const m = own ? null : centroid(i);
  return own || !m ? own : nearestRegion(m);
});
const REGION_KEYS = Object.keys(REGIONS); // region id = index + 1 in masks and shaders; 0 = no region
const regionId = (name: string) => { const r = regionOf(name); return r ? REGION_KEYS.indexOf(r) + 1 : 0; };
/** Visibility per region id (0 = none, 1..6), eased toward the chosen region each frame; shared by the globe and dot shaders. */
const fade = { uW: { value: [1, 1, 1, 1, 1, 1, 1] } };

/** Region colours for hotspots (search results use violet). */
const REGION_COLOR: Record<string, string> = {
  Americas: "#fbbf24", Europe: "#4ade80", "Middle East": "#f87171", Africa: "#facc15", Asia: "#fb923c", Oceania: "#22d3ee",
};
const colorFor = (name: string, mode: "news" | "search") => (mode === "search" ? "#c084fc" : REGION_COLOR[regionOf(name) ?? ""] ?? "#fb923c");

/** Calm night map: navy ocean, slate land barely lighter, thin cyan borders; only news countries get a soft tint.
 *  `dim` paints the "outside the region" look (darker, untinted, almost borderless) at half size; the shader blends the two. */
function baseTexture(tint: Map<string, number>, mode: "news" | "search", dim = false) {
  const W = dim ? TEX_W / 2 : TEX_W, H = dim ? TEX_H / 2 : TEX_H, k = W / TEX_W;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const ocean = g.createLinearGradient(0, 0, 0, H);
  ocean.addColorStop(0, "#01040a"); ocean.addColorStop(0.5, "#020812"); ocean.addColorStop(1, "#01040a");
  g.fillStyle = ocean; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(94,200,255,0.07)"; g.lineWidth = 1.5 * k;
  for (let lon = -180; lon <= 180; lon += 15) { const x = ((lon + 180) / 360) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const y = ((90 - lat) / 180) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const land = g.createLinearGradient(0, H * 0.12, 0, H * 0.88);
  land.addColorStop(0, "#06192a"); land.addColorStop(1, "#041322");
  const max = Math.max(1, ...tint.values());
  for (const country of COUNTRIES) {
    tracePaths(g, country, W, H);
    g.fillStyle = dim ? "#07101c" : land; g.fill("evenodd");
    const n = dim ? 0 : tint.get(country.name) ?? 0;
    if (n) { // news countries: a soft wash of their region colour, stronger with more stories
      g.globalAlpha = 0.22 + 0.13 * Math.sqrt(n / max);
      g.fillStyle = colorFor(country.name, mode); g.fill("evenodd");
      g.globalAlpha = 1;
    }
    if (dim) { g.strokeStyle = "rgba(94,200,255,0.08)"; g.lineWidth = 1.2 * k; g.stroke(); continue; }
    g.strokeStyle = "rgba(94,200,255,0.06)"; g.lineWidth = 5; g.stroke(); // faint glow under the line
    g.strokeStyle = "rgba(94,200,255,0.22)"; g.lineWidth = 1.2; g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Painting the 4096×2048 map is the slow part of opening the globe: keep the last few, keyed by what is painted,
// so reopening with the same news (and the empty first frame) repaints nothing. Only the newest is ever on screen.
// Two, not more: each is a 32 MB canvas kept for the page's lifetime (a search paints a third and evicts the oldest).
const baseCache = new Map<string, THREE.CanvasTexture>();
function cachedBase(tint: Map<string, number>, mode: "news" | "search") {
  const key = mode + JSON.stringify([...tint]);
  let t = baseCache.get(key);
  if (t) baseCache.delete(key); else t = baseTexture(tint, mode);
  baseCache.set(key, t); // most recently used last
  for (const [k, old] of baseCache) { if (baseCache.size <= 2) break; old.dispose(); baseCache.delete(k); }
  return t;
}

let regionCache: { dim: THREE.CanvasTexture; a: THREE.CanvasTexture; b: THREE.CanvasTexture } | null = null;
/** Painted once per page: the dimmed globe, plus two masks whose RGB channels hold region ids 1-3 and 4-6 (coverage 0..1). */
function regionMaps() {
  if (regionCache) return regionCache;
  const [a, b] = [0, 1].map(() => {
    const c = document.createElement("canvas");
    c.width = PICK_W; c.height = PICK_H;
    const g = c.getContext("2d")!;
    g.fillStyle = "#000"; g.fillRect(0, 0, PICK_W, PICK_H); // opaque, so anti-aliased edges blend to partial coverage
    return { c, g };
  });
  COUNTRIES.forEach((country, i) => {
    const r = ATLAS_REGION[i], id = r ? REGION_KEYS.indexOf(r) : -1;
    if (id < 0) return;
    const { g } = id < 3 ? a : b, ch = id % 3;
    g.fillStyle = `rgb(${ch === 0 ? 255 : 0},${ch === 1 ? 255 : 0},${ch === 2 ? 255 : 0})`;
    tracePaths(g, country, PICK_W, PICK_H);
    g.fill("evenodd");
  });
  const mask = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c); // raw data: no colour space, no mipmaps
    t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    return t;
  };
  return (regionCache = { dim: baseTexture(new Map(), "news", true), a: mask(a.c), b: mask(b.c) });
}

/** The globe's material: the base map blended per pixel toward the dimmed map by region visibility (no repaint on region change). */
function globeMaterial() {
  const u = { uDimMap: { value: null as THREE.Texture | null }, uMaskA: { value: null as THREE.Texture | null }, uMaskB: { value: null as THREE.Texture | null } };
  const m = new THREE.MeshBasicMaterial();
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, fade);
    s.fragmentShader = "uniform sampler2D uDimMap; uniform sampler2D uMaskA; uniform sampler2D uMaskB; uniform float uW[7];\n" +
      s.fragmentShader.replace("#include <map_fragment>", `#ifdef USE_MAP
        vec4 rgLit = texture2D(map, vMapUv);
        vec3 rgA = texture2D(uMaskA, vMapUv).rgb, rgB = texture2D(uMaskB, vMapUv).rgb;
        float rgLand = clamp(rgA.r + rgA.g + rgA.b + rgB.r + rgB.g + rgB.b, 0.0, 1.0);
        float rgVis = clamp(dot(rgA, vec3(uW[1], uW[2], uW[3])) + dot(rgB, vec3(uW[4], uW[5], uW[6])) + (1.0 - rgLand) * uW[0], 0.0, 1.0);
        // skip the dim lookup while it isn't needed (also before the dim map exists)
        vec4 rgC = rgVis > 0.999 ? rgLit : mix(texture2D(uDimMap, vMapUv), rgLit, rgVis);
        diffuseColor *= max(rgC, vec4(0.0));
      #endif`);
  };
  m.customProgramCacheKey = () => "orbit-globe-region";
  return { m, u };
}

const overlayCache = new Map<string, THREE.CanvasTexture>();
const overlayInUse = new Set<THREE.Texture>();
/** A transparent texture with just these countries ("A|B" = several), glowing softly; faded in over the base globe. Small LRU cache. */
function overlayTexture(name: string, color: string) {
  const key = `${name}|${color}`;
  const hit = overlayCache.get(key);
  if (hit) { overlayCache.delete(key); overlayCache.set(key, hit); return hit; } // most recently used last
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  for (const n of name.split("|")) {
    const i = INDEX.get(n);
    if (i === undefined) continue;
    tracePaths(g, COUNTRIES[i], 1024, 512);
    g.shadowColor = color; g.shadowBlur = 6;
    g.fillStyle = color.replace("1)", "0.3)"); g.fill("evenodd");
    g.shadowBlur = 0; g.lineWidth = 1.6; g.strokeStyle = "rgba(160,236,255,0.95)"; g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (const [k, t] of overlayCache) {
    if (overlayCache.size < 8) break;
    if (overlayInUse.has(t)) continue;
    t.dispose(); overlayCache.delete(k);
  }
  overlayCache.set(key, tex);
  return tex;
}

let landCache: THREE.BufferGeometry | null = null;
/** The holographic Earth: a Fibonacci lattice on the sphere, kept where it lands inside a country (borders fall out as gaps).
 *  Built once per page from the pick map; never disposed (shared by every mount, re-uploaded after a context loss). */
function landGeometry() {
  if (landCache) return landCache;
  const N = 120_000, pos: number[] = [], reg: number[] = [], seed: number[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, lat = (Math.asin(y) * 180) / Math.PI, lon = ((i * 137.50776405) % 360) - 180;
    const c = countryAt(lat, lon);
    if (c < 0) continue;
    const v = toVec(lat, lon, R * 1.004), r = ATLAS_REGION[c];
    pos.push(v.x, v.y, v.z); reg.push(r ? REGION_KEYS.indexOf(r) + 1 : 0); seed.push(Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aRegion", new THREE.Float32BufferAttribute(reg, 1));
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  return (landCache = g);
}

/** Paints the static maps in idle time before the globe is first opened, one per idle slot (each is a long task). */
export function warmGlobe() {
  const idle = (f: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 20000 }) : setTimeout(f, 3000));
  const steps = [() => cachedBase(new Map(), "news"), pickMap, landGeometry, regionMaps];
  const next = () => { const f = steps.shift(); if (f) idle(() => { f(); next(); }); };
  next();
}

/* ---------- shaders ---------- */

const fresnelVS = "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }";
const atmosphere = new THREE.ShaderMaterial({
  transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: fresnelVS,
  fragmentShader: "varying vec3 vN; varying vec3 vV; void main(){ float i = pow(clamp(-dot(vN, vV) * 1.9, 0.0, 1.0), 2.2); vec3 c = mix(vec3(0.35,0.4,0.9), vec3(0.2,0.55,0.95), i); gl_FragColor = vec4(c, 1.0) * i * 0.2; }",
});
const rim = new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: fresnelVS,
  fragmentShader: "varying vec3 vN; varying vec3 vV; void main(){ float i = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 3.0); gl_FragColor = vec4(0.31,0.85,1.0,1.0) * i * 0.45; }",
});

const dotMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uFade: { value: 1 } },
  vertexShader: `attribute float aSize; attribute float aPhase; attribute vec3 aColor; attribute float aRegion; uniform float uTime; uniform float uScale;
    uniform float uW[7]; varying vec3 vColor; varying float vTw; varying float vVis;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vColor = aColor;
      vVis = clamp(uW[int(clamp(aRegion, 0.0, 6.0) + 0.5)], 0.0, 1.0);
      vTw = 0.7 + 0.3 * sin(uTime * 0.9 + aPhase);
      float px = aSize * uScale * (0.92 + 0.16 * vTw) / max(-mv.z, 0.1), k = clamp(px / 2.0, 0.0, 1.0);
      vVis *= k * k; // coverage fade instead of sub-pixel flicker
      gl_PointSize = max(px, 2.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uFade; varying vec3 vColor; varying float vTw; varying float vVis;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); a = a * a;
      gl_FragColor = vec4(vColor * (0.75 + 0.25 * (1.0 - smoothstep(0.0, 0.18, d))), clamp(a * (0.35 + 0.2 * vTw) * uFade * vVis, 0.0, 1.0)); }`,
});

// Data arcs: cyan at the source warming to amber at the far end, a bright head with a comet tail; sparks ride the heads.
const ARC_HEAD = "float arcPulse(float u, float off){ float d = fract(uTime * 0.28 + off) - u; return d >= 0.0 ? exp(-d * 22.0) : exp(-d * d * 2600.0); }";
const arcMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color("#5ec8ff") }, uColor2: { value: new THREE.Color("#ffb347") }, uScale: { value: 1 } },
  vertexShader: "attribute float aU; attribute float aOff; varying float vU; varying float vOff; void main(){ vU = aU; vOff = aOff; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uColor; uniform vec3 uColor2; varying float vU; varying float vOff; ${ARC_HEAD}
    void main(){ float pulse = arcPulse(vU, vOff); float base = 0.16 * sin(3.14159 * vU) + 0.04;
      gl_FragColor = vec4(mix(mix(uColor, uColor2, vU), vec3(0.9, 0.94, 1.0), pulse * 0.35), clamp((base + pulse * 0.55) * uFade, 0.0, 0.8)); }`,
});
const arcSparkMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: arcMaterial.uniforms,
  vertexShader: `attribute float aU; attribute float aOff; uniform float uTime; uniform float uScale; varying float vP; varying float vU; ${ARC_HEAD}
    void main(){ vU = aU; vP = arcPulse(aU, aOff); vec4 mv = modelViewMatrix * vec4(position,1.0);
      float px = min(uScale * vP / max(-mv.z, 0.1), 14.0), k = clamp(px / 2.0, 0.0, 1.0); // grows and fades with the head: no pop at a threshold
      vP *= k * k; gl_PointSize = max(px, 2.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uFade; uniform vec3 uColor; uniform vec3 uColor2; varying float vP; varying float vU;
    void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(1.0 - dot(d, d) * 4.0, 0.0);
      gl_FragColor = vec4(min(mix(mix(uColor, uColor2, vU), vec3(0.9, 0.94, 1.0), 0.6) * 1.1, vec3(1.2)), clamp(a * a * vP * uFade, 0.0, 1.0)); }`,
});

/** Holographic land: cyan particles with amber city flecks, a slow scan band sweeping pole to pole; out-of-region land dims. */
const landMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uScale: { value: 14 }, uW: fade.uW },
  vertexShader: `attribute float aRegion; attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uW[7]; varying vec3 vC; varying float vA;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float vis = clamp(uW[int(clamp(aRegion, 0.0, 6.0) + 0.5)], 0.0, 1.0);
      float scan = exp(-pow((fract(position.y * 0.25 + 0.5 - uTime * 0.04) - 0.5) * 18.0, 2.0));
      float city = step(0.955, aSeed), tw = 0.8 + 0.2 * sin(uTime * (0.4 + aSeed * 0.8) + aSeed * 60.0);
      vC = mix(vec3(0.32, 0.7, 1.0), vec3(1.0, 0.84, 0.62), city); // blue-white land, warm pearl city flecks
      float px = min((1.0 + city * 0.7) * uScale / max(-mv.z, 0.1), 6.0), k = clamp(px / 1.6, 0.0, 1.0); // coverage fade, no sub-pixel flicker
      vA = (0.2 + 0.22 * fract(aSeed * 31.0) + 0.5 * city * tw + 0.3 * scan) * (0.18 + 0.82 * vis) * k * k;
      gl_PointSize = max(px, 1.6); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.1, 0.5, d);
      gl_FragColor = vec4(vC, clamp(a * vA, 0.0, 1.0)); }`,
});

/** Light columns rising from news hotspots: bright at the ground, a pulse climbing up, faded by region. */
const columnMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
  vertexShader: `attribute vec3 aColor; attribute float aPhase; attribute float aRegion; uniform float uW[7]; varying vec3 vC; varying float vY; varying float vPh; varying float vVis;
    void main(){ vC = aColor; vY = position.y; vPh = aPhase; vVis = clamp(uW[int(clamp(aRegion, 0.0, 6.0) + 0.5)], 0.0, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime; uniform float uFade; varying vec3 vC; varying float vY; varying float vPh; varying float vVis;
    void main(){ float y = clamp(vY, 0.0, 1.0), fall = pow(1.0 - y, 1.8);
      float band = exp(-pow((y - fract(uTime * 0.3 + vPh)) * 7.0, 2.0)) * (1.0 - y);
      // both faces of the open tube add up, and columns overlap: keep each one well under white
      float a = clamp((0.32 * fall + 0.38 * band) * uFade * vVis, 0.0, 0.45);
      gl_FragColor = vec4(mix(vC, vec3(0.88, 0.93, 1.0), band * 0.35 + fall * 0.15), a); }`,
});

/* ---------- scene pieces ---------- */

/** City-light dots: for each hotspot, points scattered inside the country (more stories → more, brighter dots). */
function NewsDots({ hotspots, mode, reduced }: { hotspots: Hotspot[]; mode: "news" | "search"; reduced: boolean }) {
  const geo = useMemo(() => {
    const pos: number[] = [], col: number[] = [], size: number[] = [], phase: number[] = [], reg: number[] = [];
    const max = Math.max(1, ...hotspots.map((h) => h.count));
    const warm = new THREE.Color("#ffe2b8");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    for (const h of hotspots) {
      const k = Math.sqrt(h.count / max);
      const idx = INDEX.get(h.name) ?? -1;
      const bb = idx >= 0 ? BBOX[idx] : { w: 4, h: 4 };
      const n = Math.round(5 + 55 * k);
      const base = new THREE.Color(colorFor(h.name, mode)), rid = regionId(h.name);
      const add = (lat: number, lon: number, s: number) => {
        const v = toVec(lat, lon, R * 1.004);
        pos.push(v.x, v.y, v.z);
        const c = base.clone().lerp(warm, 0.25 + rnd() * 0.35); // warm variation, like city lights
        col.push(c.r, c.g, c.b); size.push(s); phase.push(rnd() * 6.28); reg.push(rid);
      };
      add(h.lat, h.lon, 70 + 90 * k); // the brighter centre of the cluster
      for (let placed = 0, tries = 0; placed < n && tries < n * 30; tries++) {
        const lat = h.lat + gauss() * Math.max(0.6, bb.h * 0.22), lon = h.lon + gauss() * Math.max(0.6, bb.w * 0.22);
        if (idx >= 0 && countryAt(lat, lon) !== idx) continue; // stay inside the borders
        add(lat, lon, 18 + rnd() * (26 + 36 * k));
        placed++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    g.setAttribute("aRegion", new THREE.Float32BufferAttribute(reg, 1));
    return g;
  }, [hotspots, mode]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => { const m = dotMaterial.clone(); m.uniforms.uW = fade.uW; return m; }, []); // clone() copies uniforms; re-share the fade
  useEffect(() => () => mat.dispose(), [mat]);
  const born = useRef(0);
  useEffect(() => { born.current = 0; }, [geo]);
  useFrame(({ clock, gl }, dt) => {
    mat.uniforms.uTime.value = reduced ? 0 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 0.9;
    born.current = Math.min(1, born.current + dt * 1.2);
    mat.uniforms.uFade.value = ease(born.current); // new data fades in instead of popping
  });
  return <points geometry={geo} material={mat} />;
}

/** Arcs from the busiest country to the others, with light travelling along them. */
function Arcs({ hotspots, mode, reduced }: { hotspots: Hotspot[]; mode: "news" | "search"; reduced: boolean }) {
  const geo = useMemo(() => {
    const top = hotspots.slice(0, 9);
    const pos: number[] = [], u: number[] = [], off: number[] = [], index: number[] = [];
    const pairs: [Hotspot, Hotspot][] = [];
    for (let i = 1; i < top.length; i++) pairs.push([top[0], top[i]]);
    for (let i = 1; i + 1 < top.length; i += 2) pairs.push([top[i], top[i + 1]]);
    const SEG = 64;
    pairs.forEach(([a, b], p) => {
      const va = toVec(a.lat, a.lon, 1), vb = toVec(b.lat, b.lon, 1);
      const angle = va.angleTo(vb);
      const base = pos.length / 3;
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG;
        const v = va.clone().lerp(vb, t).normalize().multiplyScalar(R * (1.006 + Math.sin(Math.PI * t) * (0.04 + angle * 0.07)));
        pos.push(v.x, v.y, v.z); u.push(t); off.push(p * 0.37);
        if (s) index.push(base + s - 1, base + s);
      }
    });
    const g = new THREE.BufferGeometry(), dots = new THREE.BufferGeometry(); // dots: same vertices, unindexed (each drawn once)
    for (const d of [g, dots]) {
      d.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      d.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
      d.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 1));
    }
    g.setIndex(index);
    return { g, dots };
  }, [hotspots]);
  useEffect(() => () => { geo.g.dispose(); geo.dots.dispose(); }, [geo]);
  const { mat, spark } = useMemo(() => { const m = arcMaterial.clone(), sp = arcSparkMaterial.clone(); sp.uniforms = m.uniforms; return { mat: m, spark: sp }; }, []);
  useEffect(() => () => { mat.dispose(); spark.dispose(); }, [mat, spark]);
  useEffect(() => {
    mat.uniforms.uColor.value.set(mode === "news" ? "#5ec8ff" : "#c084fc");
    mat.uniforms.uColor2.value.set(mode === "news" ? "#ffb347" : "#e9a8ff");
  }, [mat, mode]);
  const born = useRef(0);
  useEffect(() => { born.current = 0; }, [geo]);
  useFrame(({ clock, gl }, dt) => {
    mat.uniforms.uTime.value = reduced ? 0.4 : clock.elapsedTime % 1000;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 60;
    born.current = Math.min(1, born.current + dt * 0.8);
    mat.uniforms.uFade.value = ease(born.current);
  });
  return <>
    <lineSegments geometry={geo.g} material={mat} />
    {!reduced && <points geometry={geo.dots} material={spark} />}
  </>;
}

/** The land particles (shared geometry, see landGeometry). */
function Land({ reduced }: { reduced: boolean }) {
  const geo = useMemo(landGeometry, []);
  useFrame(({ clock, gl }) => {
    landMaterial.uniforms.uTime.value = reduced ? 2 : clock.elapsedTime % 1000;
    landMaterial.uniforms.uScale.value = gl.getPixelRatio() * 10;
  });
  return <points geometry={geo} material={landMaterial} raycast={() => null} />;
}

const columnBase = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
/** One instanced draw for every hotspot's light column; height and width grow with the story count. */
function Columns({ hotspots, mode, reduced }: { hotspots: Hotspot[]; mode: "news" | "search"; reduced: boolean }) {
  const mesh = useMemo(() => {
    const top = hotspots.slice(0, 40), n = Math.max(top.length, 1), max = Math.max(1, ...top.map((h) => h.count));
    const geo = columnBase.clone(), col = new Float32Array(n * 3), ph = new Float32Array(n), reg = new Float32Array(n);
    const mat = columnMaterial.clone(); mat.uniforms.uW = fade.uW; // clone() copies uniforms; re-share the fade
    const m = new THREE.InstancedMesh(geo, mat, n), o = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), tint = new THREE.Color("#cfe3ff");
    top.forEach((h, i) => {
      const k = Math.sqrt(h.count / max), p = toVec(h.lat, h.lon, R * 1.003), w = 0.012 + 0.018 * k;
      o.position.copy(p); o.quaternion.setFromUnitVectors(up, p.clone().normalize()); o.scale.set(w, 0.25 + 0.8 * k, w);
      o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      c.set(colorFor(h.name, mode)).lerp(tint, 0.6); col.set([c.r, c.g, c.b], i * 3);
      ph[i] = Math.abs(h.lat * 7 + h.lon) % 1; reg[i] = regionId(h.name);
    });
    m.count = top.length;
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(col, 3));
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(ph, 1));
    geo.setAttribute("aRegion", new THREE.InstancedBufferAttribute(reg, 1));
    m.raycast = () => {}; // never steals globe clicks
    m.frustumCulled = false;
    return m;
  }, [hotspots, mode]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); }, [mesh]);
  const born = useRef(0);
  useEffect(() => { born.current = 0; }, [mesh]);
  useFrame(({ clock }, dt) => {
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = reduced ? 0.3 : clock.elapsedTime % 1000;
    born.current = Math.min(1, born.current + dt);
    u.uFade.value = ease(born.current);
  });
  return <primitive object={mesh} />;
}

/** Obsidian blades orbiting the globe on their own axes (alien palette + reflection map); hidden when the camera dives in. */
const BLADES = [
  { r: 1.4, h: 0.009, tilt: [1.45, 0, 0.18], spin: 0.08 },
  { r: 1.52, h: 0.013, tilt: [1.2, 0.35, -0.25], spin: -0.05 },
  { r: 1.64, h: 0.01, tilt: [1.62, -0.2, 0.4], spin: 0.035 },
] as const;
function ObsidianRings({ reduced }: { reduced: boolean }) {
  const env = useAlienEnv();
  const group = useRef<THREE.Group>(null);
  const spin = useRef<(THREE.Mesh | null)[]>([]);
  const geos = useMemo(() => BLADES.map((b) => new THREE.TorusGeometry(R * b.r, b.h, 4, 200)), []);
  const mat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#030305", metalness: 0.9, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.04,
    iridescence: 0.35, iridescenceThicknessRange: [180, 520], flatShading: true, emissive: "#0a3346", emissiveIntensity: 0.2, envMapIntensity: 0.55 }), []);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => { geos.forEach((g) => g.dispose()); mat.dispose(); }, [geos, mat]);
  useFrame(({ camera }, dt) => {
    if (group.current) group.current.visible = camera.position.length() > 5.6;
    if (reduced) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    if (group.current) group.current.rotation.y += step * 0.02;
    for (let i = 0; i < BLADES.length; i++) { const m = spin.current[i]; if (m) m.rotation.z += step * BLADES[i].spin; }
  });
  return (
    <group ref={group}>
      {BLADES.map((b, i) => (
        <group key={i} rotation={b.tilt as unknown as [number, number, number]}>
          <mesh ref={(el) => { spin.current[i] = el; }} geometry={geos[i]} material={mat} scale={[1, 1, 3]} raycast={() => null} />
        </group>
      ))}
    </group>
  );
}

/** Thin latitude/longitude lines on a glass shell just above the surface. */
function Graticule() {
  const geo = useMemo(() => {
    const pos: number[] = [], r = R * 1.03, S = 128;
    for (let lat = -75; lat <= 75; lat += 15) for (let i = 0; i < S; i++) {
      const a = toVec(lat, (i / S) * 360 - 180, r), b = toVec(lat, ((i + 1) / S) * 360 - 180, r);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let lon = -180; lon < 180; lon += 30) for (let i = 0; i < S / 2; i++) {
      const a = toVec(-90 + (i / (S / 2)) * 180, lon, r), b = toVec(-90 + ((i + 1) / (S / 2)) * 180, lon, r);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return <lineSegments geometry={geo} raycast={() => null}><lineBasicMaterial color="#5fd8ff" transparent opacity={0.07} blending={THREE.AdditiveBlending} depthWrite={false} /></lineSegments>;
}

/** Pulsing rings on the busiest hotspots. */
function Ring({ h, k, color, reduced }: { h: Hotspot; k: number; color: string; reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const { pos, q } = useMemo(() => {
    const p = toVec(h.lat, h.lon, R * 1.005);
    return { pos: p, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize()) };
  }, [h.lat, h.lon]);
  const phase = useMemo(() => Math.abs(h.lat * 7 + h.lon) % 1, [h.lat, h.lon]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = reduced ? 0.45 : (clock.elapsedTime * 0.45 + phase) % 1;
    ref.current.scale.setScalar(0.04 + (0.14 + 0.18 * k) * ease(t));
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - t) * Math.min(1, t * 8); // fades in at the start of each wave: no pop
  });
  return (
    <mesh ref={ref} position={pos} quaternion={q}>
      <ringGeometry args={[0.82, 1, 64]} />
      <meshBasicMaterial color={color} transparent side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

/** A country overlay that cross-fades when the country changes. */
function Overlay({ name, color, max }: { name: string | null; color: string; max: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useEffect(() => () => { if (mat.map) overlayInUse.delete(mat.map); mat.dispose(); }, [mat]);
  const shown = useRef<string | null>(null);
  useFrame((_, dt) => {
    // Fade out, swap texture, fade in: no flicker when moving between countries.
    if (shown.current !== name) {
      mat.opacity = Math.max(0, mat.opacity - dt * 6);
      if (mat.opacity === 0) {
        shown.current = name;
        if (mat.map) overlayInUse.delete(mat.map);
        mat.map = name ? overlayTexture(name, color) : null;
        if (mat.map) overlayInUse.add(mat.map);
        mat.needsUpdate = true;
      }
    } else if (name) mat.opacity = Math.min(max, mat.opacity + dt * 2.5);
    if (mesh.current) mesh.current.visible = mat.opacity > 0.001;
  });
  return <mesh ref={mesh} material={mat} renderOrder={2}><sphereGeometry args={[R * 1.0025, 96, 96]} /></mesh>;
}

/** Darkens everything on the globe (land, dots, arcs) while a story is highlighted; the story's countries sit above it. */
function Dimmer({ on }: { on: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#02060d", transparent: true, opacity: 0, depthWrite: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    mat.opacity = THREE.MathUtils.damp(mat.opacity, on ? 0.55 : 0, 6, dt);
    if (mesh.current) mesh.current.visible = mat.opacity > 0.005;
  });
  return <mesh ref={mesh} material={mat} renderOrder={1}><sphereGeometry args={[R * 1.001, 96, 96]} /></mesh>;
}

/** Fly-in on open, smooth flights to a focused place, idle auto-rotation. */
function Rig({ focus, reduced, offsetX }: { focus: { key: string; lat: number; lon: number } | null; reduced: boolean; offsetX: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { autoRotate: boolean; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null>(null);
  const idle = useRef(0);
  const started = useRef(false);
  const scratch = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }), []);

  useEffect(() => {
    if (size.width >= 900) camera.setViewOffset(size.width, size.height, offsetX, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, offsetX]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const to = camera.position.clone().normalize().multiplyScalar(7.6);
    flight.current = { from: to.clone().multiplyScalar(1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.9), to, t: reduced ? 1 : 0, dur: 2.2 };
  }, [camera, reduced]);

  const key = focus?.key ?? null, lat = focus?.lat ?? 0, lon = focus?.lon ?? 0;
  useEffect(() => {
    if (!key) return;
    const dist = Math.max(5, Math.min(7.6, camera.position.length()));
    flight.current = { from: camera.position.clone(), to: toVec(lat, lon, dist).add(new THREE.Vector3(0, 0.35, 0)), t: reduced ? 1 : 0, dur: 1.6 };
  }, [key, lat, lon, camera, reduced]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => { flight.current = null; idle.current = 0; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = ease(f.t);
      // Swing around the globe (direction slerp + distance lerp) instead of cutting through it.
      const dir = scratch.a.copy(f.from).normalize().lerp(scratch.b.copy(f.to).normalize(), e).normalize(); // scratch: no per-frame allocation
      camera.position.copy(dir.multiplyScalar(THREE.MathUtils.lerp(f.from.length(), f.to.length(), e)));
      camera.lookAt(0, 0, 0);
      if (f.t >= 1) flight.current = null;
      idle.current = 0;
    } else idle.current += dt;
    // Resume a slow spin after a few quiet seconds when nothing is focused.
    if (controls) controls.autoRotate = !reduced && !key && idle.current > 4;
    controls?.update();
  });
  return null;
}

/** Countries with news on followed topics: a slow, faint glow that breathes (opacity clamped to 0.06–0.3; steady when reduced). */
function FollowPulse({ names, reduced }: { names: string[]; reduced: boolean }) {
  const key = names.join("|");
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    const tex = key ? overlayTexture(key, "rgba(252,211,77,1)") : null;
    mat.map = tex; mat.needsUpdate = true;
    if (tex) overlayInUse.add(tex);
    return () => { if (tex) overlayInUse.delete(tex); };
  }, [key, mat]);
  useFrame(({ clock }) => { mat.opacity = reduced ? 0.18 : THREE.MathUtils.clamp(0.18 + 0.12 * Math.sin(clock.elapsedTime * 1.6), 0.06, 0.3); });
  return key ? <mesh material={mat} renderOrder={2}><sphereGeometry args={[R * 1.002, 96, 96]} /></mesh> : null;
}

const markerGeo = new THREE.SphereGeometry(0.018, 12, 12);
const markerMat = new THREE.MeshBasicMaterial({ color: "#67e8f9", transparent: true, opacity: 0.85 });
const markerOnMat = new THREE.MeshBasicMaterial({ color: "#a5f3fc", transparent: true, opacity: 0.95 });
let markerRegions: (string | null)[] | null = null; // lazily: nearest gazetteer region, so region mode hides the others

/** Small clickable dots for countries without a shape on the map (shared geometry and materials). */
function Markers({ selected, hover, region, onPick, onHover }: { selected: string | null; hover: string | null; region: string | null; onPick: (n: string) => void; onHover: (n: string | null, x: number, y: number) => void }) {
  const regions = (markerRegions ??= MARKERS.map(nearestRegion));
  return (
    <group>
      {MARKERS.map((m, i) => {
        if (region && regions[i] !== region && m.name !== selected) return null;
        const on = m.name === selected || m.name === hover;
        return (
          <mesh key={m.name} position={m.pos} scale={on ? 1.6 : 1} geometry={markerGeo} material={on ? markerOnMat : markerMat}
            onClick={(e) => { e.stopPropagation(); if (e.delta <= 5) onPick(m.name); }}
            onPointerMove={(e) => { e.stopPropagation(); onHover(m.name, e.nativeEvent.clientX, e.nativeEvent.clientY); }} // stop: the globe behind would reset hover
            onPointerOut={(e) => onHover(null, e.nativeEvent.clientX, e.nativeEvent.clientY)} />
        );
      })}
    </group>
  );
}

function Globe({ tint, mode, region, reduced, lit, selected, hover, onPick, onHover, followed }: {
  followed: string[]; tint: Map<string, number>; mode: "news" | "search"; region: string | null; reduced: boolean; lit: string[]; selected: string | null; hover: string | null;
  onPick: (n: string | null) => void; onHover: (n: string | null, x: number, y: number) => void;
}) {
  const texture = useMemo(() => cachedBase(tint, mode), [tint, mode]); // region is NOT an input: switching regions repaints nothing
  const { m: material, u } = useMemo(globeMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => { if (!region) fade.uW.value.fill(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reopening with no region shouldn't fade in from last time
  // Region maps: painted in idle time after opening, or right away if a region is picked first.
  useEffect(() => {
    const apply = () => { const r = regionMaps(); u.uDimMap.value = r.dim; u.uMaskA.value = r.a; u.uMaskB.value = r.b; };
    if (region) { apply(); return; }
    if (u.uDimMap.value) return;
    const idle = typeof requestIdleCallback === "function";
    const id = idle ? requestIdleCallback(apply, { timeout: 2000 }) : window.setTimeout(apply, 500);
    return () => { if (idle) cancelIdleCallback(id); else clearTimeout(id); };
  }, [region, u]);
  useFrame((_, dt) => { // ~0.5 s cross-fade of region visibility while the camera flies
    const w = fade.uW.value;
    for (let i = 0; i < w.length; i++) {
      const target = region === null || REGION_KEYS[i - 1] === region ? 1 : 0;
      w[i] = reduced ? target : THREE.MathUtils.damp(w[i], target, 8, Math.min(dt, 0.1));
    }
  });
  const at = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (!e.uv) return null;
    const i = countryAt(e.uv.y * 180 - 90, e.uv.x * 360 - 180);
    return i >= 0 ? COUNTRIES[i].name : null;
  };
  return (
    <group>
      <mesh
        onClick={(e) => { e.stopPropagation(); if (e.delta <= 5) onPick(at(e)); }} // stop: far-side markers sit behind the globe
        onPointerMove={(e) => { e.stopPropagation(); onHover(at(e), e.nativeEvent.clientX, e.nativeEvent.clientY); }}
        onPointerOut={(e) => onHover(null, e.nativeEvent.clientX, e.nativeEvent.clientY)}>
        <sphereGeometry args={[R, 128, 128]} />
        <primitive object={material} attach="material" map={texture} />
      </mesh>
      <Land reduced={reduced} />
      <Graticule />
      <Markers selected={selected} hover={hover} region={region} onPick={(n) => onPick(n)} onHover={onHover} />
      <Overlay name={hover && hover !== selected ? hover : null} color="rgba(186,230,253,1)" max={0.45} />
      <Overlay name={selected} color="rgba(103,232,249,1)" max={0.9} />
      <Dimmer on={lit.length > 0} />
      <Overlay name={lit.length ? lit.join("|") : null} color="rgba(125,211,252,1)" max={0.9} />
      <FollowPulse names={lit.length ? [] : followed} reduced={reduced} />
      <mesh material={rim}><sphereGeometry args={[R * 1.003, 96, 96]} /></mesh>
      <mesh material={atmosphere} scale={1.1}><sphereGeometry args={[R, 96, 96]} /></mesh>
    </group>
  );
}

/** A HUD dial around the globe: tick marks and arcs that face the viewer and turn slowly. */
function Dial({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const geo = useMemo(() => {
    const pos: number[] = [];
    const circle = (r: number, a0 = 0, a1 = Math.PI * 2, seg = 256) => {
      for (let i = 0; i < seg; i++) {
        const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
        pos.push(Math.cos(t0) * r, Math.sin(t0) * r, 0, Math.cos(t1) * r, Math.sin(t1) * r, 0);
      }
    };
    circle(R * 1.32);
    for (let d = 0; d < 360; d += 3) { // ticks; longer every 30°
      const a = (d * Math.PI) / 180, l = d % 30 === 0 ? 0.11 : 0.045, r = R * 1.32;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(a) * (r + l), Math.sin(a) * (r + l), 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const arcs: number[] = [];
    for (const [a0, a1, r] of [[0.2, 1.3, 1.25], [2.1, 2.9, 1.25], [3.6, 5.2, 1.25], [0.9, 2.4, 1.4], [4.2, 5.6, 1.4]] as const) {
      const seg = 64;
      for (let i = 0; i < seg; i++) {
        const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
        arcs.push(Math.cos(t0) * R * r, Math.sin(t0) * R * r, 0, Math.cos(t1) * R * r, Math.sin(t1) * R * r, 0);
      }
    }
    const ga = new THREE.BufferGeometry();
    ga.setAttribute("position", new THREE.Float32BufferAttribute(arcs, 3));
    return { g, ga };
  }, []);
  useEffect(() => () => { geo.g.dispose(); geo.ga.dispose(); }, [geo]);
  useFrame(({ camera }, dt) => {
    group.current?.quaternion.copy(camera.quaternion);
    if (spin.current && !reduced) spin.current.rotation.z += dt * 0.05;
  });
  return (
    <group ref={group}>
      <lineSegments geometry={geo.g}><lineBasicMaterial color="#67e8f9" transparent opacity={0.16} depthWrite={false} /></lineSegments>
      <group ref={spin}>
        <lineSegments geometry={geo.ga}><lineBasicMaterial color="#a5f3fc" transparent opacity={0.24} depthWrite={false} /></lineSegments>
      </group>
    </group>
  );
}

/** Projects hotspot names onto the screen as HTML labels; fades out those on the far side. */
function Labels({ items, refs }: { items: Hotspot[]; refs: React.RefObject<Record<string, HTMLSpanElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const n = useMemo(() => new THREE.Vector3(), []);
  const c = useMemo(() => new THREE.Vector3(), []);
  const at = useMemo(() => items.map((h) => toVec(h.lat, h.lon, R * 1.02)), [items]); // not per frame
  useFrame(({ camera, size }) => {
    c.copy(camera.position).normalize();
    items.forEach((h, i) => {
      const el = refs.current?.[h.name];
      if (!el) return;
      v.copy(at[i]);
      const facing = n.copy(v).normalize().dot(c);
      v.project(camera);
      el.style.opacity = String(Math.max(0, Math.min(1, (facing - 0.2) * 4)));
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width + 10}px, ${((1 - v.y) / 2) * size.height - 9}px)`;
    });
  });
  return null;
}

/* ---------- data + UI ---------- */

/** The same list while what the globe draws from it is unchanged, so a 5-minute refresh with the same news rebuilds (and re-fades) nothing. */
function useSameShape(list: Hotspot[]) {
  const key = list.map((h) => `${h.name}:${h.count}:${h.lat}:${h.lon}`).join("|");
  return useMemo(() => list, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by content on purpose
}

type Data = { hours: number; total: number; untagged: number; hotspots: Hotspot[] };
type Search = { q: string; results: Result[]; hotspots: Hotspot[] };
const WINDOWS = [{ h: 24, label: "24h" }, { h: 72, label: "3d" }, { h: 168, label: "7d" }];

/** focus: a country or region from CORE navigation; a new object flies there with the same camera moves as a click.
 *  focus.search runs that search as if typed; "" clears search and selection (the whole world). */
export default function NewsGlobe({ onClose, reduced, focus: goTo, quality = "auto", paused = false }: { onClose: () => void; reduced: boolean; focus?: { country?: string; region?: string; search?: string } | null; quality?: QualityMode; paused?: boolean }) {
  const q = worldQuality(quality);
  const glr = useGlRecovery();
  // The globe felt laggy: it always rendered with 4× MSAA at up to 1.75× pixels. On "auto", step down once frames drop.
  const [lean, setLean] = useState(false);
  const dpr = lean ? 1 : q.dpr, msaa = lean ? 0 : q.msaa;
  const [hours, setHours] = useState(72);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string | null; x: number; y: number }>({ name: null, x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);
  const [liveNews, setLiveNews] = useState<{ name: string; items: Result[] | null; local?: Result[]; error?: string } | null>(null);
  const [pick, setPick] = useState("");
  const [region, setRegion] = useState<string | null>(null);
  const [followed, setFollowed] = useState<string[]>([]); // countries in followed-topic news (server refetches at most every 30 min)
  useEffect(() => {
    const get = () => fetch("/api/news/follows", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (Array.isArray(j?.countries)) setFollowed(j.countries.filter((n: string) => INDEX.has(n)).sort()); }).catch(() => {});
    get();
    const t = setInterval(get, REFRESH_MS);
    addEventListener(FOLLOWS_EVENT, get);
    return () => { clearInterval(t); removeEventListener(FOLLOWS_EVENT, get); };
  }, []);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});
  // Only the latest request may update the screen (fast clicks, Clear during a search).
  const loadSeq = useRef(0);
  const searchSeq = useRef(0);
  const find = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    setSearching(true); setErr("");
    try {
      const json = await getJson(`/api/news/search?q=${encodeURIComponent(q)}`, "Search failed");
      if (seq !== searchSeq.current) return;
      setSearch({ q, results: json.results ?? [], hotspots: json.hotspots ?? [] });
      setSelected(null);
    } catch (e2) { if (seq === searchSeq.current) setErr(e2 instanceof Error ? e2.message : "Search failed"); }
    finally { if (seq === searchSeq.current) setSearching(false); }
  }, []);
  useEffect(() => {
    if (!goTo || (!goTo.country && !goTo.region && goTo.search === undefined)) return;
    if (goTo.search) { setQuery(goTo.search); void find(goTo.search); return; }
    searchSeq.current++; setSearching(false); setSearch(null); // region chips only exist outside search
    if (goTo.search === "") setQuery("");
    setRegion(goTo.region ?? (goTo.country ? regionOf(goTo.country) : null));
    setSelected(goTo.country ?? null);
  }, [goTo, find]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const json = await getJson(`/api/news/geo?hours=${hours}`, "Couldn't load news");
      if (seq === loadSeq.current) { setData(json); setErr(""); }
    } catch (e) { if (seq === loadSeq.current) setErr(e instanceof Error ? e.message : "Couldn't load news"); }
  }, [hours]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5 * 60_000);
    addEventListener("orbit:news", load); // a new briefing just finished
    return () => { clearInterval(t); removeEventListener("orbit:news", load); };
  }, [load]);

  // Live top headlines for the selected country (any country, even without stored stories).
  useEffect(() => {
    if (!selected) { setLiveNews(null); return; }
    let gone = false;
    setLiveNews({ name: selected, items: null });
    getJson(`/api/news/search?country=${encodeURIComponent(selected)}`, "Couldn't load headlines") // also returns its local press
      .then((j) => { if (!gone) setLiveNews({ name: selected, items: j.results ?? [], local: j.local ?? [] }); })
      .catch((e) => { if (!gone) setLiveNews({ name: selected, items: [], error: e instanceof Error ? e.message : "Couldn't load headlines" }); });
    return () => { gone = true; };
  }, [selected]);

  function pickCountry(e: React.FormEvent) {
    e.preventDefault();
    const t = pick.trim().toLowerCase();
    const name = PICKABLE.find((n) => n.toLowerCase() === t || displayName(n).toLowerCase() === t) ?? findCountry(t)?.name;
    if (name) { setSelected(name); setPick(""); }
  }

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    // A country's name flies there and opens its page; 2-letter queries stay searches (findCountry reads them as ISO codes).
    const c = q.length > 2 ? findCountry(q, displayName) : null;
    if (c) { searchSeq.current++; setSearching(false); setSearch(null); setQuery(""); setRegion(regionOf(c.name)); setSelected(c.name); return; }
    if (q.length >= 2) void find(q);
  }

  const mode: "news" | "search" = search ? "search" : "news";
  const hs = useMemo(() => (search ? search.hotspots : data?.hotspots ?? []), [search, data]);
  const tint = useMemo(() => new Map(hs.map((h) => [h.name, h.count])), [hs]);
  const stored = hs.find((h) => h.name === selected) ?? null;
  const activeRegion = search ? null : region; // region chips are hidden while searching
  const listed = useMemo(() => (activeRegion ? hs.filter((h) => regionOf(h.name) === activeRegion) : hs), [hs, activeRegion]);

  // "Top stories": the biggest stored stories of the listed countries; each keeps every country it was tagged with.
  const topStories: Result[] = useMemo(() => {
    const tags = new Map<string, string[]>();
    for (const h of hs) for (const s of h.stories) { const a = tags.get(s.url) ?? []; if (!a.includes(h.name)) a.push(h.name); tags.set(s.url, a); }
    const time = (s: Result) => (s.published_at ? Date.parse(s.published_at) || 0 : 0);
    const all = listed.flatMap((h) => h.stories).map((s): Result => ({ ...s, countries: tags.get(s.url) ?? [], live: false, score: importance(s.title) }));
    // No single country may fill more than 30% of the list (feeds are US-heavy); grouped by region below.
    return capShare(dedupe(all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || time(b) - time(a))), (s) => s.countries[0], 18, 0.3);
  }, [hs, listed]);
  const storySections = useMemo(() => {
    const m = new Map<string, Result[]>();
    for (const s of topStories) { const r = regionOf(s.countries[0] ?? "") ?? "World"; m.set(r, [...(m.get(r) ?? []), s]); }
    return [...m.entries()];
  }, [topStories]);
  const [tab, setTab] = useState<"countries" | "stories">("countries");
  const [hotStory, setHotStory] = useState<Result | null>(null);
  const [pinStory, setPinStory] = useState<Result | null>(null);
  const [camTo, setCamTo] = useState<string | null>(null); // sticky, so the camera doesn't swing back between hovers
  useEffect(() => { setHotStory(null); setPinStory(null); setCamTo(null); }, [activeRegion, tab, mode]);
  const story = !search && !selected && tab === "stories" ? hotStory ?? pinStory : null;
  const lit = useMemo(() => story?.countries ?? [], [story]);
  useEffect(() => { if (lit[0]) setCamTo(lit[0]); }, [lit]);
  const storyAt = (e: React.SyntheticEvent<HTMLElement>) => {
    const href = (e.target as HTMLElement).closest("li")?.querySelector("a.link")?.getAttribute("href");
    return href ? topStories.find((s) => safeHref(s.url) === href) ?? null : null;
  };

  const focus = useMemo(() => {
    const place = (name: string) => {
      const h = hs.find((x) => x.name === name);
      if (h) return { key: name, lat: h.lat, lon: h.lon };
      const i = INDEX.get(name); // a country without stories: fly to the middle of its shape, or to its marker
      const m = i === undefined ? MARKERS.find((x) => x.name === name) ?? null : centroid(i);
      return m ? { key: name, lat: m.lat, lon: m.lon } : null;
    };
    if (selected) return place(selected);
    const p = camTo && tab === "stories" ? place(camTo) : null;
    if (p) return { ...p, key: `story:${p.key}` };
    if (activeRegion) return { key: `region:${activeRegion}`, lat: REGIONS[activeRegion].lat, lon: REGIONS[activeRegion].lon };
    return null;
  }, [selected, hs, activeRegion, camTo, tab]);
  const sceneHs = search ? hs : listed; // in region mode only that region's dots, arcs, rings and labels
  const drawHs = useSameShape(hs), drawScene = useSameShape(sceneHs);
  const top = lit.length ? hs.filter((h) => lit.includes(h.name)) : sceneHs.slice(0, 8);
  const regionTotals = useMemo(() => Object.keys(REGIONS).map((r) => ({ r, n: hs.filter((h) => regionOf(h.name) === r).reduce((a, h) => a + h.count, 0) })), [hs]);
  const onHover = useCallback((name: string | null, x: number, y: number) => {
    setHover((h) => (h.name === name && Math.abs(h.x - x) < 2 && Math.abs(h.y - y) < 2 ? h : { name, x, y }));
    document.body.style.cursor = name ? "pointer" : "";
  }, []);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);

  const selectedStories: Result[] = useMemo(() => {
    const own: Result[] = stored ? stored.stories.map((s) => ({ ...s, countries: [stored.name], live: false })) : [];
    const live = liveNews && liveNews.name === selected ? liveNews.items ?? [] : [];
    const seen = new Set(own.map((s) => s.title.toLowerCase()));
    const all = [...own, ...live.filter((s) => !seen.has(s.title.toLowerCase()))];
    return dedupe(all.sort((a, b) => (b.score ?? importance(b.title)) - (a.score ?? importance(a.title)))); // biggest stories first
  }, [stored, liveNews, selected]);

  return (
    <div className="absolute inset-0 globe-in" aria-label="World news globe">
      <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={paused ? "never" : "always"} camera={{ position: [3.6, 1.8, 6.2], fov: 42 }} dpr={[1, dpr]} gl={{ antialias: false, powerPreference: "high-performance" }}>
        {quality === "auto" && <PerformanceMonitor onDecline={() => setLean(true)} />}
        <WarmCompile />
        <color attach="background" args={["#01040b"]} />
        <Stars radius={70} depth={40} count={reduced ? 1500 : 5000} factor={2.4} fade speed={reduced ? 0 : 0.35} />
        <Globe tint={tint} mode={mode} region={activeRegion} reduced={reduced} lit={lit} selected={selected} followed={followed}
          hover={hover.name} onPick={(n) => setSelected((cur) => (n && n !== cur ? n : n ? null : cur))} onHover={onHover} />
        {/* all dots; out-of-region ones fade out in the shader, so a region switch rebuilds nothing */}
        <NewsDots hotspots={drawHs} mode={mode} reduced={reduced} />
        <Arcs hotspots={drawScene} mode={mode} reduced={reduced} />
        <Columns hotspots={drawHs} mode={mode} reduced={reduced} />
        <ObsidianRings reduced={reduced} />
        {(lit.length ? top : sceneHs.slice(0, 6)).map((h) => <Ring key={`${mode}-${h.name}`} h={h} k={Math.sqrt(h.count / (sceneHs[0]?.count || 1))} color={colorFor(h.name, mode)} reduced={reduced} />)}
        <OrbitControls makeDefault enablePan={false} minDistance={3.2} maxDistance={12} enableDamping dampingFactor={0.06} rotateSpeed={0.45} zoomSpeed={0.6} autoRotateSpeed={0.3} />
        <Rig focus={focus} reduced={reduced} offsetX={selected ? -40 : 110} />
        {!paused && <ZoomRig home={7.6} reduced={reduced} />}
        <Dial reduced={reduced} />
        <Labels items={top} refs={labels} />
        <EffectComposer multisampling={msaa}>
          <Bloom intensity={reduced ? 0.25 : 0.35} luminanceThreshold={0.9} luminanceSmoothing={0.3} mipmapBlur />
          <Vignette offset={0.25} darkness={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          {msaa ? <></> : <SMAA />}
        </EffectComposer>
        {process.env.NODE_ENV === "development" && <FrameMark name="intelligence" />}
      </Canvas>

      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {top.map((h) => (
          <span key={`${mode}-${h.name}`} ref={(el) => { labels.current[h.name] = el; }} className="globe-label absolute left-0 top-0" style={{ ["--accent" as string]: colorFor(h.name, mode) }}>
            {displayName(h.name)} <b>{h.count}</b>
          </span>
        ))}
        {hover.name && (
          <span className="globe-tip" style={{ transform: `translate(${hover.x + 14}px, ${hover.y + 12}px)` }}>
            {displayName(hover.name)}{tint.get(hover.name) ? ` · ${tint.get(hover.name)} stories` : ""}
          </span>
        )}
      </div>

      <form onSubmit={runSearch} className="glass globe-search" role="search">
        <input className="field w-full" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={120}
          placeholder="Search world news… e.g. elections, oil prices, AI chips" aria-label="Search world news" />
        <button className="btn shrink-0" disabled={searching || query.trim().length < 2}>{searching ? "Searching…" : "Search"}</button>
        {search && <button type="button" className="chip shrink-0" onClick={() => { searchSeq.current++; setSearching(false); setSearch(null); setQuery(""); setSelected(null); }}>Clear</button>}
      </form>

      {!selected && <section className="glass hud-panel globe-side panel-in" key={mode}>
        {search ? (
          <>
            <div className="hud-title" style={{ color: "#e9d5ff" }}>SEARCH · {search.q.toUpperCase()}</div>
            <p className="muted text-xs">{search.results.length} stories · {search.hotspots.length} countries · your feeds + live Google News</p>
            <ol className="mt-3 space-y-1">
              {search.hotspots.slice(0, 8).map((h) => (
                <li key={h.name}><HotRow h={h} max={search.hotspots[0]?.count || 1} on={h.name === selected} onClick={() => setSelected(h.name === selected ? null : h.name)} accent="#c084fc" /></li>
              ))}
            </ol>
            <ul className="mt-3 space-y-2">
              {dedupe(search.results).slice(0, 20).map((s) => <StoryCard key={s.url} s={s} onCountry={setSelected} />)}
            </ul>
            {!search.results.length && <p className="mt-3 text-sm">Nothing found for “{search.q}”.</p>}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="hud-title">WORLD PULSE</div>
              <div className="flex gap-1">
                {WINDOWS.map((w) => <button key={w.h} className="chip" aria-pressed={hours === w.h} onClick={() => setHours(w.h)}>{w.label}</button>)}
              </div>
            </div>
            <p className="muted text-xs">{data ? `${data.total} stories · ${hs.length} countries${region ? ` · showing ${region}` : ""}` : err ? "" : "Loading…"}</p>
            <form onSubmit={pickCountry} className="mt-2 flex gap-1" role="search" aria-label="Open any country">
              <input className="field w-full" list="globe-countries" value={pick} onChange={(e) => setPick(e.target.value)} maxLength={60}
                placeholder={`Any country… (${PICKABLE.length})`} aria-label="Country name" />
              <button className="chip shrink-0" disabled={!pick.trim()}>Open</button>
              <datalist id="globe-countries">{PICKABLE.map((n) => <option key={n} value={displayName(n)} />)}</datalist>
            </form>
            {data && !hs.length && <p className="mt-3 text-sm">No placed stories yet. Run a <b>World brief</b> in the panel on the right and the globe lights up.</p>}
            {hs.length > 0 && (
              <div className="mt-2 flex gap-1" role="group" aria-label="List view">
                <button className="chip" aria-pressed={tab === "countries"} onClick={() => setTab("countries")}>Countries</button>
                <button className="chip" aria-pressed={tab === "stories"} onClick={() => setTab("stories")}>Top stories</button>
              </div>
            )}
            {tab === "countries" ? (
              <ol className="mt-3 space-y-1">
                {listed.slice(0, 16).map((h) => (
                  <li key={h.name}><HotRow h={h} max={listed[0]?.count || 1} on={h.name === selected} onClick={() => setSelected(h.name === selected ? null : h.name)} accent={colorFor(h.name, "news")} /></li>
                ))}
              </ol>
            ) : (
              <>
                <p className="muted mt-2 text-xs">Hover or click a story to light up the countries it mentions.</p>
                {/* StoryCard renders the <li>; delegate hover/click from the list so it stays untouched. */}
                <div className="mt-2"
                  onMouseOver={(e) => setHotStory(storyAt(e))} onFocus={(e) => setHotStory(storyAt(e))}
                  onMouseLeave={() => setHotStory(null)} onBlur={() => setHotStory(null)}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button")) return; // article link / country tag keep their own job
                    const s = storyAt(e);
                    setPinStory((p) => (s && p?.url !== s.url ? s : null));
                  }}>
                  {storySections.map(([r, list]) => (
                    <div key={r} className="mt-2">
                      {storySections.length > 1 && <div className="dash-label px-1" style={{ color: REGION_COLOR[r] }}>{r.toUpperCase()}</div>}
                      <ul className="mt-1 space-y-2 globe-stories">{list.map((s) => <StoryCard key={s.url} s={s} onCountry={setSelected} />)}</ul>
                    </div>
                  ))}
                </div>
                {!topStories.length && <p className="mt-3 text-sm">No stories here yet.</p>}
              </>
            )}
            {data && data.untagged > 0 && <p className="muted mt-2 text-xs">{data.untagged} stories don&apos;t name a country. Click any country for its live headlines.</p>}
          </>
        )}
        {err && <ErrorNote error={err} />}
      </section>}

      {selected && (
        <CountryDash key={selected} name={selected} id={countryByName(selected)?.id ?? COUNTRIES[INDEX.get(selected) ?? -1]?.id ?? ""} stories={selectedStories}
          local={liveNews?.name === selected ? liveNews.local : undefined}
          loading={liveNews?.name === selected && !liveNews.items} error={liveNews?.error}
          rank={stored ? { pos: hs.indexOf(stored) + 1, of: hs.length, count: stored.count } : null}
          onCountry={setSelected} onBack={() => setSelected(null)} backLabel={search ? "Results" : "All countries"} />
      )}

      {!search && (
        <nav className="globe-regions glass" aria-label="World regions">
          <button className={`region${!region ? " on" : ""}`} onClick={() => { setRegion(null); setSelected(null); }}>World</button>
          {regionTotals.map(({ r, n }) => (
            <button key={r} className={`region${region === r ? " on" : ""}`} style={{ ["--accent" as string]: REGION_COLOR[r] }}
              onClick={() => { setSelected(null); setRegion(region === r ? null : r); }}>
              <i />{r}<b>{n}</b>
            </button>
          ))}
        </nav>
      )}

      <button className="chip world-back absolute bottom-24 right-3 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
    </div>
  );
}

function HotRow({ h, max, on, onClick, accent }: { h: Hotspot; max: number; on: boolean; onClick: () => void; accent: string }) {
  return (
    <button className={`hud-row${on ? " on" : ""}`} onClick={onClick} style={{ ["--accent" as string]: accent }}>
      <span className="truncate">{displayName(h.name)}</span>
      <span className="hud-bar"><i style={{ width: `${(h.count / max) * 100}%` }} /></span>
      <span className="num">{h.count}</span>
    </button>
  );
}
