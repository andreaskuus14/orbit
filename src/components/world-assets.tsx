"use client";
// Real CC0 models in the planet worlds (v5). <RealOr> shows the procedural parts on tier 0, while loading, and if a file
// fails; <AssetMany> draws one node of a model at many spots, each fit to a target size, one instanced draw call per part.
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { useGLTF, Environment } from "@react-three/drei";
import { assetUrl, fitScale, useRealAssets, type AssetId } from "@/lib/world-assets-pure";
import { useWorldTier, type Inst } from "./world-kit";

class Quiet extends Component<{ fallback: ReactNode; children: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch() { /* a missing asset just keeps the procedural look */ }
  render() { return this.state.bad ? this.props.fallback : this.props.children; }
}

/** Real assets on tier 1+, else (and while loading / on error) the procedural fallback. */
export function RealOr({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const tier = useWorldTier();
  if (!useRealAssets(tier)) return <>{fallback}</>;
  return <Quiet fallback={fallback}><Suspense fallback={fallback}>{children}</Suspense></Quiet>;
}

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; rel: THREE.Matrix4 };

/** Meshes under one node (or the whole scene), with their matrices relative to it and the node's local bounds. */
function useParts(id: AssetId, node?: string) {
  const g = useGLTF(assetUrl(id));
  return useMemo(() => {
    g.scene.updateMatrixWorld(true);
    const root = (node ? g.scene.getObjectByName(node) : g.scene) ?? g.scene;
    const inv = root.matrixWorld.clone().invert(), parts: Part[] = [], box = new THREE.Box3(), b = new THREE.Box3();
    root.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      const rel = inv.clone().multiply(m.matrixWorld);
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.union(b.copy(m.geometry.boundingBox!).applyMatrix4(rel));
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
        mt.userData.realism = null; // real textures: no shader noise
        if (mt.transparent && (mt as THREE.MeshStandardMaterial).map) { mt.transparent = false; mt.alphaTest = 0.45; mt.depthWrite = true; mt.side = THREE.DoubleSide; } // leaf cards: cut-out, no sorting
      }
      parts.push({ geo: m.geometry, mat: m.material, rel });
    });
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const base = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z); // centre on x/z, sit on y = 0
    return { parts, size: [size.x, size.y, size.z] as [number, number, number], base };
  }, [g, node]);
}

/** One node of a model at many places. items[].s is the target size (w, h, d); uniform keeps proportions (fit to h). */
export function AssetMany({ id, node, items, uniform = true, shadow = true }: { id: AssetId; node?: string; items: Inst[]; uniform?: boolean; shadow?: boolean }) {
  const { parts, size, base } = useParts(id, node);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const o = new THREE.Object3D(), m = new THREE.Matrix4();
    const mats = items.map((it) => { const k = fitScale(size, it.s, uniform); o.position.set(...it.at); o.rotation.set(0, it.ry ?? 0, 0); o.scale.set(...k); o.updateMatrix(); return o.matrix.clone().multiply(base); });
    parts.forEach((p, j) => { const im = refs.current[j]; if (!im) return; mats.forEach((w, i) => im.setMatrixAt(i, m.copy(w).multiply(p.rel))); im.count = items.length; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); });
  }, [items, parts, size, base, uniform]);
  if (!items.length) return null;
  return <>{parts.map((p, j) => <instancedMesh key={`${j}:${items.length}`} ref={(r) => { refs.current[j] = r; }} args={[p.geo, p.mat, items.length]} castShadow={shadow} receiveShadow={shadow} />)}</>;
}

/** A Poly Haven HDRI as the scene's lighting (and optionally background). */
export function AssetEnv({ id, background = false, intensity = 1 }: { id: AssetId; background?: boolean; intensity?: number }) {
  return <Environment files={assetUrl(id)} background={background} environmentIntensity={intensity} />;
}
