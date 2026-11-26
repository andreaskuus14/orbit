"use client";
// ARCH preview, the realistic look: the house from lib/arch-mesh-pure (walls with thickness and real openings, framed windows with
// glass, doors, roofs with eaves and gutters) in procedural materials (./arch-textures), on a site (lawn, gravel drip strip, a path
// to the front door, Nordic trees), under a physical sky with the sun from ARCH's sun study, soft shadows, ambient occlusion,
// a little bloom and filmic (ACES) tone mapping. One draw call per material; trees are instanced. Effects follow the world's quality preset
// (auto steps down when frames drop), so the RTX 5060 laptop stays at 60 fps and a weak GPU still gets the house.
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { shadowMap } from "@/lib/arch-shell-pure";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Environment, Sky } from "@react-three/drei";
import { EffectComposer, Bloom, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { houseMesh, roofTop, siteLayout, type SiteLayout } from "@/lib/arch-mesh-pure";
import { isOpening, type Part, type Scene } from "@/lib/arch-pure";
import { archMaterials } from "./arch-textures";
import { ArchCliff } from "./ArchIsland";
import { AssetEnv, RealOr } from "./world-assets";
import { RealGround, RealPlants } from "./ArchGround";
import { useTex } from "./world-surfaces";

const GOLD = "#c9a24a";
/** Build "print" height for the ▶ Build replay: everything above it is clipped away (shared by every house material). */
const CLIP = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);

type HouseProps = { scene: Scene; hideRoof: boolean; fail: ReadonlySet<string>; selected: string | null; onPick: (id: string) => void; front?: (t: number) => number };

export const ArchHouse = memo(function ArchHouse({ scene, hideRoof, fail, selected, onPick, front }: HouseProps) {
  const mats = useMemo(archMaterials, []);
  const gl = useThree((s) => s.gl);
  const mesh = useMemo(() => houseMesh(scene, { hideRoof, fail }), [scene, hideRoof, fail]);
  const geos = useMemo(() => mesh.groups.map((g) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(g.uv, 2));
    geo.computeBoundingSphere();
    return { geo, g };
  }), [mesh]);
  useEffect(() => () => geos.forEach((x) => x.geo.dispose()), [geos]);
  useEffect(() => {
    gl.localClippingEnabled = true;
    for (const m of Object.values(mats)) if (m !== mats.lawn && m !== mats.gravel && m !== mats.paving) { m.clippingPlanes = [CLIP]; m.clipShadows = true; }
  }, [gl, mats]);
  useFrame(({ clock }) => { CLIP.constant = front ? Math.min(1e5, front(clock.elapsedTime)) : 1e5; });
  const pick = (tri: string[]) => (e: ThreeEvent<MouseEvent>) => { const id = e.faceIndex != null ? tri[e.faceIndex] : undefined; if (id) { e.stopPropagation(); onPick(id); } };
  const sel = selected ? scene.parts.find((p) => p.id === selected) : undefined;
  return <group>
    <RealOr fallback={null}><HouseSkin /></RealOr>
    {geos.map(({ geo, g }, i) => <mesh key={`${g.mat}-${g.lift}-${i}`} geometry={geo} material={mats[g.mat]} castShadow={g.mat !== "glass"} receiveShadow onClick={pick(g.tri)} renderOrder={g.mat === "glass" ? 1 : 0} />)}
    {sel && <Outline p={sel} parts={scene.parts} />}
  </group>;
});

/** v7, tier 1+: Poly Haven PBR maps (CC0) on the cladding, stucco and metal roof. The house geometry is untouched; the shared materials get
 *  colour, normal and roughness maps while this is mounted and go back to the drawn ones after (low tier never loads any of it). */
function HouseSkin() {
  const mats = useMemo(archMaterials, []);
  const t = useTex("woodD", "woodN", "woodR", "roofD", "roofN", "roofR", "stuccoD", "stuccoN", "stuccoR");
  useEffect(() => {
    const own: THREE.Texture[] = [];
    const tile = (src: THREE.Texture, m: number) => { const c = src.clone(); c.repeat.set(1 / m, 1 / m); c.needsUpdate = true; own.push(c); return c; };
    const skins = [
      { k: "timber" as const, m: 1.1, d: t[0], n: t[1], r: t[2], color: "#c9bba5", rough: 1, metal: 0, ns: 0.9 },
      { k: "roofMetal" as const, m: 1.6, d: t[3], n: t[4], r: t[5], color: "#8e949c", rough: 1, metal: 0.65, ns: 1.3 },
      { k: "plaster" as const, m: 1.8, d: t[6], n: t[7], r: t[8], color: "#f3ece0", rough: 1, metal: 0, ns: 0.8 },
    ];
    const gl = mats.glass as THREE.MeshPhysicalMaterial, glKeep = { color: gl.color.clone(), opacity: gl.opacity, env: gl.envMapIntensity };
    gl.color.set("#b4c6d0"); gl.opacity = 0.72; gl.envMapIntensity = 4; // the sky (HDRI) shows in the windows
    const was = skins.map((x) => { const m = mats[x.k] as THREE.MeshStandardMaterial;
      const keep = { map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, bumpMap: m.bumpMap, color: m.color.clone(), roughness: m.roughness, metalness: m.metalness, ns: m.normalScale.clone() };
      m.map = tile(x.d, x.m); m.normalMap = tile(x.n, x.m); m.roughnessMap = tile(x.r, x.m); m.bumpMap = null; m.color.set(x.color); m.roughness = x.rough; m.metalness = x.metal; m.normalScale.set(x.ns, x.ns);
      m.needsUpdate = true; return [m, keep] as const; });
    return () => { for (const [m, k] of was) { m.map = k.map; m.normalMap = k.normalMap; m.roughnessMap = k.roughnessMap; m.bumpMap = k.bumpMap; m.color.copy(k.color); m.roughness = k.roughness; m.metalness = k.metalness; m.normalScale.copy(k.ns); m.needsUpdate = true; }
      gl.color.copy(glKeep.color); gl.opacity = glKeep.opacity; gl.envMapIntensity = glKeep.env; own.forEach((x) => x.dispose()); };
  }, [mats, t]);
  return null;
}

