"use client";
// Gravitational lensing around the singularity: a screen-space post effect. Each pixel behind the CORE samples the
// image where a point-mass lens would have bent its light from (beta = theta - thetaE^2 / theta): stars and worlds
// smear into arcs, the far side of the system shows up mirrored inside the Einstein ring, and the CORE's own light
// wraps into the ring. Strength falls off with screen distance; the singularity's heart stays unbent so the CORE keeps
// its look. Dispersion (R/G/B bent by slightly different amounts) at the ring on the higher quality levels.
// Only the light field is bent (pixels with no depth written: stars, arms, glow): worlds and rings stay sharp and legible
// where they are; a world behind the CORE also shows up as a smeared ghost image near the ring, as a real lens would.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import * as THREE from "three";
import { einsteinRadius } from "@/lib/alien-pure";

const FS = /* glsl */ `
uniform vec2 uC; uniform float uRe; uniform float uKeep; uniform float uOn; uniform float uZ; uniform float uDisp; uniform float uTime;
vec2 bend(vec2 uv, float k, out float r) {
  vec2 d = (uv - uC) * vec2(aspect, 1.0);
  r = max(length(d), 1e-4);
  float re = uRe * k;
  float w = (1.0 - smoothstep(1.6 * uRe, 4.5 * uRe, r)) * smoothstep(max(0.18 * uRe, uKeep), max(0.62 * uRe, uKeep * 1.8), r) * uOn;
  vec2 s = d - d * (re * re / (r * r)) * w;
  return uC + s / vec2(aspect, 1.0);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float behind = step(0.99999, depth); // only the light field (stars, arms, glow: no depth written) bends; solid worlds never
  if (uOn <= 0.0 || behind <= 0.0) { outputColor = inputColor; return; }
  // A solid world may be lensed only if it really is behind the CORE. When the bent ray lands on one in front, retry
  // with a weaker lens (k^2 = 0.5, 0.2): the light field stays continuous instead of showing the world's dark "shadow".
  float r, k = 1.0;
  vec2 g = uv;
  for (int i = 0; i < 3; i++) {
    g = clamp(bend(uv, k, r), vec2(0.0), vec2(1.0));
    float sd = readDepth(g);
    if (sd >= 0.99999 || -getViewZ(sd) > uZ) break;
    k = i == 0 ? 0.7 : i == 1 ? 0.45 : 0.0;
    g = uv;
  }
  vec3 c = texture2D(inputBuffer, g).rgb;
  float x = (r - uRe) / max(uRe, 1e-4);
  float near = exp(-x * x * 14.0);
  if (uDisp > 0.0 && k == 1.0) { // chromatic dispersion where the bending is strongest
    float rr;
    c.r = texture2D(inputBuffer, clamp(bend(uv, 1.0 + 0.016 * uDisp * near, rr), vec2(0.0), vec2(1.0))).r;
    c.b = texture2D(inputBuffer, clamp(bend(uv, 1.0 - 0.016 * uDisp * near, rr), vec2(0.0), vec2(1.0))).b;
  }
  // the Einstein ring itself: a hairline of focused light, slightly prismatic, shimmering along its length
  float a = atan(uv.y - uC.y, (uv.x - uC.x) * aspect);
  float ring = exp(-pow(x * 22.0, 2.0)) * (0.55 + 0.45 * sin(a * 7.0 + uTime * 0.6) * sin(a * 3.0 - uTime * 0.25));
  vec3 prism = vec3(exp(-pow((x - 0.03) * 30.0, 2.0)), exp(-pow(x * 30.0, 2.0)), exp(-pow((x + 0.03) * 30.0, 2.0)));
  c += (vec3(0.18) * ring + prism * 0.16 * uDisp) * uOn;
  outputColor = vec4(mix(inputColor.rgb, max(c, vec3(0.0)), behind), inputColor.a);
}`;

class LensEffect extends Effect {
  constructor() {
    super("LensEffect", FS, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ["uC", new THREE.Uniform(new THREE.Vector2(0.5, 0.5))], ["uRe", new THREE.Uniform(0.1)], ["uKeep", new THREE.Uniform(0.02)], ["uOn", new THREE.Uniform(0)], ["uZ", new THREE.Uniform(40)],
        ["uDisp", new THREE.Uniform(0)], ["uTime", new THREE.Uniform(0)],
      ]),
    });
  }
}

/** The lens is a ~4.4 unit point mass at the origin. `disp` turns on the dispersion (3 texture reads instead of 1). */
export function Lensing({ disp, reduced }: { disp: boolean; reduced: boolean }) {
  const fx = useMemo(() => new LensEffect(), []);
  useEffect(() => () => fx.dispose(), [fx]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, clock }) => {
    const u = fx.uniforms, cam = camera as THREE.PerspectiveCamera;
    const dist = camera.position.length();
    const z = -v.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse).z; // the CORE's view depth
    v.set(0, 0, 0).project(camera);
    // off when the CORE is behind the camera or far off screen
    const on = v.z < 1 && Math.abs(v.x) < 2.5 && Math.abs(v.y) < 2.5 ? 1 - Math.max(0, Math.max(Math.abs(v.x), Math.abs(v.y)) - 1.2) / 1.3 : 0;
    u.get("uC")!.value.set((v.x + 1) / 2, (v.y + 1) / 2);
    u.get("uRe")!.value = einsteinRadius(4.4, dist, cam.fov ?? 50);
    u.get("uKeep")!.value = einsteinRadius(1.6, dist, cam.fov ?? 50); // the singularity's heart stays unbent
    u.get("uZ")!.value = Number.isFinite(z) ? z : 40;
    u.get("uOn")!.value = Number.isFinite(on) ? Math.min(1, Math.max(0, on)) : 0;
    u.get("uDisp")!.value = disp ? 1 : 0;
    u.get("uTime")!.value = reduced ? 0 : clock.elapsedTime;
  });
  return <primitive object={fx} dispose={null} />;
}
