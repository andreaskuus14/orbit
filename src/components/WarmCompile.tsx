"use client";
// Entering a world froze the page for 130–800 ms (measured on the owner's PC): every world mounts a fresh WebGL context, so
// three compiles all its shaders inside the first render. This holds the render loop while compileAsync compiles them in
// parallel (KHR_parallel_shader_compile), so the main thread stays free; the world then starts drawing with shaders ready.
import { useEffect, useLayoutEffect, useState } from "react";
import * as THREE from "three";
import { useThree, type RootState } from "@react-three/fiber";
import { EffectComposer, type Pass } from "postprocessing";
import { envReady } from "./alien/env";
import { passesChanged, skipFrame, type WarmState } from "@/lib/warm-pure";

type Frameloop = RootState["frameloop"];
// Several warm-ups can overlap on one canvas (a part mounting late warms again): the loop resumes when the last one ends.
const holds = new WeakMap<THREE.WebGLRenderer, { n: number; prev: Frameloop }>();

// Bound only while programs are collected, never drawn into.
let scratch: THREE.WebGLRenderTarget | null = null;
/** Collects the programs `scene` needs and compiles them in parallel. Under a composer the scene is drawn into a render
 *  target, and three keys programs by output colour space: compiled for the screen, every program was compiled AGAIN,
 *  synchronously, in the first real frame (why worlds with a warm-up still froze). */
export function compileAs(gl: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, intoTarget: boolean) {
  const prev = gl.getRenderTarget();
  if (intoTarget) gl.setRenderTarget(scratch ??= new THREE.WebGLRenderTarget(1, 1));
  try { return gl.compileAsync(scene, camera); } finally { gl.setRenderTarget(prev); } // programs are collected synchronously
}

const tick = () => new Promise((r) => setTimeout(r, 0));
/** Uploads the scene's textures one per task: a big canvas texture uploaded inside the first frame stalled it. */
async function uploadTextures(gl: THREE.WebGLRenderer, scene: THREE.Object3D, alive: () => boolean) {
  const found = new Set<THREE.Texture>();
  const add = (v: unknown) => { const t = v as THREE.Texture | null; if (t?.isTexture) found.add(t); };
  scene.traverse((o) => {
    for (const m of [(o as THREE.Mesh).material ?? []].flat()) {
      Object.values(m).forEach(add);
      Object.values((m as THREE.ShaderMaterial).uniforms ?? {}).forEach((u) => add(u?.value));
    }
  });
  for (const t of found) {
    const img = t.image as { complete?: boolean } | null | undefined;
    if (t.version === 0 || !img || img.complete === false || (t as THREE.VideoTexture).isVideoTexture || t.isRenderTargetTexture) continue;
    await tick();
    if (!alive()) return;
    gl.initTexture(t);
  }
}

