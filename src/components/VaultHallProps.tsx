"use client";
// v9 VAULT hall details (tier 1+): two hooded guardian statues holding glowing orbs either side of the vault door, hanging
// banners between the columns, stone arches over every bay, and a detailed ring chandelier with candle lamps on chains.
// All procedural, merged into a few draw calls.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const amber = (k: number) => new THREE.Color("#ffb347").multiplyScalar(k);
function place(g: THREE.BufferGeometry, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], sc: [number, number, number] = [1, 1, 1]) {
  const o = new THREE.Object3D(); o.position.set(...pos); o.rotation.set(...rot); o.scale.set(...sc); o.updateMatrix();
  const c = g.index ? g.toNonIndexed() : g.clone(); c.applyMatrix4(o.matrix); for (const k of Object.keys(c.attributes)) if (!["position", "normal", "uv"].includes(k)) c.deleteAttribute(k); g.dispose(); return c;
}

/** One guardian: robe (lathe), shoulders, hood, dark face, arms holding an orb, a pedestal. Faces +z. Height ~4. */
function statueGeo() {
  const robe = new THREE.LatheGeometry([[0.0, 0], [0.85, 0], [0.8, 0.5], [0.66, 1.4], [0.52, 2.2], [0.5, 2.7], [0.36, 3.0], [0.12, 3.05]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
  const hood = new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.78);
  const cowl = new THREE.ConeGeometry(0.3, 0.55, 10);
  const base = merged([place(new THREE.CylinderGeometry(1.05, 1.2, 0.5, 8), [0, 0.25, 0]), place(new THREE.BoxGeometry(2.2, 0.18, 2.2), [0, -0.09, 0])]);
  const body = merged([place(robe, [0, 0.5, 0]), place(hood, [0, 3.35, 0.02]), place(cowl, [0, 3.8, -0.05], [-0.15, 0, 0]),
    ...[-1, 1].map((s) => place(new THREE.CapsuleGeometry(0.11, 0.8, 4, 8), [s * 0.5, 2.35, 0.55], [-1.15, 0, s * 0.18])), // arms reaching forward
    place(new THREE.BoxGeometry(1.2, 0.18, 0.5), [0, 2.9, 0.05])]); // shoulder cape
  return { base, body };
}
function merged(list: THREE.BufferGeometry[]) { const m = mergeGeometries(list)!; list.forEach((g) => g.dispose()); return m; }

export function VaultStatues({ reduced }: { reduced: boolean }) {
  const { base, body } = useMemo(statueGeo, []);
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6a5642", metalness: 0.05, roughness: 0.9 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a2e22", metalness: 0.1, roughness: 0.85 }), []);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: amber(2.6), toneMapped: false }), []);
  const orbs = useRef<THREE.Group>(null);
  useEffect(() => () => { base.dispose(); body.dispose(); stone.dispose(); dark.dispose(); glow.dispose(); }, [base, body, stone, dark, glow]);
  useFrame(({ clock }) => { if (!orbs.current || reduced) return; orbs.current.children.forEach((c, i) => { c.rotation.y = clock.elapsedTime * (0.6 + i * 0.2); }); });
  return (<group>
    {[-1, 1].map((s) => (<group key={s} position={[s * 4.6, 0, -8.3]} rotation-y={s * 0.45}>
      <mesh geometry={base} material={dark} /><mesh geometry={body} material={stone} />
      <mesh position={[0, 3.3, 0.3]} material={dark}><boxGeometry args={[0.3, 0.3, 0.12]} /></mesh>{/* shadowed face */}
      <mesh position={[0, 2.2, 0.68]} material={glow}><boxGeometry args={[0.025, 0.9, 0.02]} /></mesh>{/* glowing chest line */}
      <group ref={s < 0 ? orbs : undefined} position={[0, 2.45, 1.15]}>
        <mesh rotation-x={Math.PI / 2}><torusGeometry args={[0.24, 0.02, 6, 32]} />{<primitive object={glow} attach="material" />}</mesh>
        <mesh><sphereGeometry args={[0.1, 12, 8]} /><primitive object={glow} attach="material" /></mesh>
      </group>
      <pointLight position={[0, 2.5, 1.3]} intensity={6} distance={5} color="#ffb347" />
    </group>))}
  </group>);
}

