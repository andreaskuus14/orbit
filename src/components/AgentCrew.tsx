"use client";
// AGENTS v2: each agent is a figure at its own workstation on a deck ring round the station: desk, holo screens in the
// agent's colour, a visor that shows the live status, hands that type while it works. Chips (name, status, current job)
// come from the same live data as the panel. Built-in materials, instanced where it counts; ~10 draws per agent.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { AgentStatus } from "@/lib/station-pure";
import { Capsule, useWorldTier, type Chip } from "./world-kit";
import { RingOf, WindowRing } from "./world-scenery";

export const CREW_R = 5.75;
const VISOR: Record<AgentStatus, string> = { working: "#fbbf24", waiting: "#c084fc", failed: "#f87171", idle: "#64748b" };
export const DOT: Record<AgentStatus, NonNullable<Chip["dot"]>> = { working: "busy", waiting: "warn", failed: "bad", idle: "idle" };
export const crewAngle = (i: number, n: number) => Math.PI / 2 + ((i + 0.5) / Math.max(1, n)) * Math.PI * 2;

function Seat({ color, status, i, n, reduced, onPick }: { color: string; status: AgentStatus; i: number; n: number; reduced: boolean; onPick: () => void }) {
  const a = crewAngle(i, n);
  const arms = useRef<THREE.Group>(null), head = useRef<THREE.Mesh>(null);
  const body = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#d9dde6", metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#14161d", metalness: 0.9, roughness: 0.3 }), []);
  const trim = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), toneMapped: false }), [color]);
  const visor = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(VISOR[status]).multiplyScalar(status === "idle" ? 1 : 2.4), toneMapped: false }), [status]);
  const screen = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(status === "working" ? 1.3 : 0.45), transparent: true, opacity: 0.8, side: THREE.DoubleSide, toneMapped: false }), [color, status]);
  useEffect(() => () => { body.dispose(); dark.dispose(); trim.dispose(); visor.dispose(); screen.dispose(); }, [body, dark, trim, visor, screen]);
  useFrame(({ clock }) => {
    if (reduced) return;
    const t = clock.elapsedTime + i * 1.7;
    if (arms.current) arms.current.children.forEach((c, k) => { c.position.y = 0.98 + (status === "working" ? Math.abs(Math.sin(t * 9 + k * 1.6)) * 0.035 : 0); });
    if (head.current) head.current.rotation.y = Math.sin(t * 0.4) * (status === "working" ? 0.12 : 0.35);
  });
  return (
    // facing the hub: the figure looks inward at its desk
    <group position={[Math.cos(a) * CREW_R, 0, Math.sin(a) * CREW_R]} rotation-y={-a - Math.PI / 2} onClick={(e) => { e.stopPropagation(); onPick(); }}>
      {/* desk: curved top, emissive edge, two holo screens */}
      <mesh position={[0, 0.82, -0.62]} material={dark}><boxGeometry args={[1.5, 0.08, 0.6]} /></mesh>
      <mesh position={[0, 0.865, -0.33]} material={trim}><boxGeometry args={[1.5, 0.015, 0.02]} /></mesh>
      <mesh position={[0, 0.42, -0.75]} material={dark}><boxGeometry args={[1.2, 0.8, 0.12]} /></mesh>
      <mesh position={[-0.34, 1.32, -0.86]} rotation-y={0.25} material={screen}><planeGeometry args={[0.62, 0.42]} /></mesh>
      <mesh position={[0.34, 1.32, -0.86]} rotation-y={-0.25} material={screen}><planeGeometry args={[0.62, 0.42]} /></mesh>
      <mesh position={[0, 0.9, -0.62]} rotation-x={-Math.PI / 2} material={screen}><planeGeometry args={[0.7, 0.32]} /></mesh>
      {/* chair */}
      <mesh position={[0, 0.48, 0.12]} material={dark}><boxGeometry args={[0.55, 0.08, 0.5]} /></mesh>
      <mesh position={[0, 0.85, 0.36]} material={dark}><boxGeometry args={[0.5, 0.7, 0.07]} /></mesh>
      <mesh position={[0, 0.24, 0.12]} material={dark}><cylinderGeometry args={[0.04, 0.2, 0.48, 8]} /></mesh>
      {/* figure */}
      <mesh position={[0, 0.88, 0.1]} material={body}><Capsule args={[0.2, 0.36, 6, 14]} /></mesh>
      <mesh position={[0, 0.98, -0.07]} material={trim}><boxGeometry args={[0.05, 0.3, 0.01]} /></mesh>
      <mesh ref={head} position={[0, 1.42, 0.06]} material={body}><sphereGeometry args={[0.17, 24, 16]} />
        <mesh position={[0, 0.01, -0.13]} material={visor}><boxGeometry args={[0.24, 0.06, 0.06]} /></mesh>
        <mesh position={[0.17, 0, 0]} rotation-z={Math.PI / 2} material={trim}><torusGeometry args={[0.06, 0.015, 6, 16]} /></mesh>
      </mesh>
      <group ref={arms}>{[-1, 1].map((s) => <mesh key={s} position={[s * 0.18, 0.98, -0.25]} rotation-x={-1.2} material={body}><Capsule args={[0.055, 0.34, 4, 8]} /></mesh>)}</group>
      <mesh position={[0, 0.5, 0.18]} rotation-x={Math.PI / 2} material={body}><Capsule args={[0.16, 0.24, 4, 10]} /></mesh>
      {/* floor pad in the agent's colour */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, -0.2]}><ringGeometry args={[0.95, 1.0, 48]} /><primitive object={trim} attach="material" /></mesh>
      {status === "working" && <pointLight position={[0, 1.3, -0.7]} intensity={3} distance={2.5} color={color} />}
    </group>
  );
}

