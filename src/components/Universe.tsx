"use client";
// Living universe, inside the galaxy scene: orbit lines brighten with vitality, STUDIO comets, BUSINESS moons, a MEMORY nebula.
// Everything here is additive and fades to nothing at zero data; every opacity is clamped to [0, 1] (bloom NaN rule).
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PLANETS, planetById } from "@/lib/planets";
import type { Universe as U } from "@/lib/universe-pure";
import { leadMoons, STAGE_COLOR, WARM } from "@/lib/living-galaxy-pure";

type Positions = Record<string, THREE.Vector3>;
const WARM_C = new THREE.Color(WARM); // a busy week warms its orbit
const STUDIO_R = planetById("studio")!.size * 1.4 + 0.5, BIZ_R = planetById("business")!.size * 1.3 + 0.35;

function Orbits({ u }: { u: U }) {
  return (
    <>
      {PLANETS.map((p) => {
        const o = u.light[p.id]?.orbit ?? 0;
        return (
          <mesh key={p.id} rotation-x={Math.PI / 2} visible={o > 0}>
            <ringGeometry args={[p.radius - 0.007, p.radius + 0.007, 256]} />
            <meshBasicMaterial color={new THREE.Color("#cfe0ff").lerp(WARM_C, o)} transparent opacity={Math.min(1, 0.05 + 0.13 * o)} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        );
      })}
    </>
  );
}

/** Instanced bodies circling a planet: comets (stretched along their path) or moons. One draw call each. */
function Swarm({ at, count, max, r, speed, comet, positions, still }: {
  at: string; count: number; max: number; r: number; speed: number; comet: boolean; positions: Positions; still: boolean;
}) {
  const g = useRef<THREE.Group>(null), inst = useRef<THREE.InstancedMesh>(null);
  const o = useMemo(() => { const x = new THREE.Object3D(); if (comet) x.scale.set(0.025, 0.025, 0.3); return x; }, [comet]);
  useEffect(() => { if (inst.current) inst.current.count = count; }, [count]);
  useFrame(({ clock }) => {
    const m = inst.current;
    if (!m || !g.current || count === 0) return;
    g.current.position.copy(positions[at]);
    const t = still ? 0 : clock.elapsedTime * speed;
    for (let i = 0; i < count; i++) {
      const a = t + (i * Math.PI * 2) / count, rr = r + (i % 3) * 0.12;
      o.position.set(Math.cos(a) * rr, Math.sin(a * 2 + i) * 0.15, Math.sin(a) * rr);
      o.rotation.set(0, -a, 0); // comet's long axis (z) follows the tangent
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={g}>
      <instancedMesh ref={inst} args={[undefined, undefined, max]} count={count} frustumCulled={false}>
        {comet ? <sphereGeometry args={[1, 8, 6]} /> : <sphereGeometry args={[0.05, 8, 8]} />}
        {comet
          ? <meshBasicMaterial color="#ffb4c4" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
          : <meshStandardMaterial color="#bae6fd" emissive="#38bdf8" emissiveIntensity={0.3} roughness={1} />}
      </instancedMesh>
    </group>
  );
}

/** BUSINESS leads as moons, coloured by stage (cold "to contact" → won). Golden-angle spacing: a new lead appends a moon
 *  without moving the others, and it arrives with a short flare. Scales with the planet's overview boost. One draw call. */
const MAX_LEADS = 24;
function LeadMoons({ stages, positions, scales, still }: { stages: U["stages"]; positions: Positions; scales?: Record<string, number>; still: boolean }) {
  const list = useMemo(() => leadMoons(stages, MAX_LEADS), [stages]);
  const g = useRef<THREE.Group>(null), inst = useRef<THREE.InstancedMesh>(null);
  const st = useRef({ prev: -1, born: new Float32Array(MAX_LEADS).fill(-99), pending: -1 });
  const o = useMemo(() => new THREE.Object3D(), []), c = useMemo(() => new THREE.Color(), []);
  useEffect(() => {
    const m = inst.current;
    if (!m) return;
    list.forEach((s, i) => m.setColorAt(i, c.set(STAGE_COLOR[s])));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.count = list.length;
    const S = st.current;
    if (S.prev >= 0 && list.length > S.prev && !still) S.pending = S.prev; // flare from here on, stamped on the next frame
    S.prev = list.length;
  }, [list, c, still]);
  useFrame(({ clock }) => {
    const m = inst.current, S = st.current;
    if (!m || !g.current || !list.length) return;
    const now = clock.elapsedTime;
    if (S.pending >= 0) { for (let i = S.pending; i < list.length; i++) S.born[i] = now; S.pending = -1; }
    g.current.position.copy(positions.business);
    const k = scales?.business ?? 1, t = still ? 0 : now * 0.22;
    for (let i = 0; i < list.length; i++) {
      const a = t + i * 2.399963, r = (BIZ_R + 0.25 + (i % 4) * 0.16) * k;
      const age = now - S.born[i], pop = age >= 0 && age < 1.6 ? 1 + 4 * (1 - age / 1.6) ** 2 : 1;
      o.position.set(Math.cos(a) * r, Math.sin(a * 1.7 + i) * 0.12 * k, Math.sin(a) * r);
      o.scale.setScalar(k * pop);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={g}>
      <instancedMesh ref={inst} args={[undefined, undefined, MAX_LEADS]} count={list.length} frustumCulled={false}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Nebula({ density, positions }: { density: number; positions: Positions }) {
  const s = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d")!, gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(167,139,250,0.9)"); gr.addColorStop(0.5, "rgba(139,92,246,0.25)"); gr.addColorStop(1, "rgba(139,92,246,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame(() => { s.current?.position.copy(positions.memory); });
  const k = 2.6 + 2 * density;
  return (
    <sprite ref={s} scale={[k, k, 1]}>
      <spriteMaterial map={tex} transparent opacity={Math.min(1, Math.max(0, 0.22 * density))} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

export function Universe({ u, positions, scales, still, level }: { u: U; positions: Positions; scales?: Record<string, number>; still: boolean; level: number }) {
  return (
    <>
      <Orbits u={u} />
      <Swarm at="studio" count={u.comets} max={5} r={STUDIO_R} speed={0.5} comet positions={positions} still={still} />
      <LeadMoons stages={u.stages} positions={positions} scales={scales} still={still} />
      {level > 0 && u.nebula > 0 && <Nebula density={u.nebula} positions={positions} />}
    </>
  );
}
