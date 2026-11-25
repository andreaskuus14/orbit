"use client";
// Shared look for the planet worlds (v2): one lighting rig with a baked studio env (Lightformers, no downloads) so PBR
// metal and glass read, a curved planet ground with an atmosphere rim, instanced crystals, drifting motes, tuned post
// FX, and glass chips projected from 3D anchors that never cover each other or the panel (world-chips-pure).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ToneMapping, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { layoutChips, type Box } from "@/lib/world-chips-pure";

/* ---------- light ---------- */

/** Key + fill + rim and a baked env (rendered once: frames=1) so metal/glass have something to reflect. */
export function WorldLights({ color, keyLight = "#fff4e0", warm = 1, env = true }: { color: string; keyLight?: string; warm?: number; env?: boolean }) {
  return (<>
    <hemisphereLight args={["#9fb6ff", "#07080c", 0.35]} />
    <directionalLight position={[8, 14, 6]} intensity={1.6 * warm} color={keyLight} />
    <directionalLight position={[-10, 4, -8]} intensity={0.9} color={color} />
    <pointLight position={[0, 6, 0]} intensity={30} distance={26} decay={1.6} color={color} />
    {env && <Environment resolution={128} frames={1}>
      <color attach="background" args={["#020308"]} />
      <Lightformer form="rect" intensity={3} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[12, 3, 1]} />
      <Lightformer form="rect" intensity={2} color={color} position={[-9, 2, 0]} rotation-y={Math.PI / 2} scale={[3, 10, 1]} />
      <Lightformer form="rect" intensity={1.4} color={keyLight} position={[9, 3, -2]} rotation-y={-Math.PI / 2} scale={[2, 8, 1]} />
      <Lightformer form="ring" intensity={1.2} color={color} position={[0, 1, -10]} scale={6} />
    </Environment>}
  </>);
}

/* ---------- ground ---------- */

