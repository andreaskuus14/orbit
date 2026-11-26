"use client";
// ARCH conifers (v12): Poly Haven's fir_sapling_medium (CC0) baked into front and side views (scripts/arch-real), drawn as two crossed alpha-cut cards per tree,
// one instanced draw call per variant. Near trees cast shadows (the depth pass uses the same alpha cut), far ones do not.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FIR_CARDS, firCardMesh, firScale } from "@/lib/arch-ground-pure";
import { useTex } from "./world-surfaces";

export type Fir = { x: number; y: number; z: number; h: number; ry: number; v: 0 | 1 };

export function ArchFirs({ items, shadow, far = false }: { items: Fir[]; shadow: boolean; /** the horizon line: unlit and unfogged */ far?: boolean }) {
  const [atlas] = useTex("firD");
  const mat = useMemo(() => { atlas.anisotropy = 4; /* the bake is dark foliage: lift it (colour above 1 is allowed). The far line is unlit and unfogged: a flat, hazy mid-green silhouette that stays a tree against the pale horizon instead of dissolving into it. */
    return far ? new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.32, fog: false, color: new THREE.Color(1.5, 1.7, 1.55) }) : new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.32, color: new THREE.Color(2.6, 2.7, 2.3), emissive: new THREE.Color(0.05, 0.06, 0.04) }); }, [atlas, far]);
  const geos = useMemo(() => ([0, 1] as const).map((v) => { const m = firCardMesh(v), g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(m.nor, 3)); g.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2)); g.setIndex(new THREE.BufferAttribute(m.idx, 1)); return g; }), []);
  useEffect(() => () => { mat.dispose(); geos.forEach((g) => g.dispose()); }, [mat, geos]);
  return <>{([0, 1] as const).map((v) => <Variant key={v} v={v} items={items.filter((t) => t.v === v)} geo={geos[v]} mat={mat} shadow={shadow} />)}</>;
}

function Variant({ v, items, geo, mat, shadow }: { v: 0 | 1; items: Fir[]; geo: THREE.BufferGeometry; mat: THREE.Material; shadow: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current; if (!im) return; const o = new THREE.Object3D();
    items.forEach((t, i) => { const k = firScale(v, t.h); o.position.set(t.x, t.y, t.z); o.rotation.set(0, t.ry, 0); o.scale.set(FIR_CARDS[v].side * k, FIR_CARDS[v].side * k, FIR_CARDS[v].side * k); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.count = items.length; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
  }, [items, v]);
  if (!items.length) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geo, mat, items.length]} castShadow={shadow} frustumCulled={false} />;
}
