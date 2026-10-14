"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { PLANETS, type PanelId, type PlanetDef, type PlanetId } from "@/lib/planets";

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
  t.anisotropy = 4;
  return t;
}

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
function rayTexture(seed: number) {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.translate(256, 256);
  g.globalCompositeOperation = "lighter";
  for (let k = 0; k < 36; k++) {
    g.save();
    g.rotate((k / 36) * Math.PI * 2 + r() * 0.15);
    const len = 140 + r() * 116, w = 2 + r() * 6;
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, "rgba(255,225,160,0.55)");
    grad.addColorStop(1, "rgba(255,140,40,0)");
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill();
    g.restore();
  }
  return toTexture(softened(c, 1.5));
}

/** Sun surface: hot orange with bright granulation. */
function sunTexture() {
  const r = rng(7);
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ff9a1f"; g.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 1400; k++) {
    g.globalAlpha = 0.2 + r() * 0.4;
    g.fillStyle = r() > 0.5 ? "#ffe27a" : "#ff6a00";
    g.beginPath(); g.arc(r() * c.width, r() * c.height, 3 + r() * 18, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  return toTexture(softened(c, 4));
}


/* ---------- photo textures generated with Higgsfield (Z Image) ---------- */

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3K4zaF8Ip5JyEmwNLHr5iAw89pD/hf_20261014_";
// crop = [x0, y0, x1, y1] as fractions: trims the black edges some generations have.
const PHOTOS: Record<PlanetId | "core", { file: string; id: string; crop: [number, number, number, number] }> = {
  core: { file: "sun", id: "132007_89489601-ef9a-4a64-9a5e-3955d8016cc1", crop: [0.3, 0.15, 0.7, 0.85] },
  memory: { file: "earth", id: "132007_5069b2ba-e1d5-4358-847b-eadc908f6cdb", crop: [0.1, 0.14, 0.9, 0.86] },
  intelligence: { file: "mars", id: "132007_10628adb-15c9-4186-bd1a-99febee610bc", crop: [0, 0, 1, 1] },
  creation: { file: "jupiter", id: "132007_4da0094a-caa6-4cea-8462-fade03c8a9b4", crop: [0.22, 0.12, 0.78, 0.88] },
  operations: { file: "saturn", id: "132007_8f5fc6c9-1651-462d-a321-0b8d85dd539e", crop: [0, 0, 1, 1] },
  agents: { file: "violet", id: "132037_343842e2-f778-4495-8159-41fc45fe3bf3", crop: [0, 0.02, 1, 0.98] },
  life: { file: "teal", id: "132036_10c1157e-cf14-4c33-90cd-d9a7c9b08993", crop: [0.04, 0.02, 0.95, 0.98] },
  vault: { file: "ice", id: "132100_675fcf9c-0c65-463e-b812-60469ef6e392", crop: [0, 0, 1, 1] },
  analytics: { file: "neptune", id: "132100_aa064c0f-5651-4b4d-bc6a-651939d7f66a", crop: [0, 0.02, 1, 0.98] },
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

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
  return toTexture(c);
}

/** Local copy first (run `npm run textures`), then Higgsfield's CDN, else null (procedural look stays). */
function usePhoto(key: PlanetId | "core") {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let dead = false;
    let made: THREE.Texture | null = null;
    const { file, id, crop } = PHOTOS[key];
    loadImage(`/textures/${file}.png`)
      .catch(() => loadImage(`${CDN}${id}.png`))
      .then((img) => { if (!dead) { made = photoTexture(img, crop); setTex(made); } })
      .catch(() => { /* offline: keep the painted texture */ });
    return () => { dead = true; made?.dispose(); };
  }, [key]);
  return tex;
}

const planetSize = (p: PlanetDef) => p.size * LOOKS[p.id].scale * 1.25;

type Look = { kind: "band" | "rock"; colors: string[]; base?: string; ring?: string; scale: number };

