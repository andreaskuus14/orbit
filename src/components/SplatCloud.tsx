"use client";
// ARCH scan viewer (roadmap 5.2): Gaussian splats as instanced quads. Splat data lives in one float texture (layout in
// splat-pure packSplats); the only per-view upload is the draw order (4 bytes a splat), sorted back-to-front in a worker
// and only when the view direction turns. Shaders and the texture upload go through WarmCompile, so opening a scan never
// compiles or uploads inside a frame. Fill rate is the limit on the owner's PC: splat count and on-screen size follow the
// world quality preset (splatBudget), tiny/transparent splats are culled in the vertex shader.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { WarmCompile } from "./WarmCompile";
import { TEX_ROW, texSize } from "@/lib/splat-pure";

export type ScanData = {
  name: string; tex: Float32Array; count: number; total: number; format: string;
  bounds: { lo: [number, number, number]; hi: [number, number, number] }; bytes?: Uint8Array | null;
  noteId?: string | null; note?: string; // the scan's MEMORY note (5.5: calibration and measurements live there)
};
type Reply = Omit<ScanData, "name"> & { order?: Float32Array; hit?: [number, number, number] | null; error?: string };
export type SplatWorker = { call: (msg: Record<string, unknown>, transfer?: Transferable[]) => Promise<Reply>; stop: () => void };