const groundVert = /* glsl */ `varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w; }`;
const groundFrag = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB; uniform vec3 uGlow; uniform float uGrid; varying vec3 vW; varying vec3 vN;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
  void main(){
    vec2 p = vW.xz;
    float m = fbm(p*0.18), c = fbm(p*0.9+7.0);
    vec3 col = mix(uA, uB, smoothstep(0.35, 0.75, m)) * (0.75 + 0.5*c);
    float r = length(p);
    float veins = smoothstep(0.02, 0.0, abs(fbm(p*0.35+3.0)-0.5)) * 0.6;        // faint glowing seams in the rock
    float rings = uGrid * smoothstep(0.035, 0.0, abs(fract(r*0.25)-0.5)) * smoothstep(26.0, 6.0, r) * 0.35; // survey rings
    col += uGlow * (veins + rings) * smoothstep(30.0, 4.0, r);
    vec3 L = normalize(vec3(0.5, 0.9, 0.3));
    col *= 0.35 + 0.65 * max(dot(vN, L), 0.0);
    float fog = smoothstep(16.0, 42.0, r);
    gl_FragColor = vec4(mix(col, uGlow*0.08, fog), 1.0);
  }`;
const atmoFrag = /* glsl */ `uniform vec3 uGlow; varying vec3 vW; varying vec3 vN;
  void main(){ vec3 v = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(normalize(vN), v)), 3.0); gl_FragColor = vec4(uGlow * f * 1.4, f); }`;

/** A planet under the scene: its top sits at y = 0 (radius R), dark rock with glowing seams, an atmosphere rim. */
export function PlanetGround({ glow, a = "#0b0d14", b = "#1a1f2e", R = 60, grid = 1 }: { glow: string; a?: string; b?: string; R?: number; grid?: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: groundVert, fragmentShader: groundFrag,
    uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uGlow: { value: new THREE.Color(glow) }, uGrid: { value: grid } } }), [a, b, glow, grid]);
  const atmo = useMemo(() => new THREE.ShaderMaterial({ vertexShader: groundVert, fragmentShader: atmoFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uGlow: { value: new THREE.Color(glow) } } }), [glow]);
  useEffect(() => () => { mat.dispose(); atmo.dispose(); }, [mat, atmo]);
  return (<group position={[0, -R, 0]}>
    <mesh material={mat}><sphereGeometry args={[R, 128, 64]} /></mesh>
    <mesh material={atmo} scale={1.035}><sphereGeometry args={[R, 64, 32]} /></mesh>
  </group>);
}

/** Height of the planet surface at (x, z) for objects that sit on it. */
export const groundY = (x: number, z: number, R = 60) => Math.sqrt(Math.max(0, R * R - x * x - z * z)) - R;

/** A flat lit platform (site plate / deck): a bevelled disc with an emissive rim line. */
export function Plate({ r, h = 0.35, y = 0, color = "#151a24", rim, metal = 0.7, rough = 0.35 }: { r: number; h?: number; y?: number; color?: string; rim: string; metal?: number; rough?: number }) {
  return (<group position={[0, y, 0]}>
    <mesh position={[0, -h / 2, 0]}><cylinderGeometry args={[r, r * 1.04, h, 96]} /><meshStandardMaterial color={color} metalness={metal} roughness={rough} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}><ringGeometry args={[r - 0.08, r - 0.02, 128]} /><meshBasicMaterial color={rim} toneMapped={false} /></mesh>
  </group>);
}

/* ---------- crystals ---------- */

/** Hexagonal crystal: prism with a pointed tip, base at y = 0, height 1. */
export function crystalGeometry() {
  const g = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.28, 0.02), new THREE.Vector2(0.3, 0.72), new THREE.Vector2(0, 1)], 6);
  g.computeVertexNormals();
  return g.toNonIndexed();
}
export type CrystalIn = { at: [number, number, number]; h: number; w?: number; tilt?: [number, number]; color: string; glow?: number };

/** Many crystals, one draw call. Emissive in the instance colour; glow scales it (0..2). */
export function Crystals({ items, reduced, intensity = 1.2, onPick }: { items: CrystalIn[]; reduced: boolean; intensity?: number; onPick?: (i: number) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(crystalGeometry, []);
  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({ color: "#ffffff", metalness: 0.1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true,
      emissive: "#ffffff", emissiveIntensity: intensity, transparent: true, opacity: 0.92, iridescence: 0.3, iridescenceIOR: 1.3, envMapIntensity: 0.5 });
    // emissive follows the instance colour (vertex colour slot): patch so emissive = instance colour * intensity
    m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * vColor;"); };
    return m;
  }, [intensity]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useLayoutEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    const o = new THREE.Object3D(), c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.at); o.rotation.set(it.tilt?.[0] ?? 0, (i * 2.39996) % 6.28, it.tilt?.[1] ?? 0);
      const w = it.w ?? it.h * 0.35; o.scale.set(w, it.h, w); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(it.color).multiplyScalar(0.35 + 0.65 * Math.min(2, it.glow ?? 1)));
    });
    mesh.count = items.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere();
  }, [items]);
  useFrame(({ clock }) => { if (!reduced) mat.emissiveIntensity = intensity * (0.9 + 0.1 * Math.sin(clock.elapsedTime * 0.8)); });
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, items.length)]} onClick={onPick ? (e) => { e.stopPropagation(); if (e.instanceId !== undefined) onPick(e.instanceId); } : undefined} />;
}

/* ---------- motes ---------- */

const moteVert = /* glsl */ `attribute float aS; uniform float uT; uniform float uM; varying float vA;
  void main(){ vec3 p = position; p.y += uM * mod(uT*0.15*(0.5+aS) + aS*20.0, 6.0) ; p.x += uM*0.3*sin(uT*0.3+aS*30.0);
    vec4 mv = modelViewMatrix*vec4(p,1.0); gl_PointSize = (2.0+4.0*aS) * 30.0 / max(-mv.z, 1.0); vA = 0.35+0.65*aS; gl_Position = projectionMatrix*mv; }`;
const moteFrag = /* glsl */ `uniform vec3 uC; varying float vA; void main(){ vec2 p=gl_PointCoord*2.0-1.0; float a=max(1.0-dot(p,p),0.0); gl_FragColor=vec4(uC*a*a*vA, 1.0); }`;
/** Slow rising light specks in a box around the scene. */
export function Motes({ count, color, spread = 18, height = 6, reduced }: { count: number; color: string; spread?: number; height?: number; reduced: boolean }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3), s = new Float32Array(count);
    let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) { p.set([(r() - 0.5) * spread * 2, r() * height, (r() - 0.5) * spread * 2], i * 3); s[i] = r(); }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("aS", new THREE.BufferAttribute(s, 1)); return g;
  }, [count, spread, height]);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: moteVert, fragmentShader: moteFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uM: { value: reduced ? 0 : 1 }, uC: { value: new THREE.Color(color) } } }), [color, reduced]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock }) => { mat.uniforms.uT.value = clock.elapsedTime; });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/** A soft vertical light shaft (additive cone), e.g. VAULT's skylight or a hologram projector. Built-in material with a
 *  gradient alpha map: an earlier custom-shader version poisoned the bloom chain (whole frame black on swiftshader). */
let shaftAlpha: THREE.DataTexture | null = null;
function shaftTexture() {
  if (shaftAlpha) return shaftAlpha;
  const n = 64, d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) { const v = Math.round(255 * Math.pow(i / (n - 1), 1.6)); d.set([v, v, v, 255], i * 4); }
  shaftAlpha = new THREE.DataTexture(d, 1, n); shaftAlpha.needsUpdate = true;
  return shaftAlpha;
}
export function LightShaft({ at = [0, 0, 0], r = 2, h = 10, color, strength = 0.35 }: { at?: [number, number, number]; r?: number; h?: number; color: string; strength?: number }) {
  return (
    <mesh position={[at[0], at[1] + h / 2, at[2]]} renderOrder={2}>
      <cylinderGeometry args={[r * 0.6, r, h, 32, 1, true]} />
      <meshBasicMaterial color={color} alphaMap={shaftTexture()} transparent opacity={Math.min(1, strength * 1.6)} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} fog={false} />
    </mesh>
  );
}

/* ---------- post ---------- */

export function WorldFX({ scale, msaa, reduced, threshold = 0.85, strength = 0.7 }: { scale: number; msaa: number; reduced: boolean; threshold?: number; strength?: number }) {
  if (scale <= 0) return null;
  return (
    <EffectComposer multisampling={msaa} enableNormalPass={false}>
      <Bloom intensity={(reduced ? 0.5 : 1) * strength * scale} luminanceThreshold={threshold} luminanceSmoothing={0.25} mipmapBlur radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.72} />
      <SMAA />
    </EffectComposer>
  );
}

/* ---------- glass chips ---------- */

export type Chip = { id: string; at: [number, number, number]; title: string; value?: string; sub?: string; color: string; prio?: number; dot?: "ok" | "busy" | "warn" | "bad" | "idle" };
export type ChipRig = { els: Map<string, HTMLDivElement>; root: RefObject<HTMLDivElement | null> };
export const useChipRig = (): ChipRig => { const els = useMemo(() => new Map<string, HTMLDivElement>(), []); const root = useRef<HTMLDivElement>(null); return { els, root }; };

/** The DOM half: render outside <Canvas>, over it. Chips start hidden; ChipProjector places them. */
export function ChipLayer({ rig, chips, onPick }: { rig: ChipRig; chips: Chip[]; onPick?: (id: string) => void }) {
  return (
    <div ref={rig.root} className="wchip-layer" aria-hidden={onPick ? undefined : true}>
      {chips.map((c) => (
        <div key={c.id} ref={(el) => { if (el) rig.els.set(c.id, el); else rig.els.delete(c.id); }} className="wchip" style={{ ["--c" as string]: c.color }}
          onClick={onPick ? () => onPick(c.id) : undefined} role={onPick ? "button" : undefined}>
          <span className="wchip-t">{c.dot && <i className={`wchip-dot ${c.dot}`} />}{c.title}</span>
          {c.value && <b className="wchip-v">{c.value}</b>}
          {c.sub && <span className="wchip-s">{c.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** The 3D half: inside <Canvas>. Projects anchors ~15x a second and lays chips out around the panel. */
export function ChipProjector({ rig, chips }: { rig: ChipRig; chips: Chip[] }) {
  const camera = useThree((s) => s.camera), size = useThree((s) => s.size), gl = useThree((s) => s.gl);
  const v = useMemo(() => new THREE.Vector3(), []);
  const last = useRef(0), blocked = useRef<Box[]>([]), blockAt = useRef(0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t - last.current < 0.066) return;
    last.current = t;
    const host = gl.domElement.getBoundingClientRect();
    if (t - blockAt.current > 0.5 || !blocked.current.length) { // the panel(s) of this world, in canvas px
      blockAt.current = t;
      const region = gl.domElement.closest("[role=region]") ?? document.body;
      blocked.current = [...region.querySelectorAll(".world-shell-slot, .world-shell, .world-panel, .pu-shell, [data-chip-block]")].map((e) => {
        const r = e.getBoundingClientRect(); return { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
      }).filter((b) => b.w > 0 && b.h > 0);
    }
    const ins = chips.map((c, i) => {
      const el = rig.els.get(c.id);
      v.set(...c.at).project(camera);
      return { id: c.id, x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0, prio: (c.prio ?? 1) - i * 1e-4, on: v.z < 1 && v.z > -1 };
    });
    const out = layoutChips(ins, { w: size.width, h: size.height }, blocked.current);
    for (const c of chips) {
      const el = rig.els.get(c.id), p = out.get(c.id); if (!el) continue;
      if (!p) { el.style.opacity = "0"; el.style.pointerEvents = "none"; continue; }
      el.style.opacity = "1"; el.style.pointerEvents = ""; el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`; el.dataset.side = p.side;
    }
  });
  return null;
}

