"use client";
// STUDIO v2: a curved wall of screens behind the planet showing the channel's real latest thumbnails (the same video list
// the panel uses), framed in dark bezels with a red studio trim; the most-viewed one is the big centre screen. A screen
// whose image can't load stays a dark glass panel. Chips (title, views) are made by studioChips and drawn by ChipLayer.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { loadImage } from "./texture-cache";
import type { Video } from "@/lib/youtube-pure";
import type { Chip } from "./world-kit";

export const WALL_R = 6.2, WALL_Y = 0.9;
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
    <group position={[s.x, s.y, s.z]} rotation-y={-s.a - Math.PI / 2}>
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

export function studioChips(videos: Video[], views: (n: number) => string): Chip[] {
  return wallSlots(videos).slice(0, 5).map((s, i) => ({ id: `v:${s.v.id}`, at: [s.x, s.y + s.h / 2 + 0.25, s.z] as [number, number, number],
    title: s.v.title.length > 30 ? `${s.v.title.slice(0, 29)}…` : s.v.title || "Video", value: views(s.v.views), color: "#ff4d5a", prio: 10 - i }));
}
