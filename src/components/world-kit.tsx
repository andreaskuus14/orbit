"use client";
// Shared look for the planet worlds (v2): one lighting rig with a baked studio env (Lightformers, no downloads) so PBR
// metal and glass read, a curved planet ground with an atmosphere rim, instanced crystals, drifting motes, tuned post
// FX, and glass chips projected from 3D anchors that never cover each other or the panel (world-chips-pure).
import { chipPrio, chipShows, itemReach, zoomLevel, type Lod } from "@/lib/world-zoom-pure";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { REALISM, surfaceFor, surfaceKey, type Surface, type WorldTier } from "@/lib/world-realism-pure";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { EffectComposer, Bloom, DepthOfField, Vignette, ToneMapping, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { layoutChips, type Box } from "@/lib/world-chips-pure";

/* ---------- light ---------- */

/* ---------- realism tier (v4) ---------- */

// The tier the open world draws at, shared so Crystals / Motes / islands can pick detail without prop drilling.
let tierNow: WorldTier = 0;
const tierSubs = new Set<() => void>();
const setTier = (t: WorldTier) => { if (t !== tierNow) { tierNow = t; tierSubs.forEach((f) => f()); } };
/** For canvases that skip <Realism> (ARCH has its own look): still tell the world parts which tier to draw. */
export function WorldTierSet({ tier }: { tier: WorldTier }) { useEffect(() => { setTier(tier); }, [tier]); return null; }
export const useWorldTier = () => useSyncExternalStore((f) => { tierSubs.add(f); return () => tierSubs.delete(f); }, () => tierNow, () => 0 as WorldTier);

const skyVert = /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const skyFrag = /* glsl */ `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uLow; varying vec3 vD;
  void main(){ float y = vD.y; vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.7, y)); c = mix(c, uLow, smoothstep(0.0, -0.35, y));
    c += uHor * 1.6 * exp(-abs(y) * 14.0); gl_FragColor = vec4(c, 1.0); }`;

/** Procedural environment: a gradient sky with a glowing horizon band plus a warm key softbox, a coloured rim strip
 *  and a faint floor bounce, prefiltered once with PMREM. No files. */
function ProcEnv({ sky, horizon, low, keyLight, rim }: { sky: string; horizon: string; low: string; keyLight: string; rim: string }) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  useEffect(() => {
    const env = new THREE.Scene(), geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
    const add = (g: THREE.BufferGeometry, m: THREE.Material, f?: (o: THREE.Mesh) => void) => { geos.push(g); mats.push(m); const o = new THREE.Mesh(g, m); f?.(o); env.add(o); };
    add(new THREE.SphereGeometry(50, 48, 24), new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
      uniforms: { uTop: { value: new THREE.Color(sky) }, uHor: { value: new THREE.Color(horizon).multiplyScalar(0.5) }, uLow: { value: new THREE.Color(low) } } }));
    const panel = (c: string, k: number, pos: [number, number, number], sc: [number, number]) => add(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }), (o) => { o.position.set(...pos); o.scale.set(sc[0], sc[1], 1); o.lookAt(0, 0, 0); });
    panel(keyLight, 9, [18, 26, 14], [16, 10]);   // key softbox, high front-right
    panel(rim, 5, [-22, 6, -20], [6, 26]);        // rim strip behind-left
    panel(rim, 2.5, [24, 4, -18], [4, 18]);       // second, fainter rim
    panel(horizon, 0.6, [0, -20, 0], [40, 40]);   // bounce from below
    const pm = new THREE.PMREMGenerator(gl), rt = pm.fromScene(env, 0.03);
    const prev = scene.environment, prevI = scene.environmentIntensity;
    scene.environment = rt.texture; scene.environmentIntensity = 0.85;
    return () => { scene.environment = prev; scene.environmentIntensity = prevI; rt.dispose(); pm.dispose(); geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); };
  }, [gl, scene, sky, horizon, low, keyLight, rim]);
  return null;
}

const NOISE_GLSL = /* glsl */ `
  float rzH(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float rzN(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(rzH(i),rzH(i+vec3(1,0,0)),f.x), mix(rzH(i+vec3(0,1,0)),rzH(i+vec3(1,1,0)),f.x), f.y),
               mix(mix(rzH(i+vec3(0,0,1)),rzH(i+vec3(1,0,1)),f.x), mix(rzH(i+vec3(0,1,1)),rzH(i+vec3(1,1,1)),f.x), f.y), f.z); }
  float rzF(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*rzN(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }`;

