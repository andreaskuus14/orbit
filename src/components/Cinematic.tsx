"use client";
// The galaxy's cinematic layer: damped wheel zoom + idle drift, drifting dust, planet rim light,
// motion-scaled chromatic aberration and the monospace HUD (corner readout + exploded-view leader label).
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ChromaticAberration } from "@react-three/postprocessing";
import type { ChromaticAberrationEffect } from "postprocessing";
import * as THREE from "three";
import { PLANETS, type PanelId, type PlanetId } from "@/lib/planets";
import { aberrationFor, damp, idleDrift, stepZoom, wheelKick } from "@/lib/cinematic-pure";
import { useScramble } from "./useScramble";

export type Motion = { speed: number }; // camera speed, fraction of the orbit distance per second (smoothed)
export const RIM_COLOR = "#8fd3ff"; // the one cold accent

type Controls = THREE.EventDispatcher<{ start: object; end: object }> & {
  target: THREE.Vector3; minDistance: number; maxDistance: number; autoRotate: boolean; autoRotateSpeed: number;
};

/** Wheel zoom with inertia that eases to rest, an idle drift on the home view, and a camera-speed meter.
 *  Wheel input still fires the controls' "start" event, so Rig flights and ZoomRig goals stop exactly as before. */
export function CameraFeel({ motion, reduced, home }: { motion: RefObject<Motion>; reduced: boolean; home: boolean }) {
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const connected = useThree((s) => s.events.connected) as HTMLElement | undefined;
  const st = useRef({ vel: 0, last: new THREE.Vector3(), primed: false, input: 0 });
  const off = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => { st.current.input = performance.now(); st.current.vel = 0; }, [home]); // a flight is not "idle", and leftover wheel inertia must not fight it
  useEffect(() => {
    const el = connected ?? gl.domElement; // the element drei's OrbitControls listens on
    const touch = () => { st.current.input = performance.now(); if (controls) controls.autoRotate = false; };
    const wheel = (e: WheelEvent) => {
      touch();
      if (reduced || !controls) return; // reduced motion: OrbitControls' own instant zoom
      e.preventDefault();
      e.stopImmediatePropagation(); // capture phase: OrbitControls never sees it
      controls.dispatchEvent({ type: "start" });
      st.current.vel += wheelKick(e.deltaY, e.deltaMode);
      controls.dispatchEvent({ type: "end" });
    };
    el.addEventListener("wheel", wheel, { capture: true, passive: false });
    el.addEventListener("pointerdown", touch, { capture: true });
    addEventListener("keydown", touch);
    return () => {
      el.removeEventListener("wheel", wheel, { capture: true });
      el.removeEventListener("pointerdown", touch, { capture: true });
      removeEventListener("keydown", touch);
    };
  }, [connected, gl, controls, reduced]);

  useFrame((_, dt) => {
    if (!controls) return;
    const s = st.current;
    if (s.vel !== 0) {
      off.copy(camera.position).sub(controls.target);
      const d = off.length();
      const z = stepZoom(d, s.vel, dt, controls.minDistance, controls.maxDistance);
      s.vel = z.vel;
      if (d > 1e-6) camera.position.copy(controls.target).addScaledVector(off, z.dist / d);
    }
    const drift = home && !reduced ? idleDrift((performance.now() - s.input) / 1000) : 0;
    controls.autoRotate = drift > 0;
    controls.autoRotateSpeed = drift;
    // Speed meter for the aberration (and anything else that wants to react to motion).
    const dist = Math.max(1, camera.position.distanceTo(controls.target));
    const raw = s.primed && dt > 0 ? camera.position.distanceTo(s.last) / dt / dist : 0;
    s.last.copy(camera.position); s.primed = true;
    if (motion.current) motion.current.speed = damp(motion.current.speed, Number.isFinite(raw) ? raw : 0, 10, dt);
  });
  return null;
}

/** Chromatic aberration at the screen edges that follows the camera's speed: zero at rest. */
export function MotionAberration({ motion }: { motion: RefObject<Motion> }) {
  const ref = useRef<ChromaticAberrationEffect>(null);
  const offset = useMemo(() => new THREE.Vector2(), []);
  useFrame(() => {
    const a = aberrationFor(motion.current?.speed ?? 0);
    ref.current?.offset.set(a, a * 0.6);
  });
  return <ChromaticAberration ref={ref} offset={offset} radialModulation modulationOffset={0.25} />;
}

