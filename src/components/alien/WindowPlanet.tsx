"use client";
// Window planets (impossible-research #3) and the bigger-on-the-inside entry (#4).
// ONE planet at a time (hovered, else the one the camera is near, else the one being dived into) turns into a glass orb:
// a cheap stand-in of its world, anchored at the planet and rendered into one shared 256² target with a frustum cropped
// to the planet's screen box, shows through it with true parallax, and runs on past the sphere's edges. The stand-in
// draws only while the portal is visible. Everything (target, scenes, materials) is built at mount and compiled for the
// target's state there, so a hover never compiles a shader. Mounted only above quality 0 and without reduced motion.
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { warmLater } from "../WarmCompile";
import { PLANETS, type PanelId, type PlanetId } from "@/lib/planets";
import { DIVE_CROSS, diveFov, diveRadii, stepWindow, windowCrop, windowTarget, type Crop, type DiveRequest, type WindowState } from "@/lib/window-pure";

type Positions = Record<string, THREE.Vector3>;
type Sizes = Record<string, number>;
type Kind = "memory" | "globe" | "agents" | "studio" | "arch" | "generic";
const KIND: Partial<Record<PlanetId, Kind>> = { memory: "memory", intelligence: "globe", agents: "agents", studio: "studio", arch: "arch" };
const RT_SIZE = 256;
const PEARL = new THREE.Color("#e4e9f2");

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---------- materials: unlit, additive, fading with depth toward the interior's own dark (never toward white) ---------- */

const FADE_VS = `uniform vec2 uFade; varying float vF;
  float fadeOf(vec4 mv) { return 1.0 - 0.85 * smoothstep(uFade.x, uFade.y, -mv.z); }`;
type Shared = { uFade: { value: THREE.Vector2 }; uPx: { value: number } };
const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;

const lineMat = (U: Shared, alpha: number) => new THREE.ShaderMaterial({ ...add,
  uniforms: { ...U, uColor: { value: new THREE.Color() }, uAlpha: { value: alpha } },
  vertexShader: `${FADE_VS} void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = fadeOf(mv); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vF; void main() { gl_FragColor = vec4(uColor * (uAlpha * vF), 1.0); }`,
});
const solidMat = (U: Shared, alpha: number) => new THREE.ShaderMaterial({ ...add,
  uniforms: { ...U, uColor: { value: new THREE.Color() }, uAlpha: { value: alpha } },
  vertexShader: `${FADE_VS} varying float vFace; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = fadeOf(mv);
    vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vF; varying float vFace;
    void main() { gl_FragColor = vec4(uColor * (uAlpha * vF * (0.3 + 0.7 * vFace)), 1.0); }`,
});
// soft = a wide gaussian glow (the core) instead of a crisp node
const pointMat = (U: Shared, size: number, alpha: number, maxPx = 7, soft = false) => new THREE.ShaderMaterial({ ...add,
  uniforms: { ...U, uColor: { value: new THREE.Color() }, uAlpha: { value: alpha }, uSize: { value: size } },
  vertexShader: `${FADE_VS} uniform float uPx; uniform float uSize; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = fadeOf(mv);
    gl_PointSize = clamp(uPx * uSize / max(-mv.z, 1e-3), 1.0, ${maxPx.toFixed(1)}); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying float vF;
    void main() { float d = length(gl_PointCoord - 0.5);
      float a = ${soft ? "exp(-d * d * 22.0) * smoothstep(0.5, 0.3, d)" : "smoothstep(0.5, 0.12, d) + 0.6 * smoothstep(0.22, 0.0, d)"};
      gl_FragColor = vec4(uColor * (uAlpha * vF * a), 1.0); }`,
});

/* ---------- geometry helpers (mount only) ---------- */

