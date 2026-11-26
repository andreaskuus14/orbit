"use client";
// v6 surfaces: real CC0 textures on the ground and rock (triplanar, so no stretching on the cliff sides), a water material
// (rippling normal map, the sky reflected stronger at grazing angles, deep/shallow tint, foam at the rim), a flowing waterfall
// ribbon with foam and mist, and mountains displaced from a heightmap. All only on tier 1+ (inside <RealOr>); the low tier
// keeps the procedural look. Textures: public/worlds/textures, sources in LICENSES.md.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { assetUrl, type AssetId } from "@/lib/world-assets-pure";
import { fallPath, mountainHeight, sampleHeight, type V3 } from "@/lib/world-surfaces-pure";

/* ---------- textures ---------- */

const tuned = new WeakSet<THREE.Texture>();
/** Loads textures by asset id (suspends). Colour maps get sRGB; all repeat. Shared through the loader cache. */
export function useTex<T extends AssetId[]>(...ids: T): THREE.Texture[] {
  const tex = useLoader(THREE.TextureLoader, ids.map(assetUrl)) as THREE.Texture[];
  tex.forEach((t, i) => { if (tuned.has(t)) return; tuned.add(t); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    if (/D$/.test(ids[i])) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; });
  return tex;
}

// world-space position and normal for any mesh, instanced or not
const WORLD_VARY = `varying vec3 vTP; varying vec3 vTN;`;
const WORLD_VERT = `#include <project_vertex>
  { vec4 tp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    tp = instanceMatrix * tp;
  #endif
    vTP = (modelMatrix * tp).xyz; vTN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz); }`;

/* ---------- triplanar ground / rock ---------- */

export type Layer = { d: THREE.Texture; n: THREE.Texture; scale: number };
/** Standard material with triplanar texturing. With `top`, faces pointing up (slope) get the top layer, sides the side layer. */
export function triplanarMaterial(side: Layer, top?: Layer, opts: { tint?: string; topTint?: string; roughness?: number; slope?: number; normal?: number } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: opts.tint ?? "#ffffff", roughness: opts.roughness ?? 0.92, metalness: 0 });
  m.userData.realism = null; // real textures: no shader noise
  const u = { tSD: { value: side.d }, tSN: { value: side.n }, uSS: { value: side.scale }, tTD: { value: (top ?? side).d }, tTN: { value: (top ?? side).n },
    uTS: { value: (top ?? side).scale }, uTop: { value: top ? 1 : 0 }, uSlope: { value: opts.slope ?? 0.62 }, uNK: { value: opts.normal ?? 1 }, uTT: { value: new THREE.Color(opts.topTint ?? "#ffffff") } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace("#include <common>", `#include <common>\n${WORLD_VARY}`).replace("#include <project_vertex>", WORLD_VERT);
    s.fragmentShader = s.fragmentShader.replace("#include <common>", `#include <common>
${WORLD_VARY}
uniform sampler2D tSD, tSN, tTD, tTN; uniform float uSS, uTS, uTop, uSlope, uNK; uniform vec3 uTT;
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec4 triC(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
vec3 triN(sampler2D t, vec3 p, vec3 n, vec3 w) { // whiteout blend (Golus)
  vec3 a = texture2D(t, p.zy).xyz * 2.0 - 1.0, b = texture2D(t, p.xz).xyz * 2.0 - 1.0, c = texture2D(t, p.xy).xyz * 2.0 - 1.0;
  a.xy *= uNK; b.xy *= uNK; c.xy *= uNK;
  a = vec3(a.xy + n.zy, abs(a.z) * n.x); b = vec3(b.xy + n.xz, abs(b.z) * n.y); c = vec3(c.xy + n.xy, abs(c.z) * n.z);
  return normalize(a.zyx * w.x + b.xzy * w.y + c.xyz * w.z); }
float topMix() { float k = smoothstep(uSlope - 0.12, uSlope + 0.12, normalize(vTN).y); return k * uTop; }`)
      .replace("#include <map_fragment>", `{ vec3 n = normalize(vTN), w = triW(n); float k = topMix();
        vec4 c = mix(triC(tSD, vTP * uSS, w), triC(tTD, vTP * uTS, w) * vec4(uTT, 1.0), k); diffuseColor *= c; }`)
      .replace("#include <normal_fragment_maps>", `{ vec3 n = normalize(vTN), w = triW(n); float k = topMix();
        vec3 wn = normalize(mix(triN(tSN, vTP * uSS, n, w), triN(tTN, vTP * uTS, n, w), k));
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`);
  };
  m.customProgramCacheKey = () => "tri6";
  return m;
}

