"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGlRecovery } from "./useGlRecovery";
import { ZoomRig } from "./ZoomRig";
import { voiceLevel } from "./voice/bus";
import { ParticleCore, type CoreLive } from "./ParticleCore";
import { coreParticleSide } from "@/lib/particle-core-pure";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, Noise, SMAA } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { PLANETS, type PanelId, type PlanetDef, type PlanetId } from "@/lib/planets";
import { QUALITY, stepQuality, type QualityLevel, type QualityMode, type QualityState } from "@/lib/quality-pure";
import { GalaxyLoader } from "./GalaxyLoader";
import { Universe } from "./Universe";
import { Ships } from "./Ships";
import type { ShipTask } from "@/lib/ships-pure";
import type { Light, Universe as UniverseData } from "@/lib/universe-pure";
import { FrameMark } from "./dev-timing";
import { StageOut, useStageActive } from "./Stage";
import { Singularity } from "./alien/Singularity";
import { GalaxyVeil, NeuralArms } from "./alien/NeuralArms";
import { Filaments } from "./alien/Filaments";
import { Lensing } from "./alien/Lensing";
import { HoloRing, planetStandIn, ThoughtShell, useLiquidMetal, type SurfaceLook } from "./alien/LiquidPlanet";
import { MicroWorld, Ringworld } from "./alien/MicroWorld";
import { WindowDive, WindowPlanets } from "./alien/WindowPlanet";
import { lensRadius } from "./alien/micro-pure";
import { armCount, boostCap, coreScale, overviewBoost, planetDetail, shellCount } from "@/lib/alien-pure";
import { lifeRingGlow, lifeRingStep } from "@/lib/galaxy-life-pure";
import { cullLabels, damp, spreadLabels, fmtCoord, HOME_POS, INTRO_SECS, introLabelAlpha } from "@/lib/cinematic-pure";
import {
  CameraFeel, DevStats, Dust, GalaxyHud, MotionAberration, newFeel, newStory, Parallax, PointerFeel, StoryFocus, StoryRail, StoryReadout, StoryRig, useRim,
  type Feel, type HudEls, type Motion, type Story,
} from "./Cinematic";
import { expDamp, smoothDampVec } from "@/lib/smooth-damp-pure";
import { cursorTarget } from "./cursor-bus";
import { markPreload } from "./GalaxyLoader";
import { standIn, WarmCompile, WarmIn } from "./WarmCompile";
import { dilationScale } from "@/lib/dilation-pure";
import { newScale, renderDpr, scaleFloor, stepScale, type ScaleState } from "@/lib/render-scale-pure";
import { perfMark } from "./PerfBeacon";
import { perfCtx } from "./PerfBeacon";
import { InkGlyph } from "./InkGlyph";
import { AlienScript } from "./AlienScript";
import { arrivalSecs, arrivalSpread, easeInStop, offscreenEdge } from "@/lib/alien-behaviour-pure";

export type GalaxyProps = {
  bloomScale?: number; // ambient night mode softens the glow
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
  universe?: UniverseData | null; // real: the ledger as light (live, or the day picked in Time travel)
  ships?: { tasks: ShipTask[]; onOpen: (id: string) => void }; // real: agent tasks flying as ships; click opens the task
  dive?: PanelId | null;     // entering this world through its planet's surface (window planets: level > 0, no reduced motion)
  onDiveCross?: () => void;  // the camera crossed the surface: mount the world now, it crossfades in
  onDiveCancel?: () => void; // the user grabbed the view mid-dive
  onIdle?: () => void;       // start-up and background shaders are compiled: a good moment for other idle work
  dilation?: { startAt: number; endAt: number } | null; // time dilation focus block: the galaxy's clock runs slow
};

type Positions = Record<string, THREE.Vector3>;
type Scales = Record<string, number>; // per-world display scale (overview boost x hover lift), written per frame
type Arrive = { id: PanelId | null; k: number }; // the planet fly-to's progress (0..1): its moons converge with it
const _v = new THREE.Vector3();
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

/** Radial glow for sprites (lightning flash). */
function glowTexture(stops: [number, string][]) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => grad.addColorStop(o, col));
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return toTexture(c);
}

const planetSize = (p: PlanetDef) => p.size * LOOKS[p.id].scale * 1.25;

// Every world has its own surface identity (c8): a pattern family (0 banded, 1 marbled, 2 cratered, 3 oceanic) and a
// restrained palette; two stay alien liquid chrome (no surf). scale = size, ring = a banded ring, obsidian = dark mirror chrome.
const SL = (fam: SurfaceLook["fam"], seed: number, a: string, b: string, c: string): SurfaceLook => ({ fam, seed, pal: [a, b, c] });
// orbital = an equatorial ring with space elevators, climbers and ships (micro-world); halo = the ringworld showpiece.
const LOOKS: Record<PlanetId, { scale: number; ring?: string; obsidian?: boolean; surf?: SurfaceLook; orbital?: boolean; halo?: boolean }> = {
  memory: { scale: 0.75, surf: SL(1, 1, "#e6e2f0", "#9d93c4", "#4b3f8a") },
  intelligence: { scale: 0.85, obsidian: true, surf: SL(0, 2, "#cfd8dc", "#6f8c99", "#2f4552") },
  creation: { scale: 1.55, orbital: true, surf: SL(1, 3, "#efe2d6", "#c08aa0", "#6b3a55") },
  operations: { scale: 1.9, ring: "#d9c39a", obsidian: true, surf: SL(0, 4, "#e8dcc4", "#b8946a", "#6c7d92") }, // orbits are spaced so its ring (size × 2.3) clears its neighbours
  agents: { scale: 1.9, ring: "#c4b5fd", surf: SL(0, 5, "#ede3cf", "#c49a6c", "#8f88b0") }, // the biggest world
  life: { scale: 0.63, obsidian: true, orbital: true, surf: SL(3, 6, "#8a9a78", "#1d4e6b", "#eef3f5") },
  vault: { scale: 0.79, ring: "#e2e8ee", surf: SL(2, 7, "#b9a27a", "#7a6a52", "#3c342a") },
  analytics: { scale: 1.0, ring: "#b3abea", obsidian: true },
  studio: { scale: 1.1, orbital: true, surf: SL(0, 9, "#ecd9cc", "#b8725e", "#5a3a40") },
  theater: { scale: 0.9, ring: "#fbbf24", obsidian: true, surf: SL(1, 10, "#f0e3c8", "#c9984a", "#5e4632") },
  markets: { scale: 0.85, ring: "#34d399", surf: SL(3, 11, "#a7b39a", "#0f5a55", "#e9f1ef") },
  business: { scale: 0.85, obsidian: true },
  arch: { scale: 0.9, halo: true, surf: SL(2, 13, "#c3c7cf", "#8a909b", "#474c56") },
};
const CORE_RING = 3.7 * 0.62; // the CORE's outer ring at the overview (coreScale): worlds keep clear of it

