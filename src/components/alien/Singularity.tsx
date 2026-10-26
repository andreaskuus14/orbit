"use client";
// The CORE as an alien artifact: a white singularity with god rays and a photon ring, an accretion disk of light trails,
// and monolithic obsidian rings machined like alien hardware (panels, chamfers, rivets, a luminous inner groove, a band of
// engraved alien script whose glow travels along the text like reading; see alien-script-pure). The rings are slices of a tesseract:
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
import { easeInStop, newUnseen, unseenJump, unseenStep, watched, wrapAngle } from "@/lib/alien-behaviour-pure";
import type { CoreLive } from "../ParticleCore";
import { encode, SCRIPT_GLSL } from "@/lib/alien-script-pure";
import { PLANETS, planetById } from "@/lib/planets";
import { expDamp } from "@/lib/smooth-damp-pure";
import { CORE_SIGNAL, moodEvent, moodLook, moodTau, newLook, newMoodCtx, resolveMood, type CoreSignal, type Look } from "@/lib/core-mood-pure";
import { CORE_BUSY } from "@/lib/interruption-pure";
import { voiceLevel } from "../voice/bus";

const finite = (x: number, lo = 0, hi = 1) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

/** Soft highlight roll-off: identity up to luminance k, then eases toward m. Close up the halo and disk fill a big part
 *  of the frame; a hard clamp there printed a flat white disc. This keeps their gradation (and the ripples) instead. */