/** One worker for ARCH's scans (parse + sort), started on first use. */
export function makeSplatWorker(): SplatWorker {
  let w: Worker | null = null, seq = 0;
  const wait = new Map<number, { ok: (r: Reply) => void; no: (e: Error) => void }>();
  const start = () => {
    w = new Worker(new URL("./splat.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<Reply & { id: number }>) => {
      const p = wait.get(e.data.id); wait.delete(e.data.id);
      if (e.data.error) p?.no(new Error(e.data.error)); else p?.ok(e.data);
    };
    w.onerror = (e) => { e.preventDefault(); for (const p of wait.values()) p.no(new Error("The scan worker crashed (out of memory?)")); wait.clear(); w?.terminate(); w = null; };
    return w;
  };
  return {
    call: (msg, transfer = []) => new Promise((ok, no) => { const id = ++seq; wait.set(id, { ok, no }); (w ?? start()).postMessage({ ...msg, id }, transfer); }),
    stop: () => { w?.terminate(); w = null; for (const p of wait.values()) p.no(new Error("stopped")); wait.clear(); },
  };
}

const VERT = /* glsl */ `uniform sampler2D uData; uniform vec2 uViewport; uniform float uMaxPx;
attribute float aIdx;
varying vec4 vColor; varying vec2 vPos;
void main() {
  int i = int(aIdx + 0.5), row = i / ${TEX_ROW}, col = (i - row * ${TEX_ROW}) * 3;
  vec4 t0 = texelFetch(uData, ivec2(col, row), 0), t1 = texelFetch(uData, ivec2(col + 1, row), 0), t2 = texelFetch(uData, ivec2(col + 2, row), 0);
  vec4 cam = modelViewMatrix * vec4(t0.xyz, 1.0);
  vec4 clip = projectionMatrix * cam;
  float lim = 1.2 * clip.w;
  if (cam.z > -0.05 || t2.z < 0.02 || abs(clip.x) > lim || abs(clip.y) > lim) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  mat3 S = mat3(t0.w, t1.x, t1.y, t1.x, t1.z, t1.w, t1.y, t1.w, t2.x);
  float fx = projectionMatrix[0][0] * uViewport.x * 0.5, fy = projectionMatrix[1][1] * uViewport.y * 0.5, z = cam.z;
  // Jacobian of the perspective projection (three looks down -z), then the 2D screen covariance (EWA splatting).
  mat3 J = mat3(fx / -z, 0.0, 0.0, 0.0, fy / -z, 0.0, fx * cam.x / (z * z), fy * cam.y / (z * z), 0.0);
  mat3 T = J * mat3(modelViewMatrix);
  mat3 C = T * S * transpose(T);
  float a = C[0][0] + 0.3, b = C[0][1], c = C[1][1] + 0.3; // +0.3 px²: low-pass, no sub-pixel shimmer
  float mid = 0.5 * (a + c), rad = length(vec2(0.5 * (a - c), b));
  float l1 = mid + rad, l2 = max(mid - rad, 0.1);
  vec2 d = abs(b) < 1e-9 ? (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) : normalize(vec2(b, l1 - a));
  vec2 major = min(3.0 * sqrt(l1), uMaxPx) * d, minor = min(3.0 * sqrt(l2), uMaxPx) * vec2(d.y, -d.x);
  float rgb = t2.y;
  vColor = vec4(floor(rgb / 65536.0), floor(mod(rgb, 65536.0) / 256.0), mod(rgb, 256.0), 255.0 * t2.z) / 255.0;
  vPos = position.xy * 3.0; // in standard deviations
  gl_Position = vec4(clip.xy / clip.w + (position.x * major + position.y * minor) * 2.0 / uViewport, clip.z / clip.w, 1.0);
}`;
const FRAG = /* glsl */ `varying vec4 vColor; varying vec2 vPos;
void main() {
  float r = dot(vPos, vPos);
  if (r > 9.0) discard;
  float a = vColor.a * exp(-0.5 * r);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

const V2 = new THREE.Vector2(), FWD = new THREE.Vector3(), INV = new THREE.Matrix4(); // per-frame scratch

/** children render in the scan's own coordinates (5.5 measurements). */
export function SplatCloud({ scan, worker, cap, maxPx, flip, children }: { scan: ScanData; worker: SplatWorker; cap: number; maxPx: number; flip: boolean; children?: ReactNode }) {
  const mesh = useRef<THREE.Mesh>(null);
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: { target: THREE.Vector3; update: () => void } | null };
  const parts = useMemo(() => {
    const { width, height } = texSize(scan.count);
    const tex = new THREE.DataTexture(scan.tex, width, height, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true; // uploaded by WarmCompile in its own task, not in a frame
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const idx = new THREE.InstancedBufferAttribute(new Float32Array(scan.count), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aIdx", idx);
    geo.instanceCount = 0; // nothing drawn until the first sort lands
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uData: { value: tex }, uViewport: { value: new THREE.Vector2(1, 1) }, uMaxPx: { value: maxPx } },
    });
    return { tex, geo, idx, mat };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- maxPx is a uniform, updated below
  }, [scan]);
  useEffect(() => () => { parts.tex.dispose(); parts.geo.dispose(); parts.mat.dispose(); }, [parts]);
  useEffect(() => { parts.mat.uniforms.uMaxPx.value = maxPx; }, [parts, maxPx]);

  // Group transform: centred on x/z, floor (2nd percentile of height) at y = 0; flip turns a y-down export upright.
  const { lo, hi } = scan.bounds;
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  const offset: [number, number, number] = flip ? [-cx, hi[1], cz] : [-cx, -lo[1], -cz];
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1);
  useEffect(() => { // frame the scan once when it opens
    camera.position.set(ext * 0.9, ext * 0.6, ext * 0.9);
    controls?.target.set(0, (hi[1] - lo[1]) * 0.35, 0); controls?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new scan
  }, [scan, controls]);

  const sort = useRef({ busy: false, last: new THREE.Vector3(), cap: -1, parts });
  useFrame(({ gl }) => {
    const m = mesh.current;
    if (!m) return;
    gl.getDrawingBufferSize(V2);
    (parts.mat.uniforms.uViewport.value as THREE.Vector2).copy(V2);
    const s = sort.current;
    if (s.busy) return;
    camera.getWorldDirection(FWD).transformDirection(INV.copy(m.matrixWorld).invert());
    if (s.parts === parts && s.cap === cap && s.last.dot(FWD) > 0.9999) return; // turned < ~0.8°: the old order still holds
    const p = parts;
    s.busy = true; s.cap = cap; s.parts = p; s.last.copy(FWD);
    worker.call({ sort: [FWD.x, FWD.y, FWD.z], cap }).then((r) => {
      if (!r.order || r.order.length > p.idx.count || sort.current.parts !== p) return; // a reply for a previous scan
      p.idx.set(r.order); p.idx.clearUpdateRanges(); p.idx.addUpdateRange(0, r.order.length); p.idx.needsUpdate = true;
      p.geo.instanceCount = r.order.length;
    }).catch(() => {}).finally(() => { s.busy = false; });
  });

  return (
    <group position={offset}>
      <group rotation-x={flip ? Math.PI : 0}>
        <mesh ref={mesh} geometry={parts.geo} material={parts.mat} frustumCulled={false} />
        {children}
      </group>
      <WarmCompile key={scan.name + scan.count} world="arch-scan" />
    </group>
  );
}