const patched = new WeakSet<THREE.Material>();
/** Adds procedural detail to a standard material in place: world-space fbm bump, roughness wobble, albedo variation per
 *  surface and per instance, and brushed-metal streaks. Shader-generated, no texture files. */
function patchMaterial(m: THREE.MeshStandardMaterial) {
  if (patched.has(m)) return; patched.add(m);
  const s = surfaceFor({ metalness: m.metalness, roughness: m.roughness, transparent: m.transparent && m.opacity < 0.99, wireframe: m.wireframe, foliage: !!m.userData.foliage },
    m.userData.realism as Partial<Surface> | null | undefined);
  if (!s) return;
  if (m.flatShading && !m.userData.keepFacets) m.flatShading = false;
  m.envMapIntensity = m.metalness >= 0.5 ? 1.2 : 0.7;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.rzOn = RZ_ON;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vRW; varying float vSeed;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec4 rzW = vec4(transformed, 1.0); vSeed = 0.0;
        #ifdef USE_INSTANCING
          rzW = instanceMatrix * rzW; vSeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        #endif
        vRW = (modelMatrix * rzW).xyz;`);
    const f = (v: number) => v.toFixed(4);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vRW; varying float vSeed; uniform float rzOn;\n${NOISE_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float rzV = rzF(vRW * ${f(s.freq * 0.35)});
        diffuseColor.rgb *= 1.0 + rzOn * (${f(s.vary)} * (rzV - 0.5) * 1.6 + ${f(s.vary * 0.7)} * (vSeed - 0.5));
        diffuseColor.rgb *= 1.0 - rzOn * 0.25 * smoothstep(0.0, -4.0, vRW.y) * ${f(s.bump > 0.3 ? 1 : 0)}; // undersides darker`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        float rzS = ${f(s.streak)} > 0.0 ? rzN(vRW * vec3(0.6, 38.0, 38.0)) : rzF(vRW * ${f(s.freq)});
        roughnessFactor = clamp(roughnessFactor + rzOn * ${f(s.rough)} * (rzS - 0.5) * 2.0, 0.03, 1.0);`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        if (rzOn > 0.5 && ${f(s.bump)} > 0.0) {
          vec3 rzP = -vViewPosition; float rzHgt = rzF(vRW * ${f(s.freq)}) * ${f(s.bump)} + rzN(vRW * ${f(s.freq * 4.0)}) * ${f(s.bump * 0.25)};
          vec3 dpx = dFdx(rzP), dpy = dFdy(rzP); float dhx = dFdx(rzHgt), dhy = dFdy(rzHgt);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
          normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2));
        }`);
  };
  const key = surfaceKey(s);
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
}
const RZ_ON = { value: 1 };

/** The realism layer for one world canvas: procedural env, soft key-light shadows, depth fog and the material pass.
 *  tier 0 does nothing (the v3 look). Re-scans the scene twice a second so parts that load later are picked up. */
export function Realism({ tier, sky = "#121a33", horizon = "#7c8cff", low = "#030308", keyLight = "#fff1dc", rim = "#8fb4ff", fog }: {
  tier: WorldTier; sky?: string; horizon?: string; low?: string; keyLight?: string; rim?: string; fog?: string }) {
  const scene = useThree((s) => s.scene), gl = useThree((s) => s.gl);
  const cfg = REALISM[tier];
  useEffect(() => { setTier(tier); RZ_ON.value = tier > 0 ? 1 : 0; }, [tier]);
  useEffect(() => { // shadows: soft PCF on the key light only
    if (!cfg.shadow) return;
    const was = gl.shadowMap.enabled; gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap; gl.shadowMap.needsUpdate = true;
    return () => { gl.shadowMap.enabled = was; };
  }, [gl, cfg.shadow]);
  useEffect(() => { // depth fog only where the world set none
    if (!cfg.fog || scene.fog) return;
    const bg = scene.background instanceof THREE.Color ? scene.background : new THREE.Color(fog ?? low);
    scene.fog = new THREE.FogExp2(fog ? new THREE.Color(fog) : bg.clone(), cfg.fog * 0.6);
    return () => { scene.fog = null; };
  }, [scene, cfg.fog, fog, low]);
  const acc = useRef(1);
  useFrame((_, dt) => {
    if (!tier) return; acc.current += dt; if (acc.current < 0.5) return; acc.current = 0;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let solid = false;
      for (const m of ms) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) { patchMaterial(m as THREE.MeshStandardMaterial); solid ||= !m.transparent; }
      if (cfg.shadow && solid && !mesh.userData.rzShadow) { mesh.userData.rzShadow = 1; mesh.castShadow = true; mesh.receiveShadow = true; }
    });
  });
  if (!cfg.env) return null;
  return <ProcEnv sky={sky} horizon={horizon} low={low} keyLight={keyLight} rim={rim} />;
}