const ROLLOFF = /* glsl */ `
vec3 rolloff(vec3 c, float k, float m) {
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  return l <= k ? c : c * ((k + (l - k) / (1.0 + (l - k) / max(m - k, 1e-3))) / l);
}`;

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
uniform float uTime; uniform float uGain; uniform float uRays; uniform float uCap; varying vec2 vP;
${HOLO}
${ROLLOFF}
void main() {
  float r = length(vP), a = atan(vP.y, vP.x), t = uTime;
  float core = exp(-r * r * 2600.0) * 6.0 + exp(-r * 48.0) * 1.2 + exp(-r * 9.0) * 0.1; // precise, not a blown-out flare
  float ring = exp(-pow((r - 0.055) * 260.0, 2.0)) * 1.3;
  float rays = pow(0.5 + 0.5 * sin(a * 9.0 + sin(a * 4.0 - t * 0.21) * 1.8 + t * 0.05), 10.0)
             + 0.6 * pow(0.5 + 0.5 * sin(a * 23.0 - t * 0.09 + sin(a * 3.0 + t * 0.13) * 2.4), 18.0);
  rays *= exp(-r * 9.0) * (1.0 - smoothstep(0.3, 0.8, r)) * uRays * 0.1;
  vec3 c = vec3(1.0, 0.98, 0.95) * (core + ring) + mix(vec3(0.85, 0.92, 1.0), holo(a * 0.159 + r + t * 0.02), 0.2) * rays;
  gl_FragColor = vec4(clamp(rolloff(max(c * uGain, vec3(0.0)), 0.6, uCap), 0.0, 4.0), 1.0);
}`;

/* ---------- accretion disk: polar light trails, faster near the centre (Kepler-ish) ---------- */
const DISK_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DISK_FS = /* glsl */ `
uniform float uTime; uniform float uGain; uniform float uIn; uniform float uOut; uniform float uCap; varying vec2 vP;
${HOLO}
${ROLLOFF}
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
  gl_FragColor = vec4(clamp(rolloff(max(c * uGain, vec3(0.0)), 0.5, uCap), 0.0, 2.0), 1.0);
}`;

/* ---------- obsidian rings: machined blades, physical material + procedural detail injected ---------- */
const RINGS = [ // radius, blade size, tilt, spin axis speed, precession speed, w (4th coordinate)
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

/** What the rings say, in the alien script: the system's names, round and round. Packed 4 codes per vec4 (-1 = space). */
const RING_TEXT = (() => {
  const codes = encode(["ORBIT CORE", ...PLANETS.map((p) => p.name)].join(" ") + " ").slice(0, 96), out = new Float32Array(96).fill(-1);
  out.set(codes);
  return { v: Array.from({ length: 24 }, (_, i) => new THREE.Vector4(out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3])), n: codes.length };
})();

const PANEL = 12; // cells (glyph pitches) per panel
// The blade's cross-section (x radial, y along the ring axis), counter-clockwise, and what each facet carries:
// 0 inner face (ports), 1 chamfer (notches), 2 top/bottom face (rivets), 4 outer facet (engraved script band),
// 5/6 the two walls of the inner groove (a luminous seam where they meet).
function bladeProfile(T: number, H: number): [number, number, number][] {
  const c = T * 0.32, o = T * 0.72, g = H * 0.09, gd = T * 0.38;
  return [[-T, -H + c, 1], [-T + c, -H, 2], [o - c, -H, 1], [o, -H + c, 4], [T, 0, 4], [o, H - c, 1], [o - c, H, 2], [-T + c, H, 1],
    [-T, H - c, 0], [-T, g, 5], [-T + gd, 0, 6], [-T, -g, 0]]; // [x, y, type of the facet from this point to the next]
}

/** A machined ring blade: each facet is its own strip (flat shading, crisp chamfers), with uv = (cells along the ring,
 *  cells across the facet) and aFacet = (type, facet length in cells). A cell is the script's glyph pitch; the ring holds
 *  a whole number of panels, so seams and text never break at the uv wrap. */
function bladeGeometry(r: number, T: number, H: number, seg = 240) {
  const prof = bladeProfile(T, H), circ = Math.PI * 2 * r;
  const panels = Math.max(1, Math.round(circ / (H * 0.36 * PANEL))), cell = circ / (panels * PANEL), N = panels * PANEL;
  const pos: number[] = [], uv: number[] = [], fa: number[] = [], idx: number[] = [];
  for (let k = 0; k < prof.length; k++) {
    const [x0, y0, type] = prof[k], [x1, y1] = prof[(k + 1) % prof.length], len = Math.hypot(x1 - x0, y1 - y0) / cell, base = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), u = (j / seg) * N;
      pos.push((r + x0) * ca, (r + x0) * sa, y0, (r + x1) * ca, (r + x1) * sa, y1);
      uv.push(u, 0, u, len); fa.push(type, len, type, len);
      if (j) { const b = base + (j - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("aFacet", new THREE.Float32BufferAttribute(fa, 2));
  geo.setIndex(idx);
  return { geo, cell };
}

// Procedural machining, all ALU in the ring's own pass: a height field h (in cells) drives a derivative bump on both the
// base and clearcoat normals; engraved strokes go frosted and carry a faint glow that travels along the text like reading.
// Every term fades by its pixel footprint (fw = cells per pixel): far off the blade is clean obsidian, up close the
// detail resolves, and nothing is ever finer than ~1.5 px (no shimmer).
const RING_FS = /* glsl */ `
varying vec2 vG; varying vec2 vF; uniform float uTime; uniform float uGlyph; uniform float uCell; uniform float uW0; uniform vec4 uText[24]; uniform float uTextN;
${SCRIPT_GLSL}
float rCode(float i) { int k = int(mod(i, uTextN)); return uText[k >> 2][k & 3]; }
vec3 bumpN(vec3 pos, vec3 n, float h) {
  vec3 sx = dFdx(pos), sy = dFdy(pos), r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 v = abs(det) * n - grad;
  return dot(v, v) > 1e-24 ? normalize(v) : n; // degenerate derivatives (edge-on): keep the facet normal, never NaN
}
float aaStep(float e, float x, float fw) { return 1.0 - smoothstep(e - fw * 0.75, e + fw * 0.75, x); } // 1 inside (x < e)
`;
const RING_MAIN = /* glsl */ `
float gInk = 0.0, gGroove = 0.0, gRead = 0.0, gRule = 0.0, gGold = 0.0, gCast = 0.0;
{
  vec2 q = vG; float type = vF.x + 0.5, len = vF.y;
  float fw = max(max(fwidth(q.x), fwidth(q.y)), 1e-4);
  float kBig = 1.0 - smoothstep(0.1, 0.4, fw), kFine = 1.0 - smoothstep(0.03, 0.075, fw), kScript = 1.0 - smoothstep(0.014, 0.035, fw);
  float panel = floor(q.x / ${PANEL}.0), px = q.x - panel * ${PANEL}.0, seam = min(px, ${PANEL}.0 - px), ci = floor(px);
  float sw = max(0.02, fw * 1.2), castM = 1.0;
  float h = -aaStep(0.06, seam, fw) * 0.6 * kBig;                                       // bevelled panel seam
  gGold = exp(-seam * seam / (sw * sw)) * 0.012 / sw;                                    // with a thread of amber light in it
  if (type < 1.0) {                                                                      // inner face: a long port and a row of round ones per panel
    float y = q.y - len * 0.5;
    vec2 d = abs(vec2(px - 6.5, y)) - vec2(2.2, min(0.2, len * 0.16));
    float box = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.08;
    h -= aaStep(0.0, box, fw) * 0.5 * kBig;
    float pr = length(vec2(fract(q.x * 2.0) - 0.5, (abs(y) - min(0.5, len * 0.32)) * 2.0)) * 0.5;
    h -= aaStep(0.07, pr, fw) * 0.4 * kFine * step(1.0, seam) * step(2.9, abs(px - 6.5)); // beside the long port, not over it
  } else if (type < 2.0) {                                                               // chamfer: a notch at every seam
    h -= aaStep(0.24, seam, fw) * 0.7 * kBig;
  } else if (type < 3.0) {                                                               // top/bottom face: rivets in a 1-1-2 rhythm
    float rv = length(vec2(fract(q.x) - 0.5, q.y - len * 0.5)), big = step(1.5, mod(floor(q.x), 3.0));
    h += aaStep(0.07 + 0.04 * big, rv, fw) * (0.25 + 0.15 * big) * kFine * step(1.0, seam);
  } else if (type < 5.0) {
    // outer facet (c12): two inset bands of fine engraved script around an amber centre seam, a row of ports and rivets
    // outside each band, rough cast metal beyond
    float y = q.y - len * 0.5, ay = abs(y), off = floor(abs(uW0) * 37.0), by = ay - 0.38;
    h -= aaStep(0.045, ay, fw) * 0.45 * kBig;                                            // the centre seam
    gGold += exp(-y * y / (sw * sw)) * 0.02 / sw;
    float inBand = aaStep(0.26, abs(by), fw);
    h -= inBand * 0.28 * kBig; castM -= inBand;
    gRule = aaStep(0.018, abs(abs(by) - 0.3), fw) * kFine;                               // hairline rules
    float sx = q.x * 2.0, sp = floor(sx) - panel * ${PANEL * 2}.0;                      // script at half-cell pitch
    if (kScript > 0.0 && abs(by) < 0.26 && sp > 1.5 && sp < ${PANEL * 2 - 2}.5) {
      float code = rCode(panel * ${PANEL * 2 - 4}.0 + sp - 2.0 + off + step(y, 0.0) * 53.0);
      if (code >= 0.0) {
        float d = glyphSdf(vec2((fract(sx) - 0.5) * 0.5, by * sign(y)) / 0.155, int(code)) * 0.155;
        gInk = aaStep(0.017, d, fw) * kScript;
      }
    }
    float ry = ay - 0.86;                                                                // ports (even cells) and rivet pairs (odd cells)
    if (abs(ry) < 0.2 && seam > 0.3) {
      float even = step(mod(ci, 2.0), 0.5), fx = fract(q.x) - 0.5;
      float port = length(vec2(fx, ry));
      float riv = length(vec2(abs(fx) - 0.25, ry));
      h -= even * (aaStep(0.12, port, fw) - aaStep(0.045, port, fw) * 0.7) * 0.5 * kFine;
      h += (1.0 - even) * aaStep(0.05, riv, fw) * 0.3 * kFine;
      castM -= aaStep(0.16, abs(ry), fw);
    }
    float rp = fract((q.x - uTime * 0.6 + off) / 41.0) * 41.0 - 20.5;                    // the reading glow: ~3 cells, 0.6 cells/s
    gRead = exp(-rp * rp * 0.18);
  } else {                                                                               // groove walls: the luminous seam where they meet
    float dd = type < 6.0 ? len - q.y : q.y, w = max(0.05, fw * 1.2);
    gGroove = exp(-dd * dd / (w * w)) * 0.05 / w;
  }
  { // rough cast texture between the machined parts: value noise at 1/7 cell, faded before it gets under ~4 px
    vec2 n = q * 7.0, i = floor(n), f = fract(n); f = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
    float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), e = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
    gCast = (mix(mix(a, b, f.x), mix(c, e, f.x), f.y) - 0.5) * clamp(castM, 0.0, 1.0) * (1.0 - smoothstep(0.02, 0.05, fw));
    h += gCast * 0.12;
  }
  vec3 bn = bumpN(-vViewPosition, normal, h * uCell * 0.05);
  normal = bn;
  #ifdef USE_CLEARCOAT
    clearcoatNormal = bn;
  #endif
  // Hairline strokes are shaded as frosted etching (rough, less metal), not bumped: a derivative bump on ~2 px lines
  // breaks into 2x2-quad dots. Only the broader machining above goes through the bump.
  roughnessFactor = clamp(mix(roughnessFactor, 0.55, max(gInk, gRule * 0.5)) + gCast * 0.3, 0.04, 1.0);
  metalnessFactor = mix(metalnessFactor, 0.55, gInk);
  gGold *= mix(0.25, 1.0, kBig);                                                         // far: a faint thread, never a glare
}
`;
const RING_EMIT = /* glsl */ `
totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * gInk * (0.07 + 0.9 * gRead) * max(uGlyph, 0.0);
totalEmissiveRadiance += vec3(0.62, 0.72, 1.0) * min(gGroove, 1.5) * (0.5 + 0.3 * gRead) * max(uGlyph, 0.0);
totalEmissiveRadiance += vec3(1.0, 0.62, 0.24) * min(gGold, 1.2) * 0.45 * (0.6 + 0.2 * min(uGlyph, 2.0));
{ // oil sheen (Annihilation): a thin-film band only where the blade turns edge-on, no glow
  float gz = 1.0 - abs(dot(nonPerturbedNormal, normalize(vViewPosition)));
  float band = smoothstep(0.7, 0.88, gz) * (1.0 - smoothstep(0.94, 1.0, gz));
  vec3 film = 0.5 + 0.5 * cos(6.2831853 * (gz * 2.6 + vG.x * 0.02 + uTime * 0.02 + vec3(0.0, 0.33, 0.67)));
  totalEmissiveRadiance += film * band * 0.07;
}`;

type GlyphU = { uTime: { value: number }; uGlyph: { value: number }; uXW: { value: number }; uYW: { value: number }; uFlat: { value: number } };
const TEXT_U = { uText: { value: RING_TEXT.v }, uTextN: { value: RING_TEXT.n } };
function glyphHook(u: GlyphU, w0: number, cell: number) {
  return (s: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(s.uniforms, u, TEXT_U, { uW0: { value: w0 }, uCell: { value: cell } });
    s.vertexShader = s.vertexShader.replace("void main() {", `attribute vec2 aFacet; varying vec2 vG; varying vec2 vF;\n${T4}\nvoid main() {\nvG = uv; vF = aFacet;`)
      .replace("#include <project_vertex>", `vec4 mvPosition = viewMatrix * vec4(t4((modelMatrix * vec4(transformed, 1.0)).xyz, uW0), 1.0);
        gl_Position = projectionMatrix * mvPosition;`); // flat shading rebuilds normals from the warped surface
    s.fragmentShader = s.fragmentShader
      .replace("void main() {", `${RING_FS}\nvoid main() {`)
      .replace("#include <clearcoat_normal_fragment_maps>", `#include <clearcoat_normal_fragment_maps>\n${RING_MAIN}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${RING_EMIT}`);
  };
}

