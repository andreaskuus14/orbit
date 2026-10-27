"use client";
// MEMORY → Palace: walk through your memories. One room per kind around a round hub (memory-palace-pure.ts); each memory is
// a crystal on a plinth, bigger for the important ones. WASD / arrows to walk and turn, drag to look, click to open.
// Everything is instanced (floors, walls, plinths, crystals: four draw calls), lit by a lantern that follows you; no post pass.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, PerformanceMonitor } from "@react-three/drei";
import { useGlRecovery } from "./useGlRecovery";
import { useLeanQuality } from "./useLeanQuality";
import { useMountLater, WarmCompile } from "./WarmCompile";
import type { QualityMode } from "@/lib/quality-pure";
import { buildPalace, CORRIDOR, move, plinthRadius, walkable, type Palace } from "@/lib/memory-palace-pure";

type Item = { id: string; title: string; kind: string; source: string | null };
type Look = { x: number; z: number; yaw: number; pitch: number };
const BG = "#020308", EYE = 1.6, WALL_H = 3.4;
const PRIV_KEY = "orbit.chronicle.private"; // the same "Include private (journal)" toggle as Chronicle
const readPriv = () => { try { return localStorage.getItem(PRIV_KEY) === "1"; } catch { return false; } };
const KIND_COLOR: Record<string, string> = {
  note: "#9ec9ff", idea: "#ffd27a", link: "#7de3d0", document: "#c3b4ff", image: "#ff9ec7", research: "#7dc4ff",
  conversation: "#b8f0a8", project: "#ffb27a", preference: "#f0a8ff", decision: "#ff8f8f", goal: "#fff3a8",
};
const kindColor = (k: string) => KIND_COLOR[k] ?? "#a9b4c8";
const plinthH = (size: number) => 0.7 + size * 0.6;
const facing = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(-(toX - fromX), -(toZ - fromZ)); // camera looks down -z

