"use client";
// Worlds as levitating liquid metal (concept c0): chrome or obsidian with oil-slick thin-film swirls, reflecting the
// alien environment. The surface is a procedural hierarchy evaluated per pixel in object space, so it never turns into a
// stretched texture: domain-warped continents (dark mirror pools vs chrome) -> Voronoi plates whose seams glow like
// glyph cuts -> etched circuitry in two octaves -> traces that resolve into micro-glyph text -> a grain sparkle.
// Every layer fades out once it gets smaller than a pixel (fwidth), and the octave budget (uOct) grows with the camera's
// closeness and the quality level: the overview pays for 3 octaves, a close-up for 8. The relief is turned into normals
// from the procedural height's screen derivatives (bump mapping), the chrome's highlights are anisotropic and follow the
// flow. Every shader term is bounded (bloom NaN rule).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO, useAlienEnv } from "./env";

/** Shared GLSL: hash, gradient noise and the surface hierarchy. `surf` returns the height and fills the layer masks. */
const SURF = /* glsl */ `
uniform float uTime; uniform float uOct; uniform float uDetail; varying vec3 vLq;
float gPool, gSeam, gCirc, gGlyph, gSpark, gFlowA, gH, gShore;
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define G(o) dot(h33(i + o) * 2.0 - 1.0, f - o)
  return mix(mix(mix(G(vec3(0,0,0)), G(vec3(1,0,0)), u.x), mix(G(vec3(0,1,0)), G(vec3(1,1,0)), u.x), u.y),
             mix(mix(G(vec3(0,0,1)), G(vec3(1,0,1)), u.x), mix(G(vec3(0,1,1)), G(vec3(1,1,1)), u.x), u.y), u.z);
  #undef G
}
// fbm whose octaves stop at the budget and fade once their wavelength drops under ~2 px (fw = pixel footprint)
float fbm(vec3 p, float fw, float oct) {
  float a = 0.5, s = 0.0, f = 1.0;
  for (int i = 0; i < 8; i++) {
    float k = clamp(oct - float(i), 0.0, 1.0) * (1.0 - smoothstep(0.25, 0.5, f * fw));
    if (k <= 0.0) break;
    s += a * k * gnoise(p * f); f *= 2.03; a *= 0.5;
    p = p.yzx + vec3(1.7, -2.3, 0.9);
  }
  return s;
}
// 3x5 dot glyph at cell c, sub-cell f in [0,1)
float glyph(vec2 c, vec2 f) {
  vec2 s = floor(f * vec2(4.0, 6.0));
  if (s.x > 2.0 || s.y > 4.0) return 0.0;
  return step(0.45, h12(c * 7.31 + s * 1.7));
}
float surf(vec3 p, float fw) {
  vec3 n = normalize(p);
  float t = uTime * 0.05;
  // continents: two-level domain warp, the liquid slowly flowing
  vec3 w = vec3(gnoise(n * 1.6 + vec3(0.0, t, 0.0)), gnoise(n * 1.6 + vec3(5.2, -t, 1.3)), gnoise(n * 1.6 + vec3(-3.1, 2.7, t)));
  vec3 q = n * 2.2 + w * 1.4;
  float c = fbm(q, fw * 2.2, 2.0);
  gFlowA = atan(w.y, w.x) * 2.0 + c * 6.0;
  gPool = smoothstep(-0.04, 0.1, c);
  // plates: Voronoi cells over the warped sphere, their seams cut deep and glowing
  vec3 vp = n * 3.2 + w * 0.45, vi = floor(vp), vf = fract(vp);
  float d1 = 8.0, d2 = 8.0; vec3 cid = vec3(0.0);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z), r = o + h33(vi + o) - vf;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cid = vi + o; } else if (d < d2) d2 = d;
  }
  float seamW = sqrt(d2) - sqrt(d1);
  float sw = max(fw * 3.2 * 1.5, 0.014);
  gSeam = (1.0 - smoothstep(sw * 0.5, sw, seamW)) * smoothstep(-0.05, 0.15, gnoise(n * 2.3 + vec3(7.1, 3.3, -2.0))); // only some seams are cut: fragments, not a football
  // relief: the fine octaves ride on the plates
  float h = c * 0.7 + fbm(n * 9.0 + w, fw * 9.0, uOct) * 0.3 * (0.4 + 0.6 * gPool) - gSeam * 0.12;
  float shore = exp(-pow((c - 0.08) * 9.0, 2.0)); gFlowA += shore * 2.0; gSpark = shore; // pool shores: where the oil film is thickest
  gCirc = 0.0; gGlyph = 0.0; float shoreK = gSpark; gSpark = 0.0;
  if (uDetail > 0.01) {
    // etched circuitry on a cube projection: one trace per cell (straight, turn or via), two octaves
    vec3 a = abs(n);
    vec2 uv = a.x > a.y && a.x > a.z ? n.yz / a.x : a.y > a.z ? n.xz / a.y : n.xy / a.z;
    float face = a.x > a.y && a.x > a.z ? 1.0 : a.y > a.z ? 2.0 : 3.0;
    float plate = h13(cid), fwu = fwidth(uv.x) + fwidth(uv.y); // derivatives outside the loop (non-uniform exits)
    for (int o = 0; o < 2; o++) {
      float S = o == 0 ? 28.0 : 112.0;
      vec2 g = uv * S, ci = floor(g), cf = fract(g) - 0.5;
      float px = fwu * S;
      float fade = (1.0 - smoothstep(0.12, 0.3, px)) * step(0.4, plate + float(o) * 0.25) * (0.35 + 0.65 * gPool);
      if (fade <= 0.0) break;
      float k = h12(ci + face * 101.0 + float(o) * 37.0);
      float d = k < 0.35 ? abs(cf.y) : k < 0.7 ? abs(cf.x) : k < 0.92 ? min(max(abs(cf.y), -cf.x), max(abs(cf.x), -cf.y)) : abs(length(cf) - 0.12);
      float lw = 0.022 + px * 0.5;
      float line = (1.0 - smoothstep(lw - px * 0.5, lw + px * 0.5, d)) * step(0.15, h12(ci * 3.1 + 9.0));
      gCirc = max(gCirc, line * fade * (o == 0 ? 1.0 : 0.6));
      h -= line * fade * (o == 0 ? 0.022 : 0.01);
      if (o == 0 && k < 0.35) { // a straight trace resolves into a strip of micro-glyphs when close
        vec2 gg = vec2((cf.x + 0.5) * 8.0, (cf.y + 0.11) / 0.22);
        float gpx = fwu * S * 8.0 * 4.0;
        float gf = (1.0 - smoothstep(0.35, 0.7, gpx)) * step(0.0, gg.y) * step(gg.y, 1.0);
        gGlyph = max(gGlyph, gf * glyph(floor(gg) + ci * 19.0, vec2(fract(gg.x), gg.y)));
      }
    }
    // grain sparkle: sub-millimetre crystals glinting as they turn
    vec3 sg = n * 420.0, sc = floor(sg);
    float spx = fwidth(sg.x) + fwidth(sg.y);
    float r = h13(sc);
    gSpark = pow(r, 70.0) * (0.5 + 0.5 * sin(uTime * 3.0 + r * 80.0)) * (1.0 - smoothstep(0.5, 1.2, spx)) * (1.0 - smoothstep(0.32, 0.5, length(fract(sg) - 0.5)));
  }
  gH = h; gShore = shoreK;
  return h;
}
`;