/** Key + fill + rim and a baked env (rendered once: frames=1) so metal/glass have something to reflect.
 *  tier > 0 (v4): procedural PMREM sky instead, a shadow-casting key, a coloured rim, a warm bounce from below. */
export function WorldLights({ color, keyLight = "#fff4e0", warm = 1, env = true, tier = 0, sky, reach = 14 }: { color: string; keyLight?: string; warm?: number; env?: boolean; tier?: WorldTier; sky?: string; reach?: number }) {
  if (tier > 0) { const sm = REALISM[tier].shadow; return (<>
    <hemisphereLight args={["#9fb6ff", "#120c10", 0.18]} />
    <directionalLight position={[10, 16, 8]} intensity={2.4 * warm} color={keyLight} castShadow shadow-mapSize={[sm, sm]} shadow-bias={-0.0005} shadow-normalBias={0.03} shadow-radius={4}
      shadow-camera-left={-reach} shadow-camera-right={reach} shadow-camera-top={reach} shadow-camera-bottom={-reach} shadow-camera-near={1} shadow-camera-far={60} />
    <directionalLight position={[-12, 5, -10]} intensity={1.6} color={color} />{/* rim */}
    <directionalLight position={[0, -8, 4]} intensity={0.35} color={color} />{/* bounce from below */}
    <pointLight position={[0, 6, 0]} intensity={18} distance={22} decay={1.8} color={color} />
    <Realism tier={tier} keyLight={keyLight} rim={color} horizon={color} sky={sky} />
  </>); }
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

/** Quartz-like crystal (v6): an uneven six-sided prism, a little narrower at the top, ending in a termination of
 *  unequal faces with an off-centre tip, flat facets. Base at y = 0, height 1, radius ~0.3. */
export function crystalGeometry() {
  const R = [0.3, 0.25, 0.31, 0.27, 0.29, 0.24], ring = (y: number, k: number, dx = 0, dz = 0) => R.map((r, i) => { const a = (i / 6) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r * k + dx, y + (i % 2 ? 0.02 : -0.015) * (y > 0.5 ? 1 : 0), Math.sin(a) * r * k + dz); });
  const b0 = ring(0, 0.92), b1 = ring(0.66, 0.86), b2 = ring(0.8, 0.52, 0.03, -0.02), tip = new THREE.Vector3(0.05, 1, -0.03), bot = new THREE.Vector3(0, -0.04, 0);
  const pos: number[] = [], tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6;
    tri(b0[i], b1[j], b0[j]); tri(b0[i], b1[i], b1[j]); // prism side
    tri(b1[i], b2[j], b1[j]); tri(b1[i], b2[i], b2[j]); // bevel
    tri(b2[i], tip, b2[j]); tri(b0[j], bot, b0[i]); } // point, base
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
export type CrystalIn = { at: [number, number, number]; h: number; w?: number; tilt?: [number, number]; color: string; glow?: number };

/** Many crystals, one draw call. Emissive in the instance colour; glow scales it (0..2).
 *  tier > 0 (v4): clear glass (transmission on the top tier) with a second instanced core inside that carries the light,
 *  so each crystal reads as lit from within. */