function Hall({ hall, items, look, keys, reduced, hover, onHover, onPick, dragged }: {
  hall: Palace; items: Map<string, Item>; look: React.MutableRefObject<Look>; keys: React.MutableRefObject<Set<string>>; reduced: boolean;
  hover: number | null; onHover: (i: number | null) => void; onPick: (i: number) => void; dragged: React.MutableRefObject<boolean>;
}) {
  const camera = useThree((s) => s.camera);
  const lantern = useRef<THREE.PointLight>(null);
  const mesh = useMemo(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => { const x = new THREE.InstancedMesh(geo, mat, Math.max(n, 1)); x.count = n; return x; };
    const floorMat = new THREE.MeshStandardMaterial({ color: "#07090f", roughness: 0.35, metalness: 0.6, emissive: "#0a1426", emissiveIntensity: 0.25 });
    // floors: hub and room discs, corridor slabs
    const floors = inst(new THREE.CylinderGeometry(1, 1, 0.1, 64), floorMat, hall.rooms.length + 1);
    const discs = [{ x: 0, z: 0, r: hall.hub }, ...hall.rooms];
    discs.forEach((d, i) => floors.setMatrixAt(i, m.compose(p.set(d.x, -0.05, d.z), q.identity(), s.set(d.r, 1, d.r))));
    const slabs = inst(new THREE.BoxGeometry(1, 0.1, 1), floorMat, hall.corridors.length);
    hall.corridors.forEach((k, i) => {
      const len = Math.hypot(k.x2 - k.x1, k.z2 - k.z1);
      slabs.setMatrixAt(i, m.compose(p.set((k.x1 + k.x2) / 2, -0.04, (k.z1 + k.z2) / 2), q.setFromAxisAngle(up, -Math.atan2(k.z2 - k.z1, k.x2 - k.x1)), s.set(len, 1, CORRIDOR)));
    });
    const walls = inst(new THREE.BoxGeometry(1, WALL_H, 0.25), new THREE.MeshStandardMaterial({ color: "#0b0d16", roughness: 0.25, metalness: 0.8, emissive: "#14244a", emissiveIntensity: 0.35, flatShading: true }), hall.walls.length);
    hall.walls.forEach((w, i) => {
      const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) + 0.12; // overlap a hair: no light leaks at the joints
      walls.setMatrixAt(i, m.compose(p.set((w.x1 + w.x2) / 2, WALL_H / 2, (w.z1 + w.z2) / 2), q.setFromAxisAngle(up, -Math.atan2(w.z2 - w.z1, w.x2 - w.x1)), s.set(len, 1, 1)));
    });
    const plinths = inst(new THREE.CylinderGeometry(0.85, 1, 1, 6), new THREE.MeshStandardMaterial({ color: "#141826", roughness: 0.3, metalness: 0.7, flatShading: true }), hall.plinths.length);
    const crystals = inst(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ toneMapped: false }), hall.plinths.length);
    const base = new Float32Array(hall.plinths.length * 3);
    hall.plinths.forEach((t, i) => {
      const r = plinthRadius(t.size), h = plinthH(t.size);
      plinths.setMatrixAt(i, m.compose(p.set(t.x, h / 2, t.z), q.setFromAxisAngle(up, i * 0.7), s.set(r, h, r)));
      crystals.setMatrixAt(i, m.compose(p.set(t.x, h + 0.45 + t.size * 0.2, t.z), q.setFromAxisAngle(up, i * 1.3), s.setScalar(0.7 + t.size * 0.9)));
      c.set(kindColor(items.get(t.id)?.kind ?? "")).multiplyScalar(0.55 + t.size * 0.5);
      base.set([c.r, c.g, c.b], i * 3); crystals.setColorAt(i, c);
    });
    for (const x of [floors, slabs, walls, plinths, crystals]) { x.computeBoundingSphere(); x.instanceMatrix.needsUpdate = true; }
    [floors, slabs, walls].forEach((x) => { x.raycast = () => {}; });
    return { floors, slabs, walls, plinths, crystals, base };
  }, [hall, items]);
  useEffect(() => () => { for (const x of [mesh.floors, mesh.slabs, mesh.walls, mesh.plinths, mesh.crystals]) { x.geometry.dispose(); (x.material as THREE.Material).dispose(); x.dispose(); } }, [mesh]);

  // hover glow fades in and out (slower under reduced motion: fades are its only movement)
  const glow = useMemo(() => new Float32Array(hall.plinths.length), [hall]), c = useMemo(() => new THREE.Color(), []), white = useMemo(() => new THREE.Color(1.4, 1.4, 1.4), []);
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  useFrame((_, raw) => {
    const dt = Math.min(Math.max(raw, 0), 0.1), L = look.current, k = keys.current;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const side = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0), turn = (k.has("ArrowLeft") ? 1 : 0) - (k.has("ArrowRight") ? 1 : 0);
    L.yaw += turn * dt * 1.8;
    if (fwd || side) {
      const sp = (k.has("ShiftLeft") || k.has("ShiftRight") ? 6 : 3.2) * dt / Math.hypot(fwd, side), sy = Math.sin(L.yaw), cy = Math.cos(L.yaw);
      const dx = (-sy * fwd + cy * side) * sp, dz = (-cy * fwd - sy * side) * sp, n = Math.ceil(Math.hypot(dx, dz) / 0.15); // small sub-steps: never through a plinth
      for (let i = 0; i < n; i++) [L.x, L.z] = move(hall, L.x, L.z, dx / n, dz / n);
    }
    camera.position.set(L.x, EYE, L.z);
    camera.quaternion.setFromEuler(euler.set(L.pitch, L.yaw, 0));
    lantern.current?.position.set(L.x, EYE + 0.6, L.z);
    let moved = false;
    const f = 1 - Math.exp(-dt * (reduced ? 3 : 12));
    for (let i = 0; i < glow.length; i++) {
      const goal = i === hover ? 1 : 0, d = goal - glow[i];
      if (d === 0) continue;
      glow[i] = Math.abs(d) < 0.01 ? goal : glow[i] + d * f;
      c.fromArray(mesh.base, i * 3).lerp(white, glow[i] * 0.6);
      mesh.crystals.setColorAt(i, c); moved = true;
    }
    if (moved && mesh.crystals.instanceColor) mesh.crystals.instanceColor.needsUpdate = true;
  });

  const hit = {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (e.instanceId != null) onHover(e.instanceId); },
    onPointerOut: () => onHover(null),
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.instanceId != null && !dragged.current) onPick(e.instanceId); },
  };
  const h = hover !== null ? hall.plinths[hover] : undefined, hi = h ? items.get(h.id) : undefined;
  return <>
    <WarmCompile world="palace" />
    <color attach="background" args={[BG]} />
    <fog attach="fog" args={[BG, 5, 42]} />
    <hemisphereLight args={["#3a4a7a", "#05060a", 0.6]} />
    <pointLight ref={lantern} color="#bcd4ff" intensity={14} distance={16} decay={1.6} />
    <primitive object={mesh.floors} />
    <primitive object={mesh.slabs} />
    <primitive object={mesh.walls} />
    <primitive object={mesh.plinths} {...hit} />
    <primitive object={mesh.crystals} {...hit} />
    {hall.rooms.map((r) => { const ux = Math.cos(r.angle), uz = Math.sin(r.angle), d = Math.hypot(r.x, r.z) - r.r; return (
      <Html key={r.kind} position={[ux * d, WALL_H + 0.3, uz * d]} center style={{ pointerEvents: "none" }} zIndexRange={[11, 0]}>
        <div className="memory-star-label"><b>{r.kind}</b><span>{r.count} {r.count === 1 ? "memory" : "memories"}</span></div>
      </Html>); })}
    {h && hi && <Html position={[h.x, plinthH(h.size) + 1.2, h.z]} style={{ pointerEvents: "none", transform: "translate(14px, -50%)" }} zIndexRange={[12, 0]}>
      <div className="memory-star-label"><b>{hi.title}</b><span>{hi.kind}</span></div>
    </Html>}
  </>;
}

