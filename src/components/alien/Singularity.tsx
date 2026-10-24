"use client";
// The CORE as an alien artifact: a white singularity with god rays and a photon ring, an accretion disk of light trails,
// and monolithic obsidian rings etched with glyphs that light in sweeping waves. The rings are slices of a tesseract:
// every frame their vertices are lifted into 4D (each ring at its own w), rotated in the xw and yw planes and projected
// back to 3D in the vertex shader, so rings swell, shrink and pass through each other, turning inside out (c6).
// A hypercube wireframe turns with them, and a raymarched recursive lattice (Fractal) hangs in the middle (c7).
// All motion is uniforms on the GPU plus four group rotations; every shader output is clamped finite and >= 0 (bloom NaN rule).
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO, useAlienEnv } from "./env";
import { Fractal } from "./Fractal";
import { coreCalm, coreScale, tesseractAngle } from "@/lib/alien-pure";
import { easeInStop, newUnseen, unseenAngle, unseenStep, watched } from "@/lib/alien-behaviour-pure";
import type { CoreLive } from "../ParticleCore";

const finite = (x: number, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

/* ---------- halo: a camera-facing quad (white core, photon ring, slowly turning god rays) ---------- */
const HALO_VS = /* glsl */ `
uniform float uSize; varying vec2 vP;
void main() {
  vP = position.xy * 2.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize * (1.0 + max(-mv.z, 0.0) * 0.018); // grows with distance, like a lens flare: the artifact stays the anchor of the overview
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FS = /* glsl */ `
uniform float uTime; uniform float uGain; uniform float uRays; varying vec2 vP;
${HOLO}
void main() {
  float r = length(vP), a = atan(vP.y, vP.x), t = uTime;
  float core = exp(-r * r * 2600.0) * 6.0 + exp(-r * 48.0) * 1.2 + exp(-r * 9.0) * 0.1; // precise, not a blown-out flare
  float ring = exp(-pow((r - 0.055) * 260.0, 2.0)) * 1.3;
  float rays = pow(0.5 + 0.5 * sin(a * 9.0 + sin(a * 4.0 - t * 0.21) * 1.8 + t * 0.05), 10.0)
             + 0.6 * pow(0.5 + 0.5 * sin(a * 23.0 - t * 0.09 + sin(a * 3.0 + t * 0.13) * 2.4), 18.0);
  rays *= exp(-r * 9.0) * (1.0 - smoothstep(0.3, 0.8, r)) * uRays * 0.1;
  vec3 c = vec3(1.0, 0.98, 0.95) * (core + ring) + mix(vec3(0.85, 0.92, 1.0), holo(a * 0.159 + r + t * 0.02), 0.2) * rays;
  gl_FragColor = vec4(clamp(c * uGain, 0.0, 4.0), 1.0);
}`;

/* ---------- accretion disk: polar light trails, faster near the centre (Kepler-ish) ---------- */
const DISK_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DISK_FS = /* glsl */ `
uniform float uTime; uniform float uGain; uniform float uIn; uniform float uOut; varying vec2 vP;
${HOLO}
void main() {
  float r = max(length(vP), 1e-3), a = atan(vP.y, vP.x), t = uTime, lr = log(r);
  float w = t * 1.6 / (r * sqrt(r));
  float s1 = pow(0.5 + 0.5 * sin(a * 3.0 - w + lr * 11.0 + sin(a * 2.0 + t * 0.4) * 0.6), 7.0);
  float s2 = pow(0.5 + 0.5 * sin(a * 7.0 - w * 1.3 + lr * 23.0), 14.0);
  float s3 = pow(0.5 + 0.5 * sin(a * 13.0 - w * 0.8 - lr * 5.0), 20.0);
  float x = (r - uIn) / (uOut - uIn);
  float fall = smoothstep(0.0, 0.08, x) * pow(max(1.0 - x, 0.0), 1.6);
  vec3 hot = vec3(1.0, 0.96, 0.9) * 1.25, cool = holo(x * 0.9 + a * 0.08 + 0.45) * 1.0; // the lens wraps this disk into the ring: keep it from blowing out
  vec3 c = mix(hot, cool, smoothstep(0.0, 0.4, x)) * (0.05 + s1 * 0.9 + s2 * 0.6 + s3 * 0.8) * fall;
  gl_FragColor = vec4(clamp(c * uGain, 0.0, 2.0), 1.0);
}`;

/* ---------- obsidian rings: physical material + glyph emission injected ---------- */
const RINGS = [ // radius, blade height, tilt, spin axis speed, precession speed, w (4th coordinate)
  { r: 2.1, h: 0.07, tilt: [1.1, 0.2, 0], spin: 0.21, pre: 0.05, w: 2.2 },
  { r: 2.6, h: 0.11, tilt: [-0.5, 0.9, 0.3], spin: -0.13, pre: -0.035, w: -2.2 },
  { r: 3.1, h: 0.09, tilt: [0.25, -0.4, 1.2], spin: 0.09, pre: 0.025, w: 1.3 },
  { r: 3.55, h: 0.15, tilt: [1.57, 0, 0.15], spin: -0.05, pre: 0.018, w: -1.3 }, // outermost: x 1.05 swell + blade < 3.9, inside MEMORY's orbit
] as const;

/** 4D: lift a world-space point to (p, w), rotate in the xw and yw planes, perspective-project back from D = 9. */
const T4 = /* glsl */ `
uniform float uXW; uniform float uYW; uniform float uW0; uniform float uFlat;
vec3 t4(vec3 p, float w) {
  vec3 p0 = p;
  vec4 q = vec4(p, w);
  float c = cos(uXW), s = sin(uXW); q = vec4(c * q.x - s * q.w, q.y, q.z, s * q.x + c * q.w);
  c = cos(uYW); s = sin(uYW); q = vec4(q.x, c * q.y - s * q.w, q.z, s * q.y + c * q.w);
  float k = 9.0 / max(9.0 - q.w, 2.0) - 1.0;
  k = k > 0.0 ? k / (1.0 + 20.0 * k) : k; // rings shrink freely but swell at most ~5 %: they never sweep through the inner orbits
  return mix(q.xyz * (1.0 + k), p0, uFlat);
}`;

type GlyphU = { uTime: { value: number }; uGlyph: { value: number }; uXW: { value: number }; uYW: { value: number }; uFlat: { value: number } };
function glyphHook(u: GlyphU, w0: number) {
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(s.uniforms, u, { uW0: { value: w0 } });
    s.vertexShader = s.vertexShader.replace("void main() {", `varying vec2 vG;\n${T4}\nvoid main() {\nvG = uv;`)
      .replace("#include <project_vertex>", `vec4 mvPosition = viewMatrix * vec4(t4((modelMatrix * vec4(transformed, 1.0)).xyz, uW0), 1.0);
        gl_Position = projectionMatrix * mvPosition;`); // flat shading rebuilds normals from the warped surface
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", `varying vec2 vG; uniform float uTime; uniform float uGlyph;
        float gh(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.3))) * 43758.5453); }
        void main() {`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        { // a band of 3x5-dot glyphs along each blade face; a slow wave lights them column by column
          vec2 g = vec2(vG.x * 380.0, fract(vG.y * 4.0));
          vec2 cell = floor(g); vec2 f = fract(g);
          vec2 sub = floor(vec2(f.x * 4.0, (g.y - 0.38) / 0.24 * 6.0));
          float inBand = step(0.38, g.y) * step(g.y, 0.62) * step(sub.x, 2.0) * step(0.0, sub.y) * step(sub.y, 4.0);
          float word = floor(cell.x / 7.0), face = floor(vG.y * 4.0);
          float lit = step(0.5, gh(cell * 7.1 + sub + face * 13.0)) * inBand * step(mod(cell.x, 7.0), 5.5) * step(0.5, gh(vec2(word, face)));
          lit *= 1.0 - smoothstep(0.05, 0.12, fwidth(g.x)); // a glyph's dot columns under ~2 px: fade, never shimmer
          float wave = pow(0.5 + 0.5 * sin(vG.x * 6.2831853 * 3.0 - uTime * 0.7 + gh(cell) * 0.6), 14.0);
          totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * lit * (0.04 + 1.6 * wave) * max(uGlyph, 0.0);
        }
        { // oil sheen (Annihilation): a thin-film band only where the blade turns edge-on, no glow
          float gz = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          float band = smoothstep(0.7, 0.88, gz) * (1.0 - smoothstep(0.94, 1.0, gz));
          vec3 film = 0.5 + 0.5 * cos(6.2831853 * (gz * 2.6 + vG.x * 5.0 + uTime * 0.02 + vec3(0.0, 0.33, 0.67)));
          totalEmissiveRadiance += film * band * 0.07;
        }`);
  };
}

