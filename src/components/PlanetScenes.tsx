"use client";
// Planet worlds v2: the 3D scenes for OPERATIONS, VAULT, BUSINESS, ANALYTICS and LIFE, built from planet-scenes-pure
// (real data) with the shared world-kit look. Each scene is a handful of draw calls (instancing), lit PBR with a baked
// env, emissive parts carried by bloom. Chips (counts, names) are made here and drawn by PlanetWorld's ChipLayer.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Capsule, Crystals, LightShaft, Many, Motes, Plate, PlanetGround, rockGeometry, useWorldTier, type Chip, type CrystalIn, type Inst } from "./world-kit";
import { lifeGarden } from "@/lib/worlds-v3-pure";
import { AssetMany, RealOr } from "./world-assets";
import { BIZ_STAGES, GATE_ANGLE, GATE_COLOR, VAULT_KIND_COLOR, bizScene, bytes, clip, fmtMin, heightAt, lifeScene, opsScene, podAngle, timeScene, vaultScene, type SceneId } from "@/lib/planet-scenes-pure";
import { STAGE_COLOR } from "@/lib/living-galaxy-pure";

type T = (k: never, v?: Record<string, string | number>) => string;
export type SceneModel =
  | { id: "operations"; m: ReturnType<typeof opsScene> } | { id: "vault"; m: ReturnType<typeof vaultScene> } | { id: "business"; m: ReturnType<typeof bizScene> }
  | { id: "analytics"; m: ReturnType<typeof timeScene> } | { id: "life"; m: ReturnType<typeof lifeScene> };

export function buildModel(id: SceneId, json: unknown, now: number): SceneModel {
  switch (id) {
    case "operations": return { id, m: opsScene(json, now) };
    case "vault": return { id, m: vaultScene(json, now) };
    case "business": return { id, m: bizScene(json, now) };
    case "analytics": return { id, m: timeScene(json) };
    default: return { id: "life", m: lifeScene(json) };
  }
}

/** Camera per scene: where it looks from and how far it may move. */
export const CAMERA: Record<SceneId, { pos: [number, number, number]; target: [number, number, number]; min: number; max: number }> = {
  operations: { pos: [0, 9.5, 14], target: [0, 0.5, 0], min: 6, max: 30 },
  vault: { pos: [0, 5.2, 13.5], target: [0, 2.4, 0], min: 5, max: 24 },
  business: { pos: [0, 6.5, 15], target: [0, 3, 0], min: 6, max: 30 },
  analytics: { pos: [0, 11, 17], target: [0, 1.5, 0], min: 6, max: 36 },
  life: { pos: [0, 5.5, 11.5], target: [0, 0.6, 0], min: 5, max: 22 },
};
export const THEME: Record<SceneId, { bg: string; glow: string; key: string; ground?: [string, string] }> = {
  operations: { bg: "#02050a", glow: "#22d3ee", key: "#dff6ff", ground: ["#06090f", "#122030"] },
  vault: { bg: "#060402", glow: "#ffb347", key: "#ffe2b0" },
  business: { bg: "#04040a", glow: "#ff9f43", key: "#fff0d8", ground: ["#0a0a10", "#1c1a22"] },
  analytics: { bg: "#01030a", glow: "#3b82f6", key: "#cfe2ff" },
  life: { bg: "#140b10", glow: "#ffcf8a", key: "#ffd9a8" },
};

/* ---------- chips ---------- */

