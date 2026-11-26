"use client";
// v9 planet-world props, all procedural (no downloads): real-looking Vault shelf contents (books, archive boxes, glass
// crystals on plinths), a detailed OPERATIONS cargo pod and a BUSINESS freighter. Each prop is a few merged geometries drawn
// as instanced meshes (a fleet = 3-5 draw calls however many pods/ships), so it stays cheap. Numbers live in world-props-pure.
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { crystalGeometry, useWorldTier } from "./world-kit";
import { BOOK_TONES, FREIGHTER, POD, bookSet, containerLayout, glyphOf, hashStr, rng, vaultVariant, type Glyph } from "@/lib/world-props-pure";
import { VAULT_KIND_COLOR, type VaultCrystal } from "@/lib/planet-scenes-pure";

type V3 = [number, number, number];
/** A geometry moved/rotated/scaled into place, stripped to position/normal/uv so parts of any kind can be merged. */
function part(g: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): THREE.BufferGeometry {
  const o = new THREE.Object3D(); o.position.set(...pos); o.rotation.set(...rot); o.scale.set(...scale); o.updateMatrix();
  let c = g.index ? g.toNonIndexed() : g.clone(); c.applyMatrix4(o.matrix);
  for (const k of Object.keys(c.attributes)) if (!["position", "normal", "uv"].includes(k)) c.deleteAttribute(k);
  if (!c.attributes.uv) c.setAttribute("uv", new THREE.BufferAttribute(new Float32Array((c.attributes.position.count) * 2), 2));
  g.dispose(); return c;
}
const merged = (list: THREE.BufferGeometry[]) => { const m = mergeGeometries(list)!; list.forEach((g) => g.dispose()); return m; };
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 2, r);
const cyl = (r0: number, r1: number, h: number, seg = 12) => new THREE.CylinderGeometry(r0, r1, h, seg);
const glow = (c: string, k = 2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });

/* ---------- fleets: one InstancedMesh per merged part, filled together ---------- */

export type FleetApi = {
  /** matrix for instance i (all parts) */ put(i: number, m: THREE.Matrix4): void;
  /** colour for instance i on the parts that take a tint */ tint(i: number, c: THREE.Color): void;
  count(n: number): void; done(): void;
};
type PartDef = { geo: THREE.BufferGeometry; mat: THREE.Material; tint?: number };
const tmp = new THREE.Color();
function Fleet({ parts, max, apiRef }: { parts: PartDef[]; max: number; apiRef: MutableRefObject<FleetApi | null> }) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    apiRef.current = {
      put: (i, m) => refs.current.forEach((r) => r?.setMatrixAt(i, m)),
      tint: (i, c) => parts.forEach((p, j) => { if (p.tint) refs.current[j]?.setColorAt(i, tmp.copy(c).multiplyScalar(p.tint)); }),
      count: (n) => refs.current.forEach((r) => { if (r) r.count = n; }),
      done: () => refs.current.forEach((r) => { if (!r) return; r.instanceMatrix.needsUpdate = true; if (r.instanceColor) r.instanceColor.needsUpdate = true; }),
    };
    return () => { apiRef.current = null; };
  }, [parts, apiRef]);
  useEffect(() => () => { for (const p of parts) { p.geo.dispose(); const m = p.mat as THREE.MeshStandardMaterial; m.map?.dispose(); p.mat.dispose(); } }, [parts]);
  return <>{parts.map((p, j) => <instancedMesh key={j} ref={(el) => { refs.current[j] = el; }} args={[p.geo, p.mat, Math.max(1, max)]} frustumCulled={false} />)}</>;
}

/* ---------- OPERATIONS: cargo pod ---------- */

