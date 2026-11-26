"use client";
// STUDIO v2: a curved wall of screens behind the planet showing the channel's real latest thumbnails (the same video list
// the panel uses), framed in dark bezels with a red studio trim; the most-viewed one is the big centre screen. A screen
// whose image can't load stays a dark glass panel. Chips (title, views) are made by studioChips and drawn by ChipLayer.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadImage } from "./texture-cache";
import type { Video } from "@/lib/youtube-pure";
import { useWorldTier, type Chip } from "./world-kit";

export const WALL_R = 5.3, WALL_Y = 0.8;
/** Up to 7 screens on an arc behind the planet; index 0 (most viewed of the latest) in the middle, bigger. */
export function wallSlots(videos: Video[]) {
  const list = [...videos].slice(0, 7).sort((a, b) => b.views - a.views);
  const order = [0, -1, 1, -2, 2, -3, 3];
  return list.map((v, i) => { const k = order[i], a = -Math.PI / 2 + k * 0.36, big = i === 0;
    return { v, a, w: big ? 2.6 : 1.8, h: (big ? 2.6 : 1.8) * 0.5625, y: WALL_Y + (big ? 0.35 : Math.abs(k) * 0.12), x: Math.cos(a) * WALL_R, z: Math.sin(a) * WALL_R }; });
}

function Screen({ s }: { s: ReturnType<typeof wallSlots>[number] }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let live = true, made: THREE.Texture | null = null;
    if (s.v.thumb) loadImage(s.v.thumb).then((img) => { if (!live) return; made = new THREE.Texture(img); made.colorSpace = THREE.SRGBColorSpace; made.needsUpdate = true; setTex(made); }).catch(() => {});
    return () => { live = false; made?.dispose(); };
  }, [s.v.thumb]);
  return (
    <group position={[s.x, s.y, s.z]} rotation={[-0.12, -s.a - Math.PI / 2, 0, "YXZ"]}>
      <mesh position={[0, 0, -0.06]}><boxGeometry args={[s.w + 0.14, s.h + 0.14, 0.1]} /><meshStandardMaterial color="#0b0c10" metalness={0.9} roughness={0.3} /></mesh>
      <mesh position={[0, -s.h / 2 - 0.08, -0.005]}><boxGeometry args={[s.w + 0.14, 0.025, 0.02]} /><meshBasicMaterial color={new THREE.Color("#ff2d3d").multiplyScalar(2)} toneMapped={false} /></mesh>
      <mesh>
        <planeGeometry args={[s.w, s.h]} />
        {tex ? <meshBasicMaterial map={tex} toneMapped={false} color={[1.05, 1.05, 1.05]} /> : <meshStandardMaterial color="#10131c" metalness={0.2} roughness={0.15} emissive="#1d2433" emissiveIntensity={0.5} />}
      </mesh>
    </group>
  );
}

export function ScreenWall({ videos }: { videos: Video[] }) {
  const slots = useMemo(() => wallSlots(videos), [videos]);
  return (<group>
    {slots.map((s) => <Screen key={s.v.id} s={s} />)}
    <mesh position={[0, WALL_Y - 1.5, 0]} rotation-y={Math.PI * 0.5 - 1.1}><cylinderGeometry args={[WALL_R + 0.2, WALL_R + 0.2, 0.05, 64, 1, true, 0, 2.2]} /><meshBasicMaterial color={new THREE.Color("#ff2d3d").multiplyScalar(1.5)} toneMapped={false} side={THREE.DoubleSide} /></mesh>
    <pointLight position={[0, 3, -6]} intensity={14} distance={12} color="#ff3b4a" />
  </group>);
}

/** v8 semantic zoom: the big screen (lod 0), the rest (lod 1); a click opens a card with views, likes and the date. */
export function studioChips(videos: Video[], views: (n: number) => string, rows?: (v: Video) => [string, string][]): Chip[] {
  return wallSlots(videos).slice(0, 7).map((s, i) => ({ id: `v:${s.v.id}`, at: [s.x, s.y + s.h / 2 + 0.25, s.z] as [number, number, number],
    title: s.v.title.length > 30 ? `${s.v.title.slice(0, 29)}…` : s.v.title || "Video", value: views(s.v.views), color: "#ff4d5a", prio: 10 - i, lod: i ? 1 : 0, rows: rows?.(s.v) }));
}

