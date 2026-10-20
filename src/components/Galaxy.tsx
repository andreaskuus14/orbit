"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGlRecovery } from "./useGlRecovery";
import { ZoomRig } from "./ZoomRig";
import { voiceLevel } from "./voice/bus";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, Noise } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { PLANETS, type PanelId, type PlanetDef, type PlanetId } from "@/lib/planets";
import { QUALITY, stepQuality, type QualityLevel, type QualityMode, type QualityState } from "@/lib/quality-pure";
import { GalaxyLoader } from "./GalaxyLoader";
import { loadImage } from "./texture-cache";
import { FrameMark } from "./dev-timing";
import { lifeRingGlow, lifeRingStep } from "@/lib/galaxy-life-pure";
import { cullLabels, damp, fmtCoord, HOME_POS, INTRO_SECS, introLabelAlpha } from "@/lib/cinematic-pure";
import {
  CameraFeel, DevStats, Dust, GalaxyHud, MotionAberration, newStory, StoryFocus, StoryRail, StoryReadout, StoryRig, useRim,
  type HudEls, type Motion, type Story,
} from "./Cinematic";

export type GalaxyProps = {
  selected: PanelId | null;
  onSelect: (id: PanelId) => void;
  memoryCount: number;       // real: one moon per stored memory (max 40 drawn)
  pulses: RefObject<Record<string, number>>; // real: last backend event time per planet (ms)
  busy: boolean;             // real: a CORE request is running
  warning: boolean;          // real: last CORE request failed
  pulseBusy: boolean;        // real: the Pulse agent is building a briefing
  pulseFailed: boolean;      // real: the last Pulse run failed
  agentsWorking: number;     // real: agent tasks running right now
  automationFailing: boolean; // real: an enabled automation's last run failed
  reduced: boolean;
  panelOpen: boolean;
  fast?: boolean;            // a command-bar/voice flight on the way into a world: ≤ 1.2 s
  paused?: boolean;          // a full-screen world covers the galaxy: stay mounted (no reload, no intro replay) but draw nothing
  quality?: QualityMode;     // "auto" adapts to the measured frame rate
  lifeProgress?: { done: number; total: number } | null; // real: today's scheduled LIFE habits done / total
};

type Positions = Record<string, THREE.Vector3>;
const glow = (pulses: RefObject<Record<string, number>>, id: string) =>
  Math.max(0, 1 - (Date.now() - (pulses.current?.[id] ?? 0)) / 3000);

/* ---------- procedural textures (painted on a canvas: no downloads, no licensing) ---------- */

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Defined up here so the preload below can list them; NEBULAE adds where each plate sits.
const NEBULAE_SRC = [
  { file: "nebula1", id: "20261014_223957_bb790662-68c9-4e31-91a4-ada73eff783b" },
  { file: "nebula2", id: "20261014_223957_74cb7b1b-e9b7-4dfc-9c78-04bdf27561d9" },
];

function softened(c: HTMLCanvasElement, px: number) {
  const out = document.createElement("canvas");
  out.width = c.width; out.height = c.height;
  const g = out.getContext("2d")!;
  g.filter = `blur(${px}px)`;
  g.drawImage(c, 0, 0);
  return out;
}

