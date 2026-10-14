"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import world from "world-atlas/countries-110m.json";
import { decodeCountries, unwrapRing, type CountryShape } from "@/lib/topo";
import { displayName, type Hotspot, type Story } from "@/lib/geo";

// INTELLIGENCE → World Pulse: a holographic Earth where the news happens.
// Country shapes come from world-atlas; each country in the news gets a cluster of twinkling city-light dots
// placed inside its borders, the busiest are linked by arcs with travelling light, and the selected country
// fades in as a glowing overlay. Data: /api/news/geo (stored articles) and /api/news/search (search + live headlines).

const R = 2;
const TEX_W = 4096, TEX_H = 2048;
const PICK_W = 2048, PICK_H = 1024;
const COUNTRIES: CountryShape[] = decodeCountries(world as never);
const INDEX = new Map(COUNTRIES.map((c, i) => [c.name, i]));
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");
const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return "";
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
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

let pickCache: Uint8ClampedArray | null = null;
/** Index map: each country filled with its own colour (index + 1); used for clicks, hover and dot placement. */
function pickMap() {
  if (pickCache) return pickCache;
  const c = document.createElement("canvas");
  c.width = PICK_W; c.height = PICK_H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  COUNTRIES.forEach((country, i) => {
    const n = i + 1;
    g.fillStyle = `rgb(${n & 255},${(n >> 8) & 255},0)`;
    tracePaths(g, country, PICK_W, PICK_H);
    g.fill("evenodd");
  });
  return (pickCache = g.getImageData(0, 0, PICK_W, PICK_H).data);
}
function countryAt(lat: number, lon: number): number {
  const pick = pickMap();
  const x = Math.min(PICK_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * PICK_W)));
  const y = Math.min(PICK_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * PICK_H)));
  const i = (y * PICK_W + x) * 4;
  if (pick[i + 3] !== 255) return -1; // anti-aliased border pixels count as "none"
  const n = pick[i] + (pick[i + 1] << 8) - 1;
  return n >= 0 && n < COUNTRIES.length ? n : -1;
}
const BBOX = COUNTRIES.map((c) => {
  let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
  for (const ring of c.rings) for (const [lon, lat] of ring) { x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }
  return { w: Math.min(60, x1 - x0), h: y1 - y0 };
});