export function Crystals({ items, reduced, intensity = 1.2, onPick }: { items: CrystalIn[]; reduced: boolean; intensity?: number; onPick?: (i: number) => void }) {
  const tier = useWorldTier(), glass = tier > 0, trans = REALISM[tier].glass;
  const ref = useRef<THREE.InstancedMesh>(null), core = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(crystalGeometry, []);
  const mat = useMemo(() => {
    const m = glass
      ? new THREE.MeshPhysicalMaterial({ color: "#ffffff", metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, flatShading: true, ior: 1.5,
          transmission: trans ? 0.92 : 0, thickness: 0.6, transparent: !trans, opacity: trans ? 1 : 0.42, emissive: "#ffffff", emissiveIntensity: intensity * 0.22,
          iridescence: 0.5, iridescenceIOR: 1.3, envMapIntensity: 1.6, specularIntensity: 1, depthWrite: trans })
      : new THREE.MeshPhysicalMaterial({ color: "#ffffff", metalness: 0.1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true,
          emissive: "#ffffff", emissiveIntensity: intensity, transparent: true, opacity: 0.92, iridescence: 0.3, iridescenceIOR: 1.3, envMapIntensity: 0.5 });
    m.userData.realism = null; // keep crystal facets clean
    // emissive follows the instance colour (vertex colour slot): patch so emissive = instance colour * intensity
    m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * vColor;"); };
    return m;
  }, [intensity, glass, trans]);
  // opaque on the transmission tier: the glass only refracts opaque things, so the light inside must be opaque to show
  const coreMat = useMemo(() => trans ? new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false })
    : new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }), [trans]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); coreMat.dispose(); }, [geo, mat, coreMat]);
  useLayoutEffect(() => {
    const mesh = ref.current; if (!mesh) return;
    const o = new THREE.Object3D(), c = new THREE.Color(), k = core.current;
    items.forEach((it, i) => {
      o.position.set(...it.at); o.rotation.set(it.tilt?.[0] ?? 0, (i * 2.39996) % 6.28, it.tilt?.[1] ?? 0);
      const w = it.w ?? it.h * 0.35; o.scale.set(w, it.h, w); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      const g = Math.min(2, it.glow ?? 1);
      mesh.setColorAt(i, c.set(it.color).multiplyScalar(glass ? 0.55 + 0.25 * g : 0.35 + 0.65 * g));
      if (k) { o.scale.set(w * 0.38, it.h * 0.78, w * 0.38); o.position.y += it.h * 0.04; o.updateMatrix(); k.setMatrixAt(i, o.matrix); k.setColorAt(i, c.set(it.color).multiplyScalar(0.9 + 1.1 * g)); }
    });
    for (const m of [mesh, k]) if (m) { m.count = items.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
  }, [items, glass, trans]);
  useFrame(({ clock }) => { if (reduced) return; const p = 0.9 + 0.1 * Math.sin(clock.elapsedTime * 0.8);
    if (glass) { if (coreMat.transparent) coreMat.opacity = 0.75 + 0.2 * p; } else mat.emissiveIntensity = intensity * p; });
  if (!items.length) return null;
  return <>
    <instancedMesh ref={ref} args={[geo, mat, Math.max(1, items.length)]} renderOrder={glass && !trans ? 3 : 0} onClick={onPick ? (e) => { e.stopPropagation(); if (e.instanceId !== undefined) onPick(e.instanceId); } : undefined} />
    {glass && <instancedMesh key={`c${items.length}${trans ? "t" : ""}`} ref={core} args={[geo, coreMat, Math.max(1, items.length)]} renderOrder={2} raycast={() => null} />}
  </>;
}

/* ---------- instanced props ---------- */

export type Inst = { at: [number, number, number]; s: [number, number, number]; ry?: number; color?: string };
/** One instanced mesh from a list of placements (static). */
export function Many({ items, geo, mat }: { items: Inst[]; geo: THREE.BufferGeometry; mat: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => { const m = ref.current; if (!m) return; const o = new THREE.Object3D(), c = new THREE.Color();
    items.forEach((it, i) => { o.position.set(...it.at); o.rotation.set(0, it.ry ?? 0, 0); o.scale.set(...it.s); o.updateMatrix(); m.setMatrixAt(i, o.matrix); if (it.color) m.setColorAt(i, c.set(it.color)); });
    m.count = items.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }, [items, geo, mat]);
  if (!items.length) return null;
  return <instancedMesh key={`${items.length}:${geo.uuid}`} ref={ref} args={[geo, mat, items.length]} />;
}

/** Rock underside: an inverted cone pushed in and out by layered noise (ledges + strata), welded so normals are smooth;
 *  the shader bump adds the fine grain. Deterministic per seed. */