/** Gas giant: wavy horizontal bands plus storm streaks. */
function bandTexture(colors: string[], seed: number) {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  for (let y = 0, i = 0; y < c.height; i++) {
    const h = 8 + r() * 34;
    g.fillStyle = colors[i % colors.length];
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= c.width; x += 32) g.lineTo(x, y + Math.sin(x * 0.012 + i) * 4);
    g.lineTo(c.width, y + h + 6); g.lineTo(0, y + h + 6); g.closePath(); g.fill();
    y += h;
  }
  for (let k = 0; k < 500; k++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.07})`;
    g.fillRect(r() * c.width, r() * c.height, 30 + r() * 140, 1 + r() * 3);
    g.fillStyle = `rgba(60,20,0,${r() * 0.06})`;
    g.fillRect(r() * c.width, r() * c.height, 30 + r() * 140, 1 + r() * 3);
  }
  return toTexture(softened(c, 2));
}

/** Rocky / ocean world: base colour with blotches and craters. */
function rockTexture(base: string, spots: string[], seed: number) {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 260; k++) {
    g.globalAlpha = 0.15 + r() * 0.5;
    g.fillStyle = spots[k % spots.length];
    g.beginPath();
    g.ellipse(r() * c.width, r() * c.height, 8 + r() * 70, 6 + r() * 40, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return toTexture(softened(c, 3));
}

/** Radial glow for sprites (sun corona, nebula clouds). */
function glowTexture(stops: [number, string][]) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return toTexture(c);
}


/** Transparent cloud layer: soft white wisps on a clear background. */
function cloudTexture(seed: number) {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  for (let k = 0; k < 520; k++) {
    const y = 40 + r() * 432;
    g.fillStyle = `rgba(255,255,255,${0.06 + r() * 0.22})`;
    g.beginPath();
    g.ellipse(r() * c.width, y, 12 + r() * 70, 4 + r() * 16, (r() - 0.5) * 0.6, 0, Math.PI * 2);
    g.fill();
  }
  return toTexture(softened(c, 5));
}

/** Sun rays: thin tapered spikes fading out from the centre, for a bloom-like glow without post-processing. */
/* ---------- photo textures generated with Higgsfield (Z Image) ---------- */

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3K4zaF8Ip5JyEmwNLHr5iAw89pD/hf_";
// crop = [x0, y0, x1, y1] as fractions: trims the black edges some generations have.
const PHOTOS: Record<PlanetId, { file: string; id: string; crop: [number, number, number, number] }> = {
  // Themed worlds (Higgsfield Z Image surface maps): ocean, storm, lava, desert, gas giant, jungle, ice, crystal.
  memory: { file: "ocean", id: "20261014_232113_6ff7dc5e-202f-4b2f-b5c7-be6dc3bfc435", crop: [0.1, 0.18, 0.9, 0.96] },
  intelligence: { file: "storm", id: "20261014_232114_9eba80cc-155f-458f-a27c-8e5a7dc8f3de", crop: [0.18, 0.04, 0.82, 0.96] },
  creation: { file: "lava", id: "20261014_232114_dc8baf3a-ee89-48b5-86a9-ab27aa06d149", crop: [0, 0.3, 1, 1] },
  operations: { file: "desert", id: "20261014_232429_78bd4209-ff2d-4126-843e-525179464aef", crop: [0, 0, 1, 1] },
  agents: { file: "gasgiant", id: "20261014_232430_7a1aec48-91b8-4d66-838f-f962f6c8d383", crop: [0.12, 0.06, 0.88, 0.94] },
  life: { file: "jungle", id: "20261014_232113_981a9abd-78f9-43ad-99e6-0319a0382419", crop: [0.22, 0.24, 0.78, 0.82] },
  vault: { file: "glacier", id: "20261014_232114_c73e34e3-2e16-44e8-97af-a160226d854a", crop: [0, 0, 1, 1] },
  analytics: { file: "crystal", id: "20261014_232113_02a85430-cdfa-4d9e-ab99-403515937ee7", crop: [0.22, 0.16, 0.78, 0.84] },
  studio: { file: "ruby", id: "20261015_150355_c603bd15-0860-4501-b765-28d2d52631c2", crop: [0, 0, 1, 1] },
  theater: { file: "crystal", id: "20261014_232113_02a85430-cdfa-4d9e-ab99-403515937ee7", crop: [0.22, 0.16, 0.78, 0.84] }, // shares ANALYTICS' photo, tinted gold
  markets: { file: "glacier", id: "20261014_232114_c73e34e3-2e16-44e8-97af-a160226d854a", crop: [0, 0, 1, 1] }, // shares VAULT's photo, tinted emerald
  business: { file: "storm", id: "20261014_232114_9eba80cc-155f-458f-a27c-8e5a7dc8f3de", crop: [0.18, 0.04, 0.82, 0.96] }, // shares INTELLIGENCE's photo, tinted sky blue
};

const photoUrl = (file: string, id: string) => [`/textures/${file}.png`, `${CDN}${id}.png`] as const;
// Start downloading and decoding every photo as soon as this chunk loads, while the loader is still up.
if (typeof window !== "undefined") for (const { file, id } of [...Object.values(PHOTOS), ...NEBULAE_SRC]) loadImage(...photoUrl(file, id)).catch(() => {});

/** Crop, then mirror horizontally so the map wraps around the sphere with no visible seam. */
function photoTexture(img: HTMLImageElement, [x0, y0, x1, y1]: [number, number, number, number]) {
  const sw = (x1 - x0) * img.width, sh = (y1 - y0) * img.height;
  const w = 1024, h = 1024;
  const c = document.createElement("canvas");
  c.width = w * 2; c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(img, x0 * img.width, y0 * img.height, sw, sh, 0, 0, w, h);
  g.save(); g.translate(w * 2, 0); g.scale(-1, 1);
  g.drawImage(img, x0 * img.width, y0 * img.height, sw, sh, 0, 0, w, h);
  g.restore();
  const t = toTexture(c);
  t.anisotropy = 4; // plenty for a sphere; 8 costs fill rate on an iGPU
  return t;
}

// One texture per photo + crop for the page: planets sharing a photo (ANALYTICS/THEATER, VAULT/MARKETS) share it,
// and a remounted galaxy (2D/3D toggle, GPU reset) skips the crop and repaint. Never disposed: a handful, page-lifetime.
const photos = new Map<string, Promise<THREE.Texture>>();
/** Local copy first (run `npm run textures`), then Higgsfield's CDN, else null (procedural look stays). */
function usePhoto(key: PlanetId) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let dead = false;
    const { file, id, crop } = PHOTOS[key];
    const k = `${file}:${crop}`;
    if (!photos.has(k)) photos.set(k, loadImage(...photoUrl(file, id)).then((img) => photoTexture(img, crop)));
    photos.get(k)!.then((t) => { if (!dead) setTex(t); }, () => { photos.delete(k); /* offline: keep the painted texture */ });
    return () => { dead = true; };
  }, [key]);
  return tex;
}

const planetSize = (p: PlanetDef) => p.size * LOOKS[p.id].scale * 1.25;
// How each world's surface answers the CORE's light: bump = relief from the photo, glow = night-side emission (lava).
// air = colour of the thin sunlit atmosphere limb (only worlds with air).
const SURFACE: Record<PlanetId, { rough: number; metal?: number; bump: number; glow?: string; clouds?: number; tint?: string; air?: string }> = {
  memory: { rough: 0.3, bump: 1.2, clouds: 0.35, tint: "#b8c6d6", air: "#7cc4ff" },
  intelligence: { rough: 0.9, bump: 0.6, clouds: 0.3, air: "#b9a6ff" },
  creation: { rough: 0.85, bump: 2.5, glow: "#ff5a1f" },
  operations: { rough: 0.95, bump: 2.5 },
  agents: { rough: 0.75, bump: 0.3 },
  life: { rough: 0.8, bump: 1.6, clouds: 0.25, air: "#9be7a8" },
  vault: { rough: 0.35, bump: 1.8 },
  analytics: { rough: 0.4, metal: 0.25, bump: 1.8 },
  studio: { rough: 0.45, bump: 1.4, glow: "#ff2d55" },
  theater: { rough: 0.5, bump: 1.2, glow: "#f59e0b", tint: "#ffd28a" },
  markets: { rough: 0.45, bump: 1.4, glow: "#10b981", tint: "#8ff0c8" },
  business: { rough: 0.5, bump: 1, tint: "#a5dcf7", air: "#7dd3fc" },
};

type Look = { kind: "band" | "rock"; colors: string[]; base?: string; ring?: string; scale: number };

// Planet looks inspired by the reference: earth-like, mars-like, banded giants, ringed giants, ice giants.
const LOOKS: Record<PlanetId, Look> = {
  memory: { kind: "rock", base: "#1f5fa8", colors: ["#2f8f4e", "#3fa35e", "#e8eef5", "#174b86"], scale: 1 },
  intelligence: { kind: "rock", base: "#b5532a", colors: ["#8a3a1c", "#d0784a", "#6e2a14"], scale: 0.85 },
  creation: { kind: "band", colors: ["#c9773b", "#e8b27a", "#a85a2a", "#f1d1a8", "#b8662f", "#d99a5c"], scale: 1.55 },
  operations: { kind: "band", colors: ["#d8b07a", "#c49460", "#ead2a6", "#b98654"], ring: "#d9c39a", scale: 1.9 }, // gas giant; orbits are spaced so its ring (size × 2.3) clears its neighbours
  agents: { kind: "band", colors: ["#a78bfa", "#c4b5fd", "#8b6fe8", "#ddd6fe"], ring: "#c4b5fd", scale: 1.9 }, // the biggest world
  life: { kind: "rock", base: "#1f8a6e", colors: ["#2bb08a", "#146b55", "#7fd6b8"], scale: 0.63 },
  vault: { kind: "band", colors: ["#e9eef2", "#cfd9e0", "#f5f7f9", "#bcc8d1"], ring: "#e2e8ee", scale: 0.79 },
  analytics: { kind: "band", colors: ["#8f86c9", "#a59de0", "#7b72b8", "#c3bdf0"], ring: "#b3abea", scale: 1.0 },
  studio: { kind: "rock", base: "#7f1d1d", colors: ["#b91c1c", "#e11d48", "#4c0519"], scale: 1.1 },
  theater: { kind: "band", colors: ["#b45309", "#f59e0b", "#78350f", "#fcd34d"], ring: "#fbbf24", scale: 0.9 },
  markets: { kind: "band", colors: ["#065f46", "#10b981", "#064e3b", "#6ee7b7"], ring: "#34d399", scale: 0.85 },
  business: { kind: "rock", base: "#0c4a6e", colors: ["#0284c7", "#38bdf8", "#075985"], scale: 0.85 },
};

/* ---------- scene pieces ---------- */

function OrbitPath({ r, warn = false }: { r: number; warn?: boolean }) {
  return (
    <mesh rotation-x={Math.PI / 2}>
      <ringGeometry args={[r - (warn ? 0.03 : 0.007), r + (warn ? 0.03 : 0.007), 256]} />
      <meshBasicMaterial color={warn ? "#f43f5e" : "#cfe0ff"} transparent opacity={warn ? 0.6 : 0.05} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Moons({ count, reduced }: { count: number; reduced: boolean }) {
  const g = useRef<THREE.Group>(null);
  const items = useMemo(
    () => Array.from({ length: Math.min(count, 40) }, (_, i) => {
      const a = i * 2.399963; // golden angle spreads moons evenly
      const r = 1.0 + (i % 5) * 0.14;
      return { x: Math.cos(a) * r, y: Math.sin(i * 1.7) * 0.3, z: Math.sin(a) * r };
    }),
    [count],
  );
  const inst = useRef<THREE.InstancedMesh>(null);
  useEffect(() => { // one draw call for all moons (was one mesh each, up to 40)
    const m = inst.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => { o.position.set(it.x, it.y, it.z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere(); // three caches the instanced bounds: recompute or moons get culled against stale ones
  }, [items]);
  useFrame((_, dt) => { if (g.current && !reduced) g.current.rotation.y += dt * 0.4; });
  return (
    <group ref={g}>
      <instancedMesh ref={inst} args={[undefined, undefined, 40]} count={items.length}>
        <sphereGeometry args={[0.045, 8, 8]} />
        <meshStandardMaterial color="#c9ccd6" roughness={1} />
      </instancedMesh>
    </group>
  );
}

/** An agent's satellite: glows and circles its planet only while the agent is really working. */
function AgentSatellite({ size, active, reduced, offset = 0 }: { size: number; active: boolean; reduced: boolean; offset?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.visible = active;
    const a = (reduced ? 0.8 : clock.elapsedTime * 2) + offset;
    ref.current.position.set(Math.cos(a) * size * 2.2, Math.sin(a * 0.7) * size * 0.4, Math.sin(a) * size * 2.2);
  });
  return (
    <group ref={ref} visible={false}>
      <mesh><sphereGeometry args={[0.09, 16, 16]} /><meshBasicMaterial color="#67e8f9" toneMapped={false} /></mesh>
      <mesh scale={2.6}><sphereGeometry args={[0.09, 16, 16]} /><meshBasicMaterial color="#22d3ee" transparent opacity={0.25} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
    </group>
  );
}

/** Banded ring like Saturn's: many fine ringlets and gaps, lit by the CORE so it has a bright and a dark side. */
function PlanetRing({ size, color }: { size: number; color: string }) {
  const { geo, tex } = useMemo(() => {
    const inner = size * 1.35, outer = size * 2.3;
    const g = new THREE.RingGeometry(inner, outer, 160, 1);
    // RingGeometry's UVs are planar; remap u to the radius so the band texture runs from inner to outer edge.
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 4;
    const ctx = c.getContext("2d")!;
    const r = rng(Math.round(size * 997));
    const base = new THREE.Color(color).lerp(new THREE.Color("#a39e94"), 0.45); // dusty, less saturated
    let dens = 0.6;
    for (let x = 0; x < c.width; x++) {
      const t = x / c.width;
      const gap = (t > 0.52 && t < 0.56) || (t > 0.84 && t < 0.855); // a Cassini-like division and a thin outer gap
      dens = Math.min(1, Math.max(0.15, dens + (r() - 0.5) * 0.18)); // random walk: irregular ringlets, not grooves
      const a = gap ? 0.03 : dens * (0.6 + 0.4 * r()) * (t > 0.9 ? (1 - t) * 10 : 1) * (t < 0.05 ? t * 20 : 1);
      const k = 0.7 + 0.3 * r();
      ctx.fillStyle = `rgba(${(base.r * 255 * k) | 0},${(base.g * 255 * k) | 0},${(base.b * 255 * k) | 0},${Math.max(0, Math.min(1, a))})`;
      ctx.fillRect(x, 0, 1, c.height);
    }
    return { geo: g, tex: toTexture(c) };
  }, [size, color]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uMap: { value: tex }, uCenter: { value: new THREE.Vector3() }, uR: { value: size } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = mat3(modelMatrix) * normal;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    // World space; the CORE (only light) is at the origin. The planet's shadow: the ray from this fragment
    // toward the CORE passes within the planet radius of its centre.
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uCenter; uniform float uR; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){ vec4 t = texture2D(uMap, vUv);
        vec3 l = normalize(-vW);
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        float lit = dot(n, l);
        vec3 c = uCenter - vW; float tc = dot(c, l);
        float d = length(c - tc * l);
        float shadow = step(0.0, tc) * (1.0 - smoothstep(uR * 0.9, uR * 1.02, d));
        float light = (max(lit, 0.0) + max(-lit, 0.0) * 0.2) * (1.0 - 0.9 * shadow) + 0.02; // face away from the CORE: dim light through the ring
        gl_FragColor = vec4(max(t.rgb, vec3(0.0)) * light, clamp(t.a, 0.0, 1.0)); }`,
  }), [tex, size]);
  useEffect(() => () => { geo.dispose(); tex.dispose(); mat.dispose(); }, [geo, tex, mat]);
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const g = ref.current?.parent;
    if (!g) return;
    g.getWorldPosition(mat.uniforms.uCenter.value);
    mat.uniforms.uR.value = size * g.scale.x; // hover lift scales the planet too
  });
  return <mesh ref={ref} geometry={geo} material={mat} rotation={[Math.PI / 2 - 0.45, 0.15, 0]} />;
}