function baseTexture(tint: Map<string, number>, tintColor: string) {
  const c = document.createElement("canvas");
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext("2d")!;
  const ocean = g.createLinearGradient(0, 0, 0, TEX_H);
  ocean.addColorStop(0, "#020a1c"); ocean.addColorStop(0.5, "#06183a"); ocean.addColorStop(1, "#020a1c");
  g.fillStyle = ocean; g.fillRect(0, 0, TEX_W, TEX_H);
  g.strokeStyle = "rgba(56,189,248,0.06)"; g.lineWidth = 2;
  for (let lon = -180; lon <= 180; lon += 15) { const x = ((lon + 180) / 360) * TEX_W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TEX_H); g.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const y = ((90 - lat) / 180) * TEX_H; g.beginPath(); g.moveTo(0, y); g.lineTo(TEX_W, y); g.stroke(); }
  // Dot-matrix continents, sampled from a land mask.
  const m = document.createElement("canvas");
  m.width = 1024; m.height = 512;
  const mg = m.getContext("2d", { willReadFrequently: true })!;
  mg.fillStyle = "#fff";
  for (const country of COUNTRIES) { tracePaths(mg, country, 1024, 512); mg.fill("evenodd"); }
  const mask = mg.getImageData(0, 0, 1024, 512).data;
  const step = 7;
  g.fillStyle = "rgba(96,165,250,0.42)";
  for (let y = step / 2; y < TEX_H; y += step) {
    const lat = 90 - (y / TEX_H) * 180, sx = step / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
    for (let x = (y / step) % 2 ? sx / 2 : 0; x < TEX_W; x += sx) {
      const mi = (Math.floor((y / TEX_H) * 512) * 1024 + Math.floor((x / TEX_W) * 1024)) * 4;
      if (mask[mi] > 128) g.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
    }
  }
  const max = Math.max(1, ...tint.values());
  for (const country of COUNTRIES) {
    const n = tint.get(country.name) ?? 0;
    tracePaths(g, country, TEX_W, TEX_H);
    if (n) { g.fillStyle = tintColor.replace("A", String(0.08 + 0.22 * Math.sqrt(n / max))); g.fill("evenodd"); }
    g.strokeStyle = n ? tintColor.replace("A", "0.55") : "rgba(45,212,191,0.16)";
    g.lineWidth = n ? 2.4 : 1.4;
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const overlayCache = new Map<string, THREE.CanvasTexture>();
/** A transparent texture with just one country, glowing; faded in over the base globe. */
function overlayTexture(name: string, color: string) {
  const key = `${name}|${color}`;
  const hit = overlayCache.get(key);
  if (hit) return hit;
  const i = INDEX.get(name);
  const c = document.createElement("canvas");
  c.width = 2048; c.height = 1024;
  const g = c.getContext("2d")!;
  if (i !== undefined) {
    tracePaths(g, COUNTRIES[i], 2048, 1024);
    g.shadowColor = color; g.shadowBlur = 18;
    g.fillStyle = color.replace("1)", "0.38)"); g.fill("evenodd");
    g.lineWidth = 3; g.strokeStyle = color; g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (overlayCache.size > 40) { for (const t of overlayCache.values()) t.dispose(); overlayCache.clear(); }
  overlayCache.set(key, tex);
  return tex;
}

/* ---------- shaders ---------- */

const fresnelVS = "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }";
const atmosphere = new THREE.ShaderMaterial({
  transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: fresnelVS,
  fragmentShader: "varying vec3 vN; varying vec3 vV; void main(){ float i = pow(clamp(-dot(vN, vV) * 1.9, 0.0, 1.0), 2.2); vec3 c = mix(vec3(0.45,0.35,1.0), vec3(0.2,0.6,1.0), i); gl_FragColor = vec4(c, 1.0) * i * 0.85; }",
});
const rim = new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: fresnelVS,
  fragmentShader: "varying vec3 vN; varying vec3 vV; void main(){ float i = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 3.0); gl_FragColor = vec4(0.25,0.8,1.0,1.0) * i * 0.85; }",
});

const dotMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uFade: { value: 1 } },
  vertexShader: `attribute float aSize; attribute float aPhase; attribute vec3 aColor; uniform float uTime; uniform float uScale;
    varying vec3 vColor; varying float vTw;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vColor = aColor;
      vTw = 0.55 + 0.45 * sin(uTime * 2.2 + aPhase);
      gl_PointSize = aSize * uScale * (0.85 + 0.3 * vTw) / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uFade; varying vec3 vColor; varying float vTw;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a;
      gl_FragColor = vec4(vColor * (1.2 + 0.8 * smoothstep(0.18, 0.0, d)), a * (0.55 + 0.45 * vTw) * uFade); }`,
});

const arcMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color("#38bdf8") } },
  vertexShader: "attribute float aU; attribute float aOff; varying float vU; varying float vOff; void main(){ vU = aU; vOff = aOff; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uColor; varying float vU; varying float vOff;
    void main(){ float head = fract(uTime * 0.28 + vOff); float d = vU - head;
      float pulse = exp(-d * d * 160.0); float base = 0.12 * sin(3.14159 * vU);
      gl_FragColor = vec4(mix(uColor, vec3(1.0), pulse * 0.6), (base + pulse * 0.95) * uFade); }`,
});

/* ---------- scene pieces ---------- */

const PALETTE = { warm: ["#fb923c", "#f97316", "#fbbf24", "#ef4444", "#fdba74"], search: ["#a78bfa", "#c084fc", "#818cf8", "#e879f9"] };

/** City-light dots: for each hotspot, points scattered inside the country (more stories → more, brighter dots). */
function NewsDots({ hotspots, mode, reduced }: { hotspots: Hotspot[]; mode: "news" | "search"; reduced: boolean }) {
  const geo = useMemo(() => {
    const pos: number[] = [], col: number[] = [], size: number[] = [], phase: number[] = [];
    const max = Math.max(1, ...hotspots.map((h) => h.count));
    const colors = (mode === "news" ? PALETTE.warm : PALETTE.search).map((c) => new THREE.Color(c));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    for (const h of hotspots) {
      const k = Math.sqrt(h.count / max);
      const idx = INDEX.get(h.name) ?? -1;
      const bb = idx >= 0 ? BBOX[idx] : { w: 4, h: 4 };
      const n = Math.round(5 + 55 * k);
      const add = (lat: number, lon: number, s: number) => {
        const v = toVec(lat, lon, R * 1.004);
        pos.push(v.x, v.y, v.z);
        const c = colors[Math.floor(rnd() * colors.length)];
        col.push(c.r, c.g, c.b); size.push(s); phase.push(rnd() * 6.28);
      };
      add(h.lat, h.lon, 130 + 160 * k); // the bright centre of the cluster
      for (let placed = 0, tries = 0; placed < n && tries < n * 30; tries++) {
        const lat = h.lat + gauss() * Math.max(0.6, bb.h * 0.22), lon = h.lon + gauss() * Math.max(0.6, bb.w * 0.22);
        if (idx >= 0 && countryAt(lat, lon) !== idx) continue; // stay inside the borders
        add(lat, lon, 26 + rnd() * (40 + 60 * k));
        placed++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    return g;
  }, [hotspots, mode]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => dotMaterial.clone(), []);
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
  useEffect(() => { mat.uniforms.uColor.value = new THREE.Color(mode === "news" ? "#38bdf8" : "#c084fc"); }, [mat, mode]);
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
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
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
  useEffect(() => () => mat.dispose(), [mat]);
  const shown = useRef<string | null>(null);
  useFrame((_, dt) => {
    // Fade out, swap texture, fade in: no flicker when moving between countries.
    if (shown.current !== name) {
      mat.opacity = Math.max(0, mat.opacity - dt * 6);
      if (mat.opacity === 0) {
        shown.current = name;
        mat.map = name ? overlayTexture(name, color) : null;
        mat.needsUpdate = true;
      }
    } else if (name) mat.opacity = Math.min(max, mat.opacity + dt * 2.5);
    if (mesh.current) mesh.current.visible = mat.opacity > 0.001;
  });
  return <mesh ref={mesh} material={mat}><sphereGeometry args={[R * 1.0025, 96, 96]} /></mesh>;
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

function Globe({ tint, tintColor, selected, hover, onPick, onHover }: {
  tint: Map<string, number>; tintColor: string; selected: string | null; hover: string | null;
  onPick: (n: string | null) => void; onHover: (n: string | null, x: number, y: number) => void;
}) {
  const texture = useMemo(() => baseTexture(tint, tintColor), [tint, tintColor]);
  useEffect(() => () => texture.dispose(), [texture]);
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
        <meshBasicMaterial map={texture} />
      </mesh>
      <Overlay name={hover && hover !== selected ? hover : null} color="rgba(186,230,253,1)" max={0.45} />
      <Overlay name={selected} color="rgba(34,211,238,1)" max={1} />
      <mesh material={rim}><sphereGeometry args={[R * 1.003, 96, 96]} /></mesh>
      <mesh material={atmosphere} scale={1.14}><sphereGeometry args={[R, 96, 96]} /></mesh>
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
type Result = Story & { countries: string[]; live: boolean };
type Search = { q: string; results: Result[]; hotspots: Hotspot[] };
const WINDOWS = [{ h: 24, label: "24h" }, { h: 72, label: "3d" }, { h: 168, label: "7d" }];

export default function NewsGlobe({ onClose, reduced }: { onClose: () => void; reduced: boolean }) {
  const [hours, setHours] = useState(72);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string | null; x: number; y: number }>({ name: null, x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);
  const [liveNews, setLiveNews] = useState<{ name: string; items: Result[] | null; error?: string } | null>(null);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/news/geo?hours=${hours}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't load news (${res.status})`);
      setData(json); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load news"); }
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
    fetch(`/api/news/search?country=1&q=${encodeURIComponent(displayName(selected))}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Couldn't load headlines"); return j; })
      .then((j) => { if (!gone) setLiveNews({ name: selected, items: j.results ?? [] }); })
      .catch((e) => { if (!gone) setLiveNews({ name: selected, items: [], error: e instanceof Error ? e.message : "Couldn't load headlines" }); });
    return () => { gone = true; };
  }, [selected]);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true); setErr("");
    try {
      const res = await fetch(`/api/news/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Search failed");
      setSearch({ q, results: json.results ?? [], hotspots: json.hotspots ?? [] });
      setSelected(null);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Search failed"); }
    finally { setSearching(false); }
  }

  const mode: "news" | "search" = search ? "search" : "news";
  const hs = useMemo(() => (search ? search.hotspots : data?.hotspots ?? []), [search, data]);
  const tint = useMemo(() => new Map(hs.map((h) => [h.name, h.count])), [hs]);
  const stored = hs.find((h) => h.name === selected) ?? null;
  const focus = useMemo(() => {
    if (!selected) return null;
    const h = hs.find((x) => x.name === selected);
    if (h) return { key: selected, lat: h.lat, lon: h.lon };
    // A country without stories: fly to the middle of its shape.
    const i = INDEX.get(selected);
    if (i === undefined) return null;
    let sx = 0, sy = 0, n = 0;
    for (const ring of COUNTRIES[i].rings) for (const [lon, lat] of unwrapRing(ring)) { sx += lon; sy += lat; n++; }
    return n ? { key: selected, lat: sy / n, lon: ((((sx / n) + 180) % 360) + 360) % 360 - 180 } : null;
  }, [selected, hs]);
  const top = hs.slice(0, 8);
  const accent = mode === "news" ? "#fb923c" : "#c084fc";
  const onHover = useCallback((name: string | null, x: number, y: number) => {
    setHover((h) => (h.name === name && Math.abs(h.x - x) < 2 && Math.abs(h.y - y) < 2 ? h : { name, x, y }));
    document.body.style.cursor = name ? "pointer" : "";
  }, []);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);

  const selectedStories: Result[] = useMemo(() => {
    const own: Result[] = stored ? stored.stories.map((s) => ({ ...s, countries: [stored.name], live: false })) : [];
    const live = liveNews && liveNews.name === selected ? liveNews.items ?? [] : [];
    const seen = new Set(own.map((s) => s.title.toLowerCase()));
    return [...own, ...live.filter((s) => !seen.has(s.title.toLowerCase()))];
  }, [stored, liveNews, selected]);

  return (
    <div className="absolute inset-0 globe-in" aria-label="World news globe">
      <Canvas camera={{ position: [3.6, 1.8, 6.2], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <color attach="background" args={["#01030a"]} />
        <Stars radius={70} depth={40} count={reduced ? 1500 : 5000} factor={2.4} fade speed={reduced ? 0 : 0.35} />
        <Globe tint={tint} tintColor={mode === "news" ? "rgba(249,115,22,A)" : "rgba(168,85,247,A)"} selected={selected}
          hover={hover.name} onPick={(n) => setSelected((cur) => (n && n !== cur ? n : n ? null : cur))} onHover={onHover} />
        <NewsDots hotspots={hs} mode={mode} reduced={reduced} />
        <Arcs hotspots={hs} mode={mode} reduced={reduced} />
        {hs.slice(0, 6).map((h) => <Ring key={`${mode}-${h.name}`} h={h} k={Math.sqrt(h.count / (hs[0]?.count || 1))} color={accent} reduced={reduced} />)}
        <OrbitControls makeDefault enablePan={false} minDistance={3.2} maxDistance={12} enableDamping dampingFactor={0.06} rotateSpeed={0.45} zoomSpeed={0.6} autoRotateSpeed={0.3} />
        <Rig focus={focus} reduced={reduced} offsetX={110} />
        <Labels items={top} refs={labels} />
        <EffectComposer multisampling={4}>
          <Bloom intensity={reduced ? 0.6 : 1.05} luminanceThreshold={0.22} luminanceSmoothing={0.35} mipmapBlur />
          <Vignette offset={0.25} darkness={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {top.map((h) => (
          <span key={`${mode}-${h.name}`} ref={(el) => { labels.current[h.name] = el; }} className="globe-label absolute left-0 top-0" style={{ ["--accent" as string]: accent }}>
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
        {search && <button type="button" className="chip shrink-0" onClick={() => { setSearch(null); setQuery(""); setSelected(null); }}>Clear</button>}
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
              {search.results.slice(0, 20).map((s) => <StoryCard key={s.url} s={s} onCountry={setSelected} />)}
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
            <p className="muted text-xs">{data ? `${data.total} stories · ${hs.length} countries` : err ? "" : "Loading…"}</p>
            {data && !hs.length && <p className="mt-3 text-sm">No placed stories yet. Run a <b>World brief</b> in the panel on the right and the globe lights up.</p>}
            <ol className="mt-3 space-y-1">
              {hs.slice(0, 16).map((h) => (
                <li key={h.name}><HotRow h={h} max={hs[0]?.count || 1} on={h.name === selected} onClick={() => setSelected(h.name === selected ? null : h.name)} accent="#fb923c" /></li>
              ))}
            </ol>
            {data && data.untagged > 0 && <p className="muted mt-2 text-xs">{data.untagged} stories don&apos;t name a country. Click any country for its live headlines.</p>}
          </>
        )}
        {err && <p className="error mt-2">{err}</p>}
      </section>}

      {selected && (
        <section className="glass hud-panel globe-country panel-in" key={selected} aria-live="polite">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="hud-title">{displayName(selected).toUpperCase()}</div>
              <p className="muted text-xs">{stored ? `${stored.count} on your feeds` : "Not on your feeds right now"} · live headlines below</p>
            </div>
            <button className="chip shrink-0" onClick={() => setSelected(null)}>← {search ? "Results" : "All countries"}</button>
          </div>
          <ul className="mt-2 space-y-2">
            {selectedStories.slice(0, 14).map((s) => <StoryCard key={s.url} s={s} />)}
            {liveNews?.name === selected && !liveNews.items && [0, 1, 2].map((i) => <li key={i} className="card skeleton" aria-hidden />)}
          </ul>
          {liveNews?.error && <p className="error mt-2">{liveNews.error}</p>}
          {liveNews?.items && !selectedStories.length && <p className="mt-2 text-sm">No recent headlines found.</p>}
        </section>
      )}

      <button className="chip absolute bottom-24 right-3 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
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

function StoryCard({ s, onCountry }: { s: Result; onCountry?: (n: string) => void }) {
  return (
    <li className="card story text-sm">
      <a className="link" href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">{s.title}</a>
      <div className="muted mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
        <span>{s.source ?? "unknown source"}{s.published_at ? ` · ${ago(s.published_at)}` : ""}</span>
        {s.live && <span className="live-tag">LIVE</span>}
        {onCountry && s.countries.slice(0, 2).map((c) => <button key={c} className="tag" onClick={() => onCountry(c)}>{displayName(c)}</button>)}
      </div>
    </li>
  );
}