export function sceneChips(s: SceneModel, t: T, zone: (k: string) => string): Chip[] {
  const tt = t as (k: string, v?: Record<string, string | number>) => string;
  switch (s.id) {
    case "operations": {
      const out: Chip[] = s.m.gates.map((g) => { const a = GATE_ANGLE[g.gate];
        return { id: `g:${g.gate}`, at: [Math.cos(a) * 7.6, 1.9, Math.sin(a) * 7.6], title: zone(g.gate === "needs" ? "waiting" : g.gate), value: String(g.count),
          sub: g.today ? tt("w2.today", { n: g.today }) : undefined, color: GATE_COLOR[g.gate], prio: 10 + (g.count ? 5 : 0),
          dot: g.gate === "running" ? "busy" : g.gate === "needs" ? "warn" : g.gate === "failed" ? "bad" : g.gate === "done" ? "ok" : "idle" }; });
      out.push({ id: "hub", at: [0, 3.4, 0], title: tt("w2.hub"), value: s.m.summary.split(",")[0], color: "#22d3ee", prio: 8 });
      const run = s.m.pods.filter((p) => p.moving), n = run.length;
      run.slice(0, 3).forEach((p) => { const a = podAngle(p, n); out.push({ id: `p:${p.id}`, at: [Math.cos(a) * 6, 0.8, Math.sin(a) * 6], title: clip(p.title, 30), sub: p.agent || undefined, color: GATE_COLOR.running, prio: 4, dot: "busy" }); });
      return out;
    }
    case "vault": return s.m.kinds.map((k): Chip => { const a = (k.from + k.to) / 2;
      return { id: `k:${k.kind}`, at: [Math.cos(a) * 7.4, 5.4, Math.sin(a) * 7.4], title: tt(`pw.kind.${k.kind}`) || k.kind, value: String(k.count), sub: bytes(k.bytes), color: VAULT_KIND_COLOR[k.kind] ?? VAULT_KIND_COLOR.other, prio: k.count }; })
      .concat([{ id: "core", at: [0, 4.2, 0] as [number, number, number], title: "VAULT", value: tt("w2.files", { n: s.m.count }), sub: bytes(s.m.total), color: "#ffb347", prio: 100 }]);
    case "business": return s.m.tiers.map((tr, i): Chip => ({ id: `t:${tr.stage}`, at: [-(tr.r + 0.4) * 0.72, tr.y + 0.2, (tr.r + 0.4) * 0.7] as [number, number, number], title: tt(`bz.stage.${tr.stage}`),
      value: String(tr.count), sub: tr.fees ? tt("w2.paying", { n: Math.round(tr.fees) }) : undefined, color: tr.color, prio: 20 - i }))
      .concat(s.m.ships.filter((p) => p.fee > 0).sort((a, b) => b.fee - a.fee).slice(0, 3).map((p) => ({ id: `s:${p.id}`, at: [Math.cos(p.angle) * p.r, p.y + 0.7, Math.sin(p.angle) * p.r] as [number, number, number],
        title: clip(p.name, 24), sub: tt("w2.paying", { n: Math.round(p.fee) }), color: STAGE_COLOR[p.stage as keyof typeof STAGE_COLOR] ?? "#fff", prio: 3 })));
    case "analytics": return s.m.peaks.length ? s.m.peaks.map((p, i): Chip => ({ id: `k:${p.name}`, at: [p.x, heightAt(s.m.peaks, p.x, p.z) + 0.6, p.z] as [number, number, number], title: clip(p.name, 24),
      value: fmtMin(p.minutes), sub: tt("w2.share", { n: Math.round((p.minutes / Math.max(1, s.m.total)) * 100) }), color: "#60a5fa", prio: 20 - i }))
      : [{ id: "none", at: [0, 1.2, 0], title: tt("w2.noTime"), color: "#60a5fa" }];
    case "life": return s.m.pods.map((p) => ({ id: `h:${p.id}`, at: [p.at[0], 1.9, p.at[2]] as [number, number, number], title: clip(p.name, 22),
      value: p.done ? tt("w2.done") : p.due ? tt("w2.notYet") : undefined, sub: p.streak ? tt("w2.streak", { n: p.streak }) : undefined, color: p.done ? "#86efac" : "#ffd9a8", dot: p.done ? "ok" : "idle", prio: p.done ? 2 : 3 }));
  }
}

/* ---------- shared bits ---------- */

const usePhys = (o: THREE.MeshPhysicalMaterialParameters, deps: unknown[] = []) => {
  const m = useMemo(() => new THREE.MeshPhysicalMaterial(o), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => m.dispose(), [m]);
  return m;
};
const glowMat = (c: string, k = 2) => <meshBasicMaterial color={new THREE.Color(c).multiplyScalar(k)} toneMapped={false} />;

/** Instanced boxes in a ring: hull plating, shelves, seats. */
function RingBlocks({ n, r, y, size, color, emissive, k = 0, skip }: { n: number; r: number; y: number; size: [number, number, number]; color: string; emissive?: string; k?: number; skip?: (i: number) => boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => { const mesh = ref.current; if (!mesh) return; const o = new THREE.Object3D(); let j = 0;
    for (let i = 0; i < n; i++) { if (skip?.(i)) continue; const a = (i / n) * Math.PI * 2; o.position.set(Math.cos(a) * r, y, Math.sin(a) * r); o.rotation.set(0, -a, 0); o.updateMatrix(); mesh.setMatrixAt(j++, o.matrix); }
    mesh.count = j; mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }, [n, r, y, skip]);
  return <instancedMesh ref={ref} args={[undefined, undefined, n]}><boxGeometry args={size} /><meshStandardMaterial color={color} metalness={0.85} roughness={0.3} emissive={emissive ?? "#000"} emissiveIntensity={k} /></instancedMesh>;
}