/** Thin sunlit atmosphere limb: only the edge facing the CORE lights up, never a full halo. */
function Atmosphere({ size, color }: { size: number; color: string }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = mat3(modelMatrix) * normal;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    // Only the shell's back faces outside the planet's silhouette survive the depth test: a rim 2.5% wide.
    // |N.V| runs 0 at the shell's outer edge to ~0.22 where it meets the planet; every term is clamped (NaN/negatives black out bloom).
    fragmentShader: `uniform vec3 uColor; varying vec3 vW; varying vec3 vN;
      void main(){ vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        vec3 l = normalize(-vW);
        float e = clamp(abs(dot(n, v)) * 4.5, 0.0, 1.0);
        float sun = clamp(dot(n, l), 0.0, 1.0);
        gl_FragColor = vec4(uColor * clamp(e * e * sun * 0.8, 0.0, 1.0), 1.0); }`,
  }), [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh scale={1.025} material={mat}>
      <sphereGeometry args={[size, 64, 64]} />
    </mesh>
  );
}

/** LIFE's habit ring: a thin arc whose sweep is today's done/total, closed (and gently pulsing) when all are done. */
function LifeRing({ size, done, total, still }: { size: number; done: number; total: number; still: boolean }) {
  const step = lifeRingStep(done, total); // quantized: geometry rebuilds only per 1/12 step, never per frame
  const geo = useMemo(() => (step > 0 ? new THREE.TorusGeometry(size * 1.6, 0.025, 8, Math.max(8, Math.round(128 * step)), step * Math.PI * 2) : null), [size, step]);
  useEffect(() => () => geo?.dispose(), [geo]);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = lifeRingGlow(step, clock.elapsedTime, still); // clamped to [0, 1.5]
  });
  if (!geo) return null;
  return (
    <mesh geometry={geo} rotation={[Math.PI / 2 - 0.45, 0.15, 0]}>
      <meshStandardMaterial ref={mat} color="#34d399" emissive="#34d399" emissiveIntensity={lifeRingGlow(step, 0, true)} transparent opacity={0.75} depthWrite={false} roughness={1} />
    </mesh>
  );
}

/* ---------- themed planet life: each world gives off its own particles ---------- */

// mode: 0 embers rise, 1 belt sweeps the equator, 2 snow drifts down, 3 fireflies blink, 4 crystal glints, 5 sea mist.
const THEME: Record<PlanetId, { mode: number; count: number; size: [number, number]; color: string; color2?: string }> = {
  memory: { mode: 5, count: 45, size: [3, 7], color: "#bfe9ff" },
  intelligence: { mode: 1, count: 70, size: [3, 7], color: "#c4b5fd" }, // storm clouds; lightning is added separately
  creation: { mode: 0, count: 60, size: [2.5, 6.5], color: "#ffe2a8", color2: "#ff4d1a" },
  operations: { mode: 1, count: 90, size: [2, 5], color: "#f5d08a" },
  agents: { mode: 1, count: 70, size: [2.5, 6], color: "#f0abfc" },
  life: { mode: 3, count: 25, size: [3.5, 6.5], color: "#bef264" },
  vault: { mode: 2, count: 50, size: [2, 4], color: "#e6f8ff" },
  analytics: { mode: 4, count: 30, size: [6, 12], color: "#dbe2ff" },
  studio: { mode: 0, count: 40, size: [2.5, 5.5], color: "#ffd1dc", color2: "#ff2d55" }, // sparks rising like a live broadcast
  theater: { mode: 3, count: 25, size: [3, 6], color: "#fde68a" }, // projector-dust glints
  markets: { mode: 2, count: 30, size: [2.5, 5], color: "#a7f3d0" }, // ticker sparks
  business: { mode: 3, count: 20, size: [3, 6], color: "#bae6fd" }, // lit shop windows
};