/** The planet's surface material. `extra` is chained (the HUD's rim light). Returns the material; animate `uTime`,
 *  set `uDetail` (0 overview .. 1 close-up, see planetDetail) every frame. */
export function useLiquidMetal(color: string, obsidian: boolean, size: number, extra?: (s: THREE.WebGLProgramParametersWithUniforms) => void) {
  const env = useAlienEnv();
  const { mat, u } = useMemo(() => {
    const u = { uTime: { value: 0 }, uLq: { value: size }, uDetail: { value: 0 }, uOct: { value: 3 }, uFar: { value: 1 }, uTint: { value: new THREE.Color(color) }, uPoolTint: { value: new THREE.Color(color).multiplyScalar(obsidian ? 0.4 : 0.025) } };
    const tint = new THREE.Color(color);
    const mat = new THREE.MeshPhysicalMaterial({
      color: obsidian ? tint.clone().multiplyScalar(0.07) : tint.clone().lerp(new THREE.Color("#ffffff"), 0.55),
      metalness: 1, roughness: obsidian ? 0.14 : 0.06, clearcoat: obsidian ? 1 : 0.5, clearcoatRoughness: 0.04,
      iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [120, 900],
      anisotropy: 0.4, // brushed-chrome streaks; the direction follows the flow (injected below)
      emissive: color, emissiveIntensity: 0, envMapIntensity: obsidian ? 2.4 : 1.15,
    });
    mat.onBeforeCompile = (s) => {
      extra?.(s);
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace("void main() {", "uniform float uTime; uniform float uLq; varying vec3 vLq;\nvoid main() {")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vLq = position / max(uLq, 1e-3);
          transformed += objectNormal * uLq * 0.018 * (sin(vLq.x * 5.0 + uTime * 0.9) * sin(vLq.y * 4.0 - uTime * 0.7) + sin(vLq.z * 6.0 + uTime * 1.1) * 0.6);`);
      s.fragmentShader = s.fragmentShader
        .replace("void main() {", `uniform float uLq; uniform vec3 uTint; uniform vec3 uPoolTint; uniform float uFar;\n${SURF}\n${HOLO}\nvoid main() {`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          surf(vLq, length(fwidth(vLq)));
          diffuseColor.rgb *= mix(uPoolTint, vec3(1.0), gPool); // continents: dark mirror pools in the chrome`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          { // bump from the procedural height: screen derivatives of h (world units), Mikkelsen's surface gradient
            float h = gH * uLq * 0.06;
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1);
            vec3 gr = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
            vec3 nb = abs(det) * normal - gr;
            normal = dot(nb, nb) > 1e-20 ? normalize(nb) : normal;
            roughnessFactor = clamp(roughnessFactor * (0.6 + 0.8 * (1.0 - gPool)) + gSeam * 0.25 + gCirc * 0.12, 0.03, 1.0);
          }`)
        .replace("vec2 anisotropyV = anisotropyVector;", "float ca = cos(gFlowA), sa = sin(gFlowA); vec2 anisotropyV = mat2(ca, sa, -sa, ca) * anisotropyVector * (0.5 + 0.5 * gPool);")
        .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
          #ifdef USE_IRIDESCENCE
          material.iridescence = clamp(0.25 + 0.75 * gShore + 0.3 * (1.0 - gPool), 0.0, 1.0);
          material.iridescenceThickness = mix(iridescenceThicknessMinimum, iridescenceThicknessMaximum, clamp(0.5 + 0.5 * sin(gH * 9.0 + gFlowA * 0.5), 0.0, 1.0));
          #endif`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          { float f = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
            vec3 hc = holo(vLq.y * 0.3 + gFlowA * 0.04 + uTime * 0.02);
            float wave = 0.5 + 0.5 * sin(dot(vLq, vec3(3.0, 5.0, 2.0)) * 2.0 - uTime * 1.2);
            totalEmissiveRadiance += mix(hc, uTint, 0.3) * gSeam * (0.03 + 0.9 * pow(wave, 6.0));       // glyph seams: read from the overview
            totalEmissiveRadiance += hc * gCirc * (0.02 + 0.5 * pow(wave, 8.0)) * uDetail;          // circuitry: a pulse runs through it
            totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * gGlyph * 0.9 * uDetail;
            totalEmissiveRadiance += mix(vec3(1.0), hc, 0.5) * gSpark * 2.0;
            totalEmissiveRadiance += hc * pow(f, 2.5) * 0.55;
            totalEmissiveRadiance += uTint * (pow(f, 1.8) * 1.4 + 0.12) * uFar; // identity colour: a strong rim from the overview
            totalEmissiveRadiance += holo(gFlowA * 0.08 + gH * 2.0) * (1.0 - gPool) * 0.1; }`); // thin-film edge sheen: a strong silhouette at any size
    };
    return { mat, u };
  }, [color, obsidian, size, extra]);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => mat.dispose(), [mat]);
  return { mat, u };
}

/* ---------- thought cluster: a shell of synapse points, dense at the surface, thinning outward ----------
   A share of the points are surface crawlers: tiny, skimming the liquid metal, visible only up close (uNear). */
const VS = /* glsl */ `
attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uR; uniform float uGlow; uniform float uNear; uniform vec3 uColor;
varying vec3 vC; varying float vA;
${HOLO}
vec3 rot(vec3 p, vec3 k, float a) { float c = cos(a), s = sin(a); return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c); }
void main() {
  float crawl = step(fract(aSeed * 13.7), 0.45);
  vec3 k = normalize(vec3(sin(aSeed * 31.0), 1.6, cos(aSeed * 17.0)));
  vec3 d = rot(position, k, uTime * (0.12 + aSeed * 0.3 + crawl * 0.25) * (aSeed > 0.5 ? 1.0 : -1.0));
  float s = fract(aSeed * 97.31);
  float r = uR * mix(1.12 + 0.85 * s * s * s + 0.04 * sin(uTime * 2.0 + aSeed * 40.0), 1.035 + 0.03 * s, crawl);
  vec4 mv = modelViewMatrix * vec4(d * r, 1.0);
  float z = max(-mv.z, 0.1);
  float fire = pow(max(sin(uTime * (0.8 + aSeed) + aSeed * 61.0), 0.0), 16.0);
  vA = (0.7 + 1.6 * fire + 0.8 * uGlow) * (1.0 - s * 0.5) * smoothstep(1.0, 4.0, z) * mix(1.0 - 0.75 * uNear, uNear * 0.7, crawl);
  vC = mix(uColor, holo(aSeed + uTime * 0.03), 0.45);
  vC = mix(vC, vec3(1.0), fire * 0.5);
  gl_PointSize = clamp(uScale * mix(0.75 + 1.6 * fire, 0.35, crawl) / z, 1.0, 9.0);
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */ `varying vec3 vC; varying float vA;
void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(1.0 - dot(d, d) * 4.0, 0.0);
  gl_FragColor = vec4(clamp(vC, 0.0, 1.0) * 2.2, clamp(a * a * vA, 0.0, 1.0)); }`;

export function ThoughtShell({ size, color, count, reduced, glow, near }: { size: number; color: string; count: number; reduced: boolean; glow: () => number; near: () => number }) {
  const geo = useMemo(() => {
    const r = Math.random;
    const p = new Float32Array(count * 3), a = new Float32Array(count), v = new THREE.Vector3();
    for (let i = 0; i < count; i++) { v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(); p.set([v.x, v.y, v.z], i * 3); a[i] = r(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(a, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 2.2);
    return g;
  }, [size, count]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 9 }, uR: { value: size }, uGlow: { value: 0 }, uNear: { value: 0 }, uColor: { value: new THREE.Color(color) } },
  }), [size, color]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock, gl }) => {
    const g = glow(), n = near();
    mat.uniforms.uTime.value = reduced ? 5 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 16;
    mat.uniforms.uGlow.value = Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 0;
    mat.uniforms.uNear.value = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  });
  return count > 0 ? <points geometry={geo} material={mat} /> : null;
}