/* ---------- OPERATIONS ---------- */

function Operations({ m, reduced }: { m: ReturnType<typeof opsScene>; reduced: boolean }) {
  const hull = usePhys({ color: "#1b2330", metalness: 0.9, roughness: 0.28, clearcoat: 0.5 });
  const pods = useRef<THREE.InstancedMesh>(null), globe = useRef<THREE.Group>(null);
  const nRun = m.pods.filter((p) => p.moving).length;
  const o = useMemo(() => new THREE.Object3D(), []), c = useMemo(() => new THREE.Color(), []);
  const place = (t: number) => { const mesh = pods.current; if (!mesh) return;
    m.pods.forEach((p, i) => { const a = podAngle(p, nRun) + (p.moving && !reduced ? Math.sin(t * 0.22 + i * 1.3) * 0.3 : 0);
      o.position.set(Math.cos(a) * 6, 0.5, Math.sin(a) * 6); o.rotation.set(0, -a, Math.PI / 2); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); });
    mesh.instanceMatrix.needsUpdate = true; };
  useLayoutEffect(() => { const mesh = pods.current; if (!mesh) return; mesh.count = m.pods.length;
    m.pods.forEach((p, i) => mesh.setColorAt(i, c.set(GATE_COLOR[p.gate]).multiplyScalar(p.moving ? 2.2 : p.gate === "done" ? 0.7 : 1.3)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; place(0); mesh.computeBoundingSphere(); }, [m.pods]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => { if (reduced) return; place(clock.elapsedTime); if (globe.current) globe.current.rotation.y = clock.elapsedTime * 0.15; });
  return (<group>
    <PlanetGround glow="#22d3ee" a="#05080d" b="#101a26" />
    {/* deck ring, lane and outer hull */}
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.2, 0]} material={hull}><ringGeometry args={[4.6, 7.1, 128, 1]} /></mesh>
    <mesh position={[0, 0.05, 0]} material={hull}><cylinderGeometry args={[7.2, 7.4, 0.35, 128, 1, true]} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.23, 0]}><ringGeometry args={[5.9, 6.1, 160]} />{glowMat("#22d3ee", 1.6)}</mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.23, 0]}><ringGeometry args={[6.95, 7.0, 160]} />{glowMat("#38bdf8", 0.9)}</mesh>
    <RingBlocks n={72} r={7.55} y={0.55} size={[0.5, 0.9, 0.4]} color="#121820" emissive="#7dd3fc" k={0.04} />
    <RingBlocks n={36} r={4.4} y={0.45} size={[0.35, 0.5, 0.3]} color="#10161e" emissive="#22d3ee" k={0.12} />
    {/* spokes and gates */}
    {Object.entries(GATE_ANGLE).map(([g, a]) => (<group key={g} rotation-y={-a}>
      <mesh position={[2.6, 0.3, 0]} material={hull}><boxGeometry args={[3.2, 0.18, 0.5]} /></mesh>
      <mesh position={[2.6, 0.4, 0]}><boxGeometry args={[3.2, 0.03, 0.08]} />{glowMat(GATE_COLOR[g as keyof typeof GATE_COLOR], 1.5)}</mesh>
      <group position={[6, 0.25, 0]}>
        <mesh rotation-y={Math.PI / 2} material={hull}><torusGeometry args={[0.95, 0.14, 12, 48, Math.PI]} /></mesh>
        <mesh rotation-y={Math.PI / 2}><torusGeometry args={[0.95, 0.035, 8, 48, Math.PI]} />{glowMat(GATE_COLOR[g as keyof typeof GATE_COLOR], 2.4)}</mesh>
      </group>
    </group>))}
    {/* hub with the holographic globe */}
    <mesh position={[0, 0.6, 0]} material={hull}><cylinderGeometry args={[2.2, 2.7, 1.2, 64]} /></mesh>
    <mesh position={[0, 1.25, 0]} material={hull}><cylinderGeometry args={[1.7, 2.1, 0.3, 64]} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 1.41, 0]}><ringGeometry args={[1.55, 1.68, 96]} />{glowMat("#22d3ee", 2)}</mesh>
    <group ref={globe} position={[0, 2.5, 0]}>
      <mesh><icosahedronGeometry args={[0.95, 3]} /><meshStandardMaterial color="#0b3a4a" emissive="#22d3ee" emissiveIntensity={0.55} metalness={0.2} roughness={0.4} transparent opacity={0.85} /></mesh>
      <mesh scale={1.04}><icosahedronGeometry args={[0.95, 2]} /><meshBasicMaterial color="#67e8f9" wireframe transparent opacity={0.35} toneMapped={false} /></mesh>
      <mesh rotation-x={Math.PI / 2.3}><torusGeometry args={[1.35, 0.015, 6, 96]} />{glowMat("#a5f3fc", 2)}</mesh>
    </group>
    <LightShaft at={[0, 1.4, 0]} r={1.3} h={2.4} color="#22d3ee" strength={0.25} />
    {/* job pods */}
    <instancedMesh ref={pods} args={[undefined, undefined, Math.max(1, m.pods.length)]}>
      <Capsule args={[0.2, 0.62, 6, 12]} /><meshStandardMaterial color="#d8e6ff" metalness={0.6} roughness={0.25} emissive="#ffffff" emissiveIntensity={0.15} />
    </instancedMesh>
    <Motes count={reduced ? 80 : 220} color="#67e8f9" spread={12} height={5} reduced={reduced} />
  </group>);
}

