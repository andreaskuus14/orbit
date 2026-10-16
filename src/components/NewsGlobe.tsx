"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useGlRecovery } from "./useGlRecovery";
import { ZoomRig } from "./ZoomRig";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import world from "world-atlas/countries-110m.json";
import { decodeCountries, unwrapRing, type CountryShape } from "@/lib/topo";
import { COUNTRIES as GAZ, displayName, importance, regionOf, REGIONS, type Hotspot } from "@/lib/geo";
import { dedupe } from "@/lib/dashboard";
import CountryDash, { StoryCard, type Result } from "./CountryDash";
import { FOLLOWS_EVENT } from "./follow-command";
import { REFRESH_MS } from "@/lib/follows-pure";

// INTELLIGENCE → World Pulse: a holographic Earth where the news happens.
// Country shapes come from world-atlas; each country in the news gets a cluster of twinkling city-light dots
// placed inside its borders, the busiest are linked by arcs with travelling light, and the selected country
// fades in as a glowing overlay. Data: /api/news/geo (stored articles) and /api/news/search (search + live headlines).

const R = 2;
const TEX_W = 4096, TEX_H = 2048;
const PICK_W = 2048, PICK_H = 1024;
const COUNTRIES: CountryShape[] = decodeCountries(world as never);
const INDEX = new Map(COUNTRIES.map((c, i) => [c.name, i]));
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
const ATLAS_REGION: (string | null)[] = COUNTRIES.map((c, i) => {
  const own = regionOf(c.name);
  const m = own ? null : centroid(i);
  if (own || !m) return own;
  let best: string | null = null, bd = 25 ** 2;
  for (const g of GAZ) {
    const dl = Math.abs(g.lon - m.lon), dx = Math.min(dl, 360 - dl) * Math.cos((m.lat * Math.PI) / 180), dy = g.lat - m.lat;
    if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = regionOf(g.name); }
  }
  return best;
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
  ocean.addColorStop(0, "#040b16"); ocean.addColorStop(0.5, "#071425"); ocean.addColorStop(1, "#040b16");
  g.fillStyle = ocean; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(94,200,255,0.04)"; g.lineWidth = 1.5 * k;
  for (let lon = -180; lon <= 180; lon += 15) { const x = ((lon + 180) / 360) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const y = ((90 - lat) / 180) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const land = g.createLinearGradient(0, H * 0.12, 0, H * 0.88);
  land.addColorStop(0, "#10263d"); land.addColorStop(1, "#0c1d30");
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
    g.strokeStyle = "rgba(94,200,255,0.07)"; g.lineWidth = 5; g.stroke(); // faint glow under the line
    g.strokeStyle = "rgba(94,200,255,0.32)"; g.lineWidth = 1.4; g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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
  fragmentShader: "varying vec3 vN; varying vec3 vV; void main(){ float i = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 3.0); gl_FragColor = vec4(0.31,0.75,1.0,1.0) * i * 0.2; }",
});

const dotMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uFade: { value: 1 } },
  vertexShader: `attribute float aSize; attribute float aPhase; attribute vec3 aColor; attribute float aRegion; uniform float uTime; uniform float uScale;
    uniform float uW[7]; varying vec3 vColor; varying float vTw; varying float vVis;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vColor = aColor;
      vVis = clamp(uW[int(clamp(aRegion, 0.0, 6.0) + 0.5)], 0.0, 1.0);
      vTw = 0.55 + 0.45 * sin(uTime * 2.2 + aPhase);
      gl_PointSize = aSize * uScale * (0.85 + 0.3 * vTw) / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uFade; varying vec3 vColor; varying float vTw; varying float vVis;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); a = a * a;
      gl_FragColor = vec4(vColor * (0.8 + 0.4 * (1.0 - smoothstep(0.0, 0.18, d))), a * (0.4 + 0.3 * vTw) * uFade * vVis); }`,
});

const arcMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color("#5ec8ff") } },
  vertexShader: "attribute float aU; attribute float aOff; varying float vU; varying float vOff; void main(){ vU = aU; vOff = aOff; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uColor; varying float vU; varying float vOff;
    void main(){ float head = fract(uTime * 0.28 + vOff); float d = vU - head;
      float pulse = exp(-d * d * 260.0); float base = 0.07 * sin(3.14159 * vU);
      gl_FragColor = vec4(mix(uColor, vec3(1.0), pulse * 0.25), (base + pulse * 0.4) * uFade); }`,
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
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
    g.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 1));
    g.setIndex(index);
    return g;
  }, [hotspots]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => arcMaterial.clone(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { mat.uniforms.uColor.value = new THREE.Color(mode === "news" ? "#5ec8ff" : "#c084fc"); }, [mat, mode]);
  const born = useRef(0);
  useEffect(() => { born.current = 0; }, [geo]);
  useFrame(({ clock }, dt) => {
    mat.uniforms.uTime.value = reduced ? 0.4 : clock.elapsedTime;
    born.current = Math.min(1, born.current + dt * 0.8);
    mat.uniforms.uFade.value = ease(born.current);
  });
  return <lineSegments geometry={geo} material={mat} />;
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
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - t);
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
      const dir = f.from.clone().normalize().lerp(f.to.clone().normalize(), e).normalize();
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

function Globe({ tint, mode, region, reduced, lit, selected, hover, onPick, onHover, followed }: {
  followed: string[]; tint: Map<string, number>; mode: "news" | "search"; region: string | null; reduced: boolean; lit: string[]; selected: string | null; hover: string | null;
  onPick: (n: string | null) => void; onHover: (n: string | null, x: number, y: number) => void;
}) {
  const texture = useMemo(() => baseTexture(tint, mode), [tint, mode]); // region is NOT an input: switching regions repaints nothing
  useEffect(() => () => texture.dispose(), [texture]);
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
        onClick={(e) => { if (e.delta <= 5) onPick(at(e)); }}
        onPointerMove={(e) => onHover(at(e), e.nativeEvent.clientX, e.nativeEvent.clientY)}
        onPointerOut={(e) => onHover(null, e.nativeEvent.clientX, e.nativeEvent.clientY)}>
        <sphereGeometry args={[R, 128, 128]} />
        <primitive object={material} attach="material" map={texture} />
      </mesh>
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
  useFrame(({ camera, size }) => {
    c.copy(camera.position).normalize();
    for (const h of items) {
      const el = refs.current?.[h.name];
      if (!el) continue;
      v.copy(toVec(h.lat, h.lon, R * 1.02));
      const facing = n.copy(v).normalize().dot(c);
      v.project(camera);
      el.style.opacity = String(Math.max(0, Math.min(1, (facing - 0.2) * 4)));
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width + 10}px, ${((1 - v.y) / 2) * size.height - 9}px)`;
    }
  });
  return null;
}

/* ---------- data + UI ---------- */

type Data = { hours: number; total: number; untagged: number; hotspots: Hotspot[] };
type Search = { q: string; results: Result[]; hotspots: Hotspot[] };
const WINDOWS = [{ h: 24, label: "24h" }, { h: 72, label: "3d" }, { h: 168, label: "7d" }];

/** focus: a country or region from CORE navigation; a new object flies there with the same camera moves as a click.
 *  focus.search runs that search as if typed; "" clears search and selection (the whole world). */