/** Gold edges round the selected part (its block, or the roof as drawn). */
function Outline({ p, parts }: { p: Part; parts: Part[] }) {
  let b = { x: p.x, y: p.y + p.h / 2, z: p.z, w: p.w, h: p.h, d: Math.max(p.d, 0.05) };
  if (p.kind === "roof") { const t = roofTop(p, parts); b = { x: p.x, y: (p.y + t) / 2, z: p.z, w: p.w, h: t - p.y + 0.3, d: p.d }; }
  if (isOpening(p.kind)) { const ns = p.face === "n" || p.face === "s"; b = { x: p.x, y: p.y + p.h / 2, z: p.z, w: ns ? p.w : 0.4, h: p.h, d: ns ? 0.4 : p.w }; }
  return <mesh position={[b.x, b.y, b.z]} scale={[b.w + 0.04, b.h + 0.04, b.d + 0.04]} raycast={() => null}>
    <boxGeometry args={[1, 1, 1]} /><meshBasicMaterial visible={false} /><Edges color={GOLD} lineWidth={2} />
  </mesh>;
}

// ---------- site ----------
const TREE = (() => {
  const g = (geo: THREE.BufferGeometry, color: string) => { const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); geo.setAttribute("color", new THREE.BufferAttribute(a, 3)); return geo.toNonIndexed(); };
  const at = (geo: THREE.BufferGeometry, y: number, sx = 1, sy = 1) => geo.scale(sx, sy, sx).translate(0, y, 0);
  const trunk = (h: number, r: number, color: string) => g(at(new THREE.CylinderGeometry(r * 0.7, r, h, 6), h / 2), color);
  const spruce = mergeGeometries([trunk(2, 0.18, "#4a3526"), ...[0, 1, 2, 3].map((i) => g(at(new THREE.ConeGeometry(2.1 - i * 0.45, 3 - i * 0.35, 8), 2.2 + i * 1.9), "#2c4428"))]);
  const birch = mergeGeometries([trunk(5, 0.14, "#e6e1d6"), g(at(new THREE.IcosahedronGeometry(1.9, 1), 6.2, 1, 1.35), "#7f9d4c"), g(at(new THREE.IcosahedronGeometry(1.3, 1), 7.8), "#8fae58")]);
  const pine = mergeGeometries([trunk(6.5, 0.2, "#8a5a3a"), g(at(new THREE.IcosahedronGeometry(2.2, 1), 7.6, 1, 0.55), "#3c5531"), g(at(new THREE.IcosahedronGeometry(1.4, 1), 8.6, 1, 0.6), "#435d36")]);
  const shrub = g(at(new THREE.IcosahedronGeometry(0.8, 1), 0.55, 1, 0.75), "#4e6a35");
  for (const x of [spruce, birch, pine, shrub]) x.computeVertexNormals();
  return { spruce, birch, pine, shrub };
})();
const LEAF = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });

function Instanced({ geo, items }: { geo: THREE.BufferGeometry; items: { x: number; z: number; s: number }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current; if (!m) return;
    const o = new THREE.Object3D(), c = new THREE.Color();
    items.forEach((t, i) => {
      o.position.set(t.x, 0, t.z); o.rotation.set(0, (t.x * 13.1 + t.z * 7.7) % 6.28, 0); o.scale.setScalar(t.s); o.updateMatrix();
      m.setMatrixAt(i, o.matrix); m.setColorAt(i, c.setHSL(0, 0, 0.85 + ((i * 0.37) % 0.3)));
    });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geo, LEAF, items.length]} castShadow receiveShadow />;
}

const Rect = ({ r, y, mat }: { r: { x0: number; x1: number; z0: number; z1: number }; y: number; mat: THREE.Material }) =>
  <mesh position={[(r.x0 + r.x1) / 2, y / 2, (r.z0 + r.z1) / 2]} material={mat} receiveShadow><boxGeometry args={[r.x1 - r.x0, y, r.z1 - r.z0]} /></mesh>;

