"use client";
// A world's signature buildings (see landmarks-pure.ts): small towns of its 3D landmark spread over the surface, each town a
// cluster of buildings at varied sizes and turns, upright along the surface normal and sunk a touch so none float. Drawn as
// one instanced batch per mesh of the model (a few draw calls per world, however many buildings). Child of the planet mesh,
// so it turns with the world; lit by the CORE. Loaded lazily; a model that fails to load draws nothing (never the galaxy).
import { Component, Suspense, useMemo, type ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { towns } from "@/lib/landmarks-pure";

const UP = new THREE.Vector3(0, 1, 0);
function Towns({ id, size, seed, scale, level }: { id: string; size: number; seed: number; scale: number; level: number }) {
  const { scene } = useGLTF(`/planets/landmarks/${id}.glb`);
  const batches = useMemo(() => {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene), dim = box.getSize(new THREE.Vector3());
    const k = (size * scale) / Math.max(dim.x, dim.y, dim.z, 1e-6); // the biggest side, so wide buildings don't swamp the world
    const spots = level <= 0 ? towns(seed, 3, 4) : level === 1 ? towns(seed, 5, 6) : towns(seed, 7, 7); // quality level: 12 / 30 / 49 buildings
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const out: THREE.InstancedMesh[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // the CORE is the galaxy's only light: let the building's own texture glow softly (lit windows, readable on the night side)
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial;
      if (mat.map) { mat.emissiveMap = mat.map; mat.emissive = new THREE.Color("#ffffff"); mat.emissiveIntensity = 0.45; }
      mat.roughness = Math.min(mat.roughness ?? 1, 0.8);
      const im = new THREE.InstancedMesh(mesh.geometry, mat, spots.length);
      im.raycast = () => {}; // clicks and hover belong to the planet sphere
      spots.forEach((s, i) => {
        const n = new THREE.Vector3(...s.d);
        q.setFromUnitVectors(UP, n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, s.turn));
        p.copy(n).multiplyScalar(size * 0.985); sc.setScalar(k * s.scale);
        im.setMatrixAt(i, m4.compose(p, q, sc).multiply(mesh.matrixWorld));
      });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      out.push(im);
    });
    return out;
  }, [scene, size, seed, scale, level]);
  return <group>{batches.map((b, i) => <primitive key={i} object={b} />)}</group>;
}

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn("[orbit] landmark model failed to load; the world stays bare", e); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function Landmarks({ id, size, seed, level, scale = 0.3 }: { id: string; size: number; seed: number; level: number; scale?: number }) {
  return <Quiet><Suspense fallback={null}><Towns id={id} size={size} seed={seed} scale={scale} level={level} /></Suspense></Quiet>;
}