/* ---------- VAULT ---------- */

const VAULT_LANTERNS: Inst[] = [-1, 1].flatMap((s) => [{ at: [s * 6, 5.6, -4.6], s: [1, 0.7, 1] }, { at: [s * 2.2, 0, 1.6], s: [1, 0.55, 1], ry: s }] as Inst[]);
const VAULT_CHESTS: Inst[] = [[-3.4, 2.4, 0.6], [3.6, 2.1, -0.5], [-4.6, -1.2, 1.2], [4.4, -1.9, -1.1]].map(([x, z, r]): Inst => ({ at: [x, 0, z], s: [1, 0.75, 1], ry: r }));

function Vault({ m, reduced }: { m: ReturnType<typeof vaultScene>; reduced: boolean }) {
  const gold = usePhys({ color: "#7a5a2a", metalness: 1, roughness: 0.32, clearcoat: 0.3 });
  const stone = usePhys({ color: "#1a140e", metalness: 0.4, roughness: 0.55, side: THREE.BackSide });
  const items = useMemo<CrystalIn[]>(() => m.crystals.map((c) => ({ at: c.at, h: c.h * 1.5, w: c.h * 0.9, color: VAULT_KIND_COLOR[c.kind] ?? VAULT_KIND_COLOR.other, glow: c.fresh ? 1.8 : 0.9 })), [m.crystals]);
  const emblem = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (emblem.current && !reduced) emblem.current.rotation.z = clock.elapsedTime * 0.05; });
  return (<group>
    <Plate r={10} h={0.5} color="#120d08" rim="#ffb347" metal={0.6} rough={0.5} />
    {[3, 5.2, 8.6].map((r) => <mesh key={r} rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}><ringGeometry args={[r, r + 0.04, 128]} />{glowMat("#ffb347", 0.7)}</mesh>)}
    {/* shelves: one arc per kind, four tiers */}
    {m.kinds.map((k) => [0, 1, 2, 3].map((row) => {
      const len = k.to - k.from;
      return (<group key={`${k.kind}${row}`}>
        <mesh position={[0, 0.5 + row * 1.15, 0]} material={gold}><cylinderGeometry args={[7.75, 7.35, 0.08, 48, 1, false, Math.PI / 2 - k.to, len]} /></mesh>
        <mesh position={[0, 0.455 + row * 1.15, 0]}><cylinderGeometry args={[7.36, 7.36, 0.02, 48, 1, true, Math.PI / 2 - k.to, len]} />{glowMat(VAULT_KIND_COLOR[k.kind] ?? "#ffb347", 1.2)}</mesh>
      </group>);
    }))}
    <mesh position={[0, 2.6, 0]} material={stone}><cylinderGeometry args={[8.3, 8.3, 5.4, 96, 1, true, Math.PI * 0.25, Math.PI * 1.5]} /></mesh>
    <Crystals items={items} reduced={reduced} intensity={0.3} />
    {/* pillars */}
    {[-1, 1].map((s) => <mesh key={s} position={[s * 6, 2.8, -4.6]} material={gold}><cylinderGeometry args={[0.35, 0.45, 5.6, 16]} /></mesh>)}
    {/* the vault door emblem and the core crystal under a skylight */}
    <group ref={emblem} position={[0, 4.2, -7.6]}>
      <mesh material={gold}><torusGeometry args={[2.6, 0.16, 16, 96]} /></mesh>
      <mesh><torusGeometry args={[2.2, 0.03, 8, 96]} />{glowMat("#ffcf7a", 2)}</mesh>
      {[0, 1, 2, 3, 4, 5].map((i) => <mesh key={i} rotation-z={(i * Math.PI) / 3} position={[0, 0, 0.05]} material={gold}><boxGeometry args={[0.08, 4.2, 0.08]} /></mesh>)}
    </group>
    <mesh position={[0, 0.35, 0]} material={gold}><cylinderGeometry args={[1.1, 1.4, 0.7, 6]} /></mesh>
    {/* v5: real brass lanterns and metal chests (Poly Haven, CC0); nothing extra on the low tier */}
    <RealOr fallback={null}>
      <AssetMany id="lantern" items={VAULT_LANTERNS} />
      <AssetMany id="chest" items={VAULT_CHESTS} />
    </RealOr>
    <Crystals items={[{ at: [0, 0.7, 0], h: 2.6, w: 1.3, color: "#ffb347", glow: 1 }]} reduced={reduced} intensity={0.8} />
    <LightShaft at={[0, 0, 0]} r={2.2} h={12} color="#ffcf8a" strength={0.3} />
    <pointLight position={[0, 2, 0]} intensity={25} distance={12} color="#ffb347" />
    <Motes count={reduced ? 100 : 300} color="#ffcf8a" spread={9} height={9} reduced={reduced} />
  </group>);
}