/** Texture for the pod's side: CARGO POD, a box icon, hazard stripes and a serial, printed in dark ink on transparent. */
function podDecal(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 256; c.height = 128; const x = c.getContext("2d"); if (!x) return null;
  x.fillStyle = "#1b2230"; x.font = "800 38px sans-serif"; x.textBaseline = "alphabetic"; x.fillText("CARGO", 86, 56); x.font = "800 30px sans-serif"; x.fillText("POD", 86, 90);
  x.strokeStyle = "#1b2230"; x.lineWidth = 6; x.lineJoin = "round"; x.beginPath(); x.moveTo(24, 40); x.lineTo(52, 28); x.lineTo(78, 40); x.lineTo(78, 74); x.lineTo(52, 86); x.lineTo(24, 74); x.closePath(); x.moveTo(24, 40); x.lineTo(52, 52); x.lineTo(78, 40); x.moveTo(52, 52); x.lineTo(52, 86); x.stroke();
  x.fillStyle = "#e8761a"; for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(8 + i * 28, 112); x.lineTo(24 + i * 28, 112); x.lineTo(14 + i * 28, 126); x.lineTo(-2 + i * 28, 126); x.closePath(); x.fill(); }
  x.fillStyle = "#1b2230"; x.font = "700 14px monospace"; x.fillText("CP-8841", 150, 106);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function usePodParts(): PartDef[] {
  return useMemo(() => {
    const { len: L, wid: W, hgt: H } = POD, bodyY = 0.3;
    const body = merged([
      part(rbox(L, 0.34, W, 0.07), [0, bodyY, 0]),
      ...[-0.33, 0, 0.33].map((x) => part(box(0.04, 0.035, W * 0.92), [x, bodyY + 0.19, 0])),
      ...[-1, 1].map((s) => part(box(L * 0.9, 0.03, 0.03), [0, bodyY + 0.2, s * 0.2])),
      part(box(0.12, 0.08, 0.2), [0.18, bodyY + 0.26, 0.1]), // roof hatch
    ]);
    const dark = merged([
      part(box(L * 0.9, 0.07, W * 0.72), [0, 0.1, 0]), // chassis
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(cyl(0.07, 0.07, 0.05, 14), [sx * 0.36, 0.07, sz * 0.24], [Math.PI / 2, 0, 0]))), // wheels
      ...[-1, 1].flatMap((s) => [-0.38, 0.38].map((x) => part(box(0.26, 0.2, 0.014), [x, bodyY, s * (W / 2 + 0.002)]))), // end-panel plates
      ...[-1, 1].map((s) => part(box(0.06, 0.2, 0.3), [s * (L / 2 + 0.01), bodyY, 0])), // end plates
      part(cyl(0.025, 0.025, 0.1, 8), [0.18, bodyY + 0.32, 0.1]), // antenna
    ]);
    const accent = merged([-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(rbox(0.19, H * 0.78, 0.17, 0.045), [sx * (L / 2 - 0.08), bodyY + 0.02, sz * (W / 2 - 0.07)]))));
    const lights = merged([
      ...[-1, 1].map((s) => part(box(0.014, 0.05, 0.3), [s * (L / 2 + 0.045), bodyY + 0.06, 0])),
      ...[-1, 1].map((s) => part(box(0.62, 0.018, 0.01), [0, 0.2, s * (W / 2 + 0.004)])),
      ...[-1, 1].map((s) => part(box(0.1, 0.02, 0.01), [0.4, bodyY + 0.12, s * (W / 2 + 0.01)])),
    ]);
    const decal = merged([part(new THREE.PlaneGeometry(0.62, 0.31), [0, bodyY + 0.02, W / 2 + 0.006]), part(new THREE.PlaneGeometry(0.62, 0.31), [0, bodyY + 0.02, -W / 2 - 0.006], [0, Math.PI, 0])]);
    const tex = podDecal();
    return [
      { geo: body, mat: new THREE.MeshStandardMaterial({ color: "#c9d0da", metalness: 0.55, roughness: 0.38 }) },
      { geo: dark, mat: new THREE.MeshStandardMaterial({ color: "#232a36", metalness: 0.8, roughness: 0.45 }) },
      { geo: accent, mat: new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.4, roughness: 0.45, emissive: "#ffffff", emissiveIntensity: 0.12 }), tint: 0.85 },
      { geo: lights, mat: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), tint: 2.4 },
      { geo: decal, mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, color: "#cfd6e0", toneMapped: false }) },
    ];
  }, []);
}