export function CrewDeck({ list, status, reduced, onPick }: { list: { slug: string; color: string }[]; status: Record<string, AgentStatus>; reduced: boolean; onPick: (slug: string) => void }) {
  return (<group position={[0, -0.62, 0]}>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}><ringGeometry args={[4.9, 7.2, 128]} /><meshStandardMaterial color="#0d0f16" metalness={0.85} roughness={0.32} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0]}><ringGeometry args={[7.12, 7.2, 160]} /><meshBasicMaterial color={new THREE.Color("#a78bfa").multiplyScalar(1.6)} toneMapped={false} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0]}><ringGeometry args={[4.9, 4.95, 160]} /><meshBasicMaterial color={new THREE.Color("#7c3aed").multiplyScalar(1.4)} toneMapped={false} /></mesh>
    <directionalLight position={[6, 10, 8]} intensity={1.4} color="#f1ecff" />
    <directionalLight position={[-8, 5, -6]} intensity={0.8} color="#8b5cf6" />
    {list.map((a, i) => <Seat key={a.slug} color={a.color} status={status[a.slug] ?? "idle"} i={i} n={list.length} reduced={reduced} onPick={() => onPick(a.slug)} />)}
  </group>);
}

/** v8 AGENTS look (tier 1+): the crew works inside a real hangar: panelled floor, pillars, a ring of wall consoles,
 *  ceiling light rows over trusses, and the big bay door open to space at the back. */
export function Hangar() {
  const tier = useWorldTier();
  const floor = useMemo(() => new THREE.ShaderMaterial({ uniforms: {}, vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vP; float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){ vec2 g = vP / 1.6, f = fract(g), id = floor(g); float seam = smoothstep(0.03, 0.0, min(min(f.x, 1.0-f.x), min(f.y, 1.0-f.y)));
        float r = length(vP); vec3 c = vec3(0.055,0.06,0.075) * (0.8 + 0.4*h(id)) - seam*0.025;
        float stripe = step(0.92, fract(atan(vP.y, vP.x) * 2.546)) * smoothstep(7.4, 7.6, r) * smoothstep(15.0, 14.0, r); // hazard dashes
        c = mix(c, vec3(0.55,0.42,0.1), stripe * 0.6);
        c += vec3(0.5,0.4,1.0) * 0.05 * smoothstep(12.0, 3.0, r); // bounce from the hub
        gl_FragColor = vec4(c, 1.0); }` }), []);
  const wall = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1a1d26", metalness: 0.75, roughness: 0.45, side: THREE.DoubleSide }), []);
  useEffect(() => () => { floor.dispose(); wall.dispose(); }, [floor, wall]);
  if (!tier) return null;
  const R = 15, H = 8.5, open = Math.PI * 0.42; // the bay door: the arc behind the hub, open to space
  const lit = new THREE.Color("#e8eeff").multiplyScalar(2.4);
  return (<group position={[0, -0.62, 0]}>
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} material={floor}><circleGeometry args={[R + 0.2, 96]} /></mesh>
    {/* walls (an open arc at the back) with consoles and window strips */}
    <mesh position={[0, H / 2, 0]} material={wall} rotation-y={Math.PI / 2 + open / 2}><cylinderGeometry args={[R, R, H, 96, 1, true, 0, Math.PI * 2 - open]} /></mesh>
    <RingOf n={44} r={R - 0.5} y={0.55} size={[1.1, 1.1, 0.7]} color="#14171f" emissive="#60a5fa" k={0.05} skip={(i) => { const a = ((i / 44) * Math.PI * 2 + Math.PI * 2) % (Math.PI * 2); return Math.abs(a - Math.PI * 1.5) < open / 2 + 0.1; }} />
    <WindowRing r={R - 0.9} y0={1.2} rows={2} n={44} size={[0.8, 0.32]} color="#60a5fa" k={1.6} lit={0.75} seed={5} inward />
    <WindowRing r={R - 0.05} y0={H - 1.2} rows={1} n={120} size={[0.5, 0.08]} color="#fff4e0" k={2} lit={0.8} seed={9} inward />
    {/* pillars and the ceiling: trusses and rows of light */}
    <RingOf n={12} r={R - 1.6} y={H / 2} size={[0.5, H, 0.5]} color="#22262f" metal={0.8} rough={0.4} skip={(i) => i === 9} />
    <mesh position={[0, H, 0]} rotation-x={Math.PI / 2} material={wall}><circleGeometry args={[R, 64]} /></mesh>
    {[-9, -4.5, 0, 4.5, 9].map((x) => (<group key={x}>
      <mesh position={[x, H - 0.4, 0]}><boxGeometry args={[0.25, 0.5, R * 1.7]} /><meshStandardMaterial color="#1c2029" metalness={0.8} roughness={0.4} /></mesh>
      <mesh position={[x, H - 0.7, 0]}><boxGeometry args={[0.16, 0.05, R * 1.5]} /><meshBasicMaterial color={lit} toneMapped={false} /></mesh>
    </group>))}
    <pointLight position={[-6, H - 1.5, -2]} intensity={22} distance={20} color="#e8eeff" />
    <pointLight position={[0, H - 1.5, 6]} intensity={30} distance={22} color="#e8eeff" />
    {/* the bay door frame */}
    <group rotation-y={0}>{[-1, 1].map((sd) => { const a = -Math.PI / 2 + sd * (open / 2); return <mesh key={sd} position={[Math.cos(a) * R, H / 2, Math.sin(a) * R]}><boxGeometry args={[0.7, H, 0.7]} /><meshStandardMaterial color="#2a2f3a" metalness={0.8} roughness={0.35} emissive="#f59e0b" emissiveIntensity={0.15} /></mesh>; })}</group>
  </group>);
}
