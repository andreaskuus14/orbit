"use client";
// GAME DEV v3: the focus game as a floating island (worlds-v3-pure devIsland). Built parts stand in stone, the rest are pink
// hologram wireframe still to build (share = the game's stage); the portal lights at beta/live; one drone per running game task;
// its open bugs circle as sparks; other games float as small islets. Every repeated thing is one instanced draw call.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Many, Motes, rockGeometry, useWorldTier, type Chip, type Inst } from "./world-kit";
import { scatter, type DevIsland } from "@/lib/worlds-v3-pure";
import { fortPiece } from "@/lib/world-assets-pure";
import { AssetMany, RealOr } from "./world-assets";
import { Water, Waterfall, triplanarMaterial, useTex } from "./world-surfaces";

/** v6: the island with real CC0 ground: grass on everything facing up, cliff rock on the sides (triplanar, no stretching). */
function TexturedIsland({ rock, disc }: { rock: THREE.BufferGeometry; disc: THREE.BufferGeometry }) {
  const [gd, gn, cd, cn] = useTex("grassD", "grassN", "cliffD", "cliffN");
  const m = useMemo(() => ({ land: triplanarMaterial({ d: cd, n: cn, scale: 0.32 }, { d: gd, n: gn, scale: 0.55 }, { tint: "#cfc4b8", topTint: "#b8e08a", slope: 0.55 }),
    grass: triplanarMaterial({ d: cd, n: cn, scale: 0.32 }, { d: gd, n: gn, scale: 0.55 }, { tint: "#cfc4b8", topTint: "#b8e08a", slope: 0.35 }) }), [gd, gn, cd, cn]);
  useEffect(() => () => { m.land.dispose(); m.grass.dispose(); }, [m]);
  return <>
    <mesh geometry={rock} material={m.land} receiveShadow />
    <mesh position={[0, -0.12, 0]} scale={[5.3, 0.25, 5.3]} geometry={disc} material={m.grass} receiveShadow />
    <mesh position={[0, 0.3, -2.2]} scale={[3.4, 0.7, 2.2]} geometry={disc} material={m.grass} receiveShadow />
  </>;
}

const PINK = "#ff3d8b", CYAN = "#5eead4";
const SEV_COLOR = { crash: "#ff4d6d", major: "#ef4444", minor: "#f59e0b", polish: "#94a3b8" } as const;

export function devChips(s: DevIsland, k: (key: string, v?: Record<string, string | number>) => string): Chip[] {
  if (!s.focus) return [];
  const f = s.focus, out: Chip[] = [
    { id: "focus", at: [0.2, 5.2, -1.8], title: f.name, value: k(`gx.stage.${f.stage}`), sub: k("w3.built", { n: f.built, of: s.parts.length }), color: PINK, prio: 30, dot: f.stage === "live" ? "ok" : "busy" },
    { id: "bugs", at: [4.6, 2.6, 1.6], title: k("w3.bugsT"), value: String(f.open), sub: f.crash ? k("w3.crash", { n: f.crash }) : undefined, color: f.crash ? SEV_COLOR.crash : "#f59e0b", prio: 20, dot: f.crash ? "bad" : f.open ? "warn" : "ok" },
  ];
  if (s.drones) out.push({ id: "drones", at: [-4.4, 3.4, 1.2], title: k("w3.jobsT"), value: String(s.drones), color: CYAN, prio: 18, dot: "busy" });
  s.others.forEach((o, i) => out.push({ id: `g:${o.id}`, at: [o.at[0], o.at[1] + 1.4, o.at[2]], title: o.name, value: k(`gx.stage.${o.stage}`), sub: o.open ? k("w3.bugs", { n: o.open }) : undefined, color: "#93c5fd", prio: 5 - i * 0.1 }));
  return out;
}

/** Falling-water streaks: a tiling alpha texture scrolled down each frame (v4). */
function fallTexture() {
  const w = 32, h = 128, d = new Uint8Array(w * h * 4); let seed = 11; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cols = Array.from({ length: w }, () => 0.35 + r() * 0.65);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.round(255 * Math.min(1, cols[x] * (0.55 + 0.45 * Math.sin((y / h) * Math.PI * 2 * 3 + x * 1.7)) + (r() > 0.97 ? 0.4 : 0))); d.set([v, v, v, 255], (y * w + x) * 4); }
  const t = new THREE.DataTexture(d, w, h); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}