function ObsidianRing({ r, h, w, env, u, tint }: { r: number; h: number; w: number; env: THREE.Texture | null; u: GlyphU; tint: THREE.Color }) {
  const { geo, cell } = useMemo(() => bladeGeometry(r, h * 0.95, h * 3.2 * 1.12), [r, h]); // a little taller than the old diamond blade, so the detail reads
  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: "#030305", metalness: 0.9, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03,
      iridescence: 0.3, iridescenceIOR: 1.5, iridescenceThicknessRange: [180, 520], flatShading: true, envMapIntensity: 0.45, // obsidian: a dark mirror, mostly clearcoat glints
    });
    m.emissive = tint; // shared: CORE's mood colour (tool planet, amber approval, grey error) washes all four blades
    m.onBeforeCompile = glyphHook(u, w, cell);
    m.customProgramCacheKey = () => "tess-ring-2"; // one program; w0 and the cell size are uniforms
    return m;
  }, [u, w, cell, tint]);
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} />; // the 4D warp leaves its bounds
}

const _dir = new THREE.Vector3(), _ndc = new THREE.Vector3(), _q = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
const LOOK_KEYS = Object.keys(newLook()) as (keyof Look)[];
const AMBER = new THREE.Color("#fbbf24"), GREY = new THREE.Color(0.5, 0.5, 0.52), BEAM_COL = new THREE.Color("#bfe9ff");
// Listening: each ring turns to present its script band to the viewer (camera frame, ring axis up, tipped toward the
// eye a little more per ring). QPT = that pose with the ring's fixed tilt undone, since the tilt group sits inside.
const QPT = RINGS.map((k, i) => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.32 + i * 0.07, 0, 0))
  .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(k.tilt as unknown as [number, number, number]))).invert()));