// All motion runs on the GPU from a per-particle seed: no per-frame JS work, however many planets.
const themeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uR: { value: 1 }, uMode: { value: 0 }, uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() } },
  vertexShader: `attribute float aSize; attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uR; uniform float uMode;
    varying float vA; varying float vT;
    vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
    void main(){
      vec3 d = position; int m = int(uMode + 0.5);
      float t = fract(uTime * 0.12 * (0.6 + aSeed) + aSeed * 7.0);
      vec3 p; float a; float sz = aSize; vT = 0.0;
      if (m == 0) { p = d * uR * (1.0 + t * 0.7) + vec3(0.0, t * uR * 0.5, 0.0); a = sin(3.1416 * t) * (1.0 - t * 0.5); sz *= 1.0 - t * 0.6; vT = t; }
      else if (m == 1) { vec3 q = normalize(vec3(d.x, d.y * 0.22, d.z)); p = rotY(q, uTime * (0.25 + aSeed * 0.35)) * uR * (1.08 + aSeed * 0.3); a = 0.3 + 0.3 * sin(uTime * 1.5 + aSeed * 30.0); }
      else if (m == 2) { p = d * uR * (1.15 + aSeed * 0.45); p.y += uR * (0.6 - t * 1.2); p.x += sin(uTime + aSeed * 20.0) * uR * 0.05; a = sin(3.1416 * t) * 0.8; }
      else if (m == 3) { vec3 w = vec3(sin(uTime * 0.7 + aSeed * 13.0), sin(uTime * 0.5 + aSeed * 29.0), cos(uTime * 0.6 + aSeed * 17.0));
        p = normalize(d + w * 0.25) * uR * (1.06 + 0.12 * (0.5 + 0.5 * sin(uTime * 0.9 + aSeed * 40.0))); a = pow(max(0.0, sin(uTime * 1.7 + aSeed * 50.0)), 4.0); }
      else if (m == 4) { p = d * uR * (1.03 + aSeed * 0.25); a = pow(max(0.0, sin(uTime * 0.9 + aSeed * 60.0)), 30.0); sz *= 1.0 + a * 0.8; }
      else { p = d * uR * (1.01 + t * 0.25); a = sin(3.1416 * t) * 0.25; sz *= 1.0 + t * 0.6; }
      vA = max(a, 0.0); // never negative: additive blending would write negative light (NaN in bloom)
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vA *= smoothstep(2.0, 6.0, -mv.z); // fade out near the camera: no blurry blobs in close-ups
      gl_PointSize = sz * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; uniform float uMode; varying float vA; varying float vT;
    void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
      float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a;
      if (uMode > 3.5 && uMode < 4.5) { // four-point star for crystal glints
        float star = max(1.0 - smoothstep(0.0, 0.05, abs(c.x)), 1.0 - smoothstep(0.0, 0.05, abs(c.y))) * (1.0 - smoothstep(0.0, 0.5, d));
        a = max(a * 0.6, star); }
      gl_FragColor = vec4(mix(uColor, uColor2, vT) * 1.3, a * vA); }`,
});

function PlanetLife({ id, size, reduced }: { id: PlanetId; size: number; reduced: boolean }) {
  const th = THEME[id];
  const geo = useMemo(() => {
    const r = rng(Math.round(size * 1000) + th.mode);
    const pos: number[] = [], sz: number[] = [], seed: number[] = [];
    for (let i = 0; i < th.count; i++) {
      const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      pos.push(v.x, v.y, v.z); sz.push(th.size[0] + r() * (th.size[1] - th.size[0])); seed.push(r());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.Float32BufferAttribute(sz, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 2.2); // particles move in the shader; keep them from being culled
    return g;
  }, [size, th]);
  const mat = useMemo(() => {
    const m = themeMat.clone();
    m.uniforms.uMode.value = th.mode; m.uniforms.uR.value = size;
    m.uniforms.uColor.value = new THREE.Color(th.color); m.uniforms.uColor2.value = new THREE.Color(th.color2 ?? th.color);
    return m;
  }, [th, size]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock, gl }) => {
    mat.uniforms.uTime.value = reduced ? 3 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 9;
  });
  return <points geometry={geo} material={mat} />;
}

/** Storm world: jagged lightning strikes across the cloud tops, flickering, with a flash that lights the limb. */
const MAX_SEG = 48;
function Lightning({ size, reduced, flash }: { size: number; reduced: boolean; flash: RefObject<number> }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 1.2);
    return g;
  }, [size]);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: "#f1ecff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const tex = useMemo(() => glowTexture([[0, "rgba(235,228,255,1)"], [0.2, "rgba(180,150,255,0.55)"], [1, "rgba(120,80,255,0)"]]), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); tex.dispose(); }, [geo, mat, tex]);
  const spr = useRef<THREE.Sprite>(null);
  const st = useRef({ next: 1.5, t0: -9, r: rng(Math.round(size * 977)) });

  const strike = () => {
    const r = st.current.r, R = size * 1.02;
    const jitter = () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5);
    const arr = geo.attributes.position.array as Float32Array;
    let n = 0;
    // Walks across the sphere in small jagged steps; points stay on the cloud layer.
    const walk = (from: THREE.Vector3, dir: THREE.Vector3, steps: number, step: number, branch: boolean) => {
      let p = from.clone();
      for (let i = 0; i < steps && n < MAX_SEG; i++) {
        const nd = dir.clone().addScaledVector(jitter(), 1.4).normalize();
        const q = p.clone().addScaledVector(nd, step).normalize();
        arr.set([p.x * R, p.y * R, p.z * R, q.x * R, q.y * R, q.z * R], n++ * 6);
        if (branch && r() < 0.3) walk(q, nd.clone().addScaledVector(jitter(), 2).normalize(), 3 + Math.floor(r() * 3), step * 0.7, false);
        p = q;
      }
    };
    const start = new THREE.Vector3(r() * 2 - 1, (r() * 2 - 1) * 0.8, r() * 2 - 1).normalize();
    walk(start, jitter().cross(start).normalize(), 10, 0.07, true);
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
    spr.current?.position.copy(start).multiplyScalar(R * 1.01);
  };

  useFrame(({ clock }) => {
    const now = clock.elapsedTime, s = st.current;
    if (now < s.t0) { s.t0 = -9; s.next = now + 1.5; } // the clock restarts at 0 when a paused galaxy resumes
    if (!reduced && now > s.next) {
      strike(); s.t0 = now;
      s.next = now + (s.r() < 0.3 ? 0.18 : 0.6 + s.r() * 2.4); // sometimes a quick double strike
    }
    const age = now - s.t0;
    const on = age >= 0 && age < 0.25 ? (0.55 + 0.45 * Math.sin(age * 90)) * (1 - age / 0.25) : 0;
    mat.opacity = on;
    if (spr.current) (spr.current.material as THREE.SpriteMaterial).opacity = on * 0.9;
    flash.current = on;
  });

  return (
    <>
      <lineSegments geometry={geo} material={mat} />
      <sprite ref={spr} scale={size * 1.3}><spriteMaterial map={tex} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></sprite>
    </>
  );
}