/* ---------- BUSINESS ---------- */

function Business({ m, reduced }: { m: ReturnType<typeof bizScene>; reduced: boolean }) {
  const hull = usePhys({ color: "#24222a", metalness: 0.9, roughness: 0.3, clearcoat: 0.4 });
  const ships = useRef<THREE.InstancedMesh>(null), traffic = useRef<THREE.Group>(null);
  useLayoutEffect(() => { const mesh = ships.current; if (!mesh) return; const o = new THREE.Object3D(), c = new THREE.Color();
    m.ships.forEach((p, i) => { o.position.set(Math.cos(p.angle) * p.r, p.y + 0.15, Math.sin(p.angle) * p.r); o.rotation.set(0, -p.angle, 0); o.scale.set(p.size * 1.5, p.size * 0.5, p.size * 0.7); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(STAGE_COLOR[p.stage as keyof typeof STAGE_COLOR] ?? "#fff").multiplyScalar(p.fresh ? 2 : 1)); });
    mesh.count = m.ships.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); }, [m.ships]);
  useFrame(({ clock }) => { if (traffic.current && !reduced) traffic.current.rotation.y = clock.elapsedTime * 0.08; });
  return (<group>
    <PlanetGround glow="#ff9f43" a="#08070a" b="#18151c" />
    <Plate r={8.2} h={0.6} y={0.1} color="#16141a" rim="#ff9f43" />
    {m.tiers.map((t, i) => (<group key={t.stage}>
      <mesh position={[0, t.y - 0.35, 0]} material={hull}><cylinderGeometry args={[t.r, t.r + 0.35, 1.0, 96]} /></mesh>
      <mesh position={[0, t.y + 0.16, 0]}><cylinderGeometry args={[t.r + 0.02, t.r + 0.02, 0.06, 96, 1, true]} />{glowMat(t.color, 2.2)}</mesh>
      <RingBlocks n={Math.round(t.r * 9)} r={t.r + 0.18} y={t.y - 0.3} size={[0.18, 0.14, 0.06]} color="#2a2630" emissive="#ffcf8a" k={1.4} skip={(j) => (j * 7 + i * 3) % 5 === 0} />
    </group>))}
    {/* spire */}
    <mesh position={[0, 7.6, 0]} material={hull}><cylinderGeometry args={[0.3, 1.6, 2.6, 8]} /></mesh>
    <mesh position={[0, 9.4, 0]} material={hull}><coneGeometry args={[0.35, 1.6, 8]} /></mesh>
    <mesh position={[0, 10.3, 0]}><sphereGeometry args={[0.12, 12, 8]} />{glowMat("#6dffae", 3)}</mesh>
    {/* docked deals */}
    <instancedMesh ref={ships} args={[undefined, undefined, Math.max(1, m.ships.length)]}>
      <coneGeometry args={[0.5, 1.4, 6]} /><meshStandardMaterial color="#c9ced8" metalness={0.8} roughness={0.25} emissive="#ffffff" emissiveIntensity={0.35} />
    </instancedMesh>
    <group ref={traffic}>{[0, 1, 2, 3].map((i) => (
      <mesh key={i} position={[Math.cos(i * 1.7) * (10 + i), 4 + i * 1.3, Math.sin(i * 1.7) * (10 + i)]} rotation-y={-i * 1.7}>
        <coneGeometry args={[0.25, 0.9, 5]} /><meshStandardMaterial color="#9aa3b5" metalness={0.8} roughness={0.3} emissive="#ffb04d" emissiveIntensity={0.6} />
      </mesh>))}</group>
    <Motes count={reduced ? 80 : 200} color="#ffcf8a" spread={14} height={9} reduced={reduced} />
  </group>);
}