/** Ground, gravel drip strip round the house, the path to the front door, trees and shrubs. Tier 1+: real grass terrain that rolls into the
 *  cliff, real trees and plants (./ArchGround); tier 0 and while loading: the drawn lawn disc and low-poly trees. */
export const ArchSiteLook = memo(function ArchSiteLook({ scene }: { scene: Scene }) {
  const mats = useMemo(archMaterials, []);
  const s: SiteLayout = useMemo(() => siteLayout(scene), [scene]);
  const big = Math.max(scene.plot.w, scene.plot.d) * 3, r = big * 0.24;
  const by = (k: string) => s.trees.filter((t) => t.kind === k);
  return <group>
    <RealOr fallback={<>
      <mesh rotation-x={-Math.PI / 2} material={mats.lawn} receiveShadow><circleGeometry args={[r, 64]} /></mesh>
      <ArchCliff r={r} />
      <Instanced geo={TREE.spruce} items={by("spruce")} />
      <Instanced geo={TREE.birch} items={by("birch")} />
      <Instanced geo={TREE.pine} items={by("pine")} />
      <Instanced geo={TREE.shrub} items={s.shrubs} />
    </>}>
      <RealGround r={r} />
      <ArchCliff r={r} noRock />
      <RealPlants site={s} r={r} />
    </RealOr>
    {s.gravel.map((r, i) => <Rect key={i} r={r} y={0.03} mat={mats.gravel} />)}
    {s.path && <Rect r={s.path} y={0.04} mat={mats.paving} />}
  </group>;
});

// ---------- light ----------
type LookProps = { sun: [number, number, number]; night: boolean; reach: number; effects: { ao: boolean; bloom: number; msaa: number } };
/** Physical sky from the sun direction, image light from that sky, a sun with soft shadows fitted to the plot, and the effects. */
export function ArchLook({ sun, night, reach, effects }: LookProps) {
  const gl = useThree((s) => s.gl);
  const dir = useMemo(() => new THREE.Vector3(...sun).normalize(), [sun]);
  const pos = useMemo(() => dir.clone().multiplyScalar(reach * 1.6), [dir, reach]);
  const low = dir.y < 0.25; // low sun = golden hour: warmer, redder sky and light, longer shadows
  const sky = { distance: 450, sunPosition: dir.toArray() as [number, number, number], turbidity: low ? 8 : 4.5, rayleigh: low ? 2.4 : 1.4, mieCoefficient: low ? 0.012 : 0.004, mieDirectionalG: low ? 0.9 : 0.82 };
  const fx = effects.ao || effects.bloom > 0;
  useEffect(() => { // without the composer the renderer tone-maps; with it, the ToneMapping effect does (and the renderer must not)
    const prev = [gl.toneMapping, gl.toneMappingExposure] as const;
    gl.toneMapping = fx ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.95;
    return () => { gl.toneMapping = prev[0]; gl.toneMappingExposure = prev[1]; };
  }, [gl, fx]);
  const procEnv = <Environment frames={1} resolution={128} environmentIntensity={night ? 0.08 : 0.45}>{!night && <Sky {...sky} />}</Environment>;
  return <>
    {!night && <Sky {...sky} />}
    {/* tier 1+ by day: a real Poly Haven sky (CC0) lights the scene and is what the glass reflects; tier 0, night and while loading: the drawn sky */}
    {night ? procEnv : <RealOr fallback={procEnv}><AssetEnv id="hdriDay" intensity={low ? 0.5 : 0.75} /></RealOr>}
    <hemisphereLight args={low ? ["#ffd9b8", "#5e5038", night ? 0.04 : 0.2] : ["#dfe9f5", "#6b7a52", night ? 0.04 : 0.15]} />
    <directionalLight position={pos} intensity={night ? 0.05 : low ? 4.2 : 3.4} color={low ? "#ffb877" : "#fff5e6"} castShadow
      shadow-mapSize={shadowMap(effects.bloom)} shadow-bias={-0.0002} shadow-normalBias={0.03} shadow-radius={3}
      shadow-camera-left={-reach} shadow-camera-right={reach} shadow-camera-top={reach} shadow-camera-bottom={-reach} shadow-camera-near={1} shadow-camera-far={reach * 4} />
    {fx && <EffectComposer multisampling={0} enableNormalPass={false}>
      {effects.ao ? <N8AO halfRes={effects.bloom < 0.8} aoRadius={1.6} distanceFalloff={0.8} intensity={2.2} quality={effects.bloom < 0.8 ? "performance" : "medium"} /> : <></>}
      {effects.bloom > 0 ? <Bloom intensity={0.22 * effects.bloom} luminanceThreshold={0.92} luminanceSmoothing={0.1} mipmapBlur /> : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {effects.msaa ? <SMAA /> : <></>}
    </EffectComposer>}
  </>;
}
