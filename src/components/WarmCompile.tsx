"use client";
// Entering a world froze the page for 130–800 ms (measured on the owner's PC): every world mounts a fresh WebGL context, so
// three compiles all its shaders inside the first render. This holds the render loop while compileAsync compiles them in
// parallel (KHR_parallel_shader_compile), so the main thread stays free; the world then starts drawing with shaders ready.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useThree, type RootState } from "@react-three/fiber";
import { EffectComposer, type Pass } from "postprocessing";
import { envReady } from "./alien/env";
import { perfMark } from "./PerfBeacon";
import { passesChanged, programLabel, skipFrame, slowest, type WarmState } from "@/lib/warm-pure";

type Frameloop = RootState["frameloop"];
// Several warm-ups can overlap on one canvas (a part mounting late warms again): the loop resumes when the last one ends.
const holds = new WeakMap<THREE.WebGLRenderer, { n: number; prev: Frameloop }>();

// Bound only while programs are collected, never drawn into.
let scratch: THREE.WebGLRenderTarget | null = null;
/** Collects the programs `scene` needs and compiles them in parallel. Under a composer the scene is drawn into a render
 *  target, and three keys programs by output colour space: compiled for the screen, every program was compiled AGAIN,
 *  synchronously, in the first real frame (why worlds with a warm-up still froze). `target`: the scene `scene` is part
 *  of (its lights, fog and environment), when `scene` is only a subtree. */
export function compileAs(gl: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, intoTarget: boolean, target?: THREE.Scene) {
  const prev = gl.getRenderTarget();
  if (intoTarget) gl.setRenderTarget(scratch ??= new THREE.WebGLRenderTarget(1, 1));
  try { return gl.compileAsync(scene, camera, target); } finally { gl.setRenderTarget(prev); } // programs are collected synchronously
}

/* Background warm-ups: what is not on screen at start (hidden parts, close-up shader variants, the window planets) compiles
   after the start-up set has drawn, one job per task, so it never competes with the start-up compile. */
type Later = { open: boolean; busy: boolean; q: (() => Promise<unknown>)[] };
const later = new WeakMap<THREE.WebGLRenderer, Later>();
const laterOf = (gl: THREE.WebGLRenderer) => { let l = later.get(gl); if (!l) later.set(gl, (l = { open: false, busy: false, q: [] })); return l; };
async function pump(l: Later) {
  if (l.busy || !l.open) return;
  l.busy = true;
  for (let job; (job = l.q.shift()); ) { await tick(); await job().catch(() => {}); }
  l.busy = false;
}
/** Runs `job` once this canvas's start-up set has drawn (a deferring <WarmCompile> opens the queue; 20 s at the latest). */
export function warmLater(gl: THREE.WebGLRenderer, job: () => Promise<unknown>) {
  const l = laterOf(gl);
  l.q.push(job);
  if (!l.open) setTimeout(() => { l.open = true; void pump(l); }, 20_000);
  void pump(l);
}