/** The Operations pods. Parent fills it through apiRef; the pod's long side runs along +x (use podMatrix to place it on the track). */
export function CargoPods({ max, apiRef }: { max: number; apiRef: MutableRefObject<FleetApi | null> }) {
  const parts = usePodParts();
  return <Fleet parts={parts} max={max} apiRef={apiRef} />;
}
/** Pod on the ring track at angle a, radius r, sitting on the rails (y = rail height). */
export function trackMatrix(o: THREE.Object3D, a: number, r: number, y: number, scale = 1): THREE.Matrix4 {
  o.position.set(Math.cos(a) * r, y, Math.sin(a) * r); o.rotation.set(0, -a + Math.PI / 2, 0); o.scale.setScalar(scale); o.updateMatrix(); return o.matrix;
}
/** Two rails and sleepers round the pod track, so the pods ride on something. */
export function PodTrack({ r = 6 }: { r?: number }) {
  const rail = useMemo(() => new THREE.MeshStandardMaterial({ color: "#3a4352", metalness: 0.9, roughness: 0.3 }), []);
  const sleep = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1c222c", metalness: 0.7, roughness: 0.5 }), []);
  const ref = useRef<THREE.InstancedMesh>(null), N = 120;
  useLayoutEffect(() => { const m = ref.current; if (!m) return; const o = new THREE.Object3D();
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; o.position.set(Math.cos(a) * r, 0.24, Math.sin(a) * r); o.rotation.set(0, -a, 0); o.updateMatrix(); m.setMatrixAt(i, o.matrix); } m.instanceMatrix.needsUpdate = true; }, [r]);
  useEffect(() => () => { rail.dispose(); sleep.dispose(); }, [rail, sleep]);
  return (<group>
    {[-0.24, 0.24].map((d) => <mesh key={d} rotation-x={Math.PI / 2} position={[0, 0.28, 0]} material={rail}><torusGeometry args={[r + d, 0.028, 6, 192]} /></mesh>)}
    <instancedMesh ref={ref} args={[undefined, undefined, N]} material={sleep}><boxGeometry args={[0.1, 0.03, 0.62]} /></instancedMesh>
  </group>);
}

/* ---------- BUSINESS: freighter ---------- */