/* ---------- holographic glyph-tick ring (c0): a hairline halo with crisp ticks, a finer tick octave and glyph text
   fading in up close, and beads of light orbiting on it. Ticks are anti-aliased with fwidth: crisp at any distance. */
const RING_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = /* glsl */ `
uniform float uTime; uniform float uIn; uniform float uOut; uniform float uDetail; uniform vec3 uColor; varying vec2 vP;
${HOLO}
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  float r = length(vP), a = atan(vP.y, vP.x) / 6.2831853 + 0.5;
  float x = (r - uIn) / (uOut - uIn);                       // 0 inner .. 1 outer edge
  float px = fwidth(x);
  float band = smoothstep(-px, px, x) * smoothstep(-px, px, 1.0 - x);
  float line = 1.0 - smoothstep(0.0, max(px * 1.5, 0.06), abs(x - 0.5) - 0.06);   // the hairline itself
  // ticks: 180 majors across the band, 720 minors on the inner half, fading in with detail and pixel size
  float A = a * 180.0, apx = fwidth(A);
  float maj = 1.0 - smoothstep(0.08 - apx, 0.08 + apx, abs(fract(A) - 0.5) - 0.42);
  maj *= step(0.0, x) * step(x, 0.42 + 0.3 * step(0.8, fract(a * 18.0)));
  float B = a * 720.0, bpx = fwidth(B);
  float mnr = (1.0 - smoothstep(0.1 - bpx, 0.1 + bpx, abs(fract(B) - 0.5) - 0.4)) * step(0.0, x) * step(x, 0.22) * (1.0 - smoothstep(0.3, 0.6, bpx)) * uDetail;
  // glyph text on the outer half, close up only
  vec2 g = vec2(a * 1440.0, (x - 0.62) / 0.26);
  vec2 s = floor(vec2(fract(g.x) * 4.0, g.y * 5.0));
  float gl = step(0.0, g.y) * step(g.y, 0.999) * step(s.x, 2.0) * step(0.45, h12(floor(g.x) * vec2(1.0, 7.0) + s)) * step(0.4, h12(vec2(floor(g.x / 9.0), 3.0)));
  gl *= (1.0 - smoothstep(0.25, 0.6, fwidth(g.x))) * uDetail;
  float beads = 0.0;
  for (int i = 0; i < 3; i++) { float b = fract(a - uTime * (0.03 + 0.017 * float(i)) + float(i) * 0.37); beads += exp(-pow(min(b, 1.0 - b) * 260.0, 2.0)); }
  vec3 c = mix(uColor, holo(a * 2.0 + uTime * 0.02), 0.55);
  float v = line * 0.9 + maj * 0.55 + mnr * 0.35 + gl * 0.7 + beads * line * 4.0;
  gl_FragColor = vec4(clamp(c * v * band * 1.4, 0.0, 6.0), 1.0);
}`;

export function HoloRing({ size, color, tilt, reduced, detail }: { size: number; color: string; tilt: [number, number, number]; reduced: boolean; detail: () => number }) {
  const inner = size * 1.62, outer = size * 1.74;
  const geo = useMemo(() => new THREE.RingGeometry(inner, outer, 256, 1), [inner, outer]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uIn: { value: inner }, uOut: { value: outer }, uDetail: { value: 0 }, uColor: { value: new THREE.Color(color) } },
  }), [inner, outer, color]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock }) => {
    const d = detail();
    mat.uniforms.uTime.value = reduced ? 7 : clock.elapsedTime;
    mat.uniforms.uDetail.value = Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
  });
  return <mesh geometry={geo} material={mat} rotation={tilt} />;
}