/* ---------- scene pieces ---------- */

function OrbitPath({ r, warn = false }: { r: number; warn?: boolean }) {
  return (
    <mesh rotation-x={Math.PI / 2}>
      <ringGeometry args={[r - (warn ? 0.03 : 0.007), r + (warn ? 0.03 : 0.007), 256]} />
      <meshBasicMaterial color={warn ? "#f43f5e" : "#cfe0ff"} transparent opacity={warn ? 0.6 : 0.05} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Moons({ count, reduced, spread }: { count: number; reduced: boolean; spread: () => number }) {
  const g = useRef<THREE.Group>(null);
  const items = useMemo(
    () => Array.from({ length: Math.min(count, 40) }, (_, i) => {
      const a = i * 2.399963; // golden angle spreads moons evenly
      const r = 0.72 + (i % 5) * 0.1; // a tight swarm: the inner moons stay clear of the CORE's rings
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
  useFrame((_, dt) => { if (g.current) { if (!reduced) g.current.rotation.y += dt * 0.4; g.current.scale.setScalar(spread()); } });
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
function AgentSatellite({ size, active, reduced, offset = 0, spread }: { size: number; active: boolean; reduced: boolean; offset?: number; spread: () => number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.visible = active;
    const a = (reduced ? 0.8 : clock.elapsedTime * 2) + offset;
    ref.current.position.set(Math.cos(a) * size * 2.2, Math.sin(a * 0.7) * size * 0.4, Math.sin(a) * size * 2.2).multiplyScalar(spread());
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
    const on = age >= 0 && age < 0.3 ? Math.sin((age / 0.3) * Math.PI) ** 2 * 0.7 : 0; // one soft flash: no strobe
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

function Planet({ p, index, selected, onSelect, onHover, positions, pulses, memoryCount, reduced, agentBusy = 0, failing = false, life = null, still = false, segs = 128, light, shell = 0, level = 1, scales, feel, arrive }: {
  p: PlanetDef; index: number; selected: boolean; onSelect: (id: PanelId) => void; onHover: (id: PlanetId, on: boolean) => void;
  positions: Positions; pulses: RefObject<Record<string, number>>; memoryCount: number; reduced: boolean;
  agentBusy?: number; failing?: boolean; // agentBusy = number of satellites to show
  life?: { done: number; total: number } | null; still?: boolean; // still = reduced motion or low quality: no animation
  segs?: number; // sphere segments: fewer on lower quality levels
  light?: Light; // living universe: busy worlds glow a touch, idle ones dim a touch
  shell?: number; // thought-cluster particles around the world
  level?: number; // quality level: caps the close-up detail octaves and the LOD mesh
  scales?: Scales;
  feel?: RefObject<Feel>; // the eased pointer: worlds lean toward it a touch
  arrive?: RefObject<Arrive>;
}) {
  const group = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const look = LOOKS[p.id];
  const size = planetSize(p);
  const phase = index * 0.95;
  const hovered = useRef(false);
  const flash = useRef(0); // lightning flash, briefly lights the storm world from inside
  const tapT = useRef<ReturnType<typeof setTimeout>>(undefined); // touch has no hover-out: clear the hover (leader label) after a beat
  const rim = useRim(); // cold fresnel rim: brighter on hover / focus so the world pops off the dark
  const liquid = useLiquidMetal(p.color, !!look.obsidian, size, rim.onBeforeCompile, look.surf, true); // lite at start: see useLiquidMetal
  useEffect(() => { liquid.u.uIdent.value = 0; }, [liquid]); // the galaxy: a thin atmosphere rim, not a glowing blob
  // first light: drawn until the surface program has compiled (registered while rendering: before the canvas's warm-up)
  useMemo(() => standIn(liquid.mat, planetStandIn(liquid.u, liquid.mat, rim.u)), [liquid, rim]);
  const base = useMemo(() => liquid.mat.color.clone(), [liquid]);
  const lit = useRef(light); lit.current = light;
  const pulse = useCallback(() => glow(pulses, p.id), [pulses, p.id]);
  // Procedural LOD: detail (0 overview .. 1 close-up) drives the shader octaves, the surface swarm, the ring's fine
  // ticks, and a denser sphere once the world is big on screen (level 2+ only; swapped in place, no re-render).
  const detail = useRef(0);
  const near = useCallback(() => detail.current, []);
  const spread = useCallback(() => { const a = arrive?.current; return a && a.id === p.id ? arrivalSpread(a.k) : 1; }, [arrive, p.id]);
  // Unseen change: the surface pattern re-seeds a little each time the world leaves the screen
  const seed0 = useMemo(() => liquid.u.uSeed.value.clone(), [liquid]);
  const off = useRef({ off: false });
  // the x-ray lens: the pointer's hit minus the world's centre (world units: it stays under a still cursor while the surface
  // turns), and that point on the planet's unit sphere
  const lensHit = useRef({ p: new THREE.Vector3(), local: new THREE.Vector3(0, 0, 1), on: false });
  useEffect(() => { // with this frame's final matrices and camera (parallax included): the rays inside the lens line up
    const m = mesh.current;
    if (!m) return;
    m.onBeforeRender = (_r, _s, cam) => {
      const U = liquid.u, lh = lensHit.current, g = group.current;
      if (lh.on && g) m.worldToLocal(lh.local.copy(g.position).add(lh.p)).normalize();
      if (U.uLensK.value > 0) m.worldToLocal(U.uCamL.value.copy(cam.position)).multiplyScalar(1 / size);
    };
    return () => { m.onBeforeRender = () => {}; };
  }, [liquid, size]);
  const [micro, setMicro] = useState(false); // the micro-world mounts on the first approach (never for a world only seen from afar)
  const lo = useMemo(() => new THREE.SphereGeometry(size, segs, segs), [size, segs]);
  // The close-up sphere (~100k vertices) is built the first time this world is approached, not at mount:
  // 13 of them up front froze the first render for seconds on the owner's PC.
  const hi = useRef<THREE.SphereGeometry | null>(null);
  useEffect(() => { // built in an idle moment after start-up, not mid-flight (an 800 ms frame was measured when built on approach)
    hi.current?.dispose(); hi.current = null;
    if (level < 2) return;
    const ric: (cb: () => void) => number = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb) => window.setTimeout(cb, 200));
    let alive = true;
    const t = window.setTimeout(() => ric(() => { if (alive && !hi.current) hi.current = new THREE.SphereGeometry(size, 192, 192); }), 3000 + index * 400); // staggered: one world per idle slot
    return () => { alive = false; clearTimeout(t); };
  }, [size, level, index]);
  useEffect(() => () => { lo.dispose(); hi.current?.dispose(); }, [lo]);
  const tilt = useMemo<[number, number, number]>(() => [Math.PI / 2 - 0.3 + Math.sin(index * 2.1) * 0.35, 0, Math.cos(index * 1.3) * 0.4], [index]);

  useFrame(({ clock, camera, size: vp }, dt) => {
    const a = phase + (reduced ? 0 : clock.elapsedTime * p.speed);
    const x = Math.cos(a) * p.radius, z = Math.sin(a) * p.radius;
    // Levitation: a slow vertical bob, so worlds float instead of sitting on rails.
    const y = reduced ? 0 : Math.sin(clock.elapsedTime * 0.4 + phase * 2) * 0.12 * size;
    group.current?.position.set(x, y, z);
    positions[p.id].set(x, y, z);
    liquid.u.uTime.value = reduced ? 0 : clock.elapsedTime;
    if (look.surf && !reduced && !selected) {
      _v.set(x, y, z).project(camera);
      if (offscreenEdge(off.current, _v.z > 1 || Math.abs(_v.x) > 1.3 || Math.abs(_v.y) > 1.3)) {
        const r = Math.random;
        liquid.u.uSeed.value.set(seed0.x + (r() - 0.5) * 0.16, seed0.y + (r() - 0.5) * 0.16, seed0.z + (r() - 0.5) * 0.16);
      }
    }
    if (mesh.current) {
      if (!reduced) mesh.current.rotation.y += dt * 0.18;
      // Real backend events and lightning add a brief flare. Nothing glows at rest otherwise.
      const m = liquid.mat, l = lit.current;
      m.emissiveIntensity = glow(pulses, p.id) * 0.8 + flash.current * 0.6 + (l?.glow ?? 0) * 0.18;
      m.color.copy(base).multiplyScalar(1 - (l?.dim ?? 0)); // dim is clamped to [0, 0.15] in universe-pure
    }
    // Hover lifts the planet a little; eases, never snaps.
    // Overview: far worlds are enlarged to a minimum on-screen size so each reads as a world, not a dot.
    const boost = selected ? 1 : Math.min(boostCap(size, p.radius, CORE_RING), overviewBoost(size, camera.position.distanceTo(positions[p.id]), (camera as THREE.PerspectiveCamera).fov ?? 50, 0.042));
    const g = group.current;
    if (g) {
      g.scale.setScalar(expDamp(g.scale.x, (hovered.current || selected ? 1.08 : 1) * boost, 0.12, dt));
      if (scales) scales[p.id] = g.scale.x;
      // Lusion-like inertia: the world leans a little toward the pointer (already eased; this adds a second, slower lag).
      const f = feel?.current, on = f && !reduced ? f.on * (hovered.current ? 1.6 : 1) : 0;
      g.rotation.x = expDamp(g.rotation.x, f && on ? -f.y * 0.07 * on : 0, 0.5, dt);
      g.rotation.z = expDamp(g.rotation.z, f && on ? -f.x * 0.07 * on : 0, 0.5, dt);
    }
    rim.u.uRim.value = expDamp(rim.u.uRim.value, hovered.current ? 0.7 : selected ? 0.35 : 0.1, 0.12, dt);
    if (group.current) {
      const d = planetDetail(size, camera.position.distanceTo(group.current.position), level); // true size: the boost adds presence, not detail
      detail.current = d;
      if (!micro && d > 0.02 && level > 0) setMicro(true);
      liquid.u.uDetail.value = d;
      liquid.u.uOct.value = 3 + 5 * d;
      liquid.u.uFar.value = 1 - d;
      const m = mesh.current, want = hi.current && d > 0.35 ? hi.current : lo;
      if (m && m.geometry !== want) m.geometry = want;
    }
    // Cursor x-ray: the lens eases across the unit sphere toward the pointer's hit (its local point is refreshed just
    // before the planet draws, see onBeforeRender), and fades in and out.
    const gp = group.current, U = liquid.u, lh = lensHit.current, lensOn = hovered.current && lh.on ? 1 : 0;
    if (lensOn) {
      const L = U.uLens.value, T = lh.local;
      if (U.uLensK.value < 0.02 || reduced) L.copy(T);
      else L.set(expDamp(L.x, T.x, 0.07, dt), expDamp(L.y, T.y, 0.07, dt), expDamp(L.z, T.z, 0.07, dt)).normalize();
    }
    U.uLensK.value = reduced ? lensOn : expDamp(U.uLensK.value, lensOn, lensOn ? 0.2 : 0.28, dt);
    if (U.uLensK.value < 1e-3 && !lensOn) U.uLensK.value = 0;
    if (U.uLensK.value > 0 && gp) {
      const dist = Math.max(0.1, camera.position.distanceTo(gp.position));
      U.uLensR.value = lensRadius(((size * gp.scale.x) / (dist * Math.tan(THREE.MathUtils.degToRad(((camera as THREE.PerspectiveCamera).fov ?? 50) / 2)))) * (vp.height / 2), 115);
    }
  });

  return (
    <>
      <OrbitPath r={p.radius} warn={failing} />
      <group ref={group}>
        <mesh
          ref={mesh}
          material={liquid.mat}
          geometry={lo}
          rotation-z={0.2}
          onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}
          onPointerOver={(e) => {
            hovered.current = true; onHover(p.id, true); document.body.style.cursor = "pointer";
            clearTimeout(tapT.current);
            if (e.pointerType === "touch") tapT.current = setTimeout(() => { hovered.current = false; onHover(p.id, false); }, 2500);
          }}
          onPointerMove={(e) => {
            const g = group.current, lh = lensHit.current;
            if (!g) return;
            lh.p.copy(e.point).sub(g.position);
            if (!lh.on) e.object.worldToLocal(lh.local.copy(e.point)).normalize(); // first touch: start where the pointer is
            lh.on = true;
          }}
          onPointerOut={() => { clearTimeout(tapT.current); hovered.current = false; lensHit.current.on = false; onHover(p.id, false); document.body.style.cursor = ""; }}
        >
          {level > 0 && micro && <MicroWorld size={size} u={liquid.u} level={level} orbital={!!look.orbital} body={look.surf?.pal[0] ?? p.color} seed={index + 1} />}
        </mesh>
        {look.halo && <Ringworld size={size} u={liquid.u} detail={near} reduced={reduced} />}
        <ThoughtShell size={size} color={p.color} count={shell} reduced={reduced} glow={pulse} near={near} />
        <HoloRing size={size} color={p.color} tilt={tilt} reduced={reduced} detail={near} />
        {p.id === "intelligence" && <Lightning size={size} reduced={reduced} flash={flash} />}
        {look.ring && <PlanetRing size={size} color={look.ring} />}
        {p.id === "memory" && <Moons count={memoryCount} reduced={reduced} spread={spread} />}
        {p.id === "life" && life && <LifeRing size={size} done={life.done} total={life.total} still={still} />}
        {Array.from({ length: Math.min(agentBusy, 5) }, (_, k) => (
          <AgentSatellite key={k} size={size} active reduced={reduced} offset={(k * Math.PI * 2) / Math.min(agentBusy, 5)} spread={spread} />
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



/** Visible thinking: when a planet gets a backend event, a light pulse runs from the CORE along an arc to it (plan #2).
 *  One additive line per planet; 40 points recoloured on the CPU each frame only while its 3 s glow is alive. */
const BEAM_N = 40;
function Beams({ positions, pulses, reduced }: { positions: Positions; pulses: RefObject<Record<string, number>>; reduced: boolean }) {
  const lines = useMemo(() => PLANETS.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BEAM_N * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(BEAM_N * 3), 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const l = new THREE.Line(g, m); l.frustumCulled = false; l.visible = false;
    return { id: p.id, line: l, col: new THREE.Color(p.color) };
  }), []);
  useEffect(() => () => lines.forEach(({ line }) => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }), [lines]);
  const mid = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const { id, line, col } of lines) {
      const g = glow(pulses, id);
      line.visible = g > 0.01 && !!positions[id];
      if (!line.visible) continue;
      const to = positions[id], pos = line.geometry.attributes.position as THREE.BufferAttribute, c = line.geometry.attributes.color as THREE.BufferAttribute;
      mid.copy(to).multiplyScalar(0.5); mid.y += 1.5 + to.length() * 0.12; // arc over the plane
      const head = reduced ? 1 : Math.min(1, (1 - g) * 2.2); // the head reaches the planet in the first ~1.4 s, then the trail fades
      for (let i = 0; i < BEAM_N; i++) {
        const t = i / (BEAM_N - 1), b = 2 * (1 - t) * t, d = t * t; // quadratic Bézier from the CORE (origin) via mid to the planet
        pos.setXYZ(i, b * mid.x + d * to.x, b * mid.y + d * to.y, b * mid.z + d * to.z);
        const k = (t <= head ? 0.25 + 0.75 * Math.exp(-((head - t) ** 2) / 0.004) : 0) * g * 1.6; // bright head, faint trail behind it
        c.setXYZ(i, col.r * k, col.g * k, col.b * k);
      }
      pos.needsUpdate = true; c.needsUpdate = true;
    }
  });
  return <>{lines.map(({ id, line }) => <primitive key={id} object={line} />)}</>;
}

function NeuralCore({ onSelect, pulses, busy, warning, reduced, particles = 0, level, aligned }: Pick<GalaxyProps, "onSelect" | "pulses" | "busy" | "warning" | "reduced"> & { particles?: number; level: number; aligned: boolean }) {
  const sat = useRef<THREE.Mesh>(null);
  const voice = useRef({ mic: 0, speak: 0 }); // smoothed copy of voiceLevel (read per frame, no React state)
  const live = useRef<CoreLive>({ g: 0, mic: 0, spk: 0, breath: 0 }); // handed to the singularity and the particle swarm each frame
  const [pcFailed, setPcFailed] = useState(false); // no float render targets: the singularity alone carries the CORE
  const onPcFail = useCallback(() => setPcFailed(true), []);
  const swarm = particles > 0 && !pcFailed;
  const hit = useRef<THREE.Mesh>(null);

  useFrame(({ clock, camera }, dt) => {
    const t = clock.elapsedTime;
    hit.current?.scale.setScalar(coreScale(camera.position.length()));
    const g = glow(pulses, "core");
    // Breathing: slow when idle, quicker while CORE is answering; events make it flare.
    const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * (busy ? 2.6 : 1.05));
    // Voice: mic = the user talking, speak = ORBIT talking.
    // Everything is clamped finite and >= 0: one NaN or negative pixel gets smeared over the screen by the bloom blur.
    const lv = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const v = voice.current;
    v.mic = lv(v.mic + (lv(voiceLevel.mic) - v.mic) * (1 - Math.exp(-step * 14)));
    v.speak = lv(v.speak + (lv(voiceLevel.speak) - v.speak) * (1 - Math.exp(-step * 8)));
    const amp = reduced ? 0.3 : 1;
    const L = live.current; L.g = g; L.mic = v.mic * amp; L.spk = v.speak * amp; L.breath = breath;
    if (sat.current) {
      const a = busy && !reduced ? t * 2.2 : 0; // orbits only while a real CORE request is in flight
      sat.current.position.set(Math.cos(a) * 3.1, 0.3, Math.sin(a) * 3.1);
      sat.current.visible = busy;
    }
  });

  return (
    <group>
      <pointLight intensity={2.7} decay={0} color="#fff1dc" /> {/* no falloff: inner worlds would blow out, outer ones go dark */}
      <Singularity live={live} reduced={reduced} level={level} aligned={aligned} />
      {swarm && <group scale={0.62}><ParticleCore side={particles} busy={busy} warning={warning} live={live} onFail={onPcFail} /></group>}
      {/* Invisible hit area. */}
      <mesh ref={hit} onClick={(e) => { e.stopPropagation(); onSelect("core"); }}
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
function LabelProjector({ positions, scales, labels, leaders, hover, selected, hud, story, reduced }: {
  positions: Positions; scales: Scales; labels: RefObject<Record<string, HTMLSpanElement | null>>; leaders: RefObject<Record<string, HTMLSpanElement | null>>;
  hover: RefObject<PlanetId | null>; selected: PanelId | null; hud: RefObject<HudEls>; story: RefObject<Story>; reduced: boolean;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const st = useRef({ t: 0, text: "" });
  const sc = useMemo(() => { const n = BODIES.length; const f = () => new Float64Array(n); return { x: f(), y: f(), prio: f(), vis: f(), alpha: f(), order: f(), ax: f(), ay: f(), ox: f(), oy: f(), la: f() }; }, []);
  useFrame(({ camera, size, controls }, scaled) => {
    const dt = realDt(scaled); // labels track the camera in real time, even dilated
    const els = labels.current;
    if (!els) return;
    const S = story.current, stopId = S.stop >= 0 ? PLANETS[S.stop].id : null, h0 = hover.current;
    for (let i = 0; i < BODIES.length; i++) {
      const id = BODIES[i], el = els[id];
      const p = i > 0 ? PLANETS[i - 1] : undefined;
      if (!p) v.set(0, -2.4, 0);
      else { const s = scales[id] ?? 1; v.copy(positions[id]); v.y -= (planetSize(p) + 0.5) * s; }
      v.project(camera);
      const visible = !!el && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      sc.x[i] = ((v.x + 1) / 2) * size.width; sc.y[i] = ((1 - v.y) / 2) * size.height;
      // Journey: only the current stop. Overview: hovered > opened > CORE > outer worlds; overlapping ones give way.
      sc.prio[i] = !visible ? -1 : stopId ? (id === stopId ? 1 : -1) : id === h0 ? 1000 : id === selected ? 900 : !p ? 100 : p.radius;
    }
    // Nudge labels off the CORE's glare and apart from each other; only what still overlaps is culled.
    const cam = camera as THREE.PerspectiveCamera, cd = Math.max(0.1, camera.position.length());
    v.set(0, 0, 0).project(camera);
    const cr = ((4.4 * coreScale(cd)) / (cd * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))) * (size.height / 2); // the lens's Einstein radius in px
    spreadLabels(sc.x, sc.y, LABEL_W, 22, sc.prio, 0, ((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height,
      v.z < 1 && cr < size.height * 0.2 ? cr : 0, 56, sc.ax, sc.ay); // close to the CORE the glare is the scene: no push
    cullLabels(sc.x, sc.y, LABEL_W, 22, sc.prio, sc.vis, sc.order); // culled on the settled layout, so it never flickers
    const lines = leaders.current;
    for (let i = 0; i < BODIES.length; i++) {
      const id = BODIES[i], el = els[id];
      if (!el) continue;
      // The de-collision nudge eases over time (no per-frame jumps when two labels trade places); the anchor tracks the world exactly.
      const tx = sc.x[i] - sc.ax[i], ty = sc.y[i] - sc.ay[i];
      sc.ox[i] = reduced ? tx : damp(sc.ox[i], tx, 6, dt); sc.oy[i] = reduced ? ty : damp(sc.oy[i], ty, 6, dt);
      const hw = LABEL_W[i] / 2 + 6; // keep the whole label on screen (worlds at the edge used to push theirs off it)
      const lx = Math.min(size.width - hw, Math.max(hw, sc.ax[i] + sc.ox[i])), ly = Math.min(size.height - 14, Math.max(14, sc.ay[i] + sc.oy[i]));
      el.style.transform = `translate(-50%, -50%) translate(${lx}px, ${ly}px)`;
      const goal = sc.vis[i] * introLabelAlpha(S.intro, i, BODIES.length);
      let a = reduced ? goal : damp(sc.alpha[i], goal, 8, dt);
      if (Math.abs(a - goal) < 0.01) a = goal; // snap: damp never lands, and a frozen 0.03-0.07 leaves ghost labels
      if (a !== sc.alpha[i]) { sc.alpha[i] = a; el.style.opacity = a === 0 ? "0" : a.toFixed(3); }
      // c11 hairline leader: from the world's anchor to a label that had to move away from it
      const ln = lines?.[id];
      if (!ln) continue;
      const dx = lx - sc.ax[i], dy = ly - 9 - (sc.ay[i] - 12), len = Math.hypot(dx, dy); // label top edge to just under the world
      const la = a * Math.min(1, Math.max(0, (len - 12) / 14)) * 0.55;
      if (la > 0.005) ln.style.transform = `translate(${sc.ax[i]}px, ${sc.ay[i] - 12}px) rotate(${Math.atan2(dy, dx)}rad) scaleX(${len})`;
      if (Math.abs(la - sc.la[i]) > 0.004 || (la === 0 && sc.la[i] !== 0)) { sc.la[i] = la; ln.style.opacity = la <= 0.005 ? "0" : la.toFixed(3); }
    }
    const h = hover.current, leader = hud.current.leader;
    const hp = h ? PLANETS.find((x) => x.id === h) : undefined;
    if (leader && hp) { // start the leader line on the planet's upper-right limb
      const dist = Math.max(0.1, camera.position.distanceTo(positions[hp.id]));
      const rPx = ((planetSize(hp) * 1.08) / (dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))) * (size.height / 2) * 0.72;
      v.copy(positions[hp.id]).project(camera);
      leader.style.visibility = v.z < 1 ? "visible" : "hidden";
      leader.style.transform = `translate(${((v.x + 1) / 2) * size.width + rPx}px, ${((1 - v.y) / 2) * size.height - rPx}px)`;
    }
    if (hp) { // the cursor ring's magnet: the hovered world's centre and radius on screen (shortcut: assumes the canvas fills the page, as it does)
      v.copy(positions[hp.id]).project(camera);
      if (v.z < 1) {
        const T = cursorTarget, dist = Math.max(0.1, camera.position.distanceTo(positions[hp.id]));
        T.at = performance.now(); T.label = hp.name;
        T.script = sc.alpha[BODIES.indexOf(hp.id)] > 0.3; // its own label already names it: the ring shows the script instead
        T.r = ((planetSize(hp) * (scales[hp.id] ?? 1)) / (dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))) * (size.height / 2);
        T.x = ((v.x + 1) / 2) * size.width; T.y = ((1 - v.y) / 2) * size.height;
      }
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

function Rig({ selected, positions, reduced, panelOpen, fast, story, arrive }: { selected: PanelId | null; positions: Positions; reduced: boolean; panelOpen: boolean; fast?: boolean; story: RefObject<Story>; arrive: RefObject<Arrive> }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  // A flight: eased from where the camera is now to a goal that keeps updating (planets orbit while we fly),
  // lifted on an arc so it swoops over the system instead of cutting through it.
  // Critically damped (smoothDamp) toward the goal, in the focused planet's moving frame so its orbit adds no lag.
  // A planet fly-to is instead an inertia-less arrival (`arr`): a fixed-length ease-in that ends in a dead stop.
  const flight = useRef<{ base: THREE.Vector3; prev: THREE.Vector3 | null; vel: THREE.Vector3; velT: THREE.Vector3; d0: number; time: number; arc: number;
    arr?: { from: THREE.Vector3; fromT: THREE.Vector3; t: number; T: number } } | null>(null);
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
    arrive.current.id = selected; arrive.current.k = 1;
    if (reduced) { camera.position.copy(goal); controls.target.copy(tgt); controls.update(); flight.current = null; return; }
    const focus = focusOf();
    // smoothTime: the glide visually lands in ~3x this (the old timed flight took <= 1.2 s fast, <= 2.4 s otherwise)
    flight.current = { base: camera.position.clone(), prev: focus ? focus.clone() : null, vel: new THREE.Vector3(), velT: new THREE.Vector3(), d0: Math.max(1e-3, dist),
      time: fastRef.current ? Math.min(0.36, 0.2 + dist / 130) : Math.min(0.75, 0.33 + dist / 66), arc: Math.min(6, dist * 0.22),
      arr: focus ? { from: camera.position.clone(), fromT: controls.target.clone(), t: 0, T: arrivalSecs(dist, !!fastRef.current) } : undefined };
    if (focus) arrive.current.k = 0;
  }, [selected, controls, camera, reduced, goals, goal, tgt, focusOf, arrive]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => { flight.current = null; arrive.current.k = 1; }; // the user grabbed the view: hand control back
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls, arrive]);

  // Keep the focused object left of the side panel on wide screens.
  useEffect(() => {
    if (panelOpen && size.width >= 900) camera.setViewOffset(size.width, size.height, 210, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [panelOpen, size, camera]);

  useFrame((_, scaled) => {
    const dt = realDt(scaled); // camera flights keep real time, even dilated
    if (!controls) return;
    if (story.current.owns) { flight.current = null; return; } // the intro / scroll journey is driving the camera
    const f = flight.current;
    if (f?.arr) {
      goals();
      const focus = focusOf(), A = f.arr;
      if (focus && f.prev) { delta.copy(focus).sub(f.prev); A.from.add(delta); A.fromT.add(delta); f.prev.copy(focus); }
      A.t += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const e = easeInStop(A.t / A.T, 0.25); // speed only grows; at e = 1 the camera is simply there
      camera.position.lerpVectors(A.from, goal, e);
      camera.position.y += Math.sin(Math.PI * e) * f.arc;
      controls.target.lerpVectors(A.fromT, tgt, e);
      arrive.current.k = e;
      if (e >= 1) flight.current = null;
    } else if (f) {
      goals();
      const focus = focusOf();
      if (focus && f.prev) { delta.copy(focus).sub(f.prev); f.base.add(delta); controls.target.add(delta); f.prev.copy(focus); }
      smoothDampVec(f.base, goal, f.vel, f.time, dt); // eases in from rest, never overshoots
      smoothDampVec(controls.target, tgt, f.velT, f.time, dt);
      const e = 1 - Math.min(1, f.base.distanceTo(goal) / f.d0);
      camera.position.copy(f.base);
      camera.position.y += Math.sin(Math.PI * e) * f.arc; // lifted on an arc: swoops over the system
      if (f.base.distanceToSquared(goal) < 1e-4 && controls.target.distanceToSquared(tgt) < 1e-4) flight.current = null;
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
/* Time dilation: the scene's clock (dt and elapsedTime for every useFrame) runs at dilationScale. One patch on the canvas's
   clock, no shader changes; the frame loop and WarmCompile's hold are untouched. Reduced motion: no change (already still). */
let frameScale = 1;
/** This frame's real seconds, for what must not slow down: frame-rate monitors, camera flights, labels. */
const realDt = (dt: number) => dt / frameScale;
function Dilation({ span, reduced }: { span: GalaxyProps["dilation"]; reduced: boolean }) {
  const clock = useThree((s) => s.clock);
  const ref = useRef(span);
  ref.current = span;
  useEffect(() => {
    clock.getDelta = function getDelta(this: THREE.Clock) {
      const d = THREE.Clock.prototype.getDelta.call(this);
      frameScale = reduced ? 1 : dilationScale(ref.current, Date.now());
      this.elapsedTime -= d * (1 - frameScale);
      return d * frameScale;
    };
    return () => { delete (clock as Partial<THREE.Clock>).getDelta; frameScale = 1; };
  }, [clock, reduced]);
  return null;
}

function QualityMonitor({ level, max, onLevel }: { level: QualityLevel; max: QualityLevel; onLevel: (l: QualityLevel) => void }) {
  const st = useRef({ warm: 0, frames: 0, t: 0, worst: 0, q: { level, low: 0, high: 0 } as QualityState });
  useEffect(() => { st.current.q = { ...st.current.q, level, low: 0, high: 0 }; st.current.warm = 0; }, [level]); // a level change hitches: re-warm
  useFrame((_, scaled) => {
    const s = st.current, dt = realDt(scaled);
    if ((s.warm += dt) < 2) return; // first frames compile shaders and upload textures
    s.frames++; s.t += dt; s.worst = Math.max(s.worst, dt * 1000);
    if (s.t < 0.5) return;
    s.q = stepQuality(s.q, s.frames / s.t, s.t, max, s.worst); // a steady vsync-halved 30 fps is not strain
    s.frames = 0; s.t = 0; s.worst = 0;
    if (s.q.level !== level) onLevel(s.q.level);
  });
  return null;
}

/** Tells the page the scene has drawn a couple of frames, so the loader can fade out. The preloader's real milestones:
 *  context up (60), start-up shaders compiled (90, from WarmCompile), first frames (100). It used to compile the scene
 *  itself, before the reflection map was baked: every env-mapped program (the planets, the CORE's rings) compiled twice. */
function FirstFrames({ onReady }: { onReady: () => void }) {
  const n = useRef(0);
  useEffect(() => { markPreload(60); }, []);
  useFrame(() => { if (++n.current === 3) { perfMark("galaxy-drawn"); onReady(); } });
  return null;
}
const compiled = () => markPreload(90);

/** Render resolution for the frame rate: a pixel cap, and a scale that steps down while frames run long and back up when
 *  there is headroom (lib/render-scale-pure). Remembered per PC. The DOM UI is not affected; it stays crisp. */
function RenderScale({ max, onDpr }: { max: number; onDpr: (dpr: number) => void }) {
  const size = useThree((s) => s.size);
  const st = useRef({ s: loadScale(), warm: 0, frames: 0, t: 0, worst: 0, low: 0, high: 0 });
  useEffect(() => { onDpr(renderDpr(size.width, size.height, devicePixelRatio, max, st.current.s.scale)); st.current.warm = 0; }, [size.width, size.height, max, onDpr]);
  useFrame((_, scaled) => {
    const r = st.current, dt = realDt(scaled);
    if ((r.warm += dt) < 2) return; // start-up and every resize hitch: no evidence
    r.frames++; r.t += dt; r.worst = Math.max(r.worst, dt * 1000);
    if (r.t < 0.5) return;
    const next = stepScale(r.s, r.frames / r.t, r.t, r.worst, scaleFloor(devicePixelRatio, max));
    r.frames = 0; r.t = 0; r.worst = 0;
    if (next.scale !== r.s.scale) {
      saveScale(next);
      onDpr(renderDpr(size.width, size.height, devicePixelRatio, max, next.scale));
      r.warm = 0;
    }
    r.s = next;
  });
  return null;
}
const SCALE_KEY = "orbit.render.scale";
function loadScale(): ScaleState { try { const v = Number(localStorage.getItem(SCALE_KEY)); return newScale(v); } catch { return newScale(1); } }
function saveScale(s: ScaleState) { try { localStorage.setItem(SCALE_KEY, String(s.scale)); } catch { /* storage off */ } }

export default function Galaxy(props: GalaxyProps) {
  const positions = useMemo<Positions>(() => Object.fromEntries(PLANETS.map((p) => [p.id, new THREE.Vector3()])), []);
  const scales = useMemo<Scales>(() => Object.fromEntries(PLANETS.map((p) => [p.id, 1])), []);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});
  const leaders = useRef<Record<string, HTMLSpanElement | null>>({});
  const glr = useGlRecovery();
  const staged = useStageActive(); // one-canvas spike: a world renders in this canvas, the galaxy scene sits idle
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => { const t = setTimeout(onReady, 20_000); return () => clearTimeout(t); }, [onReady]); // safety cap only: the loader stays until frames draw
  const max: QualityLevel = props.reduced ? 1 : 3;
  // Start at the level this PC settled on last time: every level change rebuilds the scene and recompiles shaders
  // (~1 s freeze measured on the owner's PC), so climbing 1 → 2 → 3 on each load felt like lag.
  const [autoLevel, setAutoLevelRaw] = useState<QualityLevel>(() => { try { const raw = localStorage.getItem("orbit.quality.level"), v = raw === null ? NaN : Number(raw); return (v >= 0 && v <= 3 ? v : 1) as QualityLevel; } catch { return 1; } });
  const setAutoLevel = useCallback((l: QualityLevel) => setAutoLevelRaw((cur) => {
    try { localStorage.setItem("orbit.quality.level", String(l)); } catch { /* storage off */ }
    return l > cur ? cur : l; // upgrades only take effect on the next load: each live rebuild froze ~1.3 s (freeze log, owner PC)
  }), []);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const mode = props.quality ?? "auto";
  const level: QualityLevel = mode === "high" ? 3 : mode === "low" ? 0 : (Math.min(autoLevel, max) as QualityLevel);
  perfCtx.level = level; perfCtx.selected = props.selected ?? null; perfCtx.paused = !!props.paused; // read by the freeze log
  const q = QUALITY[level];
  const motion = useRef<Motion>({ speed: 0 });
  const arrive = useRef<Arrive>({ id: null, k: 1 });
  const [feelInit] = useState(newFeel);
  const feel = useRef<Feel>(feelInit);
  useEffect(() => { markPreload(35); }, []); // the 3D chunk has loaded and mounted
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
  const [dpr, setDpr] = useState<number | null>(null); // RenderScale's choice; until then the plain range
  const windows = level > 0 && !props.reduced; // window planets + the dive: off on level 0 and under reduced motion
  const film = q.film && !props.reduced; // grain is motion, aberration is motion: both off for reduced motion
  const dof = q.dof && !props.reduced;
  // The camera story: intro flight on every fresh load, then wheel = travel planet to planet (not with reduced motion).
  const [intro, setIntro] = useState(!props.reduced);
  const [introMs] = useState(intro ? INTRO_SECS * 1000 : 900); // HUD title decrypts in step with the intro
  const [stop, setStop] = useState(-1);
  perfCtx.stop = stop;
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
      <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={(props.paused && !staged) || !visible ? "never" : "always"} aria-hidden camera={{ position: HOME.toArray(), fov: 50 }} dpr={dpr ?? [1, dprMax]}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}>
        <color attach="background" args={["#000003"]} />
        {/* Depth haze: far orbits and belts sink into the void (shader layers ignore it). */}
        <fogExp2 attach="fog" args={["#010208", 0.0055]} />
        <ambientLight intensity={0.06} color="#9aa8c0" /> {/* low fill: the CORE is the sun, worlds get a real day and night side */}
        {level > 0 && <GalaxyVeil reduced={props.reduced} />}
        <NeuralArms count={armCount(level)} reduced={props.reduced} />
        <Stars radius={110} depth={60} count={level === 0 || props.reduced ? Math.min(2000, q.stars) : 4500} factor={2.6} fade speed={props.reduced ? 0 : 0.15} />
        {/* No drei <Sparkles>: its shader writes negative alpha, which turns into NaN in the bloom blur and blacks out the screen. */}
        <Dust count={q.dust} reduced={props.reduced} feel={feel} />
        <NeuralCore onSelect={props.onSelect} pulses={props.pulses} busy={props.busy} warning={props.warning} reduced={props.reduced} particles={props.reduced ? 0 : coreParticleSide(level)} level={level} aligned={props.selected === "core"} />
        <Filaments positions={positions} pulses={props.pulses} reduced={props.reduced} />
        <Beams positions={positions} pulses={props.pulses} reduced={props.reduced} />
        {/* Main belt between MEMORY and INTELLIGENCE, and an outer belt beyond ANALYTICS, as in the reference. */}
        <AsteroidBelt inner={5.5} outer={6.0} count={Math.round(900 * q.belt)} seed={3} reduced={props.reduced} />
        <AsteroidBelt inner={32} outer={34} count={Math.round(2200 * q.belt)} seed={9} reduced={props.reduced} thickness={0.6} />
        {PLANETS.map((p, i) => (
          <Planet key={p.id} p={p} index={i} selected={props.selected === p.id} onSelect={props.onSelect} onHover={onHover}
            positions={positions} pulses={props.pulses} memoryCount={props.memoryCount} reduced={props.reduced}
            agentBusy={p.id === "intelligence" ? (props.pulseBusy ? 1 : 0) : p.id === "agents" ? props.agentsWorking : 0}
            failing={(p.id === "intelligence" && props.pulseFailed) || (p.id === "operations" && props.automationFailing)}
            life={p.id === "life" ? props.lifeProgress : null} still={props.reduced || level === 0} segs={level >= 2 ? 128 : 64} light={props.universe?.light[p.id]} shell={shellCount(level)} level={level} scales={scales} feel={feel} arrive={arrive} />
        ))}
        <WarmIn> {/* both arrive with data after the start-up compile */}
          {props.universe && <Universe u={props.universe} positions={positions} still={props.reduced || level === 0} level={level} />}
          {props.ships && <Ships tasks={props.ships.tasks} onOpen={props.ships.onOpen} positions={positions} reduced={props.reduced} />}
        </WarmIn>
        {/* a focused world may be approached until it nearly fills the view: its surface keeps resolving finer detail */}
        <OrbitControls makeDefault enabled={!staged} enablePan={false} minDistance={props.selected && props.selected in sizes ? sizes[props.selected] * 1.35 : 4} maxDistance={80} enableDamping />
        {!props.reduced && <StoryRig story={story} positions={positions} sizes={sizes} selected={props.selected} intro={intro} onIntroEnd={onIntroEnd} onStop={setStop} />}
        <Rig selected={props.selected} positions={positions} reduced={props.reduced} panelOpen={props.panelOpen} fast={props.fast} story={story} arrive={arrive} />
        {windows && <WindowDive dive={props.dive ?? null} positions={positions} sizes={sizes} scales={scales} onCross={props.onDiveCross} onCancel={props.onDiveCancel} />}
        {!props.paused && <ZoomRig home={HOME.length()} reduced={props.reduced} />} {/* zoom commands are for the world on screen */}
        <CameraFeel motion={motion} reduced={props.reduced} home={props.selected === null} story={story} />
        <PointerFeel feel={feel} enabled={!props.reduced && !coarse && !staged} />
        <Parallax feel={feel} on={!props.reduced && !staged} /> {/* after every rig: it offsets the camera they placed */}
        <LabelProjector positions={positions} scales={scales} labels={labels} leaders={leaders} hover={hover} selected={props.selected} hud={hud} story={story} reduced={props.reduced} />
        {windows && <WindowPlanets hover={hover} dive={props.dive ?? null} positions={positions} sizes={sizes} scales={scales} />}
        {process.env.NODE_ENV === "development" && <><DevStats /><FrameMark name="galaxy" /></>}
        {/* Shaders compile in parallel before the first frame. No 4 s release here: releasing mid-compile compiled the rest
            synchronously in one 14 s frame (owner's PC); the loader stays up instead. Hidden parts warm after the first frames. */}
        <WarmCompile cap={20_000} defer onDone={compiled} onLater={props.onIdle} />
        <Dilation span={props.dilation} reduced={props.reduced} />
        <RenderScale max={dprMax} onDpr={setDpr} />
        <FirstFrames onReady={onReady} />
        {mode === "auto" && !staged && <QualityMonitor level={level} max={max} onLevel={setAutoLevel} />}
        {/* Low quality drops post-processing entirely (the renderer's own ACES tone mapping still applies). */}
        {q.bloom > 0 && (
          <EffectComposer key={level} enabled={!staged} multisampling={q.msaa}>
            {/* Lensing also sets the exposure and a soft highlight knee; SMAA (a convolution) starts a new pass, so the
                bloom below reads the knee'd frame: stacked additive layers can never bloom into a white plate. */}
            <Lensing disp={level >= 2} reduced={props.reduced} exposure={1} />
            <SMAA />
            {dof ? <StoryFocus story={story} /> : <></>}
            <Bloom intensity={0.55 * (props.reduced ? 0.8 : 1) * (props.bloomScale ?? 1)} luminanceThreshold={0.82} luminanceSmoothing={0.22} mipmapBlur radius={0.7} />
            {film ? <MotionAberration motion={motion} /> : <></>}
            <Vignette offset={0.3} darkness={0.62} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
            {film ? <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.04} /> : <></>}
          </EffectComposer>
        )}
        <StageOut />
      </Canvas>
      <div style={{ display: staged ? "none" : "contents" }}>
      <GalaxyLoader done={ready} />
      <GalaxyHud selected={props.selected} hoverSet={hoverSet} els={hud} introMs={introMs} />
      {!props.reduced && <StoryReadout stop={stop} intro={intro} onOpen={onSelect} />}
      {!props.reduced && <StoryRail stop={stop} on={!intro && selected === null} onGo={(n) => story.current.goTo(n)} />}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {BODIES.map((id) => <span key={`l-${id}`} ref={(el) => { leaders.current[id] = el; }} className="planet-leader" />)}
        <span ref={(el) => { labels.current.core = el; }} className="planet-label absolute left-0 top-0" style={{ color: props.warning ? "#fb7185" : "#efe6d6" }}>
          CORE{props.warning ? " · last request failed" : ""}
          <AlienScript text="CORE" className="planet-script" />
          {props.busy && <InkGlyph reduced={props.reduced} />}
        </span>
        {PLANETS.map((p) => ( // calm labels (c11): pearl, with a breath of the world's identity colour
          <span key={p.id} ref={(el) => { labels.current[p.id] = el; }} className="planet-label absolute left-0 top-0" style={{ color: `color-mix(in srgb, ${p.color} 38%, #e4e9f2)` }}>{p.name}<AlienScript text={p.name} className="planet-script" /></span>
        ))}
      </div>
      </div>
    </div>
  );
}