const BEAM_N = 48, BEAM_IN = 0.6, BEAM_OUT = 11;

export function Singularity({ live, reduced, level, aligned = false, approval = false }: { live: RefObject<CoreLive>; reduced: boolean; level: number; aligned?: boolean; approval?: boolean }) {
  const env = useAlienEnv();
  const halo = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HALO_VS, fragmentShader: HALO_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uRays: { value: 1 }, uSize: { value: 30 }, uCap: { value: 4 } },
  }), []);
  const disk = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: DISK_VS, fragmentShader: DISK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uIn: { value: 0.45 }, uOut: { value: 2.9 }, uCap: { value: 2 } },
  }), []);
  const diskGeo = useMemo(() => new THREE.RingGeometry(0.45, 2.9, 160, 6), []);
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const glyph = useMemo<GlyphU>(() => ({ uTime: { value: 0 }, uGlyph: { value: 1 }, uXW: { value: 0 }, uYW: { value: 0 }, uFlat: { value: 0 } }), []);
  const root = useRef<THREE.Group>(null);
  const gain = useRef(1);
  const fractalGain = useMemo(() => () => gain.current, []);
  useEffect(() => () => { halo.dispose(); disk.dispose(); diskGeo.dispose(); quad.dispose(); }, [halo, disk, diskGeo, quad]);

  // E4: what CORE is doing (core-mood-pure), eased into the existing uniforms. Same line material as the planet beams in
  // Galaxy, so the scan beam reuses that program (no new shader compile).
  const tint = useMemo(() => new THREE.Color(0, 0, 0), []);
  const mood = useRef({ ctx: newMoodCtx(), tgt: newLook(), cur: newLook(), toolCol: new THREE.Color(), approval, diskT: 0, ph: 0, scan: 0, pre: new Float32Array(RINGS.length) });
  mood.current.approval = approval;
  useEffect(() => {
    const M = mood.current;
    const onBusy = (e: Event) => { moodEvent(M.ctx, { type: "busy", on: (e as CustomEvent<boolean>).detail === true }, performance.now()); };
    const onSig = (e: Event) => {
      const d = (e as CustomEvent<CoreSignal>).detail;
      if (!d || (d.type !== "step" && d.type !== "error")) return;
      moodEvent(M.ctx, d, performance.now());
      const p = M.ctx.target && planetById(M.ctx.target);
      if (p) M.toolCol.set(p.color); // kept after the step ends, so the colour fades out instead of flipping
    };
    addEventListener(CORE_BUSY, onBusy); addEventListener(CORE_SIGNAL, onSig);
    return () => { removeEventListener(CORE_BUSY, onBusy); removeEventListener(CORE_SIGNAL, onSig); };
  }, []);
  const beam = useMemo(() => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(BEAM_N * 3);
    for (let i = 0; i < BEAM_N; i++) pos[i * 3] = BEAM_IN + (BEAM_OUT - BEAM_IN) * (i / (BEAM_N - 1));
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(BEAM_N * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    l.frustumCulled = false; l.visible = false; l.rotation.z = 0.12;
    return l;
  }, []);
  useEffect(() => () => { beam.geometry.dispose(); (beam.material as THREE.Material).dispose(); }, [beam]);

  const rings = useRef<(THREE.Group | null)[]>([]);
  const spin = useRef<(THREE.Group | null)[]>([]);
  // The 4D angles drift slowly (as tesseractAngle did); unseen change (Blindsight) adds a jump on top, only behind a fast
  // camera turn or with the CORE off screen. Opening the CORE re-aligns the rings: ease-in into stillness, then a dead stop.
  const un = useRef({ ...newUnseen(), xw: 0, yw: 0, last: new THREE.Vector3(), primed: false, a: -1, ax: 0, ay: 0 });
  useEffect(() => { // the shortest way to (0, 0): the angles wrap at 2 pi
    const U = un.current;
    U.a = aligned ? 0 : -1; U.ax = wrapAngle(U.xw); U.ay = wrapAngle(U.yw);
  }, [aligned]);
  useFrame(({ clock, camera }, dt) => {
    const t = reduced ? 12 : clock.elapsedTime, L = live.current, calm = coreCalm(camera.position.length());
    const g = finite(L?.g ?? 0), br = finite(L?.breath ?? 0.5), v = finite((L?.mic ?? 0) + (L?.spk ?? 0));
    const M = mood.current, C = M.cur, st = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const m = resolveMood(M.ctx, performance.now(), { listening: voiceLevel.listening, mic: finite(L?.mic ?? 0), spk: finite(L?.spk ?? 0), approval: M.approval });
    moodLook(m, M.tgt);
    const tau = moodTau(m);
    for (let i = 0; i < LOOK_KEYS.length; i++) { const k = LOOK_KEYS[i]; C[k] = expDamp(C[k], M.tgt[k], tau, st); }
    M.diskT += st * (1 + 2.5 * C.swirl); M.ph += st * Math.PI * 2 * C.breath;
    const pulse = reduced ? 0.8 : 0.55 + 0.45 * Math.cos(t * Math.PI); // the amber pulse: every 2 s, steady with reduced motion
    tint.copy(M.toolCol).multiplyScalar(0.35 * C.tint);
    tint.r += AMBER.r * 0.3 * C.amber * pulse; tint.g += AMBER.g * 0.3 * C.amber * pulse; tint.b += AMBER.b * 0.3 * C.amber * pulse;
    tint.r += GREY.r * 0.14 * C.desat; tint.g += GREY.g * 0.14 * C.desat; tint.b += GREY.b * 0.14 * C.desat;
    const drain = 1 - C.desat; // error: the colourful light drains for a moment (no new shader: gains + a grey wash)
    halo.uniforms.uTime.value = t;
    halo.uniforms.uGain.value = (0.7 + 0.2 * br + 0.9 * g + 0.6 * v + 0.25 * C.amber * pulse) * (1 - 0.7 * calm) * (1 - 0.3 * C.desat); // overview: the lens would gather it into a blob
    halo.uniforms.uRays.value = (level === 0 ? 0.5 : 1) * (1 - 0.97 * calm) * 0.7 * drain; // god rays are a close-up drama: none on the overview
    halo.uniforms.uCap.value = 1.0 + 3.0 * calm; // close range: exposure-clamped, never a flat white plate; overview unchanged
    disk.uniforms.uCap.value = 0.75 + 1.25 * calm;
    disk.uniforms.uTime.value = reduced ? t : M.diskT; // thinking: the inner swirl (lensed into the ring) runs faster
    disk.uniforms.uGain.value = (0.75 + 0.2 * br + 0.8 * g + 0.5 * v) * (1 - 0.75 * calm) * (1 - 0.6 * C.desat);
    glyph.uFlat.value = Math.max(0.85 * calm, 0.75 * C.face); // listening: the rings settle out of 4D so the script reads
    root.current?.scale.setScalar(coreScale(camera.position.length()) * (reduced ? 1 : 1 + 0.012 * Math.sin(M.ph))); // breathing
    glyph.uTime.value = t;
    glyph.uGlyph.value = (0.8 + 1.5 * g + 0.8 * v + 0.6 * C.face) * (1 - 0.6 * calm) * (1 - 0.8 * C.desat);
    beam.visible = C.beam > 0.01;
    if (beam.visible) { // searching the web: a thin beam turning around the core, light running outward along it
      const col = beam.geometry.attributes.color as THREE.BufferAttribute, head = reduced ? 2 : (t * 0.6) % 1.3;
      if (!reduced) M.scan += st * 0.7;
      beam.rotation.y = M.scan;
      for (let i = 0; i < BEAM_N; i++) {
        const x = i / (BEAM_N - 1), k = (0.12 + (x <= head ? Math.exp(-((head - x) ** 2) / 0.004) : 0)) * (1 - x * 0.6) * C.beam * drain;
        col.setXYZ(i, BEAM_COL.r * k, BEAM_COL.g * k, BEAM_COL.b * k);
      }
      col.needsUpdate = true;
    }
    gain.current = halo.uniforms.uGain.value;
    if (reduced) {
      glyph.uXW.value = tesseractAngle(t, 0, true); glyph.uYW.value = tesseractAngle(t, 1, true);
      for (let i = 0; i < RINGS.length; i++) rings.current[i]?.scale.setScalar(1 - 0.07 * C.tight);
      return;
    }
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
    } else {
      U.xw = wrapAngle(U.xw + step * 0.23); U.yw = wrapAngle(U.yw + step * 0.137); // the slow drift (same rates as before); after an alignment it resumes from there
      if (unseenStep(U, step, watched(ang, onScreen))) {
        U.xw = wrapAngle(U.xw + unseenJump(0)); U.yw = wrapAngle(U.yw + unseenJump(1));
        for (let i = 0; i < RINGS.length; i++) M.pre[i] += (1.9 + i * 0.7) * Math.sign(RINGS[i].pre); // precession jumps too
      }
    }
    glyph.uXW.value = U.xw; glyph.uYW.value = U.yw;
    for (let i = 0; i < RINGS.length; i++) { // spin about the blade's own axis, precess the whole ring around y
      const s = spin.current[i], o = rings.current[i];
      // thinking: the glyph rings (alternate spin signs) counter-rotate faster; listening: they slow down and face you
      if (s) s.rotation.z += step * RINGS[i].spin * (1 + 2 * g) * (1 + 3 * C.counter) * (1 - 0.8 * C.face);
      M.pre[i] += step * RINGS[i].pre;
      if (o) {
        o.quaternion.setFromAxisAngle(_Y, M.pre[i]);
        if (C.face > 0.001) o.quaternion.slerp(_q.copy(camera.quaternion).multiply(QPT[i]), C.face); // root has no rotation: camera frame = parent frame
        o.scale.setScalar(1 - 0.07 * C.tight + 0.035 * C.ripple * finite(L?.spk ?? 0) * Math.sin(t * 9 - i * 1.3)); // speaking: ripples out ring by ring
      }
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
              <ObsidianRing r={k.r} h={k.h} w={k.w} env={env} u={glyph} tint={tint} />
            </group>
          </group>
        </group>
      ))}
      <primitive object={beam} />
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