export function rockGeometry(r: number, h: number, seed: number, detail = 1) {
  const radial = 18 + detail * 14, rows = 5 + detail * 6;
  let g: THREE.BufferGeometry = new THREE.ConeGeometry(r, h, radial, rows, false); g.rotateX(Math.PI); g.translate(0, -h / 2, 0);
  g.deleteAttribute("normal"); g.deleteAttribute("uv"); g = mergeVertices(g);
  const p = g.attributes.position, hs = (x: number, y: number, z: number) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 3.1) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), d = Math.hypot(x, z);
    if (d < 1e-4) { p.setY(i, y * (1.05 + hs(seed, 1, 2) * 0.15)); continue; }
    const t = -y / h; // 0 at the top rim, 1 at the tip
    const ledge = 0.12 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 7 + seed * 2) + 0.06 * Math.sin(y * 3.1 + a * 2);
    const strata = 0.05 * Math.sign(Math.sin(y * 4.5 + seed)) * (t > 0.05 ? 1 : 0);
    const k = 1 + (ledge + strata) * Math.min(1, t * 4) + (hs(x, y, z) - 0.5) * (detail ? 0.12 : 0.36) * Math.min(1, t * 3);
    p.setXYZ(i, x * k, y * (t > 0.02 ? 1 + (hs(z, x, y) - 0.5) * 0.12 : 1), z * k);
  }
  g.computeVertexNormals(); return detail ? g : g.toNonIndexed();
}

/* ---------- motes ---------- */

const moteVert = /* glsl */ `attribute float aS; uniform float uT; uniform float uM; varying float vA;
  void main(){ vec3 p = position; p.y += uM * mod(uT*0.15*(0.5+aS) + aS*20.0, 6.0) ; p.x += uM*0.3*sin(uT*0.3+aS*30.0);
    vec4 mv = modelViewMatrix*vec4(p,1.0); gl_PointSize = (2.0+4.0*aS) * 30.0 / max(-mv.z, 1.0); vA = 0.35+0.65*aS; gl_Position = projectionMatrix*mv; }`;
const moteFrag = /* glsl */ `uniform vec3 uC; varying float vA; void main(){ vec2 p=gl_PointCoord*2.0-1.0; float a=max(1.0-dot(p,p),0.0); gl_FragColor=vec4(uC*a*a*vA, 1.0); }`;
/** Slow rising light specks in a box around the scene. */
export function Motes({ count: n, color, spread = 18, height = 6, reduced }: { count: number; color: string; spread?: number; height?: number; reduced: boolean }) {
  const count = Math.round(n * REALISM[useWorldTier()].dust);
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

export function WorldFX({ scale, msaa, reduced, threshold = 0.85, strength = 0.7, focus }: { scale: number; msaa: number; reduced: boolean; threshold?: number; strength?: number;
  /** v8 semantic zoom: world point in focus (deepest level); blurs the rest with depth of field (high tiers only). */
  focus?: [number, number, number] | null }) {
  if (scale <= 0) return null;
  const dof = !!focus && scale >= 0.9 && !reduced;
  return (
    <EffectComposer multisampling={msaa} enableNormalPass={false}>
      {dof ? <DepthOfField target={focus!} focalLength={0.02} bokehScale={3.2} height={480} /> : <></>}
      <Bloom intensity={(reduced ? 0.5 : 1) * strength * scale} luminanceThreshold={threshold} luminanceSmoothing={0.25} mipmapBlur radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.28} darkness={0.72} />
      <SMAA />
    </EffectComposer>
  );
}

/* ---------- glass chips ---------- */

export type Chip = { id: string; at: [number, number, number]; title: string; value?: string; sub?: string; color: string; prio?: number; dot?: "ok" | "busy" | "warn" | "bad" | "idle";
  /** v8 semantic zoom: 0 whole world (default), 1 parts, 2 single items (shown only when zoomed in near them). */
  lod?: Lod;
  /** v11: a dimension label (ARCH): a slim pill centred on its line. */
  dim?: boolean;
  /** v8: the focused item's glass card: steps (done/now/next) and label/value rows. */
  steps?: { label: string; state: "done" | "now" | "next" }[]; rows?: [string, string][] };
export type ChipRig = { els: Map<string, HTMLDivElement>; root: RefObject<HTMLDivElement | null> };
export const useChipRig = (): ChipRig => { const els = useMemo(() => new Map<string, HTMLDivElement>(), []); const root = useRef<HTMLDivElement>(null); return { els, root }; };