function useFreighterParts(): PartDef[] {
  return useMemo(() => {
    const { len: L } = FREIGHTER, sy = 0.85, sz = 1.4;
    const hull = merged([
      part(cyl(0.17, 0.17, 1.1, 14), [-0.1, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1]).applyMatrix4(new THREE.Matrix4().makeScale(1, sy, sz)),
      part(new THREE.ConeGeometry(0.17, 0.42, 14), [0.66, 0, 0], [0, 0, -Math.PI / 2]).applyMatrix4(new THREE.Matrix4().makeScale(1, sy, sz)),
      part(rbox(0.22, 0.12, 0.22, 0.03), [0.36, 0.16, 0]), // bridge
      part(rbox(0.34, 0.3, 0.5, 0.05), [-0.72, 0, 0]), // engine block
      ...[-1, 1].map((s) => part(box(0.36, 0.022, 0.24), [-0.46, 0, s * 0.3], [0, s * 0.45, 0])), // wings
    ]);
    const dark = merged([
      part(box(L * 0.82, 0.07, 0.1), [-0.05, 0.19, 0]), // spine
      ...[-1, 0, 1].map((z) => part(cyl(0.07, 0.085, 0.14, 12), [-0.93, 0, z * 0.15], [0, 0, Math.PI / 2])), // nozzles
      ...[-1, 1].map((s) => part(box(0.5, 0.05, 0.02), [0.05, 0.19, s * 0.075])),
    ]);
    const cl = containerLayout(), cbox = (pick: (i: number) => boolean) => merged(cl.flatMap(({ x, row }, i) => (pick(i) ? [-1, 1].map((s) => part(box(0.34, 0.15, 0.2), [x - 0.05, 0.27 + row * 0.16, s * 0.17])) : [])));
    const containers = cbox((i) => i % 2 === 0), plain = cbox((i) => i % 2 === 1);
    const stripe = merged([...[-1, 1].map((s) => part(box(1.0, 0.03, 0.006), [-0.1, 0.02, s * 0.241])), ...cl.filter((c) => c.row === 1).map(({ x }) => part(box(0.3, 0.012, 0.42), [x - 0.05, 0.355, 0]))]);
    const lit = merged([
      ...[-1, 0, 1].map((z) => part(new THREE.CircleGeometry(0.058, 12), [-1.005, 0, z * 0.15], [0, -Math.PI / 2, 0])),
      part(box(0.1, 0.025, 0.16), [0.42, 0.185, 0]), // cockpit glass
      ...[-1, 1].map((s) => part(new THREE.SphereGeometry(0.018, 6, 5), [-0.58, 0, s * 0.42])), // wing-tip lights
    ]);
    return [
      { geo: hull, mat: new THREE.MeshStandardMaterial({ color: "#aeb6c3", metalness: 0.7, roughness: 0.34 }) },
      { geo: dark, mat: new THREE.MeshStandardMaterial({ color: "#262c38", metalness: 0.85, roughness: 0.4 }) },
      { geo: containers, mat: new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.35, roughness: 0.55, emissive: "#ffffff", emissiveIntensity: 0.08 }), tint: 0.42 },
      { geo: plain, mat: new THREE.MeshStandardMaterial({ color: "#5d6678", metalness: 0.5, roughness: 0.5 }) },
      { geo: stripe, mat: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), tint: 2.2 },
      { geo: lit, mat: glow("#9fdcff", 3) },
    ];
  }, []);
}
/** Freighters: nose at +x, engines at -x. Parent fills the fleet through apiRef. */
export function Freighters({ max, apiRef }: { max: number; apiRef: MutableRefObject<FleetApi | null> }) {
  const parts = useFreighterParts();
  return <Fleet parts={parts} max={max} apiRef={apiRef} />;
}

/* ---------- VAULT: shelf contents (tier 1+) ---------- */

const SHELF_R = 7.58, KRAFT = ["#9a7a52", "#8a6a45", "#a88a5e", "#7d5f3c"];
const tangentRot = (a: number) => -a - Math.PI / 2; // local +x along the shelf, local +z toward the middle of the hall

/** Books, archive boxes and glass crystals on plinths, one per file, standing where the old gold blocks were. Chips still
 *  anchor on the same slots (planet-scenes-pure), so nothing about picking changes. */
