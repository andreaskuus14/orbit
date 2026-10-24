"use client";
// The impossible object at the heart of the CORE (concept c7): a recursive megastructure. A lattice globe carved from a
// Menger sponge, holding a smaller copy of itself that turns the other way, holding a smaller copy again: an infinite
// regress the CORE's light leaks through. Raymarched (signed distance field) inside a bounding box: a few hundred
// pixels on screen, a fixed small step budget, drawn only on quality level 2+ and when the camera is near enough.
// Writes its true depth so the singularity's glow and the rings sort against it. Outputs clamped finite (bloom NaN rule).
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO } from "./env";

const VS = /* glsl */ `varying vec3 vO; void main(){ vO = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */ `
uniform vec3 uCam; uniform mat4 uMVP; uniform float uTime; uniform float uGain; uniform float uSteps; varying vec3 vO;
${HOLO}
mat3 rot(vec3 k, float a) { k = normalize(k); float c = cos(a), s = sin(a); return mat3(c) + (1.0 - c) * outerProduct(k, k) + s * mat3(0.0, k.z, -k.y, -k.z, 0.0, k.x, k.y, -k.x, 0.0); }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float menger(vec3 p) {
  float d = sdBox(p, vec3(1.0)), s = 1.0;
  for (int m = 0; m < 3; m++) {
    vec3 a = mod(p * s, 2.0) - 1.0; s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    d = max(d, (min(max(r.x, r.y), min(max(r.y, r.z), max(r.z, r.x))) - 1.0) / s);
  }
  return d;
}
float shell(vec3 p) { return max(menger(p), abs(length(p) - 0.86) - 0.075); }
mat3 R1, R2;
float map(vec3 p) {
  vec3 q = R1 * p;
  float d = shell(q);
  vec3 q2 = R2 * q / 0.46;       // the copy inside, turning the other way
  d = min(d, shell(q2) * 0.46);
  vec3 q3 = R2 * q2 / 0.46;      // and its copy
  return min(d, shell(q3) * 0.2116);
}
vec3 nrm(vec3 p) { vec2 e = vec2(0.0015, -0.0015);
  vec3 g = e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx);
  return g / max(length(g), 1e-7); } // never normalize a zero vector (NaN would smear through the bloom)
void main() {
  R1 = rot(vec3(0.3, 1.0, 0.2), uTime * 0.11); R2 = rot(vec3(1.0, -0.2, 0.4), -uTime * 0.23);
  vec3 ro = uCam, rd = normalize(vO - uCam);
  vec3 inv = 1.0 / (rd + vec3(1e-6)), t0 = (-1.0 - ro) * inv, t1 = (1.0 - ro) * inv;
  vec3 tn = min(t0, t1); float t = max(max(max(tn.x, tn.y), tn.z), 0.0);
  vec3 tf = max(t0, t1); float tEnd = min(min(tf.x, tf.y), tf.z);
  float hit = 0.0, it = 0.0;
  for (int i = 0; i < 96; i++) {
    if (float(i) >= uSteps || t > tEnd) break;
    float d = map(ro + rd * t);
    if (d < 0.0015 * (1.0 + t)) { hit = 1.0; break; }
    t += d * 0.9; it += 1.0;
  }
  if (hit < 0.5) discard;
  vec3 p = ro + rd * t, n = nrm(p);
  float r = length(p);
  vec3 l = -normalize(p);                                       // the only light: the CORE at the centre
  float fac = max(dot(n, l), 0.0), ao = clamp(1.0 - it / max(uSteps, 1.0), 0.0, 1.0);
  float fr = pow(1.0 - clamp(abs(dot(n, -rd)), 0.0, 1.0), 4.0);
  vec3 refl = reflect(rd, n);
  vec3 c = vec3(0.03, 0.034, 0.045) * (0.6 + 0.4 * n.y);         // obsidian body
  c += vec3(1.0, 0.95, 0.88) * fac * 3.2 * exp(-r * 1.3) * uGain;   // inner faces lit white-hot by the singularity
  c += holo(r * 1.7 + dot(n, vec3(0.3, 0.5, 0.2)) + uTime * 0.03) * fr * 0.9 * ao; // thin-film edges
  c += vec3(0.6, 0.75, 1.0) * pow(max(dot(refl, normalize(vec3(0.3, 1.0, 0.4))), 0.0), 40.0) * 1.4 * ao; // chrome glint
  c *= 0.35 + 0.65 * ao;
  vec4 clip = uMVP * vec4(p, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
  float lum = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5); // white-hot, but rolled off: no flat clipped faces up close
  if (lum > 0.8) c *= (0.8 + (lum - 0.8) / (1.0 + (lum - 0.8) / 1.0)) / lum;
  gl_FragColor = vec4(clamp(c, 0.0, 8.0), 1.0);
}`;

export function Fractal({ size, on, reduced, gain }: { size: number; on: boolean; reduced: boolean; gain: () => number }) {
  const geo = useMemo(() => new THREE.BoxGeometry(2, 2, 2), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side: THREE.BackSide, // back faces: still drawn when the camera is inside the box
    uniforms: { uCam: { value: new THREE.Vector3() }, uMVP: { value: new THREE.Matrix4() }, uTime: { value: 0 }, uGain: { value: 1 }, uSteps: { value: 64 } },
  }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const ref = useRef<THREE.Mesh>(null);
  const inv = useMemo(() => new THREE.Matrix4(), []);
  useFrame(({ camera, clock }) => {
    const m = ref.current;
    if (!m) return;
    const dist = camera.position.length();
    m.visible = on && dist < 34; // a few pixels from the overview: not worth a raymarch
    if (!m.visible) return;
    const u = mat.uniforms, g = gain();
    m.updateWorldMatrix(true, false);
    inv.copy(m.matrixWorld).invert();
    u.uCam.value.copy(camera.position).applyMatrix4(inv);
    u.uMVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(m.matrixWorld);
    u.uTime.value = reduced ? 9 : clock.elapsedTime;
    u.uGain.value = Number.isFinite(g) ? Math.min(3, Math.max(0, g)) : 1;
    u.uSteps.value = dist < 14 ? 80 : 48; // fewer steps when it is small on screen
  });
  return <mesh ref={ref} geometry={geo} material={mat} scale={size} frustumCulled={false} />;
}