/** Fine dust drifting through the system: one draw call, all motion on the GPU, alpha clamped >= 0 (bloom-safe). */
export function Dust({ count, reduced }: { count: number; reduced: boolean }) {
  const geo = useMemo(() => {
    let seed = 1337;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pos = new Float32Array(count * 3), size = new Float32Array(count), ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = 4 + Math.sqrt(r()) * 56; // a disc around the system, denser inside
      pos.set([Math.cos(a) * d, (r() - 0.5) * 14 * (0.4 + d / 60), Math.sin(a) * d], i * 3);
      size[i] = 1.2 + r() * 2.6; ph[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
    return g;
  }, [count]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 9 }, uColor: { value: new THREE.Color(RIM_COLOR) } },
    vertexShader: `attribute float aSize; attribute float aPh; uniform float uTime; uniform float uScale; varying float vA;
      void main(){ vec3 p = position;
        p += vec3(sin(uTime * 0.05 + aPh * 40.0), sin(uTime * 0.07 + aPh * 23.0) * 0.4, cos(uTime * 0.045 + aPh * 31.0)) * 1.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); float z = -mv.z;
        vA = smoothstep(1.5, 7.0, z) * (1.0 - smoothstep(55.0, 110.0, z)) * (0.55 + 0.45 * sin(uTime * 0.6 + aPh * 60.0));
        vA = max(vA, 0.0);
        gl_PointSize = aSize * uScale / max(z, 0.1); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d);
        gl_FragColor = vec4(uColor, max(a * a * vA * 0.35, 0.0)); }`,
  }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock, gl }) => {
    mat.uniforms.uTime.value = reduced ? 0 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 9;
  });
  return count > 0 ? <points geometry={geo} material={mat} /> : null;
}

/** Fresnel rim light injected into a MeshStandardMaterial (textures, bump and lighting untouched).
 *  Returns the uniform to animate (hover) and the hook to pass as onBeforeCompile. */
export function useRim() {
  return useMemo(() => {
    const u = { uRim: { value: 0.22 }, uRimColor: { value: new THREE.Color(RIM_COLOR) } };
    const onBeforeCompile = (s: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(s.uniforms, u);
      s.fragmentShader = s.fragmentShader
        .replace("void main() {", "uniform float uRim;\nuniform vec3 uRimColor;\nvoid main() {")
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>
          float rimF = 1.0 - clamp(abs(dot(normalize(nonPerturbedNormal), normalize(vViewPosition))), 0.0, 1.0);
          gl_FragColor.rgb += uRimColor * (rimF * rimF * rimF * max(uRim, 0.0));`);
    };
    return { u, onBeforeCompile };
  }, []);
}

/** Dev-only: logs the scene's draw calls / triangles every 5 s (gl.info summed over every pass of a frame). */
export function DevStats() {
  const gl = useThree((s) => s.gl);
  const t = useRef(0);
  useEffect(() => { gl.info.autoReset = false; return () => { gl.info.autoReset = true; }; }, [gl]);
  useFrame((_, dt) => {
    if ((t.current += dt) > 5) {
      t.current = 0;
      console.debug(`[galaxy] draw calls ${gl.info.render.calls} · triangles ${gl.info.render.triangles} · geometries ${gl.info.memory.geometries} · textures ${gl.info.memory.textures} · dpr ${gl.getPixelRatio()}`);
    }
    gl.info.reset(); // runs before the frame renders (priority 0 < the composer's 1): counts exactly one frame
  });
  return null;
}

export type HudEls = { leader: HTMLDivElement | null; coord: HTMLSpanElement | null };
const pad = (n: number) => String(n).padStart(2, "0");

/** Monospace HUD over the galaxy: a corner readout and the numbered leader label of the hovered planet.
 *  Positions/coordinates are written by the projector inside the canvas; this only owns text and the reveal. */
export function GalaxyHud({ selected, hoverSet, els }: {
  selected: PanelId | null; hoverSet: RefObject<(id: PlanetId, on: boolean) => void>; els: RefObject<HudEls>;
}) {
  const [hover, setHover] = useState<PlanetId | null>(null);
  useEffect(() => { hoverSet.current = (id, on) => setHover((h) => (on ? id : h === id ? null : h)); }, [hoverSet]);
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => { const d = new Date(); setClock(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  const focusId = hover ?? (selected && selected !== "core" && selected !== "profile" ? selected : null);
  const fi = focusId ? PLANETS.findIndex((p) => p.id === focusId) : -1;
  const title = useScramble("// ORBIT OS · SOL-01", 900);
  const focus = useScramble(fi >= 0 ? `FOCUS ${pad(fi + 1)} ${PLANETS[fi].name}` : selected === "core" ? "FOCUS 00 CORE" : "FOCUS -- SYSTEM");
  const hi = hover ? PLANETS.findIndex((p) => p.id === hover) : -1;
  const label = useScramble(hi >= 0 ? PLANETS[hi].name : "", 420);
  return (
    <>
      <div className="galaxy-hud" aria-hidden>
        <div><b>{title}</b></div>
        <div>LOCAL {clock}</div>
        <div>{focus}</div>
        <div><span ref={(el) => { els.current.coord = el; }} /></div>
      </div>
      <div className={`hud-leader${hi >= 0 ? " on" : ""}`} ref={(el) => { els.current.leader = el; }} aria-hidden>
        {hi >= 0 && (
          <div key={hover}>{/* keyed: the leader line redraws for each planet */}
            <svg width="1" height="1"><circle r="2" /><polyline points="0,0 34,-34 74,-34" /></svg>
            <span className="hud-leader-text"><b>{pad(hi + 1)}</b>{label}<small>ORBIT R {PLANETS[hi].radius.toFixed(2)}</small></span>
          </div>
        )}
      </div>
    </>
  );
}