export function VaultShelfProps({ crystals, reduced }: { crystals: VaultCrystal[]; reduced: boolean }) {
  const slots = useMemo(() => crystals.map((c, i) => { const a = Math.atan2(c.at[2], c.at[0]); return { c, a, base: c.at[1] - 0.05, v: vaultVariant(c.kind, i), seed: hashStr(c.key) }; }), [crystals]);
  const books = useMemo(() => slots.filter((s) => s.v === "books").flatMap((s) => bookSet(s.seed).map((b) => ({ ...b, a: s.a, base: s.base }))), [slots]);
  const boxes = useMemo(() => slots.filter((s) => s.v === "box").flatMap((s) => { const r = rng(s.seed), stack = r() < 0.3, kraft = Math.floor(r() * KRAFT.length);
    return (stack ? [0, 1] : [0]).map((lvl) => ({ a: s.a, y: s.base + lvl * 0.4, kraft: (kraft + lvl) % KRAFT.length, kind: s.c.kind })); }), [slots]);
  const plinths = useMemo(() => slots.filter((s) => s.v === "crystal"), [slots]);

  const geo = useMemo(() => ({
    book: box(1, 1, 1).translate(0, 0.5, 0), band: box(1.04, 0.035, 1.03), plinth: merged([part(cyl(0.2, 0.25, 0.07, 6), [0, 0.035, 0]), part(cyl(0.15, 0.17, 0.05, 6), [0, 0.095, 0]), ...[0, 1, 2, 3, 4, 5].map((i) => part(box(0.06, 0.04, 0.06), [Math.cos((i / 6) * 6.283) * 0.22, 0.03, Math.sin((i / 6) * 6.283) * 0.22]))]),
    ring: new THREE.TorusGeometry(0.19, 0.012, 5, 18).rotateX(Math.PI / 2),
    body: rbox(0.4, 0.34, 0.42, 0.02).translate(0, 0.17, 0), lid: rbox(0.43, 0.07, 0.45, 0.02).translate(0, 0.375, 0), label: box(0.2, 0.1, 0.012).translate(0, 0.2, 0.216), slot: box(0.12, 0.03, 0.014).translate(0, 0.3, 0.215),
  }), []);
  const mat = useMemo(() => ({
    book: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.62, metalness: 0.05 }), band: glow("#ffcf7a", 1.3),
    plinth: new THREE.MeshStandardMaterial({ color: "#4a3a2a", metalness: 0.75, roughness: 0.42 }), ring: glow("#ffb347", 1.8),
    kraft: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.82, metalness: 0 }), dark: new THREE.MeshStandardMaterial({ color: "#2a2018", roughness: 0.6, metalness: 0.5 }),
    label: new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  }), []);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mat).forEach((m) => m.dispose()); }, [geo, mat]);

  const rb = useRef<THREE.InstancedMesh>(null), rband = useRef<THREE.InstancedMesh>(null), rp = useRef<THREE.InstancedMesh>(null), rr = useRef<THREE.InstancedMesh>(null);
  const rbody = useRef<THREE.InstancedMesh>(null), rlid = useRef<THREE.InstancedMesh>(null), rlab = useRef<THREE.InstancedMesh>(null), rslot = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D(), c = new THREE.Color(); o.rotation.order = "YXZ";
    const fin = (m: THREE.InstancedMesh | null, n: number) => { if (!m) return; m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); };
    const tan = (a: number, dx: number, y: number, rr = SHELF_R) => o.position.set(Math.cos(a) * rr - Math.sin(a) * dx, y, Math.sin(a) * rr + Math.cos(a) * dx);
    let nb = 0, nband = 0;
    books.forEach((b) => { tan(b.a, b.dx, b.base); o.rotation.set(0, tangentRot(b.a), b.lean); o.scale.set(b.w, b.h, b.d); o.updateMatrix();
      rb.current?.setMatrixAt(nb, o.matrix); rb.current?.setColorAt(nb, c.set(BOOK_TONES[b.tone])); nb++;
      if (b.band) { tan(b.a, b.dx, b.base); o.rotation.set(0, tangentRot(b.a), b.lean); o.scale.set(1, 1, 1); o.updateMatrix();
        rband.current?.setMatrixAt(nband++, o.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, b.h * 0.72, 0)).multiply(new THREE.Matrix4().makeScale(b.w, 1, b.d))); } });
    fin(rb.current, nb); fin(rband.current, nband);
    plinths.forEach((s, i) => { o.position.set(s.c.at[0], s.base, s.c.at[2]); o.rotation.set(0, -s.a, 0); o.scale.set(1, 1, 1); o.updateMatrix(); rp.current?.setMatrixAt(i, o.matrix);
      o.position.y = s.base + 0.075; o.updateMatrix(); rr.current?.setMatrixAt(i, o.matrix); rr.current?.setColorAt(i, c.set(VAULT_KIND_COLOR[s.c.kind] ?? "#ffb347")); });
    fin(rp.current, plinths.length); fin(rr.current, plinths.length);
    boxes.forEach((b, i) => { tan(b.a, 0, b.y); o.rotation.set(0, tangentRot(b.a), 0); o.scale.set(1, 1, 1); o.updateMatrix();
      for (const m of [rbody.current, rlid.current, rlab.current, rslot.current]) m?.setMatrixAt(i, o.matrix);
      rbody.current?.setColorAt(i, c.set(KRAFT[b.kraft])); rlid.current?.setColorAt(i, c.set(KRAFT[b.kraft]).multiplyScalar(0.72));
      rlab.current?.setColorAt(i, c.set(VAULT_KIND_COLOR[b.kind] ?? "#ffb347").multiplyScalar(1.5)); });
    [rbody, rlid, rlab, rslot].forEach((m) => fin(m.current, boxes.length));
  }, [books, plinths, boxes]);

  const lights: [number, number][] = [[-0.6, 3.2], [0.4, 3.2], [1.6, 3.2]];
  return (<group>
    <instancedMesh ref={rb} args={[geo.book, mat.book, Math.max(1, books.length)]} />
    <instancedMesh ref={rband} args={[geo.band, mat.band, Math.max(1, books.length)]} />
    <instancedMesh ref={rbody} args={[geo.body, mat.kraft, Math.max(1, boxes.length)]} />
    <instancedMesh ref={rlid} args={[geo.lid, mat.kraft, Math.max(1, boxes.length)]} />
    <instancedMesh ref={rlab} args={[geo.label, mat.label, Math.max(1, boxes.length)]} />
    <instancedMesh ref={rslot} args={[geo.slot, mat.dark, Math.max(1, boxes.length)]} />
    <instancedMesh ref={rp} args={[geo.plinth, mat.plinth, Math.max(1, plinths.length)]} />
    <instancedMesh ref={rr} args={[geo.ring, mat.ring, Math.max(1, plinths.length)]} />
    <GlassCrystals slots={plinths} />
    {lights.map(([a, y], i) => <pointLight key={i} position={[Math.cos(a * 1.9) * 5.2, y, Math.sin(a * 1.9) * 5.2]} intensity={9} distance={7} color="#ffb36b" />)}
  </group>);
}