export function WarmCompile() {
  const { gl, scene, camera, setFrameloop, frameloop, get } = useThree();
  useLayoutEffect(() => {
    let alive = true, released = false;
    const h = holds.get(gl) ?? { n: 0, prev: frameloop };
    if (h.n++ === 0) h.prev = frameloop;
    holds.set(gl, h);
    setFrameloop("never");
    const release = () => { if (released) return; released = true; if (--h.n === 0) setFrameloop(h.prev); };
    // one tick later: the world's children have mounted into the scene (and a composer, if any, has taken over drawing)
    const t = setTimeout(async () => {
      // The reflection map bakes asynchronously; surfaces that use it switch programs when it lands. Wait for it, then for
      // them to apply it (a store update re-renders them synchronously), so those programs are the ones compiled here.
      const env = envReady(gl);
      if (env) { await env; await tick(); await tick(); }
      if (!alive) return;
      // Hidden parts (LOD layers, micro-worlds, orbitals) would otherwise compile synchronously the moment they first
      // show, freezing a planet switch: make them visible for the compile only (nothing draws: the loop is held).
      const hidden: { visible: boolean }[] = [];
      scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      // compileAsync collects programs synchronously on call, so the hidden parts are restored at once. Restoring them
      // later re-hid anything the app had made visible meanwhile (the INTELLIGENCE globe stayed invisible).
      // internal.priority > 0: a useFrame with priority took over drawing; here that is always the EffectComposer.
      const p = compileAs(gl, scene, camera, get().internal.priority > 0);
      hidden.forEach((o) => { o.visible = false; });
      p.then(() => uploadTextures(gl, scene, () => alive)).catch(() => {}).finally(() => { if (alive) release(); });
      // A slow driver must not hold the canvas blank: after 4 s draw anyway (anything unfinished compiles in that frame).
      setTimeout(() => { if (alive) release(); }, 4000);
    }, 0);
    return () => { alive = false; clearTimeout(t); release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);
  return null;
}

/* Post-processing compiles its own fullscreen shaders (bloom, SMAA, tone mapping…) in the first composer.render, outside
   any scene: synchronously, 100+ ms on the owner's PC. The composer now compiles them in parallel first, and skips its
   frames meanwhile (the canvas keeps its last image), again whenever its passes change. */
const warm = new WeakMap<EffectComposer, WarmState<Pass>>();

function collect(o: unknown, mats: Set<THREE.Material>, rts: Set<THREE.WebGLRenderTarget>, seen: WeakSet<object>, depth: number) {
  if (!o || typeof o !== "object" || depth > 8 || seen.has(o)) return;
  seen.add(o);
  const x = o as Record<string, unknown> & { isMaterial?: boolean; isWebGLRenderTarget?: boolean; isMesh?: boolean; isObject3D?: boolean; isTexture?: boolean; isBufferGeometry?: boolean; isWebGLRenderer?: boolean };
  if (x.isMaterial) { mats.add(o as THREE.Material); return; }
  if (x.isWebGLRenderTarget) { rts.add(o as THREE.WebGLRenderTarget); return; }
  if (x.isMesh) { collect(x.material, mats, rts, seen, depth + 1); return; } // a pass's fullscreen quad
  if (x.isObject3D || x.isTexture || x.isBufferGeometry || x.isWebGLRenderer) return; // never the world's scene or the renderer
  for (const v of Object.values(x)) collect(v, mats, rts, seen, depth + 1);
}

let plane: THREE.PlaneGeometry | null = null; // programs don't depend on the quad's shape
function warmComposer(c: EffectComposer) {
  const gl = c.getRenderer();
  const mats = new Set<THREE.Material>(), rts = new Set<THREE.WebGLRenderTarget>();
  collect(c, mats, rts, new WeakSet(), 0); // passes, their effects and the effects' own passes (luminance, blur, SMAA edges…)
  rts.forEach((rt) => gl.initRenderTarget(rt));
  const cam = new THREE.OrthographicCamera();
  const quad = (m: THREE.Material | THREE.Material[]) => new THREE.Scene().add(new THREE.Mesh(plane ??= new THREE.PlaneGeometry(2, 2), m));
  const toScreen = [...c.passes].reverse().find((p) => p.enabled && p.renderToScreen)?.fullscreenMaterial;
  // Passes draw into render targets; only the last one draws to the screen (a different program variant, see compileAs).
  const jobs = [compileAs(gl, quad([...mats]), cam, true)];
  if (toScreen) jobs.push(compileAs(gl, quad(toScreen), cam, false));
  return Promise.all(jobs);
}

const proto = EffectComposer.prototype as EffectComposer & { __warm?: boolean };
if (!proto.__warm) {
  proto.__warm = true;
  const render = proto.render;
  proto.render = function (this: EffectComposer, dt?: number) {
    const passes = this.passes;
    let w = warm.get(this);
    if (passesChanged(w, passes)) {
      const next: WarmState<Pass> = { passes: [...passes], ready: false, until: performance.now() + 2000 };
      warm.set(this, (w = next));
      Promise.resolve(this).then(warmComposer).catch(() => {}).finally(() => { next.ready = true; }); // a throw must not break the frame loop
    }
    if (skipFrame(w!, performance.now())) return; // still compiling: skip, rather than compile synchronously
    render.call(this, dt);
  };
}

/** False for the first painted frame, then true: mounts a <Canvas> (WebGL context, scene, composer) in its own task
 *  after the world's DOM has painted, instead of in the same long task. */
export function useMountLater() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let t = 0;
    const r = requestAnimationFrame(() => { t = window.setTimeout(() => setOn(true), 0); });
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, []);
  return on;
}