/** Fits the camera so the scene sits in the space left of the panel on wide screens. */
export function ShiftForPanel({ px = 480 }: { px?: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera, size = useThree((s) => s.size);
  useEffect(() => {
    if (size.width >= 900) camera.setViewOffset(size.width, size.height, px / 2, 0, size.width, size.height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    return () => { camera.clearViewOffset(); camera.updateProjectionMatrix(); };
  }, [camera, size.width, size.height, px]);
  return null;
}

/** Mount children only once the GL context exists and the tab can draw (keeps the no-WebGL path quiet). */
export function useHasWebGL() {
  const [ok] = useState(() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } });
  return ok;
}
export type Kids = { children?: ReactNode };

/** A capsule from a lathe (round caps, clean normals). Built-in CapsuleGeometry fed NaN into the bloom chain here. */
export function capsule(r: number, len: number, seg = 8, radial = 12) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r), -len / 2 + Math.sin(a) * r)); }
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(1e-4, Math.cos(a) * r), len / 2 + Math.sin(a) * r)); }
  return new THREE.LatheGeometry(pts, radial);
}
/** Same capsule as a JSX child: <mesh><Capsule args={[r, len]} /></mesh>. */
export function Capsule({ args }: { args: [number, number, number?, number?] }) {
  const g = useMemo(() => capsule(args[0], args[1], args[2], args[3]), [args[0], args[1], args[2], args[3]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => g.dispose(), [g]);
  return <primitive object={g} attach="geometry" />;
}
