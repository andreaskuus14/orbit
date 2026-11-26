"use client";
// v9 OPERATIONS station detail (tier 1+): greebled habitat ring (tanks, masts, dishes, window blocks), covered spokes,
// a layered control tower with a glass band round the globe, and a gantry crane reaching over the busy lane.
// Instanced and merged: about a dozen draw calls in all.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { rng } from "@/lib/world-props-pure";

const glowMat = (c: string, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

/** Boxes, tanks and masts scattered on the ring's top face and the inner deck, in hull greys with a few tinted panels. */
function Greeble() {
  const geo = useMemo(() => ({ box: new THREE.BoxGeometry(1, 1, 1), tank: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), mast: new THREE.CylinderGeometry(0.03, 0.05, 1, 5), win: new THREE.BoxGeometry(1, 1, 1) }), []);
  const mat = useMemo(() => ({ hull: new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.75, roughness: 0.4 }), win: glowMat("#ffffff", 1.0) }), []);
  const refs = { box: useRef<THREE.InstancedMesh>(null), tank: useRef<THREE.InstancedMesh>(null), mast: useRef<THREE.InstancedMesh>(null), win: useRef<THREE.InstancedMesh>(null) };
  const N = { box: 340, tank: 70, mast: 40, win: 520 };
  useLayoutEffect(() => {
    const r = rng(77), o = new THREE.Object3D(), c = new THREE.Color(), tones = ["#3a4250", "#2b323e", "#4a5260", "#1f2630", "#56606f"], lamp = ["#ffd9a0", "#9be7ff", "#ffe2b0"];
    const put = (m: THREE.InstancedMesh | null, i: number, col: string, k = 1) => { m?.setMatrixAt(i, o.matrix); m?.setColorAt(i, c.set(col).multiplyScalar(k)); };
    for (let i = 0; i < N.box; i++) { const ring = r() < 0.7, a = r() * 6.2832, rad = ring ? 9.85 + r() * 1.25 : 4.7 + r() * 0.6, h = 0.1 + r() * (ring ? 0.55 : 0.25), w = 0.2 + r() * 0.55, d = 0.2 + r() * 0.4;
      o.position.set(Math.cos(a) * rad, 1.05 + h / 2 + (ring ? 0 : -0.8), Math.sin(a) * rad); o.rotation.set(0, -a + (r() < 0.2 ? 0.4 : 0), 0); o.scale.set(w, h, d); o.updateMatrix(); put(refs.box.current, i, tones[Math.floor(r() * tones.length)]); }
    for (let i = 0; i < N.tank; i++) { const a = r() * 6.2832, rad = 9.9 + r() * 1.2, h = 0.3 + r() * 0.5, s = 0.22 + r() * 0.2;
      o.position.set(Math.cos(a) * rad, 1.05 + h / 2, Math.sin(a) * rad); o.rotation.set(0, 0, 0); o.scale.set(s, h, s); o.updateMatrix(); put(refs.tank.current, i, tones[Math.floor(r() * 3)], 1.1); }
    for (let i = 0; i < N.mast; i++) { const a = r() * 6.2832, rad = 10 + r() * 1.0, h = 0.8 + r() * 1.3;
      o.position.set(Math.cos(a) * rad, 1.05 + h / 2, Math.sin(a) * rad); o.rotation.set((r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1); o.scale.set(1, h, 1); o.updateMatrix(); put(refs.mast.current, i, "#6b7585"); }
    for (let i = 0; i < N.win; i++) { const a = r() * 6.2832, rad = 9.8 + r() * 1.4, wy = 1.1 + r() * 0.5; // lit window blocks on the box faces
      o.position.set(Math.cos(a) * rad, wy, Math.sin(a) * rad); o.rotation.set(0, -a, 0); o.scale.set(0.1 + r() * 0.1, 0.04, 0.12 + r() * 0.1); o.updateMatrix(); put(refs.win.current, i, lamp[Math.floor(r() * 3)], 2 + r() * 1.5); }
    (Object.keys(refs) as (keyof typeof refs)[]).forEach((k) => { const m = refs[k].current; if (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mat).forEach((m) => m.dispose()); }, [geo, mat]);
  return (<group>
    <instancedMesh ref={refs.box} args={[geo.box, mat.hull, N.box]} frustumCulled={false} />
    <instancedMesh ref={refs.tank} args={[geo.tank, mat.hull, N.tank]} frustumCulled={false} />
    <instancedMesh ref={refs.mast} args={[geo.mast, mat.hull, N.mast]} frustumCulled={false} />
    <instancedMesh ref={refs.win} args={[geo.win, mat.win, N.win]} frustumCulled={false} />
  </group>);
}

/** Covered spokes between the deck and the habitat ring, with glowing seams, and a layered control tower with a glass band. */
function SpokesAndTower() {
  const hull = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a313d", metalness: 0.85, roughness: 0.35 }), []);
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#7fe8ff", transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false }), []);
  const seam = useMemo(() => glowMat("#22d3ee", 1.8), []);
  const lamp = useMemo(() => glowMat("#ffd9a0", 2.4), []);
  useEffect(() => () => { hull.dispose(); glass.dispose(); seam.dispose(); lamp.dispose(); }, [hull, glass, seam, lamp]);
  const spokes = [0.2, 0.9, 1.65, 2.35, 3.05, 3.8, 4.5, 5.45];
  return (<group>
    {spokes.map((a) => (<group key={a} rotation-y={-a}>
      <mesh position={[8.4, 0.5, 0]} rotation-z={Math.PI / 2} material={hull}><cylinderGeometry args={[0.32, 0.32, 2.7, 12]} /></mesh>
      {[7.5, 8.1, 8.7, 9.3].map((x) => <mesh key={x} position={[x, 0.5, 0]} rotation-z={Math.PI / 2} material={seam}><torusGeometry args={[0.33, 0.012, 4, 16]} /></mesh>)}
      <mesh position={[8.4, 0.82, 0]} material={lamp}><boxGeometry args={[1.9, 0.015, 0.05]} /></mesh>
    </group>))}
    {/* control tower: glass band round the globe, window tiers above, pylons and a spire */}
    <mesh position={[0, 2.5, 0]} material={glass}><cylinderGeometry args={[1.55, 1.55, 2.2, 40, 1, true]} /></mesh>
    {[1.5, 2.5, 3.6].map((y) => <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2} material={y === 2.5 ? seam : hull}><torusGeometry args={[1.58, y === 2.5 ? 0.02 : 0.05, 6, 64]} /></mesh>)}
    {Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * 1.58, 2.55, Math.sin(a) * 1.58]} material={hull}><boxGeometry args={[0.07, 2.2, 0.07]} /></mesh>; })}
    <mesh position={[0, 3.75, 0]} material={hull}><cylinderGeometry args={[1.7, 1.9, 0.3, 40]} /></mesh>
    <mesh position={[0, 4.1, 0]} material={hull}><cylinderGeometry args={[1.1, 1.5, 0.5, 32]} /></mesh>
    <mesh position={[0, 4.36, 0]} rotation-x={Math.PI / 2} material={seam}><torusGeometry args={[1.12, 0.025, 6, 48]} /></mesh>
    {[1, 2, 3].map((i) => <mesh key={i} position={[0, 4.35 + i * 0.7, 0]} material={hull}><cylinderGeometry args={[0.2 - i * 0.04, 0.25 - i * 0.04, 0.75, 8]} /></mesh>)}
    {Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * 1.9, 3.75, Math.sin(a) * 1.9]} material={lamp}><sphereGeometry args={[0.04, 6, 4]} /></mesh>; })}
  </group>);
}

