"use client";
// Living events: the galaxy reacts to what ORBIT does. A comet streaks from a planet to the CORE when an agent finishes,
// an aurora rings STUDIO when a clip publishes, a gold flare bursts on MARKETS for a deal, and a slow sunrise glows across
// the galaxy when the night shift ends. One instanced billboard mesh draws every effect: a fixed pool of CAP slots x PER
// sprites, written in place each frame (no per-event allocation), additive, no post-processing of its own.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { perfCtx } from "./PerfBeacon";
import { admit, allowed, CAP, effectFor, LIVING_EVENT, newPool, progress } from "@/lib/living-events-pure";

const PER = 24; // sprites per effect
const COMET = new THREE.Color("#cfe8ff"), GOLD = new THREE.Color("#fbbf24"), SUN = new THREE.Color("#ffb36b"), DAWN = new THREE.Color("#ffd29a");
const AURORA = [new THREE.Color("#5eead4"), new THREE.Color("#f0abfc")];

export function LivingEffects({ positions, reduced }: { positions: Record<string, THREE.Vector3>; reduced: boolean }) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      // camera-facing sprites: the instance's centre in view space, the quad spread by its scale
      vertexShader: `varying vec2 vUv; varying vec3 vC;
        void main(){ vUv = uv; vC = instanceColor; vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          c.xy += position.xy * length(instanceMatrix[0].xyz); gl_Position = projectionMatrix * c; }`,
      fragmentShader: `varying vec2 vUv; varying vec3 vC;
        void main(){ float a = max(0.0, 1.0 - length(vUv - 0.5) * 2.0); gl_FragColor = vec4(vC * a * a, 1.0); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }), CAP * PER);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * PER * 3), 3); // before the first compile: the program needs it
    m.frustumCulled = false; m.count = 0; m.visible = false; // hidden: WarmCompile warms it after the start-up set
    return m;
  }, []);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); }, [mesh]);
  const pool = useMemo(() => newPool(), []);
  const frameMs = useRef(16.7); // smoothed frame time: new effects wait while frames are over budget
  const reducedRef = useRef(reduced); reducedRef.current = reduced;

  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<{ type: string; planet: string }>).detail, e = d && effectFor(d.type, d.planet);
      if (e && allowed({ reduced: reducedRef.current, hidden: document.hidden, level: Number(perfCtx.level ?? 0), frameMs: frameMs.current })) admit(pool, e, performance.now());
    };
    addEventListener(LIVING_EVENT, on);
    return () => removeEventListener(LIVING_EVENT, on);
  }, [pool]);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), mid: new THREE.Vector3(), c: new THREE.Color() }), []);
  useFrame((_, dt) => {
    frameMs.current += (Math.min(dt * 1000, 200) - frameMs.current) * 0.1;
    const now = performance.now(), { m, p, mid, c } = tmp;
    let n = 0;
    const put = (scale: number, col: THREE.Color, k: number) => {
      if (scale <= 0 || k <= 0) return;
      mesh.setMatrixAt(n, m.makeScale(scale, scale, scale).setPosition(p));
      mesh.setColorAt(n, c.copy(col).multiplyScalar(k));
      n++;
    };
    for (const s of pool) {
      const k = progress(s, now), at = positions[s.at];
      if (k < 0 || (s.at !== "core" && !at)) continue;
      const b = 0.7 + 0.3 * s.boost; // a coalesced burst plays brighter, not twice
      if (s.kind === "comet") { // head accelerates toward the CORE along an arc, a fading tail behind it
        mid.copy(at).multiplyScalar(0.5); mid.y += 1 + at.length() * 0.08;
        const head = k * k * (3 - 2 * k) * 1.08;
        for (let j = 0; j < PER; j++) {
          const t = Math.min(1, head - j * 0.02); if (t < 0) break;
          const u = 1 - t; // quadratic Bézier planet -> mid -> CORE (origin)
          p.set(u * u * at.x + 2 * u * t * mid.x, u * u * at.y + 2 * u * t * mid.y, u * u * at.z + 2 * u * t * mid.z);
          put(0.55 * (1 - j / PER), COMET, (1 - j / PER) * Math.min(1, (1 - k) * 4) * b);
        }
      } else if (s.kind === "aurora") { // a rippling ring that rises and fades around the planet
        const fade = Math.sin(Math.PI * k) * 0.7 * b;
        for (let j = 0; j < PER; j++) {
          const a = (j / PER) * Math.PI * 2, r = 1.4 + 0.3 * k;
          p.set(at.x + Math.cos(a) * r, at.y + 0.6 * k + Math.sin(a * 3 + k * 8) * 0.25, at.z + Math.sin(a) * r);
          put(0.8, AURORA[j & 1], fade);
        }
      } else if (s.kind === "flare") { // a bright core and a burst of gold sparks
        const f = (1 - k) * (1 - k) * b;
        p.copy(at); put(2.6 * (1 - k * 0.6), GOLD, f);
        for (let j = 1; j < PER; j++) { // golden-angle directions over a sphere
          const y = 1 - (2 * j) / PER, r = Math.sqrt(1 - y * y), a = j * 2.39996;
          p.set(at.x + Math.cos(a) * r * k * 2.4, at.y + y * k * 2.4, at.z + Math.sin(a) * r * k * 2.4);
          put(0.35, GOLD, f);
        }
      } else { // sunrise: a warm glow over the CORE and a dawn ring rolling out across the orbits
        const f = Math.sin(Math.PI * k) * b;
        p.set(0, 0, 0); put(28, SUN, 0.22 * f);
        for (let j = 1; j < PER; j++) {
          const a = (j / (PER - 1)) * Math.PI * 2, r = 4 + k * 48;
          p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          put(7, DAWN, 0.12 * f);
        }
      }
    }
    if (n || mesh.count) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor!.needsUpdate = true; }
    mesh.count = n; mesh.visible = n > 0;
  });
  return <primitive object={mesh} />;
}