/* glass crystals on the Vault plinths */
type Slot = { c: VaultCrystal; a: number; base: number };
function glyphTex(g: Glyph): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 160; const x = cv.getContext("2d"); if (!x) return null;
  x.strokeStyle = "#fff"; x.fillStyle = "#fff"; x.lineWidth = 9; x.lineJoin = "round"; x.lineCap = "round";
  if (g === "file") { x.beginPath(); x.moveTo(26, 14); x.lineTo(76, 14); x.lineTo(104, 42); x.lineTo(104, 146); x.lineTo(26, 146); x.closePath(); x.stroke(); [70, 94, 118].forEach((y) => { x.beginPath(); x.moveTo(44, y); x.lineTo(88, y); x.stroke(); }); }
  else { x.strokeRect(14, 34, 100, 92); if (g === "image") { x.beginPath(); x.moveTo(24, 118); x.lineTo(54, 74); x.lineTo(76, 100); x.lineTo(92, 82); x.lineTo(106, 118); x.stroke(); x.beginPath(); x.arc(86, 58, 8, 0, 7); x.fill(); }
    else if (g === "video") { x.beginPath(); x.moveTo(52, 62); x.lineTo(52, 100); x.lineTo(84, 81); x.closePath(); x.fill(); }
    else { [0, 1, 2, 3, 4].forEach((i) => { const h = [20, 44, 62, 36, 18][i]; x.beginPath(); x.moveTo(28 + i * 18, 80 - h / 2); x.lineTo(28 + i * 18, 80 + h / 2); x.stroke(); }); } }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Amber glass crystals with a glowing core and a file icon inside. Real transmission on the top tier; tinted translucent glass below. */