/** Hidden subtrees (their roots) and the materials only they use. three's compile() walks hidden objects too. */
function splitHidden(scene: THREE.Object3D) {
  const roots: THREE.Object3D[] = [], shown = new Set<THREE.Material>();
  const mats = (o: THREE.Object3D) => [(o as THREE.Mesh).material ?? []].flat();
  const walk = (o: THREE.Object3D) => { mats(o).forEach((m) => shown.add(m)); for (const c of o.children) if (c.visible) walk(c); else roots.push(c); };
  walk(scene);
  return roots.map((root) => {
    const only = new Set<THREE.Material>();
    root.traverse((o) => mats(o).forEach((m) => { if (!shown.has(m) && m.visible) only.add(m); }));
    return { root, only };
  });
}
/** Takes the subtrees out of their parents for one synchronous call (the programs are collected), then puts them back. */
function without<T>(roots: THREE.Object3D[], f: () => T): T {
  const out = roots.map((o) => { const p = o.parent!, i = p.children.indexOf(o); p.children.splice(i, 1); return [p, i, o] as const; });
  try { return f(); } finally { for (let k = out.length - 1; k >= 0; k--) { const [p, i, o] = out[k]; p.children.splice(i, 0, o); } }
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

type Prog = { name: string; cacheKey: string; fragmentShader: WebGLShader; program?: WebGLProgram; isReady: () => boolean };
const programsOf = (gl: THREE.WebGLRenderer) => (gl.info.programs ?? []) as unknown as Prog[];
/** How long each program `since` did not have took to compile (KHR_parallel_shader_compile completion), slowest first:
 *  the perf log then names what to cut. Polls without blocking; gives up after a minute. */
function timePrograms(gl: THREE.WebGLRenderer, since: Set<Prog>, t0: number) {
  let left: Set<Prog> | null = null;
  const done: { p: Prog; ms: number }[] = [];
  return new Promise<{ p: string; ms: number }[]>((resolve) => {
    const poll = () => {
      const now = performance.now();
      left ??= new Set(programsOf(gl).filter((p) => !since.has(p))); // a task later: the composer's programs are in too
      for (const p of left) {
        let ok = true;
        try { ok = !p.program || p.isReady(); } catch { /* lost context */ } // no program: released meanwhile
        if (ok) { left.delete(p); done.push({ p, ms: Math.round(now - t0) }); }
      }
      if (left.size && now - t0 < 60_000) { setTimeout(poll, 50); return; }
      resolve(slowest(done, 6).map(({ p, ms }) => ({ p: programLabel(p.name, p.cacheKey, gl.getContext().getShaderSource(p.fragmentShader) ?? ""), ms })));
    };
    setTimeout(poll, 0);
  });
}

// Canvases that have drawn: only a canvas's first hold shows the veil (a later hold keeps its last image instead).
const drawn = new WeakSet<THREE.WebGLRenderer>();

/** Props: `cap` ms before drawing anyway (anything unfinished then compiles synchronously in that frame, the freeze this
 *  exists to avoid, so it is only a safety net); `defer`: compile only what is visible now, warm hidden subtrees after the
 *  first frames (see warmLater); `onDone` when compiled; `onLater` when the hidden subtrees are warm too; `world`: its name
 *  in the perf log ('world-compiled'). Until the first frame the canvas's parent carries data-warming (a calm veil, CSS). */
export function WarmCompile({ cap = 20_000, defer = false, onDone, onLater, world }: { cap?: number; defer?: boolean; onDone?: () => void; onLater?: () => void; world?: string } = {}) {
  const { gl, scene, camera, setFrameloop, frameloop, get } = useThree();
  useLayoutEffect(() => {
    let alive = true, released = false;
    const h = holds.get(gl) ?? { n: 0, prev: frameloop };
    if (h.n++ === 0) h.prev = frameloop;
    holds.set(gl, h);
    setFrameloop("never");
    const veil = drawn.has(gl) ? null : gl.domElement.parentElement;
    veil?.setAttribute("data-warming", "");
    const release = () => {
      if (released) return;
      released = true; drawn.add(gl);
      if (--h.n > 0) return;
      setFrameloop(h.prev); veil?.removeAttribute("data-warming");
      const l = laterOf(gl); // background warm-ups start after the first frames have drawn
      requestAnimationFrame(() => requestAnimationFrame(() => { l.open = true; void pump(l); }));
    };
    // one tick later: the world's children have mounted into the scene (and a composer, if any, has taken over drawing)
    const t = setTimeout(async () => {
      // The reflection map bakes asynchronously; surfaces that use it switch programs when it lands. Wait for it, then for
      // them to apply it (a store update re-renders them synchronously), so those programs are the ones compiled here.
      const env = envReady(gl);
      if (env) { await env; await tick(); await tick(); }
      if (!alive) return;
      const t0 = performance.now(), had = new Set(programsOf(gl));
      // internal.priority > 0: a useFrame with priority took over drawing; here that is always the EffectComposer.
      const into = get().internal.priority > 0;
      // Deferred: hidden subtrees stay out of the start-up compile; their own materials can't draw (material.visible)
      // until their group is warmed, so a part shown early never compiles synchronously, it appears a moment later.
      const groups = defer ? splitHidden(scene) : [];
      groups.forEach((g) => g.only.forEach((m) => { m.visible = false; }));
      const p = without(groups.map((g) => g.root), () => compileAs(gl, scene, camera, into));
      // The composer's own shaders compile alongside, not in its first frames (it skipped up to 2 s, then compiled the rest
      // synchronously).
      const timed = timePrograms(gl, had, t0);
      Promise.all([p, ...[...(composers.get(gl) ?? [])].map(warmNow)])
        .then(() => uploadTextures(gl, scene, () => alive)).catch(() => {})
        .finally(() => {
          if (!alive) return;
          const ms = Math.round(performance.now() - t0), programs = gl.info.programs?.length ?? -1;
          void timed.then((slow) => perfMark(world ? "world-compiled" : "warm-compiled", { world, programs, ms, slow }));
          onDone?.(); release();
          if (!defer) return;
          const l = laterOf(gl);
          for (const g of groups) l.q.push(() => compileAs(gl, g.root, camera, into, scene).finally(() => g.only.forEach((m) => { m.visible = true; })));
          l.q.push(async () => { perfMark("warm-later", { programs: gl.info.programs?.length ?? -1, ms: Math.round(performance.now() - t0) }); onLater?.(); });
          void pump(l);
        });
      // A slow driver must not hold the canvas blank forever: after `cap` draw anyway.
      setTimeout(() => { if (alive) release(); }, cap);
    }, 0);
    return () => { alive = false; clearTimeout(t); release(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);
  return null;
}

/** Content that mounts after the canvas's warm-up (it arrives with data), or is hidden at first and shown by a useFrame:
 *  its new materials stay undrawn until their programs have compiled in parallel, instead of compiling synchronously
 *  inside a frame (a 200–700 ms frame each on the owner's PC). Checked after every render, so children that appear later
 *  are covered too. */
export function WarmIn({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const busy = useRef(new Set<THREE.Material>());
  const { gl, camera, scene, get } = useThree();
  useLayoutEffect(() => { // the children are attached by now, and no frame has drawn them yet (a useFrame may show them)
    const root = ref.current;
    if (!root) return;
    const fresh: THREE.Material[] = [];
    root.traverse((o) => { for (const m of [(o as THREE.Mesh).material ?? []].flat()) if (m.visible && !busy.current.has(m) && !(gl.properties.get(m) as { currentProgram?: unknown }).currentProgram) fresh.push(m); });
    if (!fresh.length) return;
    fresh.forEach((m) => { busy.current.add(m); m.visible = false; });
    const show = () => fresh.forEach((m) => { m.visible = true; busy.current.delete(m); });
    const job = () => { try { return compileAs(gl, root, camera, get().internal.priority > 0, scene).then(show, show); } catch { show(); return Promise.resolve(); } };
    if (holds.get(gl)?.n) warmLater(gl, job); else void job(); // during the start-up compile: after it, not competing with it
  });
  return <group ref={ref}>{children}</group>;
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

/** Starts (or joins) the warm-up for the composer's current passes; settles when they are compiled. */
function warmNow(c: EffectComposer) {
  let w = warm.get(c);
  if (passesChanged(w, c.passes)) {
    const next: WarmState<Pass> = { passes: [...c.passes], ready: false, until: performance.now() + 2000, done: null };
    next.done = Promise.resolve(c).then(warmComposer).catch(() => {}).finally(() => { next.ready = true; }); // a throw must not break the frame loop
    warm.set(c, (w = next));
  }
  return w!.done;
}
// Composers per renderer, so a canvas's WarmCompile can compile their shaders before its first frame.
const composers = new WeakMap<THREE.WebGLRenderer, Set<EffectComposer>>();

const proto = EffectComposer.prototype as EffectComposer & { __warm?: boolean };
if (!proto.__warm) {
  proto.__warm = true;
  const render = proto.render, addPass = proto.addPass;
  proto.addPass = function (this: EffectComposer, ...a: Parameters<EffectComposer["addPass"]>) {
    const gl = this.getRenderer();
    if (gl) { let s = composers.get(gl); if (!s) composers.set(gl, (s = new Set())); s.add(this); }
    return addPass.apply(this, a);
  };
  const dispose = proto.dispose;
  proto.dispose = function (this: EffectComposer) { const gl = this.getRenderer(); if (gl) composers.get(gl)?.delete(this); return dispose.call(this); };
  proto.render = function (this: EffectComposer, dt?: number) {
    void warmNow(this);
    if (skipFrame(warm.get(this)!, performance.now())) return; // still compiling: skip, rather than compile synchronously
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
