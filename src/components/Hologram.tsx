"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import { scrambleStep } from "@/lib/hologram-pure";

// Floating holographic SDF text (drei <Text> / troika) that always faces the camera.
// Look: tinted, brighter toward the glyph edges via a blurred outline halo, screen-space scanlines that roll with time,
// a rare flicker, and a ~400 ms glyph scramble whenever `text` changes. `reduced`: static, no scramble.
// Every colour channel is clamped to [0, 2] and alpha to [0, 1], so Bloom never sees NaN or negative output.

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uMotion;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float scan = 0.72 + 0.28 * sin(gl_FragCoord.y * 1.4 - uTime * 6.0 * uMotion);
  float band = smoothstep(0.0, 0.08, abs(fract(gl_FragCoord.y * 0.004 - uTime * 0.25 * uMotion) - 0.5)); // slow sweep line
  float n = fract(sin(floor(uTime * 20.0) * 12.9898) * 43758.5453);
  float flicker = 1.0 - uMotion * 0.35 * step(0.94, n);
  float rim = 1.0 + 0.5 * (1.0 - vUv.y); // brighter toward the base of each glyph quad
  vec3 col = uColor * scan * (0.75 + 0.25 * band) * flicker * rim;
  col = clamp(col, 0.0, 2.0);
  if (!(col.r >= 0.0)) col = vec3(0.0); // NaN guard
  gl_FragColor = vec4(col, clamp(uOpacity * (0.8 + 0.2 * scan), 0.0, 1.0));
}`;

type Props = {
  text: string;
  position?: [number, number, number];
  size?: number;
  color?: string;
  reduced?: boolean;
  scrambleMs?: number;
};

export default function Hologram({ text, position, size = 0.3, color = "#67e8f9", reduced = false, scrambleMs = 400 }: Props) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uMotion: { value: 1 }, uOpacity: { value: 0.9 } },
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { mat.uniforms.uColor.value.set(color); }, [mat, color]);

  const [shown, setShown] = useState(text);
  const seed = useRef(1);
  useEffect(() => {
    if (reduced) { setShown(text); return; }
    const t0 = performance.now();
    const id = window.setInterval(() => { // ~8 relayouts per change, not one per frame
      const e = performance.now() - t0;
      setShown(scrambleStep(text, e, scrambleMs, ++seed.current));
      if (e >= scrambleMs) window.clearInterval(id);
    }, 50);
    setShown(scrambleStep(text, 0, scrambleMs, ++seed.current));
    return () => window.clearInterval(id);
  }, [text, reduced, scrambleMs]);

  const bob = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    mat.uniforms.uTime.value = reduced ? 0 : t % 1000; // wrapped: keeps sin() precise over long sessions
    mat.uniforms.uMotion.value = reduced ? 0 : 1;
    if (bob.current) bob.current.position.y = reduced ? 0 : Math.sin(t * 1.1) * 0.04;
  });

  return (
    <Billboard position={position}>
      <group ref={bob}>
        <Text material={mat} fontSize={size} anchorX="center" anchorY="middle" letterSpacing={0.06} outlineWidth={size * 0.08} outlineBlur={size * 0.25} outlineOpacity={0.35}>
          {shown}
        </Text>
      </group>
    </Billboard>
  );
}