function ObsidianRing({ r, h, w, env, u }: { r: number; h: number; w: number; env: THREE.Texture | null; u: GlyphU }) {
  const geo = useMemo(() => new THREE.TorusGeometry(r, h, 4, 220), [r, h]); // 4 tube sides: a faceted, monolithic blade
  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: "#030305", metalness: 0.9, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03,
      iridescence: 0.3, iridescenceIOR: 1.5, iridescenceThicknessRange: [180, 520], flatShading: true, envMapIntensity: 0.45, // obsidian: a dark mirror, mostly clearcoat glints
    });
    m.onBeforeCompile = glyphHook(u, w);
    m.customProgramCacheKey = () => "tess-ring"; // one program; w0 is a uniform
    return m;
  }, [u, w]);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} scale={[1, 1, 3.2]} frustumCulled={false} />; // stretched along the tube's z: tall thin blade; the 4D warp leaves its bounds
}

const _dir = new THREE.Vector3(), _ndc = new THREE.Vector3();

export function Singularity({ live, reduced, level, aligned = false }: { live: RefObject<CoreLive>; reduced: boolean; level: number; aligned?: boolean }) {
  const env = useAlienEnv();
  const halo = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uRays: { value: 1 }, uSize: { value: 30 } },
  }), []);
  const disk = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: DISK_VS, fragmentShader: DISK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uIn: { value: 0.45 }, uOut: { value: 2.9 } },
  }), []);
  const diskGeo = useMemo(() => new THREE.RingGeometry(0.45, 2.9, 160, 6), []);
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const glyph = useMemo<GlyphU>(() => ({ uTime: { value: 0 }, uGlyph: { value: 1 }, uXW: { value: 0 }, uYW: { value: 0 }, uFlat: { value: 0 } }), []);
  const root = useRef<THREE.Group>(null);
  const gain = useRef(1);
  const fractalGain = useMemo(() => () => gain.current, []);
  useEffect(() => () => { halo.dispose(); disk.dispose(); diskGeo.dispose(); quad.dispose(); }, [halo, disk, diskGeo, quad]);

  const rings = useRef<(THREE.Group | null)[]>([]);
  const spin = useRef<(THREE.Group | null)[]>([]);
  // Unseen change (Blindsight): the 4D configuration holds still while watched and snaps to the next one behind a fast
  // camera turn or a far pointer. Opening the CORE re-aligns the rings: ease-in into stillness, then a dead stop.
  const un = useRef({ ...newUnseen(), xw: unseenAngle(0, 0), yw: unseenAngle(0, 1), last: new THREE.Vector3(), primed: false, a: -1, ax: 0, ay: 0 });
  useEffect(() => { // the shortest way to (0, 0): the angles wrap at 2 pi
    const U = un.current, w = (x: number) => x - Math.PI * 2 * Math.round(x / (Math.PI * 2));
    U.a = aligned ? 0 : -1; U.ax = w(U.xw); U.ay = w(U.yw);
  }, [aligned]);
  useFrame(({ clock, camera, pointer }, dt) => {
    const t = reduced ? 12 : clock.elapsedTime, L = live.current, calm = coreCalm(camera.position.length());
    const g = finite(L?.g ?? 0), br = finite(L?.breath ?? 0.5), v = finite((L?.mic ?? 0) + (L?.spk ?? 0));
    halo.uniforms.uTime.value = t;
    halo.uniforms.uGain.value = (0.7 + 0.2 * br + 0.9 * g + 0.6 * v) * (1 - 0.7 * calm); // overview: the lens would gather it into a blob
    halo.uniforms.uRays.value = (level === 0 ? 0.5 : 1) * (1 - 0.97 * calm) * 0.7; // god rays are a close-up drama: none on the overview
    disk.uniforms.uTime.value = t;
    disk.uniforms.uGain.value = (0.75 + 0.2 * br + 0.8 * g + 0.5 * v) * (1 - 0.75 * calm);
    glyph.uFlat.value = 0.85 * calm;
    root.current?.scale.setScalar(coreScale(camera.position.length()));
    glyph.uTime.value = t;
    glyph.uGlyph.value = (0.8 + 1.5 * g + 0.8 * v) * (1 - 0.6 * calm);
    gain.current = halo.uniforms.uGain.value;
    if (reduced) { glyph.uXW.value = tesseractAngle(t, 0, true); glyph.uYW.value = tesseractAngle(t, 1, true); return; }
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const U = un.current;
    camera.getWorldDirection(_dir);
    const ang = U.primed && step > 0 ? U.last.angleTo(_dir) / step : 0;
    U.last.copy(_dir); U.primed = true;
    _ndc.set(0, 0, 0).project(camera);
    const onScreen = _ndc.z < 1 && Math.abs(_ndc.x) < 1.05 && Math.abs(_ndc.y) < 1.05;
    if (U.a >= 0) { // aligning: from the held configuration to (0, 0), accelerating, then still
      U.a = Math.min(1, U.a + step / 0.8);
      const e = 1 - easeInStop(U.a);
      U.xw = U.ax * e; U.yw = U.ay * e;
    } else if (unseenStep(U, step, watched(ang, Math.hypot(pointer.x - _ndc.x, pointer.y - _ndc.y), onScreen))) {
      U.xw = unseenAngle(U.n, 0); U.yw = unseenAngle(U.n, 1);
      for (let i = 0; i < RINGS.length; i++) { const o = rings.current[i]; if (o) o.rotation.y += (1.9 + i * 0.7) * Math.sign(RINGS[i].pre); } // precession jumps too
    }
    glyph.uXW.value = U.xw; glyph.uYW.value = U.yw;
    for (let i = 0; i < RINGS.length; i++) { // spin about the blade's own axis (the shape holds); precession only jumps, unseen (above)
      const s = spin.current[i];
      if (s) s.rotation.z += step * RINGS[i].spin * (1 + 2 * g);
    }
  });

  return (
    <group ref={root}>
      <mesh geometry={quad} material={halo} frustumCulled={false} renderOrder={2} />
      <mesh geometry={diskGeo} material={disk} rotation={[-Math.PI / 2 + 0.32, 0, 0.12]} />
      {RINGS.map((k, i) => (
        <group key={i} ref={(el) => { rings.current[i] = el; }}>
          <group rotation={k.tilt as unknown as [number, number, number]}>
            <group ref={(el) => { spin.current[i] = el; }}>
              <ObsidianRing r={k.r} h={k.h} w={k.w} env={env} u={glyph} />
            </group>
          </group>
        </group>
      ))}
      <Hypercube u={glyph} />
      <Fractal size={1.5} on={level >= 2} reduced={reduced} gain={fractalGain} />
    </group>
  );
}