/** v8 STUDIO look (tier 1+): a film stage round the screen wall: glossy black floor, an overhead truss with red key
 *  lights, a camera crane on a curved dolly track, flight cases and red rim lights. */
export function FilmStage({ reduced }: { reduced: boolean }) {
  const tier = useWorldTier();
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1b1d22", metalness: 0.85, roughness: 0.35 }), []);
  const floor = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#07080a", metalness: 0.3, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }), []);
  const red = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2d3d").multiplyScalar(3), toneMapped: false }), []);
  useEffect(() => () => { metal.dispose(); floor.dispose(); red.dispose(); }, [metal, floor, red]);
  const track = useMemo(() => new THREE.TorusGeometry(7.2, 0.05, 6, 96, Math.PI * 0.7), []);
  useEffect(() => () => track.dispose(), [track]);
  if (!tier) return null;
  const Y = -2.2, lamps = [-4.5, -1.5, 1.5, 4.5];
  return (<group>
    <mesh rotation-x={-Math.PI / 2} position={[0, Y, 0]} material={floor}><circleGeometry args={[16, 64]} /></mesh>
    {/* overhead truss with red key lights aimed at the wall */}
    <mesh position={[0, 5.4, -3]} material={metal}><boxGeometry args={[12, 0.3, 0.3]} /></mesh>
    <mesh position={[0, 5.4, -2.4]} material={metal}><boxGeometry args={[12, 0.08, 0.08]} /></mesh>
    {[-6, 6].map((x) => <mesh key={x} position={[x, 1.6, -3]} material={metal}><boxGeometry args={[0.25, 7.6, 0.25]} /></mesh>)}
    {lamps.map((x) => (<group key={x} position={[x, 5.0, -2.6]} rotation-x={0.7}>
      <mesh material={metal}><cylinderGeometry args={[0.28, 0.2, 0.55, 16]} /></mesh>
      <mesh position={[0, -0.28, 0]} rotation-x={Math.PI / 2} material={red}><circleGeometry args={[0.24, 20]} /></mesh>
    </group>))}
    <spotLight position={[0, 5, -2.5]} target-position={[0, 0.8, -5.3]} angle={0.7} penumbra={0.7} intensity={60} distance={14} color="#ff3b4a" />
    {/* camera crane on a dolly track, front left */}
    <mesh rotation-x={-Math.PI / 2} rotation-z={Math.PI * 0.55} position={[0, Y + 0.03, 0]} geometry={track} material={metal} />
    <group position={[-5.6, Y, 3.6]} rotation-y={0.9}>
      <mesh position={[0, 0.25, 0]} material={metal}><boxGeometry args={[1.2, 0.3, 0.8]} /></mesh>
      <mesh position={[0, 1.3, 0]} material={metal}><cylinderGeometry args={[0.1, 0.14, 2, 10]} /></mesh>
      <group position={[0, 2.3, 0]} rotation-z={-0.35}>
        <mesh position={[1.2, 0, 0]} material={metal}><boxGeometry args={[3.6, 0.14, 0.14]} /></mesh>
        <mesh position={[-0.8, 0, 0]} material={metal}><boxGeometry args={[0.5, 0.5, 0.5]} /></mesh>
        <group position={[3, 0, 0]} rotation-z={0.35}>
          <mesh material={metal}><boxGeometry args={[0.55, 0.4, 0.35]} /></mesh>
          <mesh position={[0.4, 0, 0]} rotation-z={Math.PI / 2} material={metal}><cylinderGeometry args={[0.12, 0.15, 0.35, 16]} /></mesh>
          <mesh position={[0.1, 0.28, 0]} material={red}><sphereGeometry args={[0.04, 8, 6]} /></mesh>
        </group>
      </group>
    </group>
    {/* flight cases stacked front right */}
    {[[5.2, 0.35, 3.2, 0.3], [5.9, 0.35, 2.4, -0.2], [5.4, 1.05, 3.0, 0.2]].map(([x, y, z, r], i) => (
      <mesh key={i} position={[x, Y + y, z]} rotation-y={r} material={metal}><boxGeometry args={[1, 0.7, 0.7]} /></mesh>))}
    <pointLight position={[0, Y + 0.6, -5]} intensity={reduced ? 10 : 16} distance={8} color="#ff2d3d" />
  </group>);
}
