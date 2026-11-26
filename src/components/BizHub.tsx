"use client";
// v9 BUSINESS trade hub detail (tier 1+): a crown of lit spires on the top tier, orange banners on the tiers, and a Docks
// wing to the side with arched, orange-lit bays (hazard stripes, bay numbers, a freighter parked in each).
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Freighters, type FleetApi } from "./world-props";
import { rng } from "@/lib/world-props-pure";

const glow = (c: string, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

function textTex(lines: { t: string; size: number; y: number; color: string }[], w = 256, h = 96, bg = "rgba(0,0,0,0)"): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); if (!x) return null;
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.textAlign = "center"; x.textBaseline = "middle";
  for (const l of lines) { x.fillStyle = l.color; x.font = `800 ${l.size}px sans-serif`; x.fillText(l.t, w / 2, l.y); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Spires on the top tier: stacked needle towers (base cylinder + cone) with lit window dots, tallest in the middle. */
function Crown({ y0, r }: { y0: number; r: number }) {
  const hull = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a3542", metalness: 0.8, roughness: 0.4 }), []);
  const win = useMemo(() => glow("#ffcf8a", 2.4), []);
  const geo = useMemo(() => ({ base: new THREE.CylinderGeometry(0.5, 0.6, 1, 8), cone: new THREE.ConeGeometry(0.5, 1, 8), dot: new THREE.BoxGeometry(0.05, 0.08, 0.02) }), []);
  const spires = useMemo(() => { const g = rng(31); return Array.from({ length: 13 }, (_, i) => { const a = (i / 13) * 6.2832 + g() * 0.3, rr = i === 0 ? 0 : r * (0.45 + g() * 0.4); return { x: Math.cos(a) * rr, z: Math.sin(a) * rr, w: i === 0 ? 0.9 : 0.25 + g() * 0.25, h: i === 0 ? 3.4 : 1 + g() * 1.8, i }; }); }, [r]);
  const dots = useRef<THREE.InstancedMesh>(null), D = spires.length * 14;
  useLayoutEffect(() => { const m = dots.current; if (!m) return; const o = new THREE.Object3D(), g = rng(5); let n = 0;
    spires.forEach((s) => { for (let k = 0; k < 14; k++) { const a = g() * 6.2832, yy = 0.2 + g() * s.h * 0.75; o.position.set(s.x + Math.cos(a) * s.w * 0.55, y0 + yy, s.z + Math.sin(a) * s.w * 0.55); o.rotation.set(0, -a, 0); o.updateMatrix(); m.setMatrixAt(n++, o.matrix); } });
    m.instanceMatrix.needsUpdate = true; }, [spires, y0]);
  useEffect(() => () => { hull.dispose(); win.dispose(); Object.values(geo).forEach((x) => x.dispose()); }, [hull, win, geo]);
  return (<group>
    {spires.map((s) => (<group key={s.i} position={[s.x, y0, s.z]}>
      <mesh position={[0, s.h * 0.35, 0]} scale={[s.w, s.h * 0.7, s.w]} geometry={geo.base} material={hull} />
      <mesh position={[0, s.h * 0.7 + s.h * 0.3, 0]} scale={[s.w * 0.75, s.h * 0.6, s.w * 0.75]} geometry={geo.cone} material={hull} />
      <mesh position={[0, s.h * 1.3 + 0.05, 0]} material={win}><sphereGeometry args={[0.04, 6, 4]} /></mesh>
    </group>))}
    <instancedMesh ref={dots} args={[geo.dot, win, D]} frustumCulled={false} />
  </group>);
}

function Banners() {
  const tex = useMemo(() => { if (typeof document === "undefined") return null; const c = document.createElement("canvas"); c.width = 96; c.height = 288; const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 0, 288); g.addColorStop(0, "#ff9a3a"); g.addColorStop(1, "#c4521a"); x.fillStyle = g; x.fillRect(0, 0, 96, 288);
    x.strokeStyle = "#ffe9c8"; x.lineWidth = 6; x.beginPath(); x.arc(48, 110, 22, 0, 7); x.stroke(); x.beginPath(); x.ellipse(48, 110, 38, 11, -0.4, 0, 7); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) }), [tex]);
  useEffect(() => () => { tex?.dispose(); mat.dispose(); }, [tex, mat]);
  return (<group>{[[-5.2, 1.0, 4.4, 0.6], [-3.6, 1.0, 5.4, 0.45]].map(([x, y, z, ry], i) => <mesh key={i} position={[x, y, z]} rotation-y={ry} material={mat}><planeGeometry args={[0.55, 1.65]} /></mesh>)}</group>);
}