/* ---------- water ---------- */

export type WaterOpts = { deep?: string; shallow?: string; ripple?: number; speed?: number; foam?: number; round?: boolean; opacity?: number };
/** Water: two scrolling copies of the ripple normal map, the scene's sky (HDRI / env) reflected by the PBR shading with an
 *  extra Fresnel lift, colour from shallow at the rim to deep in the middle (uv distance: discs and planes), foam at the rim. */
export function waterMaterial(nor: THREE.Texture, o: WaterOpts = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4,
    transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, ior: 1.33, specularIntensity: 1 });
  m.userData.realism = null;
  const u = { tWN: { value: nor }, uT: { value: 0 }, uWS: { value: o.ripple ?? 0.6 }, uDeep: { value: new THREE.Color(o.deep ?? "#05303f") },
    uShal: { value: new THREE.Color(o.shallow ?? "#2fb3b8") }, uFoam: { value: o.foam ?? 1 }, uRound: { value: o.round === false ? 0 : 1 } };
  m.userData.water = u;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace("#include <common>", `#include <common>\nvarying vec2 vWUv; ${WORLD_VARY}`).replace("#include <uv_vertex>", "#include <uv_vertex>\n vWUv = uv;").replace("#include <project_vertex>", WORLD_VERT);
    s.fragmentShader = s.fragmentShader.replace("#include <common>", `#include <common>
varying vec2 vWUv; ${WORLD_VARY}
uniform sampler2D tWN; uniform float uT, uWS, uFoam, uRound; uniform vec3 uDeep, uShal;
vec3 ripple() { vec2 p = vTP.xz * uWS;
  vec3 a = texture2D(tWN, p + vec2(uT * 0.031, uT * 0.017)).xyz, b = texture2D(tWN, p * 1.7 + vec2(-uT * 0.021, uT * 0.027)).xyz;
  vec3 n = (a + b) - 1.0; return normalize(vec3(n.x * 0.55, 1.0, n.y * 0.55)); }
float rim() { vec2 q = vWUv - 0.5; return uRound > 0.5 ? clamp(length(q) * 2.0, 0.0, 1.0) : clamp(max(abs(q.x), abs(q.y)) * 2.0, 0.0, 1.0); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        { float r = rim(); vec3 rn = ripple(); float f = smoothstep(0.86, 1.0, r) * (0.55 + 0.45 * sin(rn.x * 40.0 + uT * 1.5));
          diffuseColor.rgb = mix(uDeep, uShal, smoothstep(0.2, 1.0, r)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.97, 1.0), clamp(f * uFoam, 0.0, 1.0)); }`)
      .replace("#include <normal_fragment_maps>", `{ vec3 wn = ripple(); normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`)
      .replace("#include <opaque_fragment>", `{ float fr = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
          outgoingLight += reflectedLight.indirectSpecular * fr * 1.5; }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "water6";
  return m;
}
/** Moves the ripples of the given water materials (paused when reduced). */
export function useWaterTick(mats: (THREE.Material | null | undefined)[], reduced: boolean) {
  useFrame((_, dt) => { if (reduced) return; for (const m of mats) { const u = m?.userData.water; if (u) u.uT.value += dt; } });
}
/** Water surface as a ready mesh: a disc (round) or a box top (plane), tick included. */
export function Water({ position, scale, rotationY = 0, round = true, reduced, ...o }: WaterOpts & { position: V3; scale: V3; rotationY?: number; reduced: boolean }) {
  const [n] = useTex("waterN");
  const mat = useMemo(() => waterMaterial(n, { round, ...o }), [n, round, o.deep, o.shallow, o.ripple, o.foam, o.opacity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => mat.dispose(), [mat]);
  useWaterTick([mat], reduced);
  return <mesh position={position} scale={scale} rotation={[-Math.PI / 2, 0, rotationY]} material={mat} receiveShadow>
    {round ? <circleGeometry args={[1, 64]} /> : <planeGeometry args={[1, 1, 1, 1]} />}
  </mesh>;
}

/* ---------- waterfall ---------- */

/** Ribbon along a path, `width` across, bulged a little so it reads as a sheet of water, uv.y along the fall. */
function ribbon(path: V3[], width: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], across = 6;
  path.forEach((p, i) => { const t = i / (path.length - 1), w = width * (1 + 0.35 * t);
    for (let j = 0; j <= across; j++) { const s = j / across - 0.5; pos.push(p[0] + s * w, p[1], p[2] + 0.06 * Math.cos(s * Math.PI) * (1 + t)); uv.push(j / across, t); } });
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < across; j++) { const a = i * (across + 1) + j, b = a + across + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const softDot = () => { const s = 64, d = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const r = Math.hypot(x - s / 2 + 0.5, y - s / 2 + 0.5) / (s / 2); const a = Math.max(0, 1 - r); d.set([255, 255, 255, Math.round(255 * a * a)], (y * s + x) * 4); }
  const t = new THREE.DataTexture(d, s, s); t.needsUpdate = true; return t; };

/** Falling water: a curved sheet with streaks flowing down (from the ripple map), foam at the lip and as it breaks up
 *  lower down, and a cloud of mist drifting from the bottom. Two draw calls + one for the mist. */
export function Waterfall({ lip, push = 0.9, drop = 4.2, width = 0.6, reduced, mist = 90 }: { lip: V3; push?: number; drop?: number; width?: number; reduced: boolean; mist?: number }) {
  const [n] = useTex("waterN");
  const geo = useMemo(() => ribbon(fallPath(lip, push, drop, 28), width), [lip, push, drop, width]);
  const mat = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { tN: { value: n }, uT: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D tN; uniform float uT; varying vec2 vUv; varying vec3 vN, vV;
      void main(){ float v = vUv.y, x = vUv.x;
        float s1 = texture2D(tN, vec2(x * 0.9, v * 1.2 - uT * 0.9)).r, s2 = texture2D(tN, vec2(x * 1.7 + 0.3, v * 2.1 - uT * 1.4)).g;
        float streak = smoothstep(0.62, 0.9, s1 * 0.55 + s2 * 0.55 + 0.12 * sin(x * 37.0 + s1 * 6.0));
        float edge = smoothstep(0.0, 0.14, x) * smoothstep(1.0, 0.86, x);
        float lipFoam = smoothstep(0.12, 0.0, v), breakup = smoothstep(0.55, 1.0, v);
        vec3 deep = vec3(0.12, 0.42, 0.55), foam = vec3(0.93, 0.98, 1.0);
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        vec3 c = mix(deep, foam, clamp(streak * 0.5 + lipFoam + breakup * 0.35 + fr * 0.25, 0.0, 1.0));
        float a = edge * (0.22 + 0.7 * streak + lipFoam * 0.4) * (1.0 - smoothstep(0.8, 1.0, v) * (1.0 - streak * 0.5)) * mix(1.0, 0.75, breakup);
        gl_FragColor = vec4(c * 1.15, a); }` }), [n]);
  // mist: points that rise and spread from the bottom of the fall, recycled by their own clock
  const end = fallPath(lip, push, drop, 1)[1];
  const mistGeo = useMemo(() => { const g = new THREE.BufferGeometry(), p = new Float32Array(mist * 3), seed = new Float32Array(mist);
    for (let i = 0; i < mist; i++) { p.set([end[0], end[1], end[2]], i * 3); seed[i] = (i * 0.618034) % 1; }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("seed", new THREE.BufferAttribute(seed, 1)); return g; }, [mist, end[0], end[1], end[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const mistMat = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { tDot: { value: softDot() }, uT: { value: 0 }, uW: { value: width } },
    vertexShader: `attribute float seed; uniform float uT, uW; varying float vA;
      void main(){ float age = fract(uT * 0.22 + seed); float a = seed * 51.3;
        vec3 p = position + vec3(cos(a) * (0.2 + age * 1.1) * uW * 1.6, age * 1.4 - 0.4 + sin(a * 3.0) * 0.2, sin(a) * (0.2 + age * 0.9) * uW * 1.4 + age * 0.4);
        vA = sin(age * 3.14159) * 0.35; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (380.0 + 900.0 * age) / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D tDot; varying float vA; void main(){ float a = texture2D(tDot, gl_PointCoord).a; gl_FragColor = vec4(vec3(0.9, 0.96, 1.0), a * vA); }` }), [width]);
  // spray at the lip: a few drops thrown forward
  useEffect(() => () => { geo.dispose(); mat.dispose(); mistGeo.dispose(); (mistMat.uniforms.tDot.value as THREE.Texture).dispose(); mistMat.dispose(); }, [geo, mat, mistGeo, mistMat]);
  useFrame((_, dt) => { if (reduced) return; mat.uniforms.uT.value += dt; mistMat.uniforms.uT.value += dt; });
  return <group>
    <mesh geometry={geo} material={mat} renderOrder={4} />
    <points geometry={mistGeo} material={mistMat} renderOrder={5} frustumCulled={false} />
  </group>;
}