function GlassCrystals({ slots }: { slots: Slot[] }) {
  const tier = useWorldTier(), n = slots.length;
  const geo = useMemo(() => crystalGeometry(), []), core = useMemo(() => crystalGeometry(), []);
  const glass = useMemo(() => new THREE.MeshPhysicalMaterial(tier >= 2
    ? { color: "#ffffff", transmission: 1, thickness: 0.4, ior: 1.6, roughness: 0.03, metalness: 0, attenuationColor: new THREE.Color("#ff9a2e"), attenuationDistance: 1.1, dispersion: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.8, flatShading: true, specularIntensity: 1 }
    : { color: "#ffffff", transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.6, flatShading: true, depthWrite: false, emissive: "#ff8a1e", emissiveIntensity: 0.12 }), [tier]);
  const coreMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), []);
  const glyphs: Glyph[] = ["file", "image", "video", "audio"];
  const gmat = useMemo(() => Object.fromEntries(glyphs.map((g) => [g, new THREE.MeshBasicMaterial({ map: glyphTex(g), color: new THREE.Color("#ffe2b0").multiplyScalar(1.6), alphaTest: 0.4, toneMapped: false, side: THREE.DoubleSide })])) as Record<Glyph, THREE.MeshBasicMaterial>, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plane = useMemo(() => new THREE.PlaneGeometry(0.17, 0.21), []);
  const ref = useRef<THREE.InstancedMesh>(null), cref = useRef<THREE.InstancedMesh>(null), gref = useRef<Record<Glyph, THREE.InstancedMesh | null>>({ file: null, image: null, video: null, audio: null });
  useLayoutEffect(() => {
    const o = new THREE.Object3D(), c = new THREE.Color(), cnt: Record<Glyph, number> = { file: 0, image: 0, video: 0, audio: 0 };
    slots.forEach((s, i) => { const h = 0.5 + s.c.h * 0.28, w = 0.72, col = c.set(VAULT_KIND_COLOR[s.c.kind] ?? "#ffb347"), r = rng(hashStr(s.c.key));
      o.position.set(s.c.at[0], s.base + 0.11, s.c.at[2]); o.rotation.set(0, tangentRot(s.a) + (r() - 0.5) * 0.5, 0); o.scale.set(w, h, w); o.updateMatrix(); ref.current?.setMatrixAt(i, o.matrix);
      ref.current?.setColorAt(i, tmp.copy(col).lerp(new THREE.Color("#ffffff"), tier >= 2 ? 0.75 : 0.3));
      o.scale.set(w * 0.2, h * 0.55, w * 0.2); o.position.y += h * 0.05; o.updateMatrix(); cref.current?.setMatrixAt(i, o.matrix); cref.current?.setColorAt(i, tmp.copy(col).multiplyScalar(s.c.fresh ? 1.5 : 0.9));
      const g = glyphOf(s.c.kind), m = gref.current[g]; if (m) { o.position.set(s.c.at[0], s.base + 0.11 + h * 0.4, s.c.at[2]); o.position.x += -Math.cos(s.a) * 0.0; o.rotation.set(0, tangentRot(s.a), 0); o.scale.set(h * 1.0, h * 1.0, 1); o.translateZ(0.085); o.updateMatrix(); m.setMatrixAt(cnt[g]++, o.matrix); } });
    for (const m of [ref.current, cref.current]) if (m) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    glyphs.forEach((g) => { const m = gref.current[g]; if (m) { m.count = cnt[g]; m.instanceMatrix.needsUpdate = true; } });
  }, [slots, n, tier]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { geo.dispose(); core.dispose(); glass.dispose(); coreMat.dispose(); plane.dispose(); Object.values(gmat).forEach((m) => { m.map?.dispose(); m.dispose(); }); }, [geo, core, glass, coreMat, plane, gmat]);
  return (<group>
    <instancedMesh ref={cref} args={[core, coreMat, Math.max(1, n)]} frustumCulled={false} />
    {glyphs.map((g) => <instancedMesh key={g} ref={(el) => { gref.current[g] = el; }} args={[plane, gmat[g], Math.max(1, n)]} frustumCulled={false} />)}
    <instancedMesh ref={ref} args={[geo, glass, Math.max(1, n)]} frustumCulled={false} />
  </group>);
}