/* ---------- ANALYTICS ---------- */

function Analytics({ m, reduced }: { m: ReturnType<typeof timeScene>; reduced: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(44, 32, 176, 128).rotateX(-Math.PI / 2), p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(m.peaks, p.getX(i), p.getZ(i)));
    g.computeVertexNormals(); return g;
  }, [m.peaks]);
  useEffect(() => () => geo.dispose(), [geo]);
  const wire = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: true,
    uniforms: { uT: { value: 0 } },
    vertexShader: `varying float vH; varying vec2 vP; void main(){ vH = position.y; vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position + vec3(0.0,0.01,0.0),1.0); }`,
    fragmentShader: `uniform float uT; varying float vH; varying vec2 vP; void main(){ float e = smoothstep(18.0, 6.0, length(vP));
      float scan = 0.6 + 0.4*sin(vP.x*0.6 - uT*1.2); vec3 c = mix(vec3(0.05,0.25,0.9), vec3(0.55,0.85,1.0), clamp(vH/6.0,0.0,1.0));
      gl_FragColor = vec4(c * (0.25 + vH*0.35) * scan * e, 1.0); }` }), []);
  useEffect(() => () => wire.dispose(), [wire]);
  useFrame(({ clock }) => { if (!reduced) wire.uniforms.uT.value = clock.elapsedTime; });
  return (<group>
    <mesh geometry={geo}><meshStandardMaterial color="#04081a" metalness={0.3} roughness={0.75} emissive="#0a1a4a" emissiveIntensity={0.25} /></mesh>
    <mesh geometry={geo} material={wire} />
    {m.peaks.map((p) => { const y = heightAt(m.peaks, p.x, p.z);
      return (<group key={p.name} position={[p.x, 0, p.z]}>
        <mesh position={[0, y / 2 + 0.3, 0]}><cylinderGeometry args={[0.02, 0.02, y + 0.6, 6]} />{glowMat("#93c5fd", 2.5)}</mesh>
        <mesh position={[0, y + 0.1, 0]}><sphereGeometry args={[0.11, 12, 8]} />{glowMat("#dbeafe", 3)}</mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.05, 0]}><ringGeometry args={[p.w * 0.9, p.w * 0.94, 64]} />{glowMat("#3b82f6", 1)}</mesh>
      </group>); })}
    <Motes count={reduced ? 120 : 360} color="#60a5fa" spread={18} height={7} reduced={reduced} />
  </group>);
}

/* ---------- LIFE ---------- */