/* ---------- mountains ---------- */

/** Grey heightmap → numbers 0..1 (size × size). Reads the image's pixels once, on the client. */
function useHeight(t: THREE.Texture) {
  return useMemo(() => {
    const img = t.image as HTMLImageElement | ImageBitmap | undefined, size = 64;
    const data = new Float32Array(size * size);
    if (!img || typeof document === "undefined") return { data, size };
    const c = document.createElement("canvas"); c.width = c.height = size; const x = c.getContext("2d"); if (!x) return { data, size };
    x.drawImage(img as CanvasImageSource, 0, 0, size, size); const px = x.getImageData(0, 0, size, size).data;
    for (let i = 0; i < size * size; i++) data[i] = px[i * 4] / 255;
    return { data, size };
  }, [t]);
}

export type Range = { at: V3; w: number; d: number; h: number; ry: number; seed: number };
/** A ring of mountain ranges: grids displaced by a ridge shape × the CC0 rock heightmap, textured triplanar with the
 *  matching rock maps, snow above a height. One geometry per range (few), one shared material. */
export function Mountains({ ranges, snow = 0.62 }: { ranges: Range[]; snow?: number }) {
  const [d, nm, hm] = useTex("mtnD", "mtnN", "mtnH");
  const h = useHeight(hm);
  const geos = useMemo(() => ranges.map((r) => {
    const seg = 72, g = new THREE.PlaneGeometry(1, 1, seg, Math.round(seg * 0.5)); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 0.5, v = p.getZ(i) + 0.5;
      const det = sampleHeight(h.data, h.size, u * 1.3 + r.seed * 0.17, v * 0.8 + r.seed * 0.31);
      p.setXYZ(i, (u - 0.5) * r.w, mountainHeight(det, u, v, r.seed) * r.h, (v - 0.5) * r.d); }
    g.computeVertexNormals(); return g; }), [ranges, h]);
  const mat = useMemo(() => {
    const m = triplanarMaterial({ d, n: nm, scale: 0.05 }, undefined, { tint: "#b9b3ab", roughness: 0.95 });
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (s, r) => { base(s, r); s.uniforms.uSnow = { value: snow }; s.uniforms.uTopY = { value: Math.max(...ranges.map((x) => x.at[1] + x.h)) };
      s.uniforms.uBotY = { value: Math.min(...ranges.map((x) => x.at[1])) };
      s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uSnow, uTopY, uBotY;").replace("#include <color_fragment>", `#include <color_fragment>
        { float hy = (vTP.y - uBotY) / max(0.01, uTopY - uBotY); float up = normalize(vTN).y;
          float k = smoothstep(uSnow - 0.06, uSnow + 0.06, hy + up * 0.12) * smoothstep(0.35, 0.65, up); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), k); }`); };
    m.customProgramCacheKey = () => "mtn6";
    return m; }, [d, nm, snow, ranges]);
  useEffect(() => () => { geos.forEach((g) => g.dispose()); mat.dispose(); }, [geos, mat]);
  return <>{ranges.map((r, i) => <mesh key={i} geometry={geos[i]} material={mat} position={r.at} rotation-y={r.ry} />)}</>;
}