/** Docks wing: body, three arched bays with orange frames and hazard stripes, a sign plate, bay numbers and a freighter in each bay. */
function Docks({ at = [9.2, 1.1, -2.4] as [number, number, number], ry = -0.4 }) {
  const hull = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2b2833", metalness: 0.85, roughness: 0.4 }), []);
  const orange = useMemo(() => glow("#ff8a2a", 2.2), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0a0908", roughness: 0.9 }), []);
  const hazard = useMemo(() => { const t = textTex([], 64, 16); if (!t) return null; const c = t.image as HTMLCanvasElement, x = c.getContext("2d")!; x.fillStyle = "#e8a020"; x.fillRect(0, 0, 64, 16); x.fillStyle = "#17120a"; for (let i = -1; i < 6; i++) { x.beginPath(); x.moveTo(i * 12, 16); x.lineTo(i * 12 + 6, 16); x.lineTo(i * 12 + 14, 0); x.lineTo(i * 12 + 8, 0); x.fill(); } t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping; return t; }, []);
  const hzMat = useMemo(() => new THREE.MeshBasicMaterial({ map: hazard, toneMapped: false }), [hazard]);
  const sign = useMemo(() => textTex([{ t: "DOCKS", size: 64, y: 50, color: "#ffb866" }], 256, 96, "#1a0f08"), []);
  const nums = useMemo(() => ["02", "03", "04"].map((n) => textTex([{ t: n, size: 54, y: 40, color: "#ffb866" }], 128, 80)), []);
  const fleet = useRef<FleetApi | null>(null);
  const bays = [-1.9, 0, 1.9];
  useLayoutEffect(() => { const f = fleet.current; if (!f) return; const o = new THREE.Object3D(), c = new THREE.Color("#ffa24a"); f.count(3);
    bays.forEach((x, i) => { o.position.set(x, -0.45, 1.4); o.rotation.set(0, -Math.PI / 2, 0); o.scale.setScalar(0.62); o.updateMatrix(); f.put(i, o.matrix); f.tint(i, c); }); f.done(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { hull.dispose(); orange.dispose(); dark.dispose(); hzMat.dispose(); hazard?.dispose(); sign?.dispose(); nums.forEach((n) => n?.dispose()); }, [hull, orange, dark, hzMat, hazard, sign, nums]);
  return (<group position={at} rotation-y={ry}>
    <mesh material={hull}><boxGeometry args={[6.4, 2.6, 3.0]} /></mesh>
    <mesh position={[0, 1.55, 0]} material={hull}><boxGeometry args={[6.8, 0.5, 3.3]} /></mesh>
    <mesh position={[0, 2.2, 0.1]} material={dark}><boxGeometry args={[3.2, 0.7, 0.2]} /></mesh>
    <mesh position={[0, 2.2, 0.22]}><planeGeometry args={[3.0, 0.56]} /><meshBasicMaterial map={sign} toneMapped={false} /></mesh>
    {bays.map((x, i) => (<group key={x} position={[x, -0.2, 1.52]}>
      <mesh material={dark}><boxGeometry args={[1.5, 1.7, 0.1]} /></mesh>
      <mesh position={[0, 0.9, 0.06]} material={orange}><boxGeometry args={[1.6, 0.06, 0.05]} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[s * 0.78, 0, 0.06]} material={orange}><boxGeometry args={[0.06, 1.8, 0.05]} /></mesh>)}
      <mesh position={[0, -0.88, 0.07]} material={hzMat}><boxGeometry args={[1.6, 0.1, 0.04]} /></mesh>
      <mesh position={[0, 0.0, -0.01]}><planeGeometry args={[1.4, 1.6]} /><meshBasicMaterial color={new THREE.Color("#ff7a1a").multiplyScalar(0.55)} toneMapped={false} /></mesh>
      <mesh position={[0, 1.15, 0.08]}><planeGeometry args={[0.7, 0.44]} /><meshBasicMaterial map={nums[i]} transparent toneMapped={false} /></mesh>
    </group>))}
    <pointLight position={[0, 0, 2.4]} intensity={9} distance={7} color="#ff8a2a" />
    <Freighters max={3} apiRef={fleet} />
  </group>);
}

export function BizHubDetail({ topY, topR }: { topY: number; topR: number }) {
  return (<group><Crown y0={topY + 0.2} r={topR} /><Banners /><Docks /></group>);
}
