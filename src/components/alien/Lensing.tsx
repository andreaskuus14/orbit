"use client";
// Gravitational lensing around the singularity: a screen-space post effect. Each pixel behind the CORE samples the
// image where a point-mass lens would have bent its light from (beta = theta - thetaE^2 / theta): stars and dust
// smear into arcs, the far side of the system shows up mirrored inside the Einstein ring, and the CORE's own light
// wraps into the ring. Strength falls off with screen distance; the singularity's heart stays unbent so the CORE keeps
// its look. Dispersion (R/G/B bent by slightly different amounts) at the ring on the higher quality levels.
// It also applies the frame exposure and a soft highlight knee (see knee()) before the bloom pass.
// Only the light field is bent (pixels with no depth written: stars, arms, glow): worlds and rings stay sharp and legible
// where they are, and never leave ghost copies in the light field (owner feedback: ghosts read as glitches).
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import * as THREE from "three";
import { coreCalm, coreScale, einsteinRadius } from "@/lib/alien-pure";

const FS = /* glsl */ `
uniform vec2 uC; uniform float uRe; uniform float uKeep; uniform float uOn; uniform float uDisp; uniform float uTime; uniform float uCalm; uniform float uExp; uniform float uMax;
vec2 bend(vec2 uv, float k, out float r) {
  vec2 d = (uv - uC) * vec2(aspect, 1.0);
  r = max(length(d), 1e-4);
  float re = uRe * k;
  float w = (1.0 - smoothstep(1.6 * uRe, 4.5 * uRe, r)) * smoothstep(max(0.18 * uRe, uKeep), max(0.62 * uRe, uKeep * 1.8), r) * uOn * (1.0 - 0.6 * uCalm);
  vec2 s = d - d * (re * re / (r * r)) * w;
  return uC + s / vec2(aspect, 1.0);
}
// Exposure and a soft highlight knee for the whole frame, before the bloom pass reads it: however many additive layers
// stack (arms, filaments, halos, ring, rays), luminance rolls off toward uMax instead of clipping to a white plate.
vec3 knee(vec3 c) {
  c = max(c, vec3(0.0)) * uExp;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)), k = 0.7;
  if (l <= k) return c;
  float m = k + (l - k) / (1.0 + (l - k) / max(uMax - k, 1e-3));
  return c * (m / l);
}
float solid(vec2 p) { return readDepth(p) < 0.99999 ? 1.0 : 0.0; }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float behind = step(0.99999, depth); // only the light field (stars, arms, glow: no depth written) bends; solid worlds never
  if (uOn <= 0.0 || behind <= 0.0) { outputColor = vec4(knee(inputColor.rgb), inputColor.a); return; }
  float r;
  vec2 g = clamp(bend(uv, 1.0, r), vec2(0.0), vec2(1.0));
  // Only the light field is bent. A bent ray landing on a world would print a ghost copy of it (or its shadow) into the
  // background: blend toward the unbent light instead, by a soft 5-tap coverage around the landing point (no seams).
  vec2 px = 2.0 / resolution;
  float occ = (solid(g) * 2.0 + solid(g + vec2(px.x, 0.0)) + solid(g - vec2(px.x, 0.0)) + solid(g + vec2(0.0, px.y)) + solid(g - vec2(0.0, px.y))) / 6.0;
  vec3 c = mix(texture2D(inputBuffer, g).rgb, inputColor.rgb, occ);
  float x = (r - uRe) / max(uRe, 1e-4);
  float near = exp(-x * x * 14.0);
  if (uDisp > 0.0) { // chromatic dispersion where the bending is strongest
    float rr, w = near * (1.0 - occ);
    c.r = mix(c.r, texture2D(inputBuffer, clamp(bend(uv, 1.0 + 0.008 * uDisp, rr), vec2(0.0), vec2(1.0))).r, w);
    c.b = mix(c.b, texture2D(inputBuffer, clamp(bend(uv, 1.0 - 0.008 * uDisp, rr), vec2(0.0), vec2(1.0))).b, w);
  }
  // the Einstein ring itself: one crisp hairline of focused light, slowly breathing along its length
  float a = atan(uv.y - uC.y, (uv.x - uC.x) * aspect);
  // overview (uCalm 1): exposure-clamp the gathered light, a hairline ring, a black shadow disk inside it
  float zone = (1.0 - smoothstep(1.6 * uRe, 4.5 * uRe, r)) * uCalm * uOn;
  c *= min(1.0, mix(1e3, 0.45, zone) / max(dot(c, vec3(0.3, 0.59, 0.11)), 1e-4));
  float rw = mix(22.0, 60.0, uCalm), pxr = fwidth(x) * rw; // keep the hairline at least ~1.5 px wide: no crawling stair-steps
  float ring = exp(-pow(x * rw / max(1.0, pxr * 0.7), 2.0)) / max(1.0, pxr * 0.7) * (0.75 + 0.25 * sin(a * 3.0 + uTime * 0.2) * sin(a * 2.0 - uTime * 0.13));
  vec3 prism = vec3(exp(-pow((x - 0.03) * 30.0, 2.0)), exp(-pow(x * 30.0, 2.0)), exp(-pow((x + 0.03) * 30.0, 2.0)));
  c += (vec3(1.0, 0.97, 0.93) * ring * (0.22 + 0.5 * uCalm) + prism * 0.05 * uDisp * (1.0 - 0.9 * uCalm)) * uOn;
  c *= 1.0 - 0.97 * (1.0 - smoothstep(0.74 * uRe, 0.8 * uRe, r)) * uCalm * uOn;
  // close range: halo, disk and ring stack into the lens zone; roll their highlights off (soft, keeps the gradation and
  // the hairline) so the CORE never clips to a flat white disc
  float lc = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5), kz = (1.0 - smoothstep(2.0 * uRe, 4.5 * uRe, r)) * (1.0 - uCalm) * uOn;
  if (lc > 0.5 && kz > 0.0) c *= mix(1.0, (0.5 + (lc - 0.5) / (1.0 + (lc - 0.5) / 0.5)) / lc, kz);
  outputColor = vec4(knee(mix(inputColor.rgb, max(c, vec3(0.0)), behind)), inputColor.a);
}`;