/** Garden props from worlds-v3-pure lifeGarden (habit positions only): one instanced draw call per kind. */
function useLifeGarden(pods: { at: [number, number, number] }[]) {
  const key = pods.map((p) => p.at.join(",")).join(";"), tier = useWorldTier();
  const lg = useMemo(() => {
    const g = lifeGarden(pods), FL = ["#f9a8d4", "#fde68a", "#e9d5ff", "#ffffff", "#fda4af"];
    return {
      rock: tier ? rockGeometry(7.6, 8, 21, tier) : rockGeometry(7.4, 5, 21, 0), disc: new THREE.CylinderGeometry(1, 1, 1, tier ? 40 : 14), ball: new THREE.IcosahedronGeometry(0.5, tier ? 3 : 1), stem: new THREE.CylinderGeometry(0.5, 0.7, 1, 7),
      stone: new THREE.MeshStandardMaterial({ color: "#a89f8f", roughness: 0.85 }), pad: new THREE.MeshStandardMaterial({ color: "#4d8a3a", roughness: 0.7 }),
      leaf: Object.assign(new THREE.MeshStandardMaterial({ color: "#3f7a32", roughness: 0.9, flatShading: true }), { userData: { foliage: true } }), bark: new THREE.MeshStandardMaterial({ color: "#5a3e2b", roughness: 1 }),
      flower: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffd1e8", emissiveIntensity: 0.25, roughness: 0.6 }),
      blossom: Object.assign(new THREE.MeshStandardMaterial({ color: "#ffb3d1", emissive: "#ff8fbf", emissiveIntensity: 0.18, roughness: 0.8, flatShading: true }), { userData: { foliage: true } }),
      fall: new THREE.MeshBasicMaterial({ color: "#dff6ff", transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
      stones: g.stones.map((p): Inst => ({ at: [p.x, 0.03, p.z], s: [0.34 * p.s, 0.06, 0.28 * p.s], ry: p.x })),
      pads: g.pads.map((p): Inst => ({ at: [p.x, 0.05, p.z], s: [0.26 * p.s, 0.02, 0.26 * p.s] })),
      bushes: g.bushes.map((p): Inst => ({ at: [p.x, 0.17 * p.s, p.z], s: [0.55 * p.s, 0.4 * p.s, 0.55 * p.s], ry: p.z })),
      flowers: g.flowers.map((p, i): Inst => ({ at: [p.x, 0.1, p.z], s: [0.16, 0.16, 0.16], color: FL[i % FL.length] })),
      realBushes: g.bushes.map((p): Inst => ({ at: [p.x, 0, p.z], s: [1, 0.55 * p.s, 1], ry: p.z * 3 })),
      realFlowers: g.flowers.map((p): Inst => ({ at: [p.x, 0, p.z], s: [1, 0.5, 1], ry: p.x * 5 })),
      ferns: [0.4, 1.5, 2.6, 3.7, 4.8, 5.9].map((a): Inst => ({ at: [Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5], s: [1, 0.45, 1], ry: a })),
      pondRocks: [1.0, 2.9, 4.4].map((a): Inst => ({ at: [Math.cos(a) * 2.35, -0.05, Math.sin(a) * 2.35], s: [1, 0.22, 1], ry: a })),
      realTree: [{ at: [g.tree.x, 0, g.tree.z], s: [1, 5.2, 1], ry: 0.7 }] as Inst[],
      trunk: [{ at: [g.tree.x, 1.2, g.tree.z], s: [0.3, 2.4, 0.3] }] as Inst[],
      canopy: [[0, 3, 0, 2.6], [0.9, 2.6, 0.4, 1.8], [-0.8, 2.7, -0.3, 1.9], [0.2, 3.6, -0.6, 1.7], [-0.3, 2.4, 0.9, 1.5]].map(([x, y, z, k]): Inst => ({ at: [g.tree.x + x, y, g.tree.z + z], s: [k, k * 0.8, k] })),
      isles: [[-9, 6, -12, 0.5], [7, 8, -15, 0.4], [-2, 9.5, -19, 0.35]].map(([x, y, z, k]): Inst => ({ at: [x, y, z], s: [k * 0.45, k * 0.45, k * 0.45] })),
      isleTops: [[-9, 6, -12, 0.5], [7, 8, -15, 0.4], [-2, 9.5, -19, 0.35]].map(([x, y, z, k]): Inst => ({ at: [x, y + 0.1, z], s: [k * 3.3, 0.2, k * 3.3] })),
    };
  }, [key, tier]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const v of Object.values(lg)) if (v instanceof THREE.BufferGeometry || v instanceof THREE.Material) v.dispose(); }, [lg]);
  return lg;
}