// Planet looks inspired by the reference: earth-like, mars-like, banded giants, ringed giants, ice giants.
const LOOKS: Record<PlanetId, Look> = {
  memory: { kind: "rock", base: "#1f5fa8", colors: ["#2f8f4e", "#3fa35e", "#e8eef5", "#174b86"], scale: 1 },
  intelligence: { kind: "rock", base: "#b5532a", colors: ["#8a3a1c", "#d0784a", "#6e2a14"], scale: 0.85 },
  creation: { kind: "band", colors: ["#c9773b", "#e8b27a", "#a85a2a", "#f1d1a8", "#b8662f", "#d99a5c"], scale: 1.55 },
  operations: { kind: "band", colors: ["#d8b07a", "#c49460", "#ead2a6", "#b98654"], ring: "#d9c39a", scale: 1.3 },
  agents: { kind: "band", colors: ["#a78bfa", "#c4b5fd", "#8b6fe8", "#ddd6fe"], ring: "#c4b5fd", scale: 1.15 },
  life: { kind: "rock", base: "#1f8a6e", colors: ["#2bb08a", "#146b55", "#7fd6b8"], scale: 0.9 },
  vault: { kind: "band", colors: ["#e9eef2", "#cfd9e0", "#f5f7f9", "#bcc8d1"], ring: "#e2e8ee", scale: 1.05 },
  analytics: { kind: "band", colors: ["#8f86c9", "#a59de0", "#7b72b8", "#c3bdf0"], ring: "#b3abea", scale: 1.0 },
};

/* ---------- scene pieces ---------- */