/** A gantry crane over the lane: base outside the track, two arm segments and a claw above the lane. Sways slowly. angle = the lane's gate angle. */
function Crane({ angle, reduced }: { angle: number; reduced: boolean }) {
  const arm = useRef<THREE.Group>(null), claw = useRef<THREE.Group>(null);
  const hull = useMemo(() => new THREE.MeshStandardMaterial({ color: "#9aa6b6", metalness: 0.6, roughness: 0.4 }), []);
  const orange = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9741f", metalness: 0.5, roughness: 0.5 }), []);
  const cy = useMemo(() => glowMat("#67e8f9", 2.2), []);
  useEffect(() => () => { hull.dispose(); orange.dispose(); cy.dispose(); }, [hull, orange, cy]);
  useFrame(({ clock }) => { if (reduced) return; const t = clock.elapsedTime; if (arm.current) arm.current.rotation.z = -0.9 + Math.sin(t * 0.35) * 0.05; if (claw.current) claw.current.position.y = -0.5 + Math.sin(t * 0.6) * 0.1; });
  return (<group rotation-y={-angle - 0.32}>
    <mesh position={[7.9, 0.5, 0]} material={orange}><boxGeometry args={[0.9, 0.7, 0.9]} /></mesh>
    <mesh position={[7.9, 1.3, 0]} material={hull}><cylinderGeometry args={[0.28, 0.36, 1.2, 10]} /></mesh>
    <group position={[7.9, 1.95, 0]}>
      <mesh material={hull}><sphereGeometry args={[0.3, 12, 8]} /></mesh>
      <group ref={arm} rotation-z={-0.9}>
        <mesh position={[-1.1, 0, 0]} rotation-z={Math.PI / 2} material={orange}><boxGeometry args={[0.32, 2.2, 0.32]} /></mesh>
        <group position={[-2.2, 0, 0]}>
          <mesh material={hull}><sphereGeometry args={[0.22, 10, 8]} /></mesh>
          <group rotation-z={1.9}>
            <mesh position={[-0.9, 0, 0]} rotation-z={Math.PI / 2} material={orange}><boxGeometry args={[0.28, 1.8, 0.28]} /></mesh>
            <group ref={claw} position={[-1.8, -0.5, 0]} rotation-z={-1.0}>
              <mesh position={[0, 0.5, 0]} material={hull}><cylinderGeometry args={[0.025, 0.025, 1, 5]} /></mesh>
              <mesh rotation-x={Math.PI / 2} material={cy}><torusGeometry args={[0.32, 0.03, 6, 24]} /></mesh>
              {[0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 0.78; return <mesh key={i} position={[Math.cos(a) * 0.3, -0.12, Math.sin(a) * 0.3]} material={hull}><boxGeometry args={[0.05, 0.28, 0.05]} /></mesh>; })}
            </group>
          </group>
        </group>
      </group>
    </group>
  </group>);
}

export function OpsStationDetail({ runningAngle, reduced }: { runningAngle: number; reduced: boolean }) {
  return (<group><Greeble /><SpokesAndTower /><Crane angle={runningAngle} reduced={reduced} /></group>);
}