class LensEffect extends Effect {
  constructor() {
    super("LensEffect", FS, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ["uC", new THREE.Uniform(new THREE.Vector2(0.5, 0.5))], ["uRe", new THREE.Uniform(0.1)], ["uKeep", new THREE.Uniform(0.02)], ["uOn", new THREE.Uniform(0)],
        ["uDisp", new THREE.Uniform(0)], ["uTime", new THREE.Uniform(0)], ["uCalm", new THREE.Uniform(0)], ["uExp", new THREE.Uniform(1)], ["uMax", new THREE.Uniform(2.2)],
      ]),
    });
  }
  /** Set by <Lensing>: fills the uniforms. Runs from update(), i.e. at render time inside the composer, after every
   *  useFrame (camera rigs included) and after the scene pass refreshed the camera matrices: the lens centre is
   *  projected with this frame's camera, never last frame's (a one-frame lag put the ring off-centre while moving). */
  sync: (() => void) | null = null;
  update() { this.sync?.(); }
}

/** The lens is a ~4.4 unit point mass at the origin. `disp` turns on the dispersion (3 texture reads instead of 1). */
/** `exposure` scales the whole frame before the highlight knee (tone mapping comes later, in the composer). */
export function Lensing({ disp, reduced, exposure = 1 }: { disp: boolean; reduced: boolean; exposure?: number }) {
  const fx = useMemo(() => new LensEffect(), []);
  useEffect(() => () => fx.dispose(), [fx]);
  const v = useMemo(() => new THREE.Vector3(), []);
  const get = useThree((s) => s.get);
  useEffect(() => { fx.sync = () => {
    const { camera, clock } = get();
    const u = fx.uniforms, cam = camera as THREE.PerspectiveCamera;
    const dist = camera.position.length();
    v.set(0, 0, 0).project(camera);
    // off when the CORE is behind the camera or far off screen
    const on = v.z < 1 && Math.abs(v.x) < 2.5 && Math.abs(v.y) < 2.5 ? 1 - Math.max(0, Math.max(Math.abs(v.x), Math.abs(v.y)) - 1.2) / 1.3 : 0;
    u.get("uC")!.value.set((v.x + 1) / 2, (v.y + 1) / 2);
    const k = coreScale(dist); // the artifact shrinks at the overview: so does its lens
    u.get("uRe")!.value = einsteinRadius(4.4 * k, dist, cam.fov ?? 50);
    u.get("uKeep")!.value = einsteinRadius(1.6 * k, dist, cam.fov ?? 50); // the singularity's heart stays unbent
    u.get("uExp")!.value = Number.isFinite(exposure) ? Math.max(0, exposure) : 1;
    u.get("uOn")!.value = Number.isFinite(on) ? Math.min(1, Math.max(0, on)) : 0;
    u.get("uDisp")!.value = disp ? 1 : 0;
    u.get("uTime")!.value = reduced ? 0 : clock.elapsedTime;
    u.get("uCalm")!.value = coreCalm(dist); // overview: subtle lens, thin ring, black shadow; close-up: full drama
  }; return () => { fx.sync = null; }; }, [fx, v, get, disp, reduced, exposure]);
  return <primitive object={fx} dispose={null} />;
}
