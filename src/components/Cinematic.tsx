"use client";
// The galaxy's cinematic layer: damped wheel zoom + idle drift, drifting dust, planet rim light,
// motion-scaled chromatic aberration and the monospace HUD (corner readout + exploded-view leader label).
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ChromaticAberration, DepthOfField } from "@react-three/postprocessing";
import type { ChromaticAberrationEffect, DepthOfFieldEffect } from "postprocessing";
import * as THREE from "three";
import { PLANETS, type PanelId, type PlanetDef, type PlanetId } from "@/lib/planets";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import {
  aberrationFor, damp, fmtCoord, framePose, HOME_POS, idleDrift, INTRO_SECS, introPose, smoothDamp, stepStop, stepZoom, wheelGate, wheelKick, wheelStep,
} from "@/lib/cinematic-pure";
import { expDamp } from "@/lib/smooth-damp-pure";
import { useScramble } from "./useScramble";
import { AlienScript } from "./AlienScript";
import { codeOf } from "@/lib/alien-script-pure";
import { MaskText } from "./MaskText";
import { preloading } from "./GalaxyLoader";

export type Motion = { speed: number }; // camera speed, fraction of the orbit distance per second (smoothed)
export const RIM_COLOR = "#8fd3ff"; // the one cold accent

type Controls = THREE.EventDispatcher<{ start: object; end: object }> & {
  target: THREE.Vector3; minDistance: number; maxDistance: number; autoRotate: boolean; autoRotateSpeed: number;
};

/** Wheel zoom with inertia that eases to rest, an idle drift on the home view, and a camera-speed meter.
 *  Wheel input still fires the controls' "start" event, so Rig flights and ZoomRig goals stop exactly as before. */
export function CameraFeel({ motion, reduced, home, story }: { motion: RefObject<Motion>; reduced: boolean; home: boolean; story: RefObject<Story> }) {
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
      if (story.current.wheel?.(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; } // the scroll journey took it
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
  }, [connected, gl, controls, reduced, story]);

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
    const drift = home && !reduced && !story.current.owns ? idleDrift((performance.now() - s.input) / 1000) : 0;
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
export function Dust({ count, reduced, feel }: { count: number; reduced: boolean; feel?: RefObject<Feel> }) {
  const geo = useMemo(() => {
    let seed = 1337;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pos = new Float32Array(count * 3), size = new Float32Array(count), ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // in three loose spiral streams (the arms drift on, so they only rhyme): dust gathers in lanes, not as confetti
      const d = 4 + Math.sqrt(r()) * 56, arm = Math.floor(r() * 3), g = (r() + r() + r() - 1.5) * 0.5;
      const a = (arm * Math.PI * 2) / 3 + 1.75 * Math.log(d / 3) + g;
      pos.set([Math.cos(a) * d, (r() - 0.5) * 14 * (0.4 + d / 60), Math.sin(a) * d], i * 3);
      size[i] = 0.8 + r() * r() * 1.6; ph[i] = r(); // mostly fine motes, a few larger
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
    uniforms: { uTime: { value: 0 }, uScale: { value: 9 }, uColor: { value: new THREE.Color("#c9d4ee") }, // pearl, a breath of blue
      uRayO: { value: new THREE.Vector3() }, uRayD: { value: new THREE.Vector3(0, 0, -1) }, uPush: { value: 0 } },
    // The pointer parts the dust: motes near the (smoothed) pointer ray slide out sideways, inside a cone that is the
    // same size on screen at any depth. Points have no model transform, so position is world space.
    vertexShader: `attribute float aSize; attribute float aPh; uniform float uTime; uniform float uScale; uniform vec3 uRayO; uniform vec3 uRayD; uniform float uPush; varying float vA;
      void main(){ vec3 p = position;
        p += vec3(sin(uTime * 0.03 + aPh * 40.0), sin(uTime * 0.04 + aPh * 23.0) * 0.4, cos(uTime * 0.025 + aPh * 31.0)) * 1.2;
        vec3 q = p - uRayO; float t = max(dot(q, uRayD), 0.0); vec3 side = q - t * uRayD; float l = length(side);
        float R = max(0.075 * t, 0.01), f = 1.0 - smoothstep(0.0, R, l);
        p += side / max(l, 1e-3) * (uPush * f * f * R * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); float z = -mv.z;
        vA = smoothstep(2.0, 9.0, z) * (1.0 - smoothstep(45.0, 90.0, z)) * (0.8 + 0.2 * sin(uTime * 0.2 + aPh * 60.0));
        float px = aSize * uScale / max(z, 0.1);
        vA = max(vA, 0.0) * (px < 1.5 ? (px / 1.5) * (px / 1.5) : 1.0); // never sub-pixel: fade by coverage instead
        gl_PointSize = clamp(px, 1.5, 6.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.0, 0.5, d);
        gl_FragColor = vec4(uColor, clamp(a * a * vA * 0.22, 0.0, 1.0)); }`,
  }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock, gl }) => {
    const u = mat.uniforms, f = feel?.current;
    u.uTime.value = reduced ? 0 : clock.elapsedTime;
    u.uScale.value = gl.getPixelRatio() * 9;
    u.uPush.value = f && !reduced ? f.on : 0;
    if (f && f.on > 0) { u.uRayO.value.copy(f.origin); u.uRayD.value.copy(f.dir); }
  });
  return count > 0 ? <points geometry={geo} material={mat} /> : null;
}