export default function NewsGlobe({ onClose, reduced, focus: goTo }: { onClose: () => void; reduced: boolean; focus?: { country?: string; region?: string; search?: string } | null }) {
  const glr = useGlRecovery();
  const [hours, setHours] = useState(72);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string | null; x: number; y: number }>({ name: null, x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);
  const [liveNews, setLiveNews] = useState<{ name: string; items: Result[] | null; error?: string } | null>(null);
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
      const res = await fetch(`/api/news/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Search failed");
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
      const res = await fetch(`/api/news/geo?hours=${hours}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't load news (${res.status})`);
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
    fetch(`/api/news/search?country=${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Couldn't load headlines"); return j; })
      .then((j) => { if (!gone) setLiveNews({ name: selected, items: j.results ?? [] }); })
      .catch((e) => { if (!gone) setLiveNews({ name: selected, items: [], error: e instanceof Error ? e.message : "Couldn't load headlines" }); });
    return () => { gone = true; };
  }, [selected]);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
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
    return dedupe(all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || time(b) - time(a))).slice(0, 12);
  }, [hs, listed]);
  const [tab, setTab] = useState<"countries" | "stories">("countries");
  const [hotStory, setHotStory] = useState<Result | null>(null);
  const [pinStory, setPinStory] = useState<Result | null>(null);
  const [camTo, setCamTo] = useState<string | null>(null); // sticky, so the camera doesn't swing back between hovers
  useEffect(() => { setHotStory(null); setPinStory(null); setCamTo(null); }, [activeRegion, tab, mode]);
  const story = !search && !selected && tab === "stories" ? hotStory ?? pinStory : null;
  const lit = useMemo(() => story?.countries ?? [], [story]);
  useEffect(() => { if (lit[0]) setCamTo(lit[0]); }, [lit]);
  const storyAt = (e: React.SyntheticEvent<HTMLUListElement>) => {
    const li = (e.target as HTMLElement).closest("li");
    return li ? topStories[Array.from(e.currentTarget.children).indexOf(li)] ?? null : null;
  };

  const focus = useMemo(() => {
    const place = (name: string) => {
      const h = hs.find((x) => x.name === name);
      if (h) return { key: name, lat: h.lat, lon: h.lon };
      const i = INDEX.get(name); // a country without stories: fly to the middle of its shape
      const m = i === undefined ? null : centroid(i);
      return m ? { key: name, ...m } : null;
    };
    if (selected) return place(selected);
    const p = camTo && tab === "stories" ? place(camTo) : null;
    if (p) return { ...p, key: `story:${p.key}` };
    if (activeRegion) return { key: `region:${activeRegion}`, lat: REGIONS[activeRegion].lat, lon: REGIONS[activeRegion].lon };
    return null;
  }, [selected, hs, activeRegion, camTo, tab]);
  const sceneHs = search ? hs : listed; // in region mode only that region's dots, arcs, rings and labels
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
      <Canvas key={glr.key} onCreated={glr.onCreated} camera={{ position: [3.6, 1.8, 6.2], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={["#01040b"]} />
        <Stars radius={70} depth={40} count={reduced ? 1500 : 5000} factor={2.4} fade speed={reduced ? 0 : 0.35} />
        <Globe tint={tint} mode={mode} region={activeRegion} reduced={reduced} lit={lit} selected={selected} followed={followed}
          hover={hover.name} onPick={(n) => setSelected((cur) => (n && n !== cur ? n : n ? null : cur))} onHover={onHover} />
        {/* all dots; out-of-region ones fade out in the shader, so a region switch rebuilds nothing */}
        <NewsDots hotspots={hs} mode={mode} reduced={reduced} />
        <Arcs hotspots={sceneHs} mode={mode} reduced={reduced} />
        {(lit.length ? top : sceneHs.slice(0, 6)).map((h) => <Ring key={`${mode}-${h.name}`} h={h} k={Math.sqrt(h.count / (sceneHs[0]?.count || 1))} color={colorFor(h.name, mode)} reduced={reduced} />)}
        <OrbitControls makeDefault enablePan={false} minDistance={3.2} maxDistance={12} enableDamping dampingFactor={0.06} rotateSpeed={0.45} zoomSpeed={0.6} autoRotateSpeed={0.3} />
        <Rig focus={focus} reduced={reduced} offsetX={selected ? -40 : 110} />
        <ZoomRig home={7.6} reduced={reduced} />
        <Dial reduced={reduced} />
        <Labels items={top} refs={labels} />
        <EffectComposer multisampling={4}>
          <Bloom intensity={reduced ? 0.3 : 0.45} luminanceThreshold={0.75} luminanceSmoothing={0.3} mipmapBlur />
          <Vignette offset={0.25} darkness={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
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
                <ul className="mt-2 space-y-2 globe-stories"
                  onMouseOver={(e) => setHotStory(storyAt(e))} onFocus={(e) => setHotStory(storyAt(e))}
                  onMouseLeave={() => setHotStory(null)} onBlur={() => setHotStory(null)}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button")) return; // article link / country tag keep their own job
                    const s = storyAt(e);
                    setPinStory((p) => (s && p?.url !== s.url ? s : null));
                  }}>
                  {topStories.map((s) => <StoryCard key={s.url} s={s} onCountry={setSelected} />)}
                </ul>
                {!topStories.length && <p className="mt-3 text-sm">No stories here yet.</p>}
              </>
            )}
            {data && data.untagged > 0 && <p className="muted mt-2 text-xs">{data.untagged} stories don&apos;t name a country. Click any country for its live headlines.</p>}
          </>
        )}
        {err && <p className="error mt-2">{err}</p>}
      </section>}

      {selected && (
        <CountryDash key={selected} name={selected} id={COUNTRIES[INDEX.get(selected) ?? -1]?.id ?? ""} stories={selectedStories}
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