const segs = (a: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(a, 3)); return g; };
function circle(a: number[], r: number, y: number, n = 64) {
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
    a.push(Math.cos(t0) * r, y, Math.sin(t0) * r, Math.cos(t1) * r, y, Math.sin(t1) * r);
  }
}
function edgesOf(a: number[], g: THREE.BufferGeometry, x = 0, y = 0, z = 0) {
  const e = new THREE.EdgesGeometry(g), p = e.attributes.position;
  for (let i = 0; i < p.count; i++) a.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z);
  e.dispose(); g.dispose();
}
const cloud = (n: number, r: number, squash: number, seed: number) => {
  const R = rng(seed), a: number[] = [];
  while (a.length < n * 3) {
    const x = R() * 2 - 1, y = R() * 2 - 1, z = R() * 2 - 1;
    if (x * x + y * y + z * z <= 1) a.push(x * r, y * r * squash, z * r);
  }
  return a;
};

/** Builds the whole window once: target, interior scene, stand-ins, shell. */
function buildWindow() {
  const rt = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, { samples: 4, depthBuffer: true });
  const mini = new THREE.Scene();
  mini.background = new THREE.Color("#010208"); // the galaxy's own void: recursion fades toward it, never toward white
  const cam = new THREE.PerspectiveCamera();
  cam.matrixAutoUpdate = true;
  const U: Shared = { uFade: { value: new THREE.Vector2(1, 10) }, uPx: { value: 1 } };
  const M = { lineA: lineMat(U, 0.55), lineB: lineMat(U, 0.3), solidA: solidMat(U, 0.5), solidB: solidMat(U, 0.32),
    pointA: pointMat(U, 0.085, 1.0), pointB: pointMat(U, 0.035, 0.6), dust: pointMat(U, 0.05, 0.35), floor: solidMat(U, 0.12),
    glow: pointMat(U, 2.2, 0.9, 128, true), motes: pointMat(U, 0.022, 0.4) };  const back = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vDir;
      float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() { vec3 d = normalize(vDir); vec3 q = d * 90.0; float s = h(floor(q));
        float star = step(0.94, s) * smoothstep(0.45, 0.0, length(fract(q) - 0.5)) * (s - 0.94) * 9.0;
        gl_FragColor = vec4(uColor * (0.4 + 0.6 * (0.5 + 0.5 * d.y)) + vec3(0.5, 0.55, 0.65) * star * 0.5, 1.0); }`,
  });
  const geos: THREE.BufferGeometry[] = [];
  const keep = <G extends THREE.BufferGeometry>(g: G) => { geos.push(g); return g; };
  const root = new THREE.Group(); // at the planet's centre, scaled by its radius: everything below is in planet radii
  mini.add(root);
  const backdrop = new THREE.Mesh(keep(new THREE.SphereGeometry(10, 24, 16)), back);
  backdrop.frustumCulled = false;
  root.add(backdrop, new THREE.Points(keep(segs(cloud(160, 4.5, 0.8, 99))), M.dust));
  const spin = new THREE.Group(); // the stand-in turns slowly (< 0.1 rad/s)
  root.add(spin);
  const kinds = {} as Record<Kind, THREE.Group>;
  const group = (k: Kind, ...o: THREE.Object3D[]) => { const g = new THREE.Group(); g.add(...o); g.visible = false; spin.add(g); kinds[k] = g; return g; };

  const glow = () => new THREE.Points(keep(segs([0, 0, 0])), M.glow); // a glowing heart
  { // MEMORY (the owner's concept c13): a deep constellation, each node linked to its three nearest, fine motes, a glowing core
    const N = 110, p = cloud(N, 1.9, 0.9, 7), a: number[] = [];
    for (let i = 0; i < N; i++) {
      const best = [-1, -1, -1], bd = [Infinity, Infinity, Infinity];
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const d = (p[i * 3] - p[j * 3]) ** 2 + (p[i * 3 + 1] - p[j * 3 + 1]) ** 2 + (p[i * 3 + 2] - p[j * 3 + 2]) ** 2;
        for (let k = 0; k < 3; k++) if (d < bd[k]) { bd.splice(k, 0, d); best.splice(k, 0, j); bd.length = 3; best.length = 3; break; }
      }
      for (const j of best) a.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
    }
    group("memory", new THREE.LineSegments(keep(segs(a)), M.lineB), new THREE.Points(keep(segs(p)), M.pointA),
      new THREE.Points(keep(segs(cloud(420, 1.7, 0.9, 13))), M.motes), glow());
  }
  { // INTELLIGENCE: a particle globe inside two tilted orbits
    const a: number[] = [], n = 900;
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = i * 2.399963;
      a.push(Math.cos(t) * r * 0.95, y * 0.95, Math.sin(t) * r * 0.95);
    }
    const o: number[] = [];
    circle(o, 1.45, 0, 96);
    const rings = keep(segs(o)), r1 = new THREE.LineSegments(rings, M.lineB), r2 = new THREE.LineSegments(rings, M.lineB);
    r1.rotation.set(0.5, 0, 0.2); r2.rotation.set(-0.35, 0.6, -0.5); r2.scale.setScalar(1.25);
    group("globe", new THREE.Points(keep(segs(a)), M.pointB), r1, r2, glow());
  }
  { // AGENTS: a ring station with ships along it
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(1.5, 0.035, 6, 96)), M.solidA);
    ring.rotation.x = Math.PI / 2;
    const hub = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.3, 1)), M.solidA);
    const sp: number[] = [];
    for (let i = 0; i < 4; i++) { const t = (i / 4) * Math.PI * 2; sp.push(Math.cos(t) * 0.3, 0, Math.sin(t) * 0.3, Math.cos(t) * 1.47, 0, Math.sin(t) * 1.47); }
    const ships: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const t = (i / 7) * Math.PI * 2 + (i % 2) * 0.3, g = new THREE.ConeGeometry(0.045, 0.16, 5);
      g.rotateX(Math.PI / 2); g.rotateY(-t); g.translate(Math.cos(t) * 1.75, (i % 3 - 1) * 0.12, Math.sin(t) * 1.75);
      ships.push(g);
    }
    const fleet = new THREE.Group();
    fleet.add(new THREE.Mesh(keep(mergeGeometries(ships)), M.solidB));
    ships.forEach((g) => g.dispose());
    fleet.name = "fleet";
    const st = group("agents", ring, hub, new THREE.LineSegments(keep(segs(sp)), M.lineB), fleet);
    st.rotation.set(0.45, 0, 0.15);
  }
  { // STUDIO: a glowing stage ringed by floating frames
    const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(1.5, 48)), M.floor);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.75;
    const f: number[] = [];
    circle(f, 0.7, -0.749, 48); circle(f, 1.15, -0.749, 64); circle(f, 1.5, -0.749, 64);
    const fr: number[] = [];
    for (let i = 0; i < 7; i++) { // a ring of frames floating over the stage, at two heights
      const t = (i / 7) * Math.PI * 2, r = 0.95 + (i % 2) * 0.3, cx = Math.cos(t) * r, cz = Math.sin(t) * r, y = -0.25 + (i % 3) * 0.3;
      const w = 0.3, h = 0.19, tx = -Math.sin(t) * w, tz = Math.cos(t) * w; // the frame faces the stage's centre
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + tx * u, y + h * v, cz + tz * u]);
      for (let k = 0; k < 4; k++) fr.push(...c[k], ...c[(k + 1) % 4]);
    }
    group("studio", floor, new THREE.LineSegments(keep(segs(f)), M.lineB), new THREE.LineSegments(keep(segs(fr)), M.lineA),
      new THREE.Points(keep(segs(cloud(70, 1.2, 0.6, 21))), M.pointB));
  }
  { // ARCH: a wireframe building with floor plates, on a site grid
    const a: number[] = [];
    edgesOf(a, new THREE.BoxGeometry(1.3, 0.45, 1.0), 0, -0.62, 0);
    edgesOf(a, new THREE.BoxGeometry(0.72, 1.15, 0.6), -0.1, 0.18, 0);
    edgesOf(a, new THREE.BoxGeometry(0.4, 0.5, 0.34), -0.1, 1.0, 0);
    edgesOf(a, new THREE.BoxGeometry(0.5, 0.32, 0.5), 0.95, -0.69, 0.25);
    for (let y = -0.2; y < 0.7; y += 0.18) { // floor plates
      const x0 = -0.46, x1 = 0.26, z0 = -0.3, z1 = 0.3;
      a.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const g: number[] = [];
    for (let i = -6; i <= 6; i++) { const v = i * 0.4; g.push(v, -0.85, -2.4, v, -0.85, 2.4, -2.4, -0.85, v, 2.4, -0.85, v); }
    group("arch", new THREE.LineSegments(keep(segs(a)), M.lineA), new THREE.LineSegments(keep(segs(g)), M.lineB));
  }
  { // everything else: nested crystals in the world's identity colour, drifting motes
    const a: number[] = [], b: number[] = [];
    edgesOf(a, new THREE.IcosahedronGeometry(1.0, 1));
    edgesOf(b, new THREE.OctahedronGeometry(0.5));
    group("generic", new THREE.LineSegments(keep(segs(a)), M.lineA), new THREE.LineSegments(keep(segs(b)), M.lineB),
      new THREE.Points(keep(segs(cloud(120, 2.4, 0.8, 5))), M.pointB), glow());
  }
  const fleet = kinds.agents.getObjectByName("fleet")!;

  const shellU = { uMap: { value: rt.texture }, uCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, uK: { value: 0 }, uInside: { value: 0 },
    uRim: { value: new THREE.Color() } };
  const shellMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false, uniforms: shellU,
    vertexShader: `varying vec4 vClip; varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; vN = normalMatrix * normal;
        gl_Position = projectionMatrix * mv; vClip = gl_Position; }`,
    // Outside: the near hemisphere only (front faces). Inside: the back faces fill the view. The interior is sampled
    // where this pixel sits on screen (the target was rendered for the same camera), bent a little toward the rim like a
    // meniscus; a thin fresnel rim is all that is left of the surface. Clamped below the bloom threshold: no glare.
    fragmentShader: `uniform sampler2D uMap; uniform vec4 uCrop; uniform float uK; uniform float uInside; uniform vec3 uRim;
      varying vec4 vClip; varying vec3 vN; varying vec3 vV;
      void main() {
        bool front = gl_FrontFacing;
        if (front == (uInside > 0.5)) discard;
        vec3 n = normalize(vN) * (front ? 1.0 : -1.0), v = normalize(vV);
        float ndv = clamp(dot(n, v), 0.0, 1.0), edge = front ? pow(1.0 - ndv, 3.0) : 0.0;
        vec2 ndc = vClip.xy / max(abs(vClip.w), 1e-4);
        vec2 uv = ((ndc - uCrop.xy) / max(uCrop.zw, vec2(1e-4))) * 0.5 + 0.5 - n.xy * edge * 0.14;
        vec3 inside = texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb * (1.0 - 0.4 * edge);
        float g = front ? 1.0 - ndv : 0.0;
        float rim = smoothstep(0.7, 1.0, g);                                  // the thin glass edge
        float men = smoothstep(0.42, 0.52, g) * (1.0 - smoothstep(0.55, 0.7, g)); // a faint meniscus ring just inside it
        float spec = front ? pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 48.0) : 0.0; // one soft highlight
        vec3 col = min(inside + uRim * (rim * rim * 0.42 + men * 0.06 + spec * 0.12), vec3(0.72));
        gl_FragColor = vec4(col, clamp(uK, 0.0, 1.0));
      }`,
  });
  const shellGeo = new THREE.SphereGeometry(1, 64, 40);

  return {
    rt, mini, cam, U, M, back, root, spin, kinds, fleet, shellMat, shellGeo, shellU,
    dispose() {
      rt.dispose(); geos.forEach((g) => g.dispose()); Object.values(M).forEach((m) => m.dispose()); back.dispose();
      shellMat.dispose(); shellGeo.dispose();
    },
  };
}
type Win = ReturnType<typeof buildWindow>;

/** Paints a stand-in in a world's identity colour, mixed toward pearl and kept low (calm palette). */
function tint(W: Win, id: PlanetId) {
  const c = new THREE.Color(PLANETS.find((p) => p.id === id)?.color ?? "#94a3b8"); // once per switch, not per frame
  const M = W.M, set = (m: THREE.ShaderMaterial, k: number, gain: number) => (m.uniforms.uColor.value as THREE.Color).copy(c).lerp(PEARL, k).multiplyScalar(gain);
  set(M.lineA, 0.35, 0.9); set(M.solidA, 0.35, 0.9); set(M.pointA, 0.5, 0.95);
  set(M.lineB, 0.6, 0.7); set(M.solidB, 0.6, 0.7); set(M.floor, 0.5, 0.8);
  set(M.glow, 0.6, 0.85); set(M.motes, 0.4, 0.75); set(M.pointB, 0.55, 0.85); set(M.dust, 0.75, 0.6);
  (W.back.uniforms.uColor.value as THREE.Color).copy(c).multiplyScalar(0.045);
  W.shellU.uRim.value.copy(c).lerp(PEARL, 0.7);
  for (const k of Object.keys(W.kinds) as Kind[]) W.kinds[k].visible = k === (KIND[id] ?? "generic");
}

/** The window itself: picks the one planet, blends it, renders its interior. Mount after every camera rig (Parallax
 *  included), so the interior is rendered for this frame's final camera. */
export function WindowPlanets({ hover, dive, positions, sizes, scales }: {
  hover: RefObject<PlanetId | null>; dive: PanelId | null; positions: Positions; sizes: Sizes; scales: Sizes;
}) {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const W = useMemo(buildWindow, []);
  const shell = useRef<THREE.Mesh>(null);
  useEffect(() => () => W.dispose(), [W]);
  const ready = useRef(false); // until its shaders are compiled the window stays shut: opening it would compile them synchronously
  useEffect(() => { // compile for the render target's state (linear, no tone mapping), so the first hover never compiles;
    // in the background after the galaxy has drawn, not alongside its start-up compile
    let alive = true;
    warmLater(gl, () => {
      if (!alive) return Promise.resolve();
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(W.rt);
      try { return Promise.all([gl.compileAsync(W.mini, W.cam), shell.current && gl.compileAsync(shell.current, camera, scene)]).then(() => { ready.current = alive; }); }
      finally { gl.setRenderTarget(prev); }
    });
    return () => { alive = false; };
  }, [gl, W, camera, scene]);
  const st = useMemo(() => ({ w: { id: null, k: 0 } as WindowState<PlanetId>, tinted: null as PlanetId | null,
    crop: { x: 0, y: 0, w: 1, h: 1, ok: false } as Crop, v: new THREE.Vector3(), m: new THREE.Matrix4() }), []);

  useFrame((_, dt) => {
    const sh = shell.current;
    if (!sh) return;
    let near: PlanetId | null = null, nr = Infinity;
    for (const p of PLANETS) {
      const r = camera.position.distanceTo(positions[p.id]) / Math.max(1e-3, sizes[p.id] * (scales[p.id] ?? 1));
      if (r < nr) { nr = r; near = p.id; }
    }
    const dv = dive && dive in positions ? (dive as PlanetId) : null;
    const w = stepWindow(st.w, windowTarget(dv, hover.current, near, nr), dt, 0.1, !!dv);
    sh.visible = false;
    if (!w.id || w.k <= 0 || !ready.current) return;
    const C = positions[w.id], R = Math.max(1e-3, sizes[w.id] * (scales[w.id] ?? 1)), Rs = R * 1.012;
    camera.updateMatrixWorld();
    const v = st.v.copy(C).applyMatrix4(camera.matrixWorldInverse), dz = -v.z;
    v.copy(C).project(camera);
    const P = camera.projectionMatrix.elements, c = windowCrop(v.x, v.y, dz, Rs, P[0], P[5], st.crop);
    if (!c.ok) return; // off screen: nothing to draw, nothing rendered
    const d = camera.position.distanceTo(C), inside = d < Rs;
    if (st.tinted !== w.id) { tint(W, w.id); st.tinted = w.id; }
    sh.visible = true;
    sh.position.copy(C); sh.scale.setScalar(Rs);
    // The interior camera is the main camera, with its near plane at the glass and its frustum cropped to the planet.
    const cam = W.cam, pm = cam.projectionMatrix;
    cam.position.copy(camera.position); cam.quaternion.copy(camera.quaternion);
    const n = Math.max(R * 0.02, d - Rs), f = d + R * 12;
    pm.copy(camera.projectionMatrix);
    pm.elements[10] = -(f + n) / (f - n); pm.elements[14] = (-2 * f * n) / (f - n);
    pm.premultiply(st.m.set(1 / c.w, 0, 0, -c.x / c.w, 0, 1 / c.h, 0, -c.y / c.h, 0, 0, 1, 0, 0, 0, 0, 1));
    cam.projectionMatrixInverse.copy(pm).invert();
    W.U.uFade.value.set(Math.max(0, d - R * 1.5), d + R * 8);
    W.U.uPx.value = (RT_SIZE / 2) * pm.elements[5] * R;
    W.root.position.copy(C); W.root.scale.setScalar(R);
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    W.spin.rotation.y += step * 0.06; W.fleet.rotation.y += step * 0.05;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(W.rt);
    gl.render(W.mini, cam);
    gl.setRenderTarget(prev);
    W.shellU.uCrop.value.set(c.x, c.y, c.w, c.h); W.shellU.uK.value = w.k; W.shellU.uInside.value = inside ? 1 : 0;
    W.shellMat.depthTest = d > Rs * 1.15; // at the surface the planet's own relief would poke through the glass: draw over it
    sh.renderOrder = W.shellMat.depthTest ? 0 : 10;
  });
  return <mesh ref={shell} geometry={W.shellGeo} material={W.shellMat} visible={false} raycast={() => null} />;
}

/** Bigger on the inside: a reverse dolly zoom into the planet (the FOV widens as the camera closes in), through the
 *  surface at DIVE_CROSS (onCross: the world mounts and crossfades in), then a settle inside the window's interior.
 *  Mount after the Rig and before Parallax. Grabbing the view cancels it. */
export function WindowDive({ request, positions, sizes, scales, onCross, onCancel }: {
  request: DiveRequest | null; positions: Positions; sizes: Sizes; scales: Sizes; onCross?: (request: DiveRequest) => void; onCancel?: (request: DiveRequest) => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const st = useMemo(() => ({ request: null as DiveRequest | null, t: 0, r0: 1, fov0: 50, dir: new THREE.Vector3(), crossed: false,
    from: new THREE.Vector3(), look: new THREE.Vector3() }), []);
  const cb = useRef({ onCross, onCancel });
  cb.current = { onCross, onCancel };
  useLayoutEffect(() => {
    st.request = request && request.id in positions ? request : null;
    st.t = 0;
    st.crossed = false;
    if (!st.request) return;
    const { id } = st.request;
    const C = positions[id], R = Math.max(1e-3, sizes[id] * (scales[id] ?? 1));
    const d = st.dir.copy(camera.position).sub(C).length();
    if (d < 1e-4) st.dir.set(0, 0, 1); else st.dir.multiplyScalar(1 / d);
    st.r0 = d / R; st.fov0 = camera.fov;
    camera.getWorldDirection(st.from).multiplyScalar(d).add(camera.position); // where the camera looks now, at the planet's distance
  }, [request, positions, sizes, scales, camera, st]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => {
      if (!st.request || st.crossed) return;
      const stopped = st.request;
      st.request = null;
      cb.current.onCancel?.(stopped);
    };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls, st]);
  useFrame((_, dt) => {
    const active = st.request;
    if (!active) return;
    const { id } = active;
    st.t += Number.isFinite(dt) ? Math.min(0.05, Math.max(0, dt)) : 0; // a hitch must not jump the camera through the planet
    const C = positions[id], R = Math.max(1e-3, sizes[id] * (scales[id] ?? 1));
    camera.position.copy(C).addScaledVector(st.dir, R * diveRadii(st.t, st.r0));
    const k = Math.min(1, st.t / 0.3), turn = k * k * (3 - 2 * k); // the gaze swings onto the planet in 0.3 s: no snap
    camera.lookAt(st.look.lerpVectors(st.from, C, turn));
    controls?.target.copy(st.look);
    const fov = diveFov(st.t, st.fov0);
    if (Math.abs(fov - camera.fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (!st.crossed && st.t >= DIVE_CROSS) { st.crossed = true; cb.current.onCross?.(active); }
  });
  return null;
}