function Life({ m, reduced }: { m: ReturnType<typeof lifeScene>; reduced: boolean }) {
  const glass = usePhys({ color: "#cfe8ff", metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false });
  const rock = usePhys({ color: "#3b302a", roughness: 0.9, metalness: 0, flatShading: true });
  const sky = useMemo(() => new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; void main(){ float y = vP.y; vec3 top = vec3(0.04,0.03,0.10), mid = vec3(0.45,0.18,0.16), low = vec3(0.75,0.42,0.22);
      vec3 c = mix(low, mid, smoothstep(-0.05, 0.12, y)); c = mix(c, top, smoothstep(0.1, 0.6, y));
      float sun = exp(-pow(length(vP - normalize(vec3(-0.6, 0.06, -0.8))) * 7.0, 2.0)); gl_FragColor = vec4(c*0.55 + vec3(1.0,0.7,0.4)*sun*1.2, 1.0); }` }), []);
  useEffect(() => () => sky.dispose(), [sky]);
  const seeds = useRef<THREE.Group>(null);
  const lg = useLifeGarden(m.pods);
  useFrame(({ clock }) => { if (!seeds.current || reduced) return; seeds.current.children.forEach((c, i) => { c.position.y = 0.75 + Math.sin(clock.elapsedTime * 0.8 + i) * 0.06; }); });
  return (<group>
    <mesh material={sky}><sphereGeometry args={[80, 32, 16]} /></mesh>
    <directionalLight position={[-8, 3, -10]} intensity={1.6} color="#ffb070" />
    {/* the island: grass top, jagged rock below, waterfalls off the front edge, a ring of stepping stones round the pond */}
    <mesh position={[0, -0.15, 0]}><cylinderGeometry args={[7.6, 7.4, 0.3, 64]} /><meshStandardMaterial color="#3d6b2c" roughness={0.95} flatShading /></mesh>
    <mesh position={[0, -0.3, 0]} geometry={lg.rock} material={rock} />
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}><circleGeometry args={[2.2, 48]} /><meshPhysicalMaterial color="#1d4f6b" metalness={0.1} roughness={0.05} clearcoat={1} emissive="#3aa0c8" emissiveIntensity={0.15} /></mesh>
    {[[-2.4, 7.2], [3.1, 6.9]].map(([x, z], i) => <mesh key={i} position={[x, -1.9, z]} rotation-y={Math.atan2(x, z)} material={lg.fall}><planeGeometry args={[1.1, 3.6]} /></mesh>)}
    <Many items={lg.stones} geo={lg.disc} mat={lg.stone} />
    <Many items={lg.pads} geo={lg.disc} mat={lg.pad} />
    <RealOr fallback={<><Many items={lg.bushes} geo={lg.ball} mat={lg.leaf} /><Many items={lg.flowers} geo={lg.ball} mat={lg.flower} /></>}>
      {/* v5: real CC0 plants (Poly Haven) on the same spots */}
      <AssetMany id="shrub" items={lg.realBushes} />
      <AssetMany id="flower" items={lg.realFlowers} />
      <AssetMany id="fern" items={lg.ferns} />
      <AssetMany id="rocks" items={lg.pondRocks} />
    </RealOr>
    {/* the blossom tree and three small islands floating behind */}
    <RealOr fallback={<><Many items={lg.trunk} geo={lg.stem} mat={lg.bark} /><Many items={lg.canopy} geo={lg.ball} mat={lg.blossom} /></>}>
      <AssetMany id="tree" items={lg.realTree} />
    </RealOr>
    <Many items={lg.isles} geo={lg.rock} mat={rock} />
    <Many items={lg.isleTops} geo={lg.disc} mat={lg.leaf} />
    {/* pods */}
    <group ref={seeds}>{m.pods.map((p) => (<group key={p.id} position={[p.at[0], 0, p.at[2]]}>
      <pointLight position={[0, 0.8, 0]} intensity={p.done ? 4 : 0.6} distance={3} color={p.done ? "#a7f3d0" : "#ffd9a8"} />
      <mesh position={[0, 0.75, 0]}><icosahedronGeometry args={[0.22, 1]} />{glowMat(p.done ? "#86efac" : "#7a6a55", p.done ? 2.2 : 0.6)}</mesh>
    </group>))}</group>
    {m.pods.map((p) => (<group key={p.id} position={[p.at[0], 0, p.at[2]]}>
      <mesh position={[0, 0.06, 0]}><cylinderGeometry args={[0.95, 1.05, 0.12, 32]} /><meshStandardMaterial color="#6f6553" roughness={0.6} /></mesh>
      <mesh position={[0, 0.12, 0]} material={glass}><sphereGeometry args={[0.9, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      <mesh position={[0, 0.13, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[0.88, 0.93, 48]} />{glowMat(p.done ? "#86efac" : "#ffd9a8", p.done ? 1.6 : 0.5)}</mesh>
    </group>))}
    <Motes count={reduced ? 60 : 160} color="#ffe6b0" spread={9} height={5} reduced={reduced} />
  </group>);
}

export function SceneFor({ s, reduced }: { s: SceneModel; reduced: boolean }) {
  switch (s.id) {
    case "operations": return <Operations m={s.m} reduced={reduced} />;
    case "vault": return <Vault m={s.m} reduced={reduced} />;
    case "business": return <Business m={s.m} reduced={reduced} />;
    case "analytics": return <Analytics m={s.m} reduced={reduced} />;
    case "life": return <Life m={s.m} reduced={reduced} />;
  }
}
export const STAGES = BIZ_STAGES;