/** Banner texture: dark cloth, gold border, a ringed-planet emblem. */
function bannerTex(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 128; c.height = 384; const x = c.getContext("2d"); if (!x) return null;
  x.fillStyle = "#2a1410"; x.fillRect(0, 0, 128, 384); x.strokeStyle = "#e0a548"; x.lineWidth = 5; x.strokeRect(8, 8, 112, 340);
  x.beginPath(); x.moveTo(8, 348); x.lineTo(64, 380); x.lineTo(120, 348); x.stroke();
  x.beginPath(); x.arc(64, 160, 26, 0, 7); x.stroke(); x.beginPath(); x.ellipse(64, 160, 50, 14, -0.4, 0, 7); x.stroke();
  x.lineWidth = 3; x.beginPath(); x.moveTo(64, 220); x.lineTo(64, 300); x.moveTo(40, 250); x.lineTo(88, 250); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function VaultBanners({ n = 14, r = 8.7, skip }: { n?: number; r?: number; skip: (i: number) => boolean }) {
  const tex = useMemo(bannerTex, []), g = useMemo(() => new THREE.PlaneGeometry(0.85, 2.5, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: "#c88a30", emissiveIntensity: 0.35, roughness: 0.9, side: THREE.DoubleSide }), [tex]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => { const m = ref.current; if (!m) return; const o = new THREE.Object3D(); let j = 0;
    for (let i = 0; i < n; i++) { if (skip(i)) continue; const a = ((i + 0.5) / n) * Math.PI * 2; o.position.set(Math.cos(a) * r, 5.0, Math.sin(a) * r); o.rotation.set(0, -a + Math.PI / 2, 0); o.updateMatrix(); m.setMatrixAt(j++, o.matrix); }
    m.count = j; m.instanceMatrix.needsUpdate = true; }, [n, r, skip]);
  useEffect(() => () => { tex?.dispose(); g.dispose(); mat.dispose(); }, [tex, g, mat]);
  return <instancedMesh ref={ref} args={[g, mat, n]} frustumCulled={false} />;
}

/** A stone arch over every bay between the columns (half tori in the tangent plane). */
export function VaultArches({ n = 14, r = 9.2, skip, material }: { n?: number; r?: number; skip: (i: number) => boolean; material: THREE.Material }) {
  const chord = 2 * r * Math.sin(Math.PI / n), geo = useMemo(() => new THREE.TorusGeometry(chord / 2 - 0.25, 0.22, 6, 18, Math.PI), [chord]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => { const m = ref.current; if (!m) return; const o = new THREE.Object3D(); let j = 0;
    for (let i = 0; i < n; i++) { if (skip(i)) continue; const a = ((i + 0.5) / n) * Math.PI * 2; o.position.set(Math.cos(a) * r, 8.0, Math.sin(a) * r); o.rotation.set(0, -a + Math.PI / 2, 0); o.updateMatrix(); m.setMatrixAt(j++, o.matrix); }
    m.count = j; m.instanceMatrix.needsUpdate = true; }, [n, r, skip]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <instancedMesh ref={ref} args={[geo, material, n]} frustumCulled={false} />;
}

/** Chandelier extras: 16 candle lamps on the ring, spokes to a centre boss, and three chains up to the oculus. Goes inside the rotating ring group. */
export function ChandelierDetail() {
  const lamp = useMemo(() => new THREE.MeshBasicMaterial({ color: amber(3.2), toneMapped: false }), []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#5b4630", metalness: 0.95, roughness: 0.35 }), []);
  useEffect(() => () => { lamp.dispose(); metal.dispose(); }, [lamp, metal]);
  return (<group>
    {Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return (<group key={i} position={[Math.cos(a) * 2.4, 0.05, Math.sin(a) * 2.4]}>
      <mesh position={[0, 0.06, 0]} material={metal}><cylinderGeometry args={[0.035, 0.05, 0.12, 6]} /></mesh>
      <mesh position={[0, 0.2, 0]} material={lamp}><sphereGeometry args={[0.05, 8, 6]} /></mesh>
      <mesh position={[0, -0.18, 0]} material={lamp}><coneGeometry args={[0.03, 0.16, 6]} /></mesh>
    </group>); })}
    {[0, 1, 2].map((i) => <mesh key={i} rotation-y={(i * Math.PI) / 3} rotation-x={Math.PI / 2} material={metal}><boxGeometry args={[4.8, 0.03, 0.04]} /></mesh>)}
    <mesh position={[0, 0.1, 0]} material={metal}><sphereGeometry args={[0.18, 12, 8]} /></mesh>
    {[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * 1.2, 2.2, Math.sin(a) * 1.2]} rotation={[Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]} material={metal}><cylinderGeometry args={[0.012, 0.012, 4.6, 4]} /></mesh>; })}
  </group>);
}