function Planet({ p, index, selected, onSelect, onHover, positions, pulses, memoryCount, reduced, agentBusy = 0, failing = false, life = null, still = false, segs = 128 }: {
  p: PlanetDef; index: number; selected: boolean; onSelect: (id: PanelId) => void; onHover: (id: PlanetId, on: boolean) => void;
  positions: Positions; pulses: RefObject<Record<string, number>>; memoryCount: number; reduced: boolean;
  agentBusy?: number; failing?: boolean; // agentBusy = number of satellites to show
  life?: { done: number; total: number } | null; still?: boolean; // still = reduced motion or low quality: no animation
  segs?: number; // sphere segments: fewer on lower quality levels
}) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const look = LOOKS[p.id];
  const size = planetSize(p);
  const map = useMemo(
    () => (look.kind === "band" ? bandTexture(look.colors, index + 11) : rockTexture(look.base!, look.colors, index + 11)),
    [look, index],
  );
  useEffect(() => () => map.dispose(), [map]);
  const photo = usePhoto(p.id);
  const surf = SURFACE[p.id];
  const clouds = useRef<THREE.Mesh>(null);
  const cloudTex = useMemo(() => (surf.clouds ? cloudTexture(21 + index) : null), [surf.clouds, index]);
  useEffect(() => () => cloudTex?.dispose(), [cloudTex]);
  const phase = index * 0.95;
  const hovered = useRef(false);
  const flash = useRef(0); // lightning flash, briefly lights the storm world from inside
  const tapT = useRef<ReturnType<typeof setTimeout>>(undefined); // touch has no hover-out: clear the hover (leader label) after a beat
  const rim = useRim(); // cold fresnel rim: brighter on hover / focus so the world pops off the dark

  useFrame(({ clock }, dt) => {
    const a = phase + (reduced ? 0 : clock.elapsedTime * p.speed);
    const x = Math.cos(a) * p.radius, z = Math.sin(a) * p.radius;
    group.current?.position.set(x, 0, z);
    positions[p.id].set(x, 0, z);
    if (mesh.current) {
      if (!reduced) mesh.current.rotation.y += 0.003;
      if (clouds.current && !reduced) clouds.current.rotation.y += 0.0045; // clouds drift a little faster than the ground
      // Lava glows on its own; real backend events and lightning add a brief flare. Nothing glows at rest otherwise.
      (mesh.current.material as THREE.MeshStandardMaterial).emissiveIntensity = (surf.glow ? 0.55 : 0) + glow(pulses, p.id) * 0.8 + flash.current * 0.6;
    }
    // Hover lifts the planet a little; eases, never snaps.
    const k = 1 - Math.exp(-dt * 8);
    if (group.current) group.current.scale.setScalar(THREE.MathUtils.lerp(group.current.scale.x, hovered.current || selected ? 1.08 : 1, k));
    rim.u.uRim.value = THREE.MathUtils.lerp(rim.u.uRim.value, hovered.current ? 1.1 : selected ? 0.6 : 0.22, k);
  });

  return (
    <>
      <OrbitPath r={p.radius} warn={failing} />
      <group ref={group}>
        <mesh
          ref={mesh}
          rotation-z={0.2}
          onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}
          onPointerOver={(e) => {
            hovered.current = true; onHover(p.id, true); document.body.style.cursor = "pointer";
            clearTimeout(tapT.current);
            if (e.pointerType === "touch") tapT.current = setTimeout(() => { hovered.current = false; onHover(p.id, false); }, 2500);
          }}
          onPointerOut={() => { clearTimeout(tapT.current); hovered.current = false; onHover(p.id, false); document.body.style.cursor = ""; }}
        >
          <sphereGeometry args={[size, segs, segs]} />
          <meshStandardMaterial map={photo ?? map} color={surf.tint ?? "#ffffff"} bumpMap={photo ?? map} bumpScale={surf.bump}
            roughness={surf.rough} metalness={surf.metal ?? 0}
            emissive={surf.glow ?? p.color} emissiveMap={surf.glow ? (photo ?? map) : null} emissiveIntensity={0} onBeforeCompile={rim.onBeforeCompile} />
        </mesh>
        {cloudTex && (
          <mesh ref={clouds} scale={1.02} rotation-z={0.2}>
            <sphereGeometry args={[size, segs * 0.75, segs * 0.75]} />
            <meshStandardMaterial map={cloudTex} transparent opacity={surf.clouds} depthWrite={false} roughness={1} />
          </mesh>
        )}
        {surf.air && <Atmosphere size={size} color={surf.air} />}
        <PlanetLife id={p.id} size={size} reduced={reduced} />
        {p.id === "intelligence" && <Lightning size={size} reduced={reduced} flash={flash} />}
        {look.ring && <PlanetRing size={size} color={look.ring} />}
        {p.id === "memory" && <Moons count={memoryCount} reduced={reduced} />}
        {p.id === "life" && life && <LifeRing size={size} done={life.done} total={life.total} still={still} />}
        {Array.from({ length: Math.min(agentBusy, 5) }, (_, k) => (
          <AgentSatellite key={k} size={size} active reduced={reduced} offset={(k * Math.PI * 2) / Math.min(agentBusy, 5)} />
        ))}
      </group>
    </>
  );
}

function AsteroidBelt({ inner, outer, count, seed, reduced, thickness = 0.25 }: {
  inner: number; outer: number; count: number; seed: number; reduced: boolean; thickness?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const r = rng(seed);
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const d = inner + (outer - inner) * Math.pow(r(), 0.8);
      o.position.set(Math.cos(a) * d, (r() - 0.5) * thickness, Math.sin(a) * d);
      o.rotation.set(r() * 6, r() * 6, r() * 6);
      o.scale.setScalar(0.02 + r() * r() * 0.09);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [inner, outer, count, seed, thickness]);
  useFrame((_, dt) => { if (ref.current && !reduced) ref.current.rotation.y += dt * 0.012; });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#7d7a8c" roughness={1} flatShading transparent opacity={0.55} />
    </instancedMesh>
  );
}

// Nebula backdrops generated with Higgsfield (Z Image); their dark edges blend into space when added on top.
const NEBULAE = [
  { ...NEBULAE_SRC[0], pos: [-20, 14, -95] as [number, number, number], s: [150, 84] as [number, number], rot: 0.2 },
  { ...NEBULAE_SRC[1], pos: [85, -8, 40] as [number, number, number], s: [120, 68] as [number, number], rot: -0.4 },
];
/** Nebula image faded to a soft round cloud: no straight edges against the sky. */
function nebulaShader(map: THREE.Texture) {
  return {
    uniforms: { uMap: { value: map }, uOpacity: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform sampler2D uMap; uniform float uOpacity; varying vec2 vUv;
      void main(){ vec2 p = (vUv - 0.5) * vec2(1.0, 0.5625) * 2.0; float r = length(p) / 0.5625;
        float mask = 1.0 - smoothstep(0.35, 1.0, r); vec3 c = texture2D(uMap, vUv).rgb;
        gl_FragColor = vec4(c * mask * uOpacity, 1.0); }`,
  };
}
function NebulaPlates({ reduced }: { reduced: boolean }) {
  const [texs, setTexs] = useState<(THREE.Texture | null)[]>([]);
  useEffect(() => {
    let dead = false;
    const made: THREE.Texture[] = [];
    Promise.all(NEBULAE.map((n) => loadImage(...photoUrl(n.file, n.id)).then((img) => {
      if (dead) return null; // unmounted while loading: don't create a texture nobody will dispose
      const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; made.push(t);
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; // a far, screen-sized plate: mipmaps would only cost upload time
      return t;
    }).catch(() => null))).then((t) => { if (!dead) setTexs(t); });
    return () => { dead = true; made.forEach((t) => t.dispose()); };
  }, []);
  const mats = useMemo(() => texs.map((t) => (t ? new THREE.ShaderMaterial(nebulaShader(t)) : null)), [texs]);
  useEffect(() => () => mats.forEach((m) => m?.dispose()), [mats]);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ camera, clock }, dt) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      m.lookAt(camera.position); // always face the viewer, slowly turning in place
      m.rotateZ(NEBULAE[i].rot + (reduced ? 0 : clock.elapsedTime * 0.004));
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uOpacity.value = Math.min(0.6, u.uOpacity.value + dt * 0.3); // fade in once loaded
    });
  });
  return (
    <>
      {NEBULAE.map((n, i) => mats[i] && (
        <mesh key={n.file} ref={(el) => { refs.current[i] = el; }} position={n.pos} material={mats[i]!}>
          <planeGeometry args={n.s} />

        </mesh>
      ))}
    </>
  );
}

/** Coloured gas clouds far behind the system, like the green/teal haze in the reference. */
function Nebula() {
  const clouds = useMemo(() => {
    const tex = (c: string) => glowTexture([[0, c], [0.45, c.replace(/[\d.]+\)$/, "0.12)")], [1, "rgba(0,0,0,0)"]]);
    return [
      // One cool blue-violet tint behind the system (the old green hazes fought the nebula's palette).
      { t: tex("rgba(59,91,219,0.12)"), pos: [0, -4, -20] as [number, number, number], s: 64 },
      { t: tex("rgba(109,75,216,0.10)"), pos: [-10, 8, -60] as [number, number, number], s: 90 },
    ];
  }, []);
  useEffect(() => () => clouds.forEach((c) => c.t.dispose()), [clouds]);
  return (
    <>
      {clouds.map((c, i) => (
        <sprite key={i} position={c.pos} scale={[c.s, c.s, 1]}>
          <spriteMaterial map={c.t} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </>
  );
}

/* ---------- CORE: a breathing neural orb (filaments of light flowing out from a bright centre) ---------- */

const filamentMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { uTime: { value: 0 }, uBreath: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } },
  vertexShader: "attribute float aU; attribute float aOff; varying float vU; varying float vOff; void main(){ vU = aU; vOff = aOff; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform float uTime; uniform float uBreath; uniform vec3 uTint; varying float vU; varying float vOff;
    void main(){ float head = fract(uTime * 0.32 + vOff); float d = vU - head;
      float pulse = exp(-d * d * 90.0);
      vec3 c = mix(vec3(1.0, 0.94, 0.79), vec3(0.35, 0.62, 1.0), smoothstep(0.0, 0.6, vU)); // warm centre, cool tips
      float a = pow(max(1.0 - vU, 0.0), 1.4) * 0.22 + pulse * 0.75 * (1.0 - vU * 0.6); // max(): MSAA samples vU just past 1, and pow(negative) = NaN, which bloom spreads over the whole screen
      gl_FragColor = vec4(c * uTint * (1.0 + pulse), a * uBreath); }`,
});
const sparkMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uBreath: { value: 1 }, uColor: { value: new THREE.Color(0.7, 0.85, 1.0) } },
  vertexShader: `attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uScale; varying float vTw;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vTw = 0.5 + 0.5 * sin(uTime * 1.8 + aPhase);
      gl_PointSize = aSize * uScale * (0.8 + 0.4 * vTw) / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uBreath; uniform vec3 uColor; varying float vTw;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a;
      gl_FragColor = vec4(uColor * 1.3, a * (0.35 + 0.45 * vTw) * uBreath * 0.8); }`,
});

