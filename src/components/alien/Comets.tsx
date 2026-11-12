"use client";
// Deadline comets (N10): each upcoming deadline falls toward the CORE, its distance = days left (comet-pure.ts).
// One instanced mesh for all of them (≤ 20), off on quality level 0, still under reduced motion. Click opens its panel.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { cometPosition, isUrgent, MAX_COMETS, type CometItem } from "@/lib/comet-pure";
import type { PanelId } from "@/lib/planets";

const CALM = new THREE.Color("#cfe0ff"), RED = new THREE.Color("#f43f5e");
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export function Comets({ level, reduced, onSelect }: { level: number; reduced: boolean; onSelect: (id: PanelId) => void }) {
  const [items, setItems] = useState<CometItem[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<THREE.InstancedMesh>(null);
  const on = level > 0;
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () => fetch("/api/comets").then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && Array.isArray(j?.comets)) setItems(j.comets.slice(0, MAX_COMETS)); }).catch(() => {});
    load();
    const t = setInterval(load, 10 * 60_000);
    return () => { live = false; clearInterval(t); };
  }, [on]);
  // Tail along +y of the cone, pointing away from the CORE (the CORE is the sun).
  const geo = useMemo(() => new THREE.ConeGeometry(0.07, 0.9, 8, 1, true).translate(0, 0.45, 0), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const now = Date.now();
    items.forEach((it, i) => m.setColorAt(i, isUrgent(it.due, now) ? RED : CALM));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.boundingSphere = null; // raycast uses a cached sphere: recompute it for the new set, or clicks miss
  }, [items]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const now = Date.now(), t = clock.elapsedTime;
    items.forEach((it, i) => {
      _p.set(...cometPosition(it, now));
      _q.setFromUnitVectors(UP, _s.copy(_p).normalize());
      const k = (hover === i ? 1.6 : 1) * (reduced ? 1 : 1 + 0.08 * Math.sin(t * 3 + i));
      m.setMatrixAt(i, _m.compose(_p, _q, _s.set(k, k, k)));
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
  });
  if (!on || !items.length) return null;
  const h = hover !== null ? items[hover] : null;
  return (
    <>
      <instancedMesh ref={ref} args={[geo, undefined, MAX_COMETS]} frustumCulled={false}
        onClick={(e) => { e.stopPropagation(); const it = e.instanceId !== undefined ? items[e.instanceId] : null; if (it) onSelect(it.panel); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(e.instanceId ?? null); }} onPointerOut={() => setHover(null)}>
        <meshBasicMaterial transparent opacity={0.85} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      {h && (
        <Html position={cometPosition(h, Date.now())} center style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-black/70 px-2 py-0.5 text-xs text-slate-100">{h.title} · {h.due}</div>
        </Html>
      )}
    </>
  );
}