/** The pointer as the galaxy feels it: NDC eased with inertia (x, y), presence 0..1 (on) and the world ray through the
 *  eased point (origin, dir). Mouse/pen only: touch never drives it. Written once per frame; dust, worlds and camera read it. */
export type Feel = { x: number; y: number; on: number; origin: THREE.Vector3; dir: THREE.Vector3 };
export const newFeel = (): Feel => ({ x: 0, y: 0, on: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) });

export function PointerFeel({ feel, enabled }: { feel: RefObject<Feel>; enabled: boolean }) {
  const camera = useThree((s) => s.camera);
  const st = useRef({ x: 0, y: 0, inside: false });
  useEffect(() => {
    if (!enabled) return;
    const s = st.current;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      s.x = (e.clientX / innerWidth) * 2 - 1; s.y = 1 - (e.clientY / innerHeight) * 2; s.inside = true;
    };
    const leave = (e: PointerEvent) => { if (!e.relatedTarget) s.inside = false; };
    const blur = () => { s.inside = false; };
    addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerout", leave);
    addEventListener("blur", blur);
    return () => { removeEventListener("pointermove", move); document.removeEventListener("pointerout", leave); removeEventListener("blur", blur); s.inside = false; };
  }, [enabled]);
  useFrame((_, dt) => {
    const f = feel.current, s = st.current, live = enabled && s.inside;
    f.x = expDamp(f.x, live ? s.x : 0, 0.3, dt);
    f.y = expDamp(f.y, live ? s.y : 0, 0.3, dt);
    f.on = expDamp(f.on, live ? 1 : 0, 0.45, dt);
    if (f.on < 1e-3) { f.on = 0; return; }
    f.origin.copy(camera.position);
    f.dir.set(f.x, f.y, 0.5).unproject(camera).sub(camera.position);
    const l = f.dir.length();
    if (Number.isFinite(l) && l > 1e-6) f.dir.multiplyScalar(1 / l); else f.dir.set(0, 0, -1);
  });
  return null;
}

/** A small camera parallax toward the pointer. The offset is a pure translation in the camera's own plane, added after
 *  every rig has placed the camera and taken off again before OrbitControls runs (priority -2), so no rig ever sees it
 *  and it can't accumulate. Mount it after the rigs: the same priority runs in mount order. */