function NeuralCore({ onSelect, pulses, busy, warning, reduced }: Pick<GalaxyProps, "onSelect" | "pulses" | "busy" | "warning" | "reduced">) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Sprite>(null);
  const sat = useRef<THREE.Mesh>(null);
  const voice = useRef({ mic: 0, speak: 0 }); // smoothed copy of voiceLevel (read per frame, no React state)
  const { strands, sparks } = useMemo(() => {
    const r = rng(77);
    const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
    const pos: number[] = [], u: number[] = [], off: number[] = [], index: number[] = [];
    const sp: number[] = [], ss: number[] = [], sph: number[] = [];
    const N = 260, SEG = 26;
    for (let i = 0; i < N; i++) {
      const dir = new THREE.Vector3(gauss(), gauss() * 0.85, gauss()).normalize();
      const axis = new THREE.Vector3(gauss(), gauss(), gauss()).cross(dir).normalize();
      const len = 1.4 + r() * 1.1, curl = (r() - 0.5) * 1.4, wob = r() * 6;
      const base = pos.length / 3;
      let tip = new THREE.Vector3();
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG;
        const v = dir.clone().applyAxisAngle(axis, curl * t * t).multiplyScalar(len * Math.pow(t, 0.9) + 0.08);
        v.addScaledVector(axis, Math.sin(t * 5 + wob) * 0.05 * t);
        pos.push(v.x, v.y, v.z); u.push(t); off.push(r());
        if (s) index.push(base + s - 1, base + s);
        tip = v;
      }
      sp.push(tip.x, tip.y, tip.z); ss.push(10 + r() * 22); sph.push(r() * 6.28);
    }
    // A loose halo of dots around the orb, like the reference.
    for (let i = 0; i < 520; i++) {
      const v = new THREE.Vector3(gauss(), gauss() * 0.85, gauss()).normalize().multiplyScalar(2.45 + r() * 0.5);
      sp.push(v.x, v.y, v.z); ss.push(6 + r() * 14); sph.push(r() * 6.28);
    }
    const strands = new THREE.BufferGeometry();
    strands.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    strands.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
    strands.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 1));
    strands.setIndex(index);
    const sparks = new THREE.BufferGeometry();
    sparks.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    sparks.setAttribute("aSize", new THREE.Float32BufferAttribute(ss, 1));
    sparks.setAttribute("aPhase", new THREE.Float32BufferAttribute(sph, 1));
    return { strands, sparks };
  }, []);
  const mats = useMemo(() => ({ fil: filamentMat.clone(), spark: sparkMat.clone() }), []);
  const tex = useMemo(() => ({
    inner: glowTexture([[0, "rgba(255,241,201,1)"], [0.18, "rgba(255,226,170,0.85)"], [0.45, "rgba(120,170,255,0.3)"], [1, "rgba(0,0,0,0)"]]),
    mid: glowTexture([[0, "rgba(110,170,255,0.32)"], [0.5, "rgba(70,110,255,0.08)"], [1, "rgba(0,0,0,0)"]]),
    haze: glowTexture([[0, "rgba(140,120,255,0.12)"], [0.4, "rgba(80,90,220,0.03)"], [1, "rgba(0,0,0,0)"]]),
  }), []);
  useEffect(() => () => {
    strands.dispose(); sparks.dispose(); mats.fil.dispose(); mats.spark.dispose();
    Object.values(tex).forEach((t) => t.dispose());
  }, [strands, sparks, mats, tex]);

  useFrame(({ clock, gl }, dt) => {
    const t = clock.elapsedTime;
    const g = glow(pulses, "core");
    // Breathing: slow when idle, quicker while CORE is answering; events make it flare.
    const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * (busy ? 2.6 : 1.05));
    // Voice: mic = the user talking (cool, fast), speak = ORBIT talking (warm, slower breath).
    // Everything is clamped finite and >= 0: one NaN or negative pixel gets smeared over the screen by the bloom blur.
    const lv = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const v = voice.current;
    v.mic = lv(v.mic + (lv(voiceLevel.mic) - v.mic) * (1 - Math.exp(-step * 14)));
    v.speak = lv(v.speak + (lv(voiceLevel.speak) - v.speak) * (1 - Math.exp(-step * 8)));
    const amp = reduced ? 0.3 : 1;
    const mic = v.mic * amp, spk = v.speak * amp;
    if (group.current) {
      group.current.scale.setScalar(0.72 * (1 + 0.05 * breath + g * 0.12 + spk * 0.07 + mic * 0.03));
      if (!reduced) group.current.rotation.y += dt * (busy ? 0.18 : 0.05);
    }
    inner.current?.scale.setScalar(1.2 * (1 + 0.22 * breath + g * 0.5 + spk * 0.4 + mic * 0.15));
    mats.fil.uniforms.uTime.value = reduced ? 0 : t * (busy ? 1.8 : 1);
    mats.fil.uniforms.uBreath.value = Math.min(4, Math.max(0, 0.7 + 0.45 * breath + g * 1.2 + mic * 0.9 + spk * 0.6));
    const tr = Math.min(2, Math.max(0.2, 1 - mic * 0.3 + spk * 0.25)), tg = Math.min(2, Math.max(0.2, 1 - mic * 0.08 + spk * 0.02)), tb = Math.min(2, Math.max(0.2, 1 + mic * 0.35 - spk * 0.3));
    (mats.fil.uniforms.uTint.value as THREE.Color).setRGB(tr, tg, tb);
    (mats.spark.uniforms.uColor.value as THREE.Color).setRGB(0.7 * tr, 0.85 * tg, 1.0 * tb);
    mats.spark.uniforms.uTime.value = reduced ? 0 : t;
    mats.spark.uniforms.uScale.value = gl.getPixelRatio() * 9;
    mats.spark.uniforms.uBreath.value = Math.min(4, Math.max(0, 0.75 + 0.35 * breath + g + mic * 1.0 + spk * 0.4));
    if (sat.current) {
      const a = busy && !reduced ? t * 2.2 : 0; // orbits only while a real CORE request is in flight
      sat.current.position.set(Math.cos(a) * 3.1, 0.3, Math.sin(a) * 3.1);
      sat.current.visible = busy;
    }
  });

  return (
    <group>
      <pointLight intensity={3.2} decay={0} color="#fff1dc" /> {/* no falloff: inner worlds would blow out, outer ones go dark */}
      <group ref={group}>
        <lineSegments geometry={strands} material={mats.fil} />
        <points geometry={sparks} material={mats.spark} />
      </group>
      <sprite ref={inner} scale={1.2}><spriteMaterial map={tex.inner} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></sprite>
      <sprite scale={9}><spriteMaterial map={tex.mid} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></sprite>
      <sprite scale={18}><spriteMaterial map={tex.haze} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></sprite>
      {/* Invisible hit area: the orb itself is lines and points. */}
      <mesh onClick={(e) => { e.stopPropagation(); onSelect("core"); }}
        onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
        <sphereGeometry args={[1.9, 24, 24]} />
        <meshBasicMaterial visible={false} /> {/* not drawn (one draw call saved); raycasting ignores material visibility */}
      </mesh>
      <mesh ref={sat} visible={false}><sphereGeometry args={[0.14, 16, 16]} /><meshBasicMaterial color="#67e8f9" toneMapped={false} /></mesh>
      {warning && (
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[3.2, 0.035, 8, 96]} />
          <meshBasicMaterial color="#f43f5e" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

const BODIES = ["core", ...PLANETS.map((p) => p.id)];
const LABEL_W = BODIES.map((id) => (id === "core" ? 4 : PLANETS.find((p) => p.id === id)!.name.length) * 11 + 18); // px, 12px font at 0.3em tracking

/** Projects each body's position to screen space every frame and moves plain DOM labels there (no extra React roots).
 *  Also places the HUD's leader label beside the hovered planet and writes the focus coordinates (no allocations). */
function LabelProjector({ positions, labels, hover, selected, hud, story, reduced }: {
  positions: Positions; labels: RefObject<Record<string, HTMLSpanElement | null>>;
  hover: RefObject<PlanetId | null>; selected: PanelId | null; hud: RefObject<HudEls>; story: RefObject<Story>; reduced: boolean;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const st = useRef({ t: 0, text: "" });
  const sc = useMemo(() => { const n = BODIES.length; const f = () => new Float64Array(n); return { x: f(), y: f(), prio: f(), vis: f(), alpha: f(), order: f() }; }, []);
  useFrame(({ camera, size, controls }, dt) => {
    const els = labels.current;
    if (!els) return;
    const S = story.current, stopId = S.stop >= 0 ? PLANETS[S.stop].id : null, h0 = hover.current;
    for (let i = 0; i < BODIES.length; i++) {
      const id = BODIES[i], el = els[id];
      const p = i > 0 ? PLANETS[i - 1] : undefined;
      if (!p) v.set(0, -2.4, 0);
      else { v.copy(positions[id]); v.y -= planetSize(p) + 0.5; }
      v.project(camera);
      const visible = !!el && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      sc.x[i] = ((v.x + 1) / 2) * size.width; sc.y[i] = ((1 - v.y) / 2) * size.height;
      // Journey: only the current stop. Overview: hovered > opened > CORE > outer worlds; overlapping ones give way.
      sc.prio[i] = !visible ? -1 : stopId ? (id === stopId ? 1 : -1) : id === h0 ? 1000 : id === selected ? 900 : !p ? 100 : p.radius;
      if (el) el.style.transform = `translate(-50%, -50%) translate(${sc.x[i]}px, ${sc.y[i]}px)`;
    }
    cullLabels(sc.x, sc.y, LABEL_W, 22, sc.prio, sc.vis, sc.order);
    for (let i = 0; i < BODIES.length; i++) {
      const el = els[BODIES[i]];
      if (!el) continue;
      const goal = sc.vis[i] * introLabelAlpha(S.intro, i, BODIES.length);
      let a = reduced ? goal : damp(sc.alpha[i], goal, 8, dt);
      if (Math.abs(a - goal) < 0.01) a = goal; // snap: damp never lands, and a frozen 0.03-0.07 leaves ghost labels
      if (a !== sc.alpha[i]) { sc.alpha[i] = a; el.style.opacity = a === 0 ? "0" : a.toFixed(3); }
    }
    const h = hover.current, leader = hud.current.leader;
    const hp = h ? PLANETS.find((x) => x.id === h) : undefined;
    if (leader && hp) { // start the leader line on the planet's upper-right limb
      const cam = camera as THREE.PerspectiveCamera;
      const dist = Math.max(0.1, camera.position.distanceTo(positions[hp.id]));
      const rPx = ((planetSize(hp) * 1.08) / (dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))) * (size.height / 2) * 0.72;
      v.copy(positions[hp.id]).project(camera);
      leader.style.visibility = v.z < 1 ? "visible" : "hidden";
      leader.style.transform = `translate(${((v.x + 1) / 2) * size.width + rPx}px, ${((1 - v.y) / 2) * size.height - rPx}px)`;
    }
    const s = st.current, coord = hud.current.coord;
    if (!coord || (s.t += dt) < 0.15) return; // ~7 Hz is plenty for a readout
    s.t = 0;
    const fid = h ?? (selected && selected !== "core" && selected !== "profile" ? selected : null);
    const c = controls as unknown as { target: THREE.Vector3 } | null;
    const text = fid ? `X${fmtCoord(positions[fid].x)}  Z${fmtCoord(positions[fid].z)}`
      : `CAM R${fmtCoord(c ? camera.position.distanceTo(c.target) : camera.position.length())}`;
    if (text !== s.text) { s.text = text; coord.textContent = text; }
  });
  return null;
}

// Low, oblique view like the reference illustration.
const HOME = new THREE.Vector3(...HOME_POS); // pulled back to fit the wider outer orbits

function Rig({ selected, positions, reduced, panelOpen, fast, story }: { selected: PanelId | null; positions: Positions; reduced: boolean; panelOpen: boolean; fast?: boolean; story: RefObject<Story> }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  // A flight: eased from where the camera is now to a goal that keeps updating (planets orbit while we fly),
  // lifted on an arc so it swoops over the system instead of cutting through it.
  const flight = useRef<{ from: THREE.Vector3; fromT: THREE.Vector3; t: number; dur: number; arc: number } | null>(null);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  const delta = useMemo(() => new THREE.Vector3(), []);
  const fastRef = useRef(fast); // read when a flight starts; flipping it must not restart the flight
  useEffect(() => { fastRef.current = fast; }, [fast]); // declared before the flight effect, so it runs first

  const focusOf = useCallback(() => (selected && selected !== "profile" && selected !== "core" ? positions[selected] : null), [selected, positions]);
  const goals = useCallback(() => {
    const focus = focusOf();
    if (focus) { // view from the sunlit side (between the planet and the CORE), a little off-axis so the terminator shows
      tgt.copy(focus);
      const p = PLANETS.find((x) => x.id === selected);
      const k = p ? Math.max(1, planetSize(p) / 0.75) : 1; // big worlds: back off so they still fit
      const out = delta.copy(focus).setY(0).normalize();
      goal.copy(focus).addScaledVector(out, -2.8 * k).add(out.set(out.z * 3 * k, 1.8 * k, -out.x * 3 * k));
    }
    else { tgt.set(0, 0, 0); goal.copy(selected === "core" ? delta.set(0, 3, 9) : HOME); }
  }, [focusOf, selected, goal, tgt, delta]);

  useEffect(() => {
    if (!controls) return;
    goals();
    const dist = camera.position.distanceTo(goal);
    flight.current = { from: camera.position.clone(), fromT: controls.target.clone(), t: reduced ? 1 : 0, dur: fastRef.current ? Math.min(1.2, 0.6 + dist / 40) : Math.min(2.4, 1 + dist / 22), arc: Math.min(6, dist * 0.22) };
  }, [selected, controls, camera, reduced, goals, goal]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => { flight.current = null; }; // the user grabbed the view: hand control back
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  // Keep the focused object left of the side panel on wide screens.
  useEffect(() => {
    if (panelOpen && size.width >= 900) camera.setViewOffset(size.width, size.height, 210, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [panelOpen, size, camera]);

  useFrame((_, dt) => {
    if (!controls) return;
    if (story.current.owns) { flight.current = null; return; } // the intro / scroll journey is driving the camera
    const f = flight.current;
    if (f) {
      goals();
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2; // ease in-out cubic
      camera.position.lerpVectors(f.from, goal, e);
      camera.position.y += Math.sin(Math.PI * e) * f.arc;
      controls.target.lerpVectors(f.fromT, tgt, e);
      if (f.t >= 1) flight.current = null;
    } else {
      const focus = focusOf();
      if (focus) { // follow the orbiting planet
        delta.copy(focus).sub(controls.target);
        controls.target.add(delta);
        camera.position.add(delta);
      }
    }
    controls.update();
  });
  return null;
}

/** Averages the frame rate over 0.5 s windows and asks for a cheaper/richer level (rules in lib/quality-pure). */
function QualityMonitor({ level, max, onLevel }: { level: QualityLevel; max: QualityLevel; onLevel: (l: QualityLevel) => void }) {
  const st = useRef({ warm: 0, frames: 0, t: 0, worst: 0, q: { level, low: 0, high: 0 } as QualityState });
  useEffect(() => { st.current.q = { ...st.current.q, level, low: 0, high: 0 }; st.current.warm = 0; }, [level]); // a level change hitches: re-warm
  useFrame((_, dt) => {
    const s = st.current;
    if ((s.warm += dt) < 2) return; // first frames compile shaders and upload textures
    s.frames++; s.t += dt; s.worst = Math.max(s.worst, dt * 1000);
    if (s.t < 0.5) return;
    s.q = stepQuality(s.q, s.frames / s.t, s.t, max, s.worst); // a steady vsync-halved 30 fps is not strain
    s.frames = 0; s.t = 0; s.worst = 0;
    if (s.q.level !== level) onLevel(s.q.level);
  });
  return null;
}

/** Tells the page the scene has drawn a couple of frames, so the loader can fade out. */
function FirstFrames({ onReady }: { onReady: () => void }) {
  const n = useRef(0);
  useFrame(() => { if (++n.current === 3) onReady(); });
  return null;
}

export default function Galaxy(props: GalaxyProps) {
  const positions = useMemo<Positions>(() => Object.fromEntries(PLANETS.map((p) => [p.id, new THREE.Vector3()])), []);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});
  const glr = useGlRecovery();
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => { const t = setTimeout(onReady, 8000); return () => clearTimeout(t); }, [onReady]); // never hang on the loader if no frame draws
  const max: QualityLevel = props.reduced ? 1 : 3;
  // Start with a light first frame; the existing monitor adds detail when there is headroom.
  const [autoLevel, setAutoLevel] = useState<QualityLevel>(1);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const mode = props.quality ?? "auto";
  const level: QualityLevel = mode === "high" ? 3 : mode === "low" ? 0 : (Math.min(autoLevel, max) as QualityLevel);
  const q = QUALITY[level];
  const motion = useRef<Motion>({ speed: 0 });
  const hover = useRef<PlanetId | null>(null);
  const hoverSet = useRef<(id: PlanetId, on: boolean) => void>(() => {});
  const hud = useRef<HudEls>({ leader: null, coord: null });
  const onHover = useCallback((id: PlanetId, on: boolean) => {
    if (on) hover.current = id; else if (hover.current === id) hover.current = null;
    hoverSet.current(id, on);
  }, []);
  // Phones (Tailscale) get at most 1.5x: past that the fill rate costs more than the sharpness is worth.
  const [coarse] = useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const dprMax = coarse ? Math.min(1.5, q.dpr) : Math.min(2, q.dpr);
  const film = q.film && !props.reduced; // grain is motion, aberration is motion: both off for reduced motion
  const dof = q.dof && !props.reduced;
  // The camera story: intro flight on every fresh load, then wheel = travel planet to planet (not with reduced motion).
  const [intro, setIntro] = useState(!props.reduced);
  const [introMs] = useState(intro ? INTRO_SECS * 1000 : 900); // HUD title decrypts in step with the intro
  const [stop, setStop] = useState(-1);
  const story = useRef<Story>(newStory(intro));
  const onIntroEnd = useCallback(() => setIntro(false), []);
  const sizes = useMemo(() => Object.fromEntries(PLANETS.map((p) => [p.id, planetSize(p)])), []);
  const { onSelect, selected } = props;
  useEffect(() => { // Enter opens the current stop, exactly like clicking it
    if (stop < 0 || selected !== null) return;
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "Enter" || e.defaultPrevented || (el && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|VIDEO|AUDIO)$/.test(el.tagName) || el.isContentEditable))) return;
      onSelect(PLANETS[stop].id);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [stop, selected, onSelect]);
  return (
    <div className="relative h-full w-full">
      <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={props.paused || !visible ? "never" : "always"} aria-hidden camera={{ position: HOME.toArray(), fov: 50 }} dpr={[1, dprMax]}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}>
        <color attach="background" args={["#02040b"]} />
        {/* Depth haze: far orbits and belts sink into a cold blue-black (shader layers like stars/nebulae ignore it). */}
        <fogExp2 attach="fog" args={["#070c1c", 0.0055]} />
        <ambientLight intensity={0.06} color="#9aa8c0" /> {/* low fill: the CORE is the sun, worlds get a real day and night side */}
        {level >= 2 && <Nebula />} {/* two screen-filling additive sprites: pure fill-rate, the first thing to go */}
        <NebulaPlates reduced={props.reduced} />
        <Stars radius={110} depth={60} count={props.reduced ? Math.min(2000, q.stars) : q.stars} factor={3.2} fade speed={props.reduced ? 0 : 0.5} />
        {/* No drei <Sparkles>: its shader writes negative alpha, which turns into NaN in the bloom blur and blacks out the screen. */}
        <Dust count={q.dust} reduced={props.reduced} />
        <NeuralCore onSelect={props.onSelect} pulses={props.pulses} busy={props.busy} warning={props.warning} reduced={props.reduced} />
        {/* Main belt between MEMORY and INTELLIGENCE, and an outer belt beyond ANALYTICS, as in the reference. */}
        <AsteroidBelt inner={5.5} outer={6.0} count={Math.round(900 * q.belt)} seed={3} reduced={props.reduced} />
        <AsteroidBelt inner={32} outer={34} count={Math.round(2200 * q.belt)} seed={9} reduced={props.reduced} thickness={0.6} />
        {PLANETS.map((p, i) => (
          <Planet key={p.id} p={p} index={i} selected={props.selected === p.id} onSelect={props.onSelect} onHover={onHover}
            positions={positions} pulses={props.pulses} memoryCount={props.memoryCount} reduced={props.reduced}
            agentBusy={p.id === "intelligence" ? (props.pulseBusy ? 1 : 0) : p.id === "agents" ? props.agentsWorking : 0}
            failing={(p.id === "intelligence" && props.pulseFailed) || (p.id === "operations" && props.automationFailing)}
            life={p.id === "life" ? props.lifeProgress : null} still={props.reduced || level === 0} segs={level >= 2 ? 128 : 64} />
        ))}
        <OrbitControls makeDefault enablePan={false} minDistance={4} maxDistance={80} enableDamping />
        {!props.reduced && <StoryRig story={story} positions={positions} sizes={sizes} selected={props.selected} intro={intro} onIntroEnd={onIntroEnd} onStop={setStop} />}
        <Rig selected={props.selected} positions={positions} reduced={props.reduced} panelOpen={props.panelOpen} fast={props.fast} story={story} />
        {!props.paused && <ZoomRig home={HOME.length()} reduced={props.reduced} />} {/* zoom commands are for the world on screen */}
        <CameraFeel motion={motion} reduced={props.reduced} home={props.selected === null} story={story} />
        <LabelProjector positions={positions} labels={labels} hover={hover} selected={props.selected} hud={hud} story={story} reduced={props.reduced} />
        {process.env.NODE_ENV === "development" && <><DevStats /><FrameMark name="galaxy" /></>}
        <FirstFrames onReady={onReady} />
        {mode === "auto" && <QualityMonitor level={level} max={max} onLevel={setAutoLevel} />}
        {/* Low quality drops post-processing entirely (the renderer's own ACES tone mapping still applies). */}
        {q.bloom > 0 && (
          <EffectComposer key={level} multisampling={q.msaa}>
            {dof ? <StoryFocus story={story} /> : <></>}
            <Bloom intensity={props.reduced ? Math.min(0.6, q.bloom) : q.bloom} luminanceThreshold={0.55} luminanceSmoothing={0.3} mipmapBlur />
            {film ? <MotionAberration motion={motion} /> : <></>}
            <Vignette offset={0.28} darkness={0.7} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            {film ? <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.16} /> : <></>}
          </EffectComposer>
        )}
      </Canvas>
      <GalaxyLoader done={ready} />
      <GalaxyHud selected={props.selected} hoverSet={hoverSet} els={hud} introMs={introMs} />
      {!props.reduced && <StoryReadout stop={stop} intro={intro} onOpen={onSelect} />}
      {!props.reduced && <StoryRail stop={stop} on={!intro && selected === null} onGo={(n) => story.current.goTo(n)} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span ref={(el) => { labels.current.core = el; }} className="planet-label absolute left-0 top-0" style={{ color: props.warning ? "#fb7185" : "#ffe2b0" }}>
          CORE{props.warning ? " · last request failed" : ""}
        </span>
        {PLANETS.map((p) => (
          <span key={p.id} ref={(el) => { labels.current[p.id] = el; }} className="planet-label absolute left-0 top-0" style={{ color: p.color }}>{p.name}</span>
        ))}
      </div>
    </div>
  );
}