export default function MemoryPalace({ items, links, reduced, quality = "auto", paused = false, slot, onOpen }: {
  items: Item[] | null; links: { from: string; to: string }[]; reduced: boolean; quality?: QualityMode; paused?: boolean; slot: HTMLElement | null; onOpen: (id: string) => void;
}) {
  const glr = useGlRecovery();
  const later = useMountLater();
  const q = useLeanQuality(quality);
  const [priv, setPriv] = useState(false);
  useEffect(() => setPriv(readPriv()), []);
  const togglePriv = () => { const v = !priv; try { localStorage.setItem(PRIV_KEY, v ? "1" : "0"); } catch {} setPriv(v); };
  const byId = useMemo(() => new Map((items ?? []).map((m) => [m.id, m])), [items]);
  const hall = useMemo(() => {
    const deg = new Map<string, number>();
    for (const l of links) { deg.set(l.from, (deg.get(l.from) ?? 0) + 1); deg.set(l.to, (deg.get(l.to) ?? 0) + 1); }
    return buildPalace((items ?? []).map((m) => ({ id: m.id, kind: m.kind, source: m.source, links: deg.get(m.id) ?? 0 })), priv);
  }, [items, links, priv]);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => setHover(null), [hall]);
  const look = useRef<Look>({ x: 0, z: 0, yaw: 0, pitch: 0 });
  const placed = useRef(false);
  useEffect(() => { // first layout, or he now stands in a wall (a refetch after opening a memory keeps his spot): the hub, facing the first room
    const r = hall.rooms[0];
    if (placed.current && walkable(hall, look.current.x, look.current.z)) return;
    placed.current = !!r;
    look.current = { x: 0, z: 0, yaw: r ? facing(0, 0, r.x, r.z) : 0, pitch: 0 };
  }, [hall]);
  const goTo = (i: number) => { // just inside the room's doorway, facing its centre
    const r = hall.rooms[i], d = Math.hypot(r.x, r.z), t = (d - r.r + 1.2) / d;
    look.current = { x: r.x * t, z: r.z * t, yaw: facing(r.x * t, r.z * t, r.x, r.z), pitch: 0 };
  };

  const keys = useRef(new Set<string>());
  useEffect(() => {
    if (paused) return;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(Key[WASD]|Arrow\w+|Shift\w+)$/.test(e.code)) { keys.current.add(e.code); if (e.code.startsWith("Arrow")) e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", clear);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", clear); clear(); };
  }, [paused]);

  // drag to look; a drag never counts as a click on a plinth
  const drag = useRef<{ x: number; y: number } | null>(null), dragged = useRef(false);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY }; dragged.current = false; },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!dragged.current && Math.hypot(dx, dy) < 4) return;
      dragged.current = true; drag.current = { x: e.clientX, y: e.clientY };
      const L = look.current;
      L.yaw += dx * 0.004; L.pitch = Math.min(1.2, Math.max(-1.2, L.pitch + dy * 0.004)); // drag the world: right turns left, like grabbing it
    },
    onPointerUp: () => { drag.current = null; },
    onPointerLeave: () => { drag.current = null; },
  };

  const hv = hover !== null ? byId.get(hall.plinths[hover]?.id ?? "") : undefined;
  const panel = <div className="space-y-3">
    {!items && <p className="muted" role="status">Building your palace…</p>}
    {items && !hall.plinths.length && <p className="muted">No memories to walk among yet.</p>}
    {hv && <div className="card"><div className="font-medium">{hv.title}</div><p className="muted text-xs">{hv.kind} · click to open</p></div>}
    {hall.rooms.length > 0 && <div className="space-y-1">
      <div className="muted text-[10px] uppercase tracking-widest">Rooms</div>
      <div className="flex flex-wrap gap-1.5">{hall.rooms.map((r, i) => <button key={r.kind} className="chip" onClick={() => goTo(i)}>
        <i aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9, background: kindColor(r.kind) }} />{r.kind} <span className="muted">{r.count}</span></button>)}</div>
    </div>}
    <label className="muted flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={priv} onChange={togglePriv} />Include private (journal, on this device only)</label>
    <p className="muted text-[11px]">Each room holds one kind of memory; bigger crystals are the more connected and weightier ones. W A S D or the arrow keys to walk and turn (Shift runs), drag to look, click a crystal to open it.</p>
  </div>;

  return <>
    <div className="absolute inset-0" style={{ background: BG, touchAction: "none", cursor: hover !== null ? "pointer" : "grab" }} {...handlers}
      role="application" aria-label="Memory palace: walk with W A S D or the arrow keys, drag to look, click a crystal to open its memory">
      {later && items && <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={paused ? "never" : "always"} camera={{ position: [0, EYE, 0], fov: 70, near: 0.1, far: 120 }}
        dpr={[1, q.dpr]} gl={{ antialias: q.bloomScale > 0 }} onPointerMissed={() => setHover(null)}>
        {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
        <Hall hall={hall} items={byId} look={look} keys={keys} reduced={reduced} hover={hover} onHover={setHover}
          onPick={(i) => { const id = hall.plinths[i]?.id; if (id) onOpen(id); }} dragged={dragged} />
      </Canvas>}
    </div>
    {slot && createPortal(panel, slot)}
  </>;
}