function OrbitPath({ r, warn = false }: { r: number; warn?: boolean }) {
  return (
    <mesh rotation-x={Math.PI / 2}>
      <ringGeometry args={[r - (warn ? 0.03 : 0.01), r + (warn ? 0.03 : 0.01), 192]} />
      <meshBasicMaterial color={warn ? "#f43f5e" : "#cfe0ff"} transparent opacity={warn ? 0.6 : 0.16} side={THREE.DoubleSide} depthWrite={false} />
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
  useFrame((_, dt) => { if (g.current && !reduced) g.current.rotation.y += dt * 0.4; });
  return (
    <group ref={g}>
      {items.map((m, i) => (
        <mesh key={i} position={[m.x, m.y, m.z]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshBasicMaterial color="#e9e4ff" />
        </mesh>
      ))}
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

function PlanetRing({ size, color }: { size: number; color: string }) {
  return (
    <group rotation={[Math.PI / 2 - 0.45, 0.15, 0]}>
      <mesh>
        <ringGeometry args={[size * 1.35, size * 1.85, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh>
        <ringGeometry args={[size * 1.9, size * 2.3, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Planet({ p, index, selected, onSelect, positions, pulses, memoryCount, reduced, agentBusy = 0, failing = false }: {
  p: PlanetDef; index: number; selected: boolean; onSelect: (id: PanelId) => void;
  positions: Positions; pulses: RefObject<Record<string, number>>; memoryCount: number; reduced: boolean;
  agentBusy?: number; failing?: boolean; // agentBusy = number of satellites to show
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
  const isEarth = p.id === "memory";
  const clouds = useRef<THREE.Mesh>(null);
  const cloudTex = useMemo(() => (isEarth ? cloudTexture(21) : null), [isEarth]);
  useEffect(() => () => cloudTex?.dispose(), [cloudTex]);
  const phase = index * 0.95;

  useFrame(({ clock }) => {
    const a = phase + (reduced ? 0 : clock.elapsedTime * p.speed);
    const x = Math.cos(a) * p.radius, z = Math.sin(a) * p.radius;
    group.current?.position.set(x, 0, z);
    positions[p.id].set(x, 0, z);
    if (mesh.current) {
      if (!reduced) mesh.current.rotation.y += 0.003;
      if (clouds.current && !reduced) clouds.current.rotation.y += 0.0045; // clouds drift a little faster than the ground
      // Real backend events for this planet make it flare in its own colour.
      (mesh.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.04 + glow(pulses, p.id) * 1.2 + (selected ? 0.25 : 0);
    }
  });

  return (
    <>
      <OrbitPath r={p.radius} warn={failing} />
      <group ref={group}>
        <mesh
          ref={mesh}
          rotation-z={0.2}
          onClick={(e) => { e.stopPropagation(); onSelect(p.id); }}
          onPointerOver={() => (document.body.style.cursor = "pointer")}
          onPointerOut={() => (document.body.style.cursor = "")}
        >
          <sphereGeometry args={[size, 64, 64]} />
          <meshStandardMaterial map={photo ?? map} emissive={p.color} roughness={0.85} metalness={0} />
        </mesh>
        {cloudTex && (
          <mesh ref={clouds} scale={1.025} rotation-z={0.2}>
            <sphereGeometry args={[size, 64, 64]} />
            <meshStandardMaterial map={cloudTex} transparent depthWrite={false} roughness={1} />
          </mesh>
        )}
        <mesh scale={isEarth ? 1.09 : 1.06}>
          <sphereGeometry args={[size, 32, 32]} />
          <meshBasicMaterial color={isEarth ? "#7cc4ff" : p.color} transparent opacity={isEarth ? 0.16 : 0.1}
            side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {look.ring && <PlanetRing size={size} color={look.ring} />}
        {p.id === "memory" && <Moons count={memoryCount} reduced={reduced} />}
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
      <meshStandardMaterial color="#9a8a72" roughness={1} flatShading />
    </instancedMesh>
  );
}

/** Coloured gas clouds far behind the system, like the green/teal haze in the reference. */
function Nebula() {
  const clouds = useMemo(() => {
    const tex = (c: string) => glowTexture([[0, c], [0.45, c.replace(/[\d.]+\)$/, "0.12)")], [1, "rgba(0,0,0,0)"]]);
    return [
      { t: tex("rgba(31,163,138,0.55)"), pos: [-30, -12, -55] as [number, number, number], s: 80 },
      { t: tex("rgba(46,125,90,0.5)"), pos: [35, -6, -60] as [number, number, number], s: 70 },
      { t: tex("rgba(110,70,190,0.45)"), pos: [5, 10, -70] as [number, number, number], s: 90 },
      { t: tex("rgba(20,90,140,0.45)"), pos: [-50, 4, 10] as [number, number, number], s: 70 },
      { t: tex("rgba(40,150,120,0.35)"), pos: [45, -10, 25] as [number, number, number], s: 60 },
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

function Core({ onSelect, pulses, busy, warning, reduced }: Pick<GalaxyProps, "onSelect" | "pulses" | "busy" | "warning" | "reduced">) {
  const star = useRef<THREE.Mesh>(null);
  const corona = useRef<THREE.Sprite>(null);
  const sat = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => ({
    surface: sunTexture(),
    inner: glowTexture([[0, "rgba(255,240,180,1)"], [0.25, "rgba(255,190,70,0.75)"], [0.6, "rgba(255,120,20,0.18)"], [1, "rgba(0,0,0,0)"]]),
    outer: glowTexture([[0, "rgba(255,170,60,0.45)"], [0.5, "rgba(255,110,20,0.1)"], [1, "rgba(0,0,0,0)"]]),
    haze: glowTexture([[0, "rgba(255,200,120,0.22)"], [0.35, "rgba(255,140,60,0.07)"], [1, "rgba(0,0,0,0)"]]),
    rays: rayTexture(5),
  }), []);
  const rays = useRef<THREE.SpriteMaterial>(null);
  const rays2 = useRef<THREE.SpriteMaterial>(null);
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex]);
  const photo = usePhoto("core");

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = glow(pulses, "core");
    if (star.current && !reduced) star.current.rotation.y += 0.0015;
    const breathe = reduced ? 0 : Math.sin(t * 1.3) * 0.04;
    corona.current?.scale.setScalar(7.5 * (1 + g * 0.35 + breathe));
    if (!reduced) {
      if (rays.current) rays.current.rotation = t * 0.02;
      if (rays2.current) rays2.current.rotation = -t * 0.013;
    }
    if (sat.current) {
      // The satellite only orbits while a real CORE request is in flight.
      const a = busy && !reduced ? t * 2.2 : 0;
      sat.current.position.set(Math.cos(a) * 2.4, 0.3, Math.sin(a) * 2.4);
      sat.current.visible = busy;
    }
  });

  return (
    <group>
      <pointLight intensity={22} decay={1} color="#ffe2b0" />
      <mesh ref={star} onClick={(e) => { e.stopPropagation(); onSelect("core"); }}
        onPointerOver={() => (document.body.style.cursor = "pointer")} onPointerOut={() => (document.body.style.cursor = "")}>
        <sphereGeometry args={[1.6, 64, 64]} />
        <meshBasicMaterial map={photo ?? tex.surface} toneMapped={false} />
      </mesh>
      <sprite ref={corona} scale={7.5}>
        <spriteMaterial map={tex.inner} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={16}>
        <spriteMaterial map={tex.outer} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={34}>
        <spriteMaterial map={tex.haze} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={12}>
        <spriteMaterial ref={rays} map={tex.rays} transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={9}>
        <spriteMaterial ref={rays2} map={tex.rays} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <mesh ref={sat} visible={false}><sphereGeometry args={[0.14, 16, 16]} /><meshBasicMaterial color="#67e8f9" /></mesh>
      {warning && (
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[2.9, 0.035, 8, 96]} />
          <meshBasicMaterial color="#f43f5e" />
        </mesh>
      )}
    </group>
  );
}


/** Projects each body's position to screen space every frame and moves plain DOM labels there (no extra React roots). */
function LabelProjector({ positions, labels }: { positions: Positions; labels: RefObject<Record<string, HTMLSpanElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const els = labels.current;
    if (!els) return;
    for (const [id, el] of Object.entries(els)) {
      if (!el) continue;
      const p = PLANETS.find((x) => x.id === id);
      if (id === "core") v.set(0, -2.4, 0);
      else if (p) { v.copy(positions[id]); v.y -= planetSize(p) + 0.5; }
      v.project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.opacity = visible ? "1" : "0";
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

// Low, oblique view like the reference illustration.
const HOME = new THREE.Vector3(-6, 9, 30);

function Rig({ selected, positions, reduced, panelOpen }: { selected: PanelId | null; positions: Positions; reduced: boolean; panelOpen: boolean }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  // A flight: eased from where the camera is now to a goal that keeps updating (planets orbit while we fly),
  // lifted on an arc so it swoops over the system instead of cutting through it.
  const flight = useRef<{ from: THREE.Vector3; fromT: THREE.Vector3; t: number; dur: number; arc: number } | null>(null);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  const delta = useMemo(() => new THREE.Vector3(), []);

  const focusOf = useCallback(() => (selected && selected !== "profile" && selected !== "core" ? positions[selected] : null), [selected, positions]);
  const goals = useCallback(() => {
    const focus = focusOf();
    if (focus) { tgt.copy(focus); goal.copy(focus).add(delta.set(2.6, 1.8, 3.8)); }
    else { tgt.set(0, 0, 0); goal.copy(selected === "core" ? delta.set(0, 3, 9) : HOME); }
  }, [focusOf, selected, goal, tgt, delta]);

  useEffect(() => {
    if (!controls) return;
    goals();
    const dist = camera.position.distanceTo(goal);
    flight.current = { from: camera.position.clone(), fromT: controls.target.clone(), t: reduced ? 1 : 0, dur: Math.min(2.4, 1 + dist / 22), arc: Math.min(6, dist * 0.22) };
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

export default function Galaxy(props: GalaxyProps) {
  const positions = useMemo<Positions>(() => Object.fromEntries(PLANETS.map((p) => [p.id, new THREE.Vector3()])), []);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});
  return (
    <div className="relative h-full w-full">
      <Canvas aria-hidden camera={{ position: HOME.toArray(), fov: 50 }} dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}>
        <color attach="background" args={["#02040b"]} />
        <ambientLight intensity={0.55} />
        <Nebula />
        <Stars radius={110} depth={60} count={props.reduced ? 2000 : 6000} factor={3.2} fade speed={props.reduced ? 0 : 0.5} />
        <Sparkles count={props.reduced ? 60 : 140} scale={[70, 24, 70]} size={4} speed={props.reduced ? 0 : 0.25} color="#ffffff" opacity={0.9} />
        <Core onSelect={props.onSelect} pulses={props.pulses} busy={props.busy} warning={props.warning} reduced={props.reduced} />
        {/* Main belt between MEMORY and INTELLIGENCE, and an outer belt beyond ANALYTICS, as in the reference. */}
        <AsteroidBelt inner={5.5} outer={6.0} count={900} seed={3} reduced={props.reduced} />
        <AsteroidBelt inner={21.5} outer={23.5} count={1800} seed={9} reduced={props.reduced} thickness={0.6} />
        {PLANETS.map((p, i) => (
          <Planet key={p.id} p={p} index={i} selected={props.selected === p.id} onSelect={props.onSelect}
            positions={positions} pulses={props.pulses} memoryCount={props.memoryCount} reduced={props.reduced}
            agentBusy={p.id === "intelligence" ? (props.pulseBusy ? 1 : 0) : p.id === "agents" ? props.agentsWorking : 0}
            failing={(p.id === "intelligence" && props.pulseFailed) || (p.id === "operations" && props.automationFailing)} />
        ))}
        <OrbitControls makeDefault enablePan={false} minDistance={4} maxDistance={60} enableDamping />
        <Rig selected={props.selected} positions={positions} reduced={props.reduced} panelOpen={props.panelOpen} />
        <LabelProjector positions={positions} labels={labels} />
      </Canvas>
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
