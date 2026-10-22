"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { STAGES } from "@/lib/business-pure";
import { STAGE_COLOR, STAGE_RADIUS, pulse, type MapNode } from "@/lib/business-map-pure";

// BUSINESS pipeline map: one orbit ring per stage, one glowing node per business. Loaded with ssr:false from BusinessPanel.
// Decorative twin of the list (aria-hidden there); the list stays the real interface.

function Node({ n, reduced, onHover, onPick }: { n: MapNode; reduced: boolean; onHover: (name: string) => void; onPick: (id: string) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (n.due && ref.current) ref.current.scale.setScalar(pulse(clock.elapsedTime, reduced)); });
  const lost = n.stage === "lost";
  return (
    <mesh ref={ref} position={[n.x, lost ? -0.15 : 0, n.z]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(n.name); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { onHover(""); document.body.style.cursor = ""; }}
      onClick={(e) => { e.stopPropagation(); onPick(n.id); }}>
      <sphereGeometry args={[lost ? 0.07 : 0.1, 12, 12]} />
      <meshBasicMaterial color={n.color} transparent opacity={lost ? 0.45 : 1} toneMapped={false} />
    </mesh>
  );
}

function Scene({ nodes, reduced, onHover, onPick }: { nodes: MapNode[]; reduced: boolean; onHover: (name: string) => void; onPick: (id: string) => void }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (g.current && !reduced) g.current.rotation.y += Math.min(dt, 0.1) * 0.06; });
  return (
    <group ref={g}>
      {STAGES.filter((s) => s !== "lost").map((s) => (
        <mesh key={s} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[STAGE_RADIUS[s] - 0.008, STAGE_RADIUS[s] + 0.008, 96]} />
          <meshBasicMaterial color={STAGE_COLOR[s]} transparent opacity={0.35} toneMapped={false} />
        </mesh>))}
      <mesh><sphereGeometry args={[0.18, 16, 16]} /><meshBasicMaterial color="#fde68a" toneMapped={false} /></mesh>
      {nodes.map((n) => <Node key={n.id} n={n} reduced={reduced} onHover={onHover} onPick={onPick} />)}
    </group>
  );
}

export default function BusinessMap({ nodes, onPick }: { nodes: MapNode[]; onPick: (id: string) => void }) {
  const [reduced, setReduced] = useState(true);
  const [hover, setHover] = useState("");
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches); on();
    m.addEventListener("change", on); return () => { m.removeEventListener("change", on); document.body.style.cursor = ""; };
  }, []);
  return (
    <div className="relative h-[260px] overflow-hidden rounded-md border border-white/10 bg-black/40">
      {/* Reduced motion: render on demand only (hover/click/props); otherwise the slow spin needs every frame. */}
      <Canvas frameloop={reduced ? "demand" : "always"} dpr={[1, 1.5]} camera={{ position: [0, 3.6, 4.6], fov: 45 }} gl={{ antialias: true, powerPreference: "low-power" }}>
        <Scene nodes={nodes} reduced={reduced} onHover={setHover} onPick={onPick} />
      </Canvas>
      {hover && <div className="pointer-events-none absolute bottom-2 left-2 chip">{hover}</div>}
    </div>
  );
}