export function Parallax({ feel, on }: { feel: RefObject<Feel>; on: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const applied = useMemo(() => new THREE.Vector3(), []);
  const axis = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => { camera.position.sub(applied); applied.set(0, 0, 0); }, -2);
  useFrame(() => {
    const f = feel.current;
    if (!on || f.on <= 0) return;
    const k = 0.012 * f.on * (controls ? camera.position.distanceTo(controls.target) : camera.position.length());
    applied.copy(axis.setFromMatrixColumn(camera.matrixWorld, 0)).multiplyScalar(f.x * k);
    applied.addScaledVector(axis.setFromMatrixColumn(camera.matrixWorld, 1), f.y * k);
    if (Number.isFinite(applied.x + applied.y + applied.z)) camera.position.add(applied); else applied.set(0, 0, 0);
  });
  useEffect(() => () => { camera.position.sub(applied); applied.set(0, 0, 0); }, [camera, applied]);
  return null;
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
export function GalaxyHud({ selected, hoverSet, els, introMs = 900 }: {
  selected: PanelId | null; hoverSet: RefObject<(id: PlanetId, on: boolean) => void>; els: RefObject<HudEls>; introMs?: number;
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
  const title = useScramble("// ORBIT OS · SOL-01", introMs);
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

/* ---------- the camera story: intro flight, scroll journey, focus (DOF), section readout and rail ---------- */

/** Shared between the canvas (StoryRig writes, labels/DOF read) and the DOM HUD. Mutated per frame, never re-rendered. */
export type Story = {
  owns: boolean;     // the story is driving the camera (Rig / idle drift stand aside)
  intro: number;     // intro progress 0..1 (1 = done / none)
  stop: number;      // -1 overview, else index into PLANETS
  dof: number;       // 0..1 how much depth of field to apply
  focus: THREE.Vector3; focusSize: number;
  wheel: ((e: WheelEvent) => boolean) | null; // returns true when it consumed the wheel event
  goTo: (n: number) => void;
};
export const newStory = (intro: boolean): Story => ({
  owns: intro, intro: intro ? 0 : 1, stop: -1, dof: 0, focus: new THREE.Vector3(), focusSize: 1, wheel: null, goTo: () => {},
});

/** The current journey stop's planet, written by StoryRig every journey frame: client px (x, y) and world x / z.
 *  Module state (like GalaxyLoader's preloading) so the readout's particles can leave from the planet. */
export const storyMark = { stop: -1, ok: false, x: 0, y: 0, wx: 0, wz: 0 };

type Mode = "intro" | "journey" | "settle" | "idle";
type StoryControls = Controls & { update: () => void };
const GLIDE = 0.32; // smoothDamp time: ~1.1 s between stops, frame-rate independent

/** Drives the camera for the intro flight and the scroll journey; hands back to OrbitControls/Rig when idle. */
export function StoryRig({ story, positions, sizes, selected, intro, onIntroEnd, onStop }: {
  story: RefObject<Story>; positions: Record<string, THREE.Vector3>; sizes: Record<string, number>; selected: PanelId | null;
  intro: boolean; onIntroEnd: () => void; onStop: (n: number) => void;
}) {
  const controls = useThree((s) => s.controls) as unknown as StoryControls | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const st = useRef({ alignAt: 0, alignY: 0, rect: { l: 0, t: 0, w: 0, h: 0 }, proj: new THREE.Vector3(), mode: (intro ? "intro" : "idle") as Mode, t: 0, stop: -1, home: selected === null,
    pose: new Float64Array(6), vel: new Float64Array(6), gate: wheelGate() });
  useEffect(() => { st.current.home = selected === null; }, [selected]);

  const endIntro = useCallback((next: Mode) => {
    const s = st.current;
    if (s.mode !== "intro") return;
    s.mode = next; story.current.intro = 1; onIntroEnd();
  }, [story, onIntroEnd]);
  const setStop = useCallback((n: number) => {
    const s = st.current;
    if (n === s.stop) return;
    s.stop = n; story.current.stop = n; onStop(n);
  }, [story, onStop]);
  const go = useCallback((n: number) => {
    const s = st.current;
    if (!s.home) return;
    endIntro("settle");
    n = stepStop(n, 0, PLANETS.length);
    s.mode = n >= 0 ? "journey" : "settle"; // back to the overview: glide home (also after a drag left the camera elsewhere)
    setStop(n);
  }, [endIntro, setStop]);
  const release = useCallback(() => { // the user grabbed the camera (drag, pinch/ctrl zoom, voice zoom): it's theirs
    const s = st.current;
    endIntro("idle");
    s.mode = "idle"; s.vel.fill(0); setStop(-1);
  }, [endIntro, setStop]);

  useEffect(() => { if (selected !== null) release(); }, [selected, release]); // opening a planet: Rig flies

  useEffect(() => {
    const S = story.current;
    S.goTo = go;
    S.wheel = (e) => {
      const s = st.current;
      if (!s.home || e.ctrlKey || e.shiftKey || e.metaKey) return false; // modifier / pinch: the old zoom
      if (s.mode === "intro") { endIntro("settle"); return true; }
      const d = wheelStep(s.gate, e.deltaY, e.deltaMode, performance.now());
      if (d) go(stepStop(s.stop, d, PLANETS.length));
      return true;
    };
    const skip = (e: Event) => { // any key / pointer skips the intro (a drag then releases it via "start")
      const k = e as KeyboardEvent, el = e.target as HTMLElement | null;
      // ← / → on the galaxy travel like the wheel (title card and all); preventDefault tells Orbit's handler not to open a panel.
      if ((k.key === "ArrowRight" || k.key === "ArrowLeft") && st.current.home && !k.altKey && !k.ctrlKey && !k.metaKey
        && !(el && (/^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(el.tagName) || el.isContentEditable)) && !document.querySelector("dialog[open], :popover-open")) {
        k.preventDefault();
        go(stepStop(st.current.stop, k.key === "ArrowRight" ? 1 : -1, PLANETS.length));
        return;
      }
      endIntro("settle");
    };
    const nav = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.zoom) release(); };
    addEventListener("keydown", skip, true);
    addEventListener("pointerdown", skip, true);
    addEventListener(NAV_EVENT, nav);
    const c = controls as unknown as THREE.EventDispatcher<{ start: object }> | null;
    c?.addEventListener("start", release);
    return () => {
      S.wheel = null; S.goTo = () => {};
      removeEventListener("keydown", skip, true);
      removeEventListener("pointerdown", skip, true);
      removeEventListener(NAV_EVENT, nav);
      c?.removeEventListener("start", release);
    };
  }, [story, controls, go, endIntro, release]);

  useFrame(({ gl }, dt) => {
    const s = st.current, S = story.current, P = s.pose, V = s.vel;
    S.owns = s.mode !== "idle" && s.home;
    // FOV: tele while travelling, narrower still on an opened planet (the dolly-in), back to 50 at home.
    const fovGoal = selected && selected !== "core" && selected !== "profile" ? 38 : s.mode === "journey" ? 44 : 50;
    const fov = damp(camera.fov, fovGoal, 3, dt);
    if (Math.abs(fov - camera.fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
    // Focus for the depth of field: the current stop, else the opened planet.
    const fid = s.mode === "journey" && s.stop >= 0 ? PLANETS[s.stop].id : selected && selected !== "core" && selected !== "profile" ? selected : null;
    if (fid) { S.focus.copy(positions[fid]); S.focusSize = sizes[fid] ?? 1; }
    S.dof = fid ? 1 : 0;
    if (!controls || !S.owns) return;
    const cam = camera.position, tgt = controls.target;
    if (s.mode === "intro") {
      const step = preloading() ? 0 : Math.min(Math.max(0, dt), 0.05); // a compile hitch must not eat the flight; the first-load counter holds it at the start
      s.t = Math.min(1, s.t + step / INTRO_SECS);
      S.intro = s.t;
      introPose(s.t, P);
      if (step > 0) { // track velocity so a skip glides on instead of stopping dead
        V[0] = (P[0] - cam.x) / step; V[1] = (P[1] - cam.y) / step; V[2] = (P[2] - cam.z) / step;
        V[3] = (P[3] - tgt.x) / step; V[4] = (P[4] - tgt.y) / step; V[5] = (P[5] - tgt.z) / step;
      }
      cam.set(P[0], P[1], P[2]); tgt.set(P[3], P[4], P[5]);
      if (s.t >= 1) { V.fill(0); endIntro("idle"); }
    } else {
      if (s.mode === "journey") {
        const id = PLANETS[s.stop].id, p = positions[id];
        // Line the planet up with its title (StoryReadout's .story-name); re-measured 4×/s, not every frame (layout read).
        const now = performance.now();
        if (now - s.alignAt > 250) {
          s.alignAt = now;
          const el = document.querySelector(".story-name"), c = gl.domElement.getBoundingClientRect();
          if (el && c.height) { const r = el.getBoundingClientRect(); s.alignY = 1 - (2 * (r.top + r.height / 2 - c.top)) / c.height; }
          s.rect.l = c.left; s.rect.t = c.top; s.rect.w = c.width; s.rect.h = c.height;
        }
        const v = s.proj.copy(p).project(camera);
        storyMark.stop = s.stop; storyMark.wx = p.x; storyMark.wz = p.z; storyMark.ok = v.z < 1 && s.rect.w > 0; // ok: in front of the camera
        if (storyMark.ok) { storyMark.x = s.rect.l + ((v.x + 1) / 2) * s.rect.w; storyMark.y = s.rect.t + ((1 - v.y) / 2) * s.rect.h; }
        framePose(p.x, p.z, sizes[id] ?? 1, camera.aspect, camera.fov, P, s.alignY);
        P[1] += Math.min(6, 0.22 * Math.hypot(cam.x - P[0], cam.z - P[2])); // lift on long hops: an arc over the system
      } else { P[0] = HOME_POS[0]; P[1] = HOME_POS[1]; P[2] = HOME_POS[2]; P[3] = 0; P[4] = 0; P[5] = 0; }
      cam.set(smoothDamp(cam.x, P[0], V, 0, GLIDE, dt), smoothDamp(cam.y, P[1], V, 1, GLIDE, dt), smoothDamp(cam.z, P[2], V, 2, GLIDE, dt));
      tgt.set(smoothDamp(tgt.x, P[3], V, 3, GLIDE, dt), smoothDamp(tgt.y, P[4], V, 4, GLIDE, dt), smoothDamp(tgt.z, P[5], V, 5, GLIDE, dt));
      if (s.mode === "settle" && Math.hypot(cam.x - P[0], cam.y - P[1], cam.z - P[2]) + Math.hypot(tgt.x, tgt.y, tgt.z) < 0.03) {
        cam.set(P[0], P[1], P[2]); tgt.set(0, 0, 0); V.fill(0); s.mode = "idle";
      }
    }
    controls.update();
  });
  return null;
}

const ORIGIN: [number, number, number] = [0, 0, 0];
/** Depth of field on the story's focus (top quality level only): bokeh eases in at a stop / opened planet, off at home. */
export function StoryFocus({ story }: { story: RefObject<Story> }) {
  const ref = useRef<DepthOfFieldEffect>(null);
  useFrame((_, dt) => {
    const e = ref.current, S = story.current;
    if (!e) return;
    e.target?.copy(S.focus);
    e.bokehScale = damp(e.bokehScale, S.dof * 3, 3, dt);
    e.cocMaterial.focusRange = S.focusSize * 4 + 2; // the planet and its moons/ring stay sharp, the system behind goes soft
  });
  return <DepthOfField ref={ref} target={ORIGIN} focusRange={6} bokehScale={0} />;
}

/** The decode's unlocked letters, drawn as alien-script logograms over their (transparent) real letters: the same
 *  scramble and timing (useScramble), only its random glyphs come from the script. The line never changes width. */
function ScriptDecode({ text, out }: { text: string; out: string }) {
  if (out === text) return <>{text}</>;
  return <>{Array.from(text, (c, i) => (out[i] === c ? c : <span key={i} className="script-dc">{c}<AlienScript codes={[codeOf(out[i] ?? c)]} r={4} stroke={1.3} /></span>))}</>;
}

/** igloo-style section readout, bottom left: "03 / 11", the planet's name large, one line on what it does. Above the
 *  name, its alien-script line draws in first; then the name decodes out of the script. */
export function StoryReadout({ stop, intro, onOpen }: { stop: number; intro: boolean; onOpen: (id: PanelId) => void }) {
  const live = stop >= 0 ? stop : intro ? -2 : null; // -2 = the intro card
  const [shown, setShown] = useState<number>(intro ? -2 : -1);
  useEffect(() => { if (live !== null) setShown(live); }, [live]); // keep the last card while it fades out
  const p = shown >= 0 ? PLANETS[shown] : null;
  const name = useScramble(p ? p.name : shown === -2 ? "ORBITAL" : "", shown === -2 ? 2600 : 650);
  if (shown === -1) return <div className="story-readout" />;
  return (
    <div className={`story-readout${live !== null ? " on" : ""}`} aria-hidden={live === null || undefined}>
      <div key={p?.id ?? "intro"} className="story-anim">
        <div className="story-idx" aria-hidden><b>{pad(p ? shown + 1 : 0)}</b> / {pad(PLANETS.length)}</div>
        <AlienScript text={p ? p.name : "ORBITAL"} r={4} stroke={1.1} className="story-script" />
        {p ? <button type="button" className="story-name" onClick={() => onOpen(p.id)} aria-label={`Open ${p.name}`} tabIndex={live !== null ? 0 : -1}><ScriptDecode text={p.name} out={name} /></button>
          : <div className="story-name" aria-hidden><ScriptDecode text="ORBITAL" out={name} /></div>}
        <p className="story-line">{p ? p.blurb : "Your mind has a universe."}</p>
        <p className="story-hint" aria-hidden>{p ? "CLICK OR ENTER TO OPEN · SCROLL TO TRAVEL" : "SCROLL TO EXPLORE"}</p>
      </div>
    </div>
  );
}

/** Slim progress rail on the right edge: one dot per stop (plus the overview); click glides there. */
export function StoryRail({ stop, on, onGo }: { stop: number; on: boolean; onGo: (n: number) => void }) {
  return (
    <nav className={`story-rail${on ? " on" : ""}`} aria-label="Planet journey" aria-hidden={!on || undefined}>
      <button type="button" className="story-rail-home" aria-label="Overview" title="Overview" aria-current={stop === -1 ? "step" : undefined} onClick={() => onGo(-1)} tabIndex={on ? 0 : -1} />
      {PLANETS.map((p, i) => (
        <button type="button" key={p.id} aria-label={`Fly to ${p.name}`} title={p.name} aria-current={stop === i ? "step" : undefined} onClick={() => onGo(i)} tabIndex={on ? 0 : -1} />
      ))}
    </nav>
  );
}