/** The DOM half: render outside <Canvas>, over it. Chips start hidden; ChipProjector places them. */
export function ChipLayer({ rig, chips, onPick, focus }: { rig: ChipRig; chips: Chip[]; onPick?: (id: string) => void; focus?: string | null }) {
  return (
    <div ref={rig.root} className="wchip-layer" aria-hidden={onPick ? undefined : true}>
      {chips.map((c) => (
        <div key={c.id} ref={(el) => { if (el) rig.els.set(c.id, el); else rig.els.delete(c.id); }} className={focus === c.id ? "wchip wchip-focus" : c.dim ? "wchip wchip-dim" : "wchip"} data-id={c.id} style={{ ["--c" as string]: c.color }}
          onClick={onPick ? () => onPick(c.id) : undefined} role={onPick ? "button" : undefined}>
          <span className="wchip-t">{c.dot && <i className={`wchip-dot ${c.dot}`} />}{c.title}</span>
          {c.value && <b className="wchip-v">{c.value}</b>}
          {c.sub && <span className="wchip-s">{c.sub}</span>}
          {focus === c.id && c.steps && <ol className="wchip-steps">{c.steps.map((st, i) => <li key={i} className={st.state}><i />{st.label}</li>)}</ol>}
          {focus === c.id && c.rows && <dl className="wchip-rows">{c.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        </div>
      ))}
    </div>
  );
}

/** The 3D half: inside <Canvas>. Projects anchors ~15x a second and lays chips out around the panel. */
/** throttle: seconds between layouts (0 for frameloop="demand" canvases, whose few frames must each count). */
export function ChipProjector({ rig, chips, throttle = 0.066, zoom, focus, onLevel }: { rig: ChipRig; chips: Chip[]; throttle?: number;
  /** v8: camera distance range; with it, chips show by zoom level (lod) and the layer gets data-lod for styling. */
  zoom?: { min: number; max: number };
  /** v8: the focused item always shows; onLevel hears zoom-level changes (e.g. to drop the focus when zooming out). */
  focus?: string | null; onLevel?: (l: Lod) => void }) {
  const camera = useThree((s) => s.camera), size = useThree((s) => s.size), gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  const level = useRef<Lod>(0), tv = useMemo(() => new THREE.Vector3(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const last = useRef(0), blocked = useRef<Box[]>([]), blockAt = useRef(0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (throttle > 0 && t - last.current < throttle) return;
    last.current = t;
    const host = gl.domElement.getBoundingClientRect();
    if (t - blockAt.current > 0.5 || !blocked.current.length) { // the panel(s) of this world, in canvas px
      blockAt.current = t;
      const region = gl.domElement.closest("[role=region]") ?? document.body;
      blocked.current = [...region.querySelectorAll(".world-shell-slot, .world-shell, .world-panel, .pu-shell, [data-chip-block]")].map((e) => {
        const r = e.getBoundingClientRect(); return { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
      }).filter((b) => b.w > 0 && b.h > 0);
    }
    let reach = Infinity;
    if (zoom) {
      const d = camera.position.distanceTo(controls?.target ?? tv.set(0, 0, 0));
      const was = level.current; level.current = zoomLevel(d, zoom.min, zoom.max, level.current); if (was !== level.current) onLevel?.(level.current); reach = itemReach(zoom.min, zoom.max);
      if (rig.root.current) rig.root.current.dataset.lod = String(level.current);
    }
    const ins = chips.map((c, i) => {
      const el = rig.els.get(c.id);
      const near = zoom ? camera.position.distanceTo(tv.set(...c.at)) : 0;
      const foc = c.id === focus, show = foc || !zoom || chipShows(c.lod, level.current, near, reach);
      v.set(...c.at).project(camera);
      return { id: c.id, x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, w: el?.offsetWidth ?? 0, h: el?.offsetHeight ?? 0,
        prio: (foc ? 1e4 : zoom ? chipPrio(c.lod, level.current, c.prio ?? 1) : c.prio ?? 1) - i * 1e-4, on: show && v.z < 1 && v.z > -1, centre: c.dim };
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

/** v8 semantic zoom: eases OrbitControls' target to a picked point and the camera to a distance (one flight per goal). */
export type FlyGoal = { at: [number, number, number]; dist: number; n: number } | null;
export function FlyTo({ goal, reduced }: { goal: FlyGoal; reduced: boolean }) {
  const camera = useThree((s) => s.camera), controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const live = useRef(0), to = useMemo(() => new THREE.Vector3(), []), dir = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { if (goal) live.current = goal.n; }, [goal]);
  useFrame((_, dt) => {
    if (!goal || !controls || live.current !== goal.n) return;
    to.set(...goal.at);
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3.2);
    controls.target.lerp(to, k);
    dir.copy(camera.position).sub(controls.target); const d = dir.length(), nd = d + (goal.dist - d) * k;
    camera.position.copy(controls.target).addScaledVector(dir.normalize(), nd); controls.update();
    if (controls.target.distanceTo(to) < 0.02 && Math.abs(nd - goal.dist) < 0.05) live.current = -1; // arrived: hand back to the user
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