/* ---------- the tesseract itself: 32 edges of a 4D hypercube, rotated with the rings, glowing hairlines ---------- */
const CUBE_VS = /* glsl */ `attribute float aW; attribute float aT; varying float vT; varying float vD;
${T4}
void main() { vT = aT; vec3 p = t4(position, aW); vD = length(p); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`;
const CUBE_FS = /* glsl */ `uniform float uTime; uniform float uGlyph; varying float vT; varying float vD;
${HOLO}
void main() {
  float run = pow(0.5 + 0.5 * sin(vT * 6.2831853 - uTime * 1.3), 12.0); // light runs along every edge
  gl_FragColor = vec4(clamp(mix(vec3(0.75, 0.82, 1.0), holo(vD * 0.12 + uTime * 0.02), 0.5) * (0.05 + 0.9 * run) * min(uGlyph, 1.5), 0.0, 1.5), 1.0);
}`;

function Hypercube({ u }: { u: GlyphU }) {
  const { geo, mat } = useMemo(() => {
    const S = 2.9, SUB = 24, pos: number[] = [], w: number[] = [], t: number[] = [], idx: number[] = [];
    const vtx = (i: number) => [0, 1, 2, 3].map((b) => ((i >> b) & 1 ? S : -S) * (b === 3 ? 0.55 : 1));
    for (let a = 0; a < 16; a++) for (let b = 0; b < 4; b++) {
      const c = a | (1 << b);
      if (c === a) continue;
      const A = vtx(a), B = vtx(c), base = pos.length / 3;
      for (let k = 0; k <= SUB; k++) { // subdivided: the 4D rotation is linear, but the edge keeps its running light
        const f = k / SUB;
        pos.push(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f);
        w.push(A[3] + (B[3] - A[3]) * f); t.push(f);
        if (k) idx.push(base + k - 1, base + k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aW", new THREE.Float32BufferAttribute(w, 1));
    geo.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      vertexShader: CUBE_VS, fragmentShader: CUBE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uTime: u.uTime, uXW: u.uXW, uYW: u.uYW, uW0: { value: 0 }, uFlat: u.uFlat, uGlyph: u.uGlyph },
    });
    return { geo, mat };
  }, [u]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} />;
}