export function DevIslandScene({ s, reduced }: { s: DevIsland; reduced: boolean }) {
  const tier = useWorldTier(), hi = tier > 0;
  const mats = useMemo(() => ({
    rock: new THREE.MeshStandardMaterial({ color: hi ? "#3a2f2a" : "#6e5a50", roughness: 0.95, flatShading: !hi }),
    grass: Object.assign(new THREE.MeshStandardMaterial({ color: hi ? "#3f6b22" : "#4f7a2c", roughness: 0.9, flatShading: !hi }), { userData: { foliage: true } }),
    stone: new THREE.MeshStandardMaterial({ color: "#9a9088", roughness: 0.75, metalness: 0.05, flatShading: true }),
    roof: new THREE.MeshStandardMaterial({ color: "#4b2a3a", roughness: 0.6 }),
    holo: new THREE.MeshBasicMaterial({ color: new THREE.Color(PINK).multiplyScalar(1.8), wireframe: true, toneMapped: false }),
    holoFill: new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }),
    trunk: new THREE.MeshStandardMaterial({ color: "#4a3426", roughness: 1 }),
    bloom: Object.assign(new THREE.MeshStandardMaterial({ color: "#ffb7d5", emissive: "#ff7eb6", emissiveIntensity: hi ? 0.12 : 0.25, roughness: 0.8, flatShading: !hi }), { userData: { foliage: true } }),
    pine: Object.assign(new THREE.MeshStandardMaterial({ color: "#244a2a", roughness: 0.9, flatShading: !hi }), { userData: { foliage: true } }),
    water: Object.assign(new THREE.MeshStandardMaterial({ color: hi ? "#0f6f8c" : "#1fa6c9", emissive: "#2dd4ff", emissiveIntensity: hi ? 0.18 : 0.35, roughness: 0.05, metalness: 0.2 }), { userData: { realism: { bump: 0.06, freq: 2.5, rough: 0.04, vary: 0.05, streak: 0 } } }),
    fall: new THREE.MeshBasicMaterial({ color: "#cff6ff", transparent: true, opacity: hi ? 0.8 : 0.55, depthWrite: false, side: THREE.DoubleSide, alphaMap: hi ? fallTexture() : null }),
    drone: new THREE.MeshStandardMaterial({ color: "#e0a526", metalness: 0.7, roughness: 0.35, emissive: "#3dd6ff", emissiveIntensity: 0.2 }),
    bug: new THREE.MeshBasicMaterial({ toneMapped: false }),
  }), [hi]);
  const geos = useMemo(() => ({ rock: hi ? rockGeometry(5.6, 7, 7, tier) : rockGeometry(5.4, 4.2, 7, 0), islet: rockGeometry(1, hi ? 1.9 : 1.4, 3, hi ? 1 : 0),
    box: hi ? new RoundedBoxGeometry(1, 1, 1, 2, 0.06) : new THREE.BoxGeometry(1, 1, 1), wire: new THREE.BoxGeometry(1, 1, 1), cone: new THREE.ConeGeometry(0.5, 1, hi ? 16 : 6),
    ball: hi ? canopy() : new THREE.IcosahedronGeometry(0.5, 1), trunk: new THREE.CylinderGeometry(0.06, 0.09, 1, hi ? 10 : 6), disc: new THREE.CylinderGeometry(1, 1, 1, hi ? 72 : 24), spark: new THREE.SphereGeometry(0.06, 6, 6) }), [hi, tier]);
  useEffect(() => () => { mats.fall.alphaMap?.dispose(); Object.values(mats).forEach((m) => m.dispose()); Object.values(geos).forEach((g) => g.dispose()); }, [mats, geos]);

  const built = useMemo<Inst[]>(() => s.parts.filter((p) => p.built).map((p) => ({ at: [p.at[0], p.at[1] + 0.6, p.at[2]], s: p.size })), [s.parts]);
  const todo = useMemo<Inst[]>(() => s.parts.filter((p) => !p.built).map((p) => ({ at: [p.at[0], p.at[1] + 0.6, p.at[2]], s: p.size })), [s.parts]);
  const roofs = useMemo<Inst[]>(() => s.parts.filter((p) => p.built && p.kind === "tower").map((p) => ({ at: [p.at[0], p.size[1] + 0.6 + 0.45, p.at[2]], s: [p.size[0] * 1.5, 0.9, p.size[2] * 1.5] })), [s.parts]);
  const flora = useMemo(() => { const spots = scatter(30, 0.8, 4.8, 17, [[0, -2.2, 2.6], [1.2, 2.2, 0.9]], 0.1); // keep off the castle hill and the pond
    const trees = spots.slice(0, 12), pines = spots.slice(12);
    return { trunks: trees.map((t): Inst => ({ at: [t.x, 0.5 * t.s, t.z], s: [t.s, t.s, t.s] })), blooms: trees.map((t): Inst => ({ at: [t.x, 1.1 * t.s, t.z], s: [1.3 * t.s, 1 * t.s, 1.3 * t.s], ry: t.x })),
      pines: pines.map((t): Inst => ({ at: [t.x, 0.7 * t.s, t.z], s: [0.9 * t.s, 1.4 * t.s, 0.9 * t.s] })) }; }, []);
  // v5: real fort pieces (Poly Haven, CC0) per built part, fit to the part's box; walls run along x so the model turns.
  const fort = useMemo(() => { const by = new Map<string, Inst[]>();
    for (const p of s.parts) if (p.built) { const n = fortPiece(p.kind), wall = p.kind === "wall";
      by.set(n, [...(by.get(n) ?? []), { at: [p.at[0], 0.6 + p.at[1] - p.size[1] / 2, p.at[2]], s: wall ? [p.size[2] * 2, p.size[1] * 1.4, p.size[0]] : [p.size[0] * 1.1, p.size[1] * 1.15, p.size[2] * 1.1], ry: wall ? Math.PI / 2 : 0 }]); }
    return [...by]; }, [s.parts]);
  const real = useMemo(() => ({ trees: flora.trunks.map((t): Inst => ({ at: [t.at[0], 0, t.at[2]], s: [1, 2.3 * t.s[1], 1], ry: t.at[0] * 3 })),
    rocks: [[-4.3, 1.8, 1.2], [3.8, -2.6, 0.9], [-1.6, 4.1, 0.7], [4.4, 1.4, 0.6]].map(([x, z, k]): Inst => ({ at: [x, 0, z], s: [k, k * 0.55, k], ry: x })),
    shrubs: flora.pines.map((t): Inst => ({ at: [t.at[0], 0, t.at[2]], s: [1, 0.55 * t.s[1], 1], ry: t.at[2] * 2 })) }), [flora]);
  const islets = useMemo(() => ({ rock: s.others.map((o): Inst => ({ at: o.at, s: [o.size, o.size, o.size] })), top: s.others.map((o): Inst => ({ at: [o.at[0], o.at[1] + 0.05 * o.size, o.at[2]], s: [o.size * 0.95, 0.1 * o.size, o.size * 0.95] })) }), [s.others]);

  const drones = useRef<THREE.InstancedMesh>(null), sparks = useRef<THREE.InstancedMesh>(null), portal = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => ({ o: new THREE.Object3D(), c: new THREE.Color() }), []);
  useLayoutEffect(() => { const m = sparks.current; if (!m) return; s.bugs.forEach((b, i) => m.setColorAt(i, tmp.c.set(SEV_COLOR[b.sev]).multiplyScalar(2))); if (m.instanceColor) m.instanceColor.needsUpdate = true; }, [s.bugs, tmp]);
  const place = (t: number) => {
    const d = drones.current, b = sparks.current, o = tmp.o;
    if (d) { for (let i = 0; i < s.drones; i++) { const a = (i / Math.max(1, s.drones)) * Math.PI * 2 + t * 0.3; o.position.set(Math.cos(a) * 6.3, 3.2 + Math.sin(t * 1.3 + i) * 0.35, Math.sin(a) * 6.3); o.rotation.set(0, -a, 0); o.scale.set(0.5, 0.28, 0.4); o.updateMatrix(); d.setMatrixAt(i, o.matrix); } d.instanceMatrix.needsUpdate = true; }
    if (b) { s.bugs.forEach((p, i) => { const a = p.phase + t * p.speed; o.position.set(Math.cos(a) * p.r, p.y + Math.sin(a * 2 + p.tilt) * 0.4, Math.sin(a) * p.r); o.rotation.set(0, 0, 0); o.scale.setScalar(p.sev === "crash" ? 2 : 1); o.updateMatrix(); b.setMatrixAt(i, o.matrix); }); b.instanceMatrix.needsUpdate = true; }
  };
  useLayoutEffect(() => place(0)); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => { if (reduced) return; const t = clock.elapsedTime; place(t); if (portal.current) portal.current.rotation.z = t * 0.4; if (mats.fall.alphaMap) mats.fall.alphaMap.offset.y = t * 0.9; });

  return (<group>
    {/* the sky planet behind */}
    <mesh position={[18, 14, -40]}><sphereGeometry args={[11, 48, 24]} /><meshStandardMaterial color="#2b3f73" emissive="#1e3a8a" emissiveIntensity={0.35} roughness={0.8} /></mesh>
    {/* island: rock underside, grass top, castle hill */}
    <RealOr fallback={<>
      <mesh geometry={geos.rock} material={mats.rock} />
      <mesh position={[0, -0.12, 0]} scale={[5.3, 0.25, 5.3]} geometry={geos.disc} material={mats.grass} />
      <mesh position={[0, 0.3, -2.2]} scale={[3.4, 0.7, 2.2]} geometry={geos.disc} material={mats.grass} />
    </>}><TexturedIsland rock={geos.rock} disc={geos.disc} /></RealOr>
    <pointLight position={[0, hi ? -4.8 : -3.2, 5]} intensity={hi ? 12 : 40} distance={14} decay={1.6} color={PINK} />
    <mesh position={[0, hi ? -2.4 : -1.3, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[hi ? 6.4 : 5.3, 0.05, 8, 128]} /><meshBasicMaterial color={new THREE.Color(PINK).multiplyScalar(2.2)} toneMapped={false} /></mesh>
    {/* pond, river and the waterfall off the front edge */}
    <RealOr fallback={<>
      <mesh position={[1.2, 0.02, 2.2]} scale={[0.9, 0.04, 0.9]} geometry={geos.disc} material={mats.water} />
      <mesh position={[1.4, 0.02, hi ? 4.2 : 3.9]} scale={[0.35, 0.04, hi ? 2.1 : 1.5]} geometry={geos.box} material={mats.water} />
      {hi ? <mesh position={[1.45, -0.95, 5.72]} rotation-x={0.08} scale={[0.62, 1.9, 1]}><planeGeometry args={[1, 1]} /><primitive object={mats.fall} attach="material" /></mesh>
        : <mesh position={[1.4, -1.6, 4.85]} scale={[0.6, 3.3, 1]}><planeGeometry args={[1, 1]} /><primitive object={mats.fall} attach="material" /></mesh>}
    </>}>
      {/* v6: rippling water reflecting the sky, and a real flowing fall with foam and mist off the rim */}
      <Water position={[1.2, 0.05, 2.2]} scale={[0.95, 0.95, 1]} reduced={reduced} />
      <Water position={[1.4, 0.045, 4.15]} scale={[0.42, 2.2, 1]} round={false} foam={0.6} reduced={reduced} />
      <Waterfall lip={[1.4, 0.03, 5.22]} push={0.85} drop={3.3} width={0.5} reduced={reduced} />
    </RealOr>
    {/* buildings: solid = built, wireframe = still to build */}
    <RealOr fallback={<><Many items={built} geo={geos.box} mat={mats.stone} /><Many items={roofs} geo={geos.cone} mat={mats.roof} /></>}>
      {fort.map(([n, items]) => <AssetMany key={n} id="fort" node={n} items={items} uniform={false} />)}
      <AssetMany id="rocks" items={real.rocks} />
    </RealOr>
    <Many items={todo} geo={geos.wire} mat={mats.holo} />
    <Many items={todo} geo={geos.wire} mat={mats.holoFill} />
    {/* trees */}
    <RealOr fallback={<><Many items={flora.trunks} geo={geos.trunk} mat={mats.trunk} /><Many items={flora.blooms} geo={geos.ball} mat={mats.bloom} /><Many items={flora.pines} geo={geos.cone} mat={mats.pine} /></>}>
      <AssetMany id="tree" items={real.trees.filter((_, i) => i % 3)} />
      <AssetMany id="tree" items={real.trees.filter((_, i) => !(i % 3))} tint="#ffb3cf" />
      <AssetMany id="shrub" items={real.shrubs} />
    </RealOr>
    {/* release portal: lit once the game is in beta or live */}
    <group position={[3.4, 1.5, 0.6]} rotation-y={-0.9}>
      <mesh><torusGeometry args={[0.95, 0.16, 10, 48]} /><meshStandardMaterial color="#6b5866" roughness={0.6} /></mesh>
      <mesh ref={portal}><torusGeometry args={[0.78, 0.04, 8, 48]} /><meshBasicMaterial color={s.portalLit ? new THREE.Color(PINK).multiplyScalar(2.6) : "#3b2a33"} toneMapped={false} /></mesh>
    </group>
    {/* the other games */}
    <Many items={islets.rock} geo={geos.islet} mat={mats.rock} />
    <Many items={islets.top} geo={geos.disc} mat={mats.grass} />
    {s.drones > 0 && <instancedMesh key={`d${s.drones}`} ref={drones} args={[geos.box, mats.drone, s.drones]} frustumCulled={false} />}
    {s.bugs.length > 0 && <instancedMesh key={`b${s.bugs.length}`} ref={sparks} args={[geos.spark, mats.bug, s.bugs.length]} frustumCulled={false} />}
    <Motes count={reduced ? 30 : 70} color="#ffc2dc" spread={7} height={5} reduced={reduced} />
  </group>);
}

/** Leafy canopy: an icosphere puffed by low-frequency noise, smooth-shaded (v4). */
function canopy() {
  const ico = new THREE.IcosahedronGeometry(0.5, 4); ico.deleteAttribute("normal"); ico.deleteAttribute("uv"); const g = mergeVertices(ico); ico.dispose(); const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize(); const k = 1 + 0.14 * Math.sin(n.x * 7 + n.y * 3) * Math.cos(n.z * 6 - n.y * 4) + 0.06 * Math.sin(n.x * 17 + n.z * 13); v.multiplyScalar(k); p.setXYZ(i, v.x, v.y * 0.92, v.z); }
  g.computeVertexNormals(); return g;
}
