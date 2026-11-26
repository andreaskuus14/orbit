"use client";
// Matte-painting plates (v9): a cleaned crop of one of the owner's own Higgsfield renders on a curved backdrop behind the
// live 3D. Unlit and fog-free, so the painting stays as painted; the live objects (shelves, crystals, chips) stand in front.
// Tier 1+ only (wrap in <RealOr fallback={null}>); the low tier keeps the procedural look and downloads nothing.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import { assetUrl, type AssetId } from "@/lib/world-assets-pure";

/** A band of an open cylinder, seen from inside. facing = direction the band's middle looks toward (radians, x = sin, z = cos, so PI = -z). */
export function MattePlate({ id, r, y, h, facing, arc, repeat = 1, k = 1, mirror = true, feather = false }: { id: AssetId; r: number; y: number; h: number; facing: number; arc: number; repeat?: number; k?: number; mirror?: boolean; /** soft edges (alpha fade on all four sides) so a plate melts into the scene */ feather?: boolean }) {
  const tex = useTexture(assetUrl(id));
  const t = useMemo(() => { const c = tex.clone(); c.colorSpace = THREE.SRGBColorSpace; c.wrapS = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping; c.repeat.set(-repeat, 1); c.offset.x = repeat; c.anisotropy = 4; c.needsUpdate = true; return c; }, [tex, repeat, mirror]);
  const fade = useMemo(() => { if (!feather || typeof document === "undefined") return null; const c = document.createElement("canvas"); c.width = 128; c.height = 64; const x = c.getContext("2d")!;
    const gx = x.createLinearGradient(0, 0, 128, 0); gx.addColorStop(0, "#000"); gx.addColorStop(0.18, "#fff"); gx.addColorStop(0.82, "#fff"); gx.addColorStop(1, "#000"); x.fillStyle = gx; x.fillRect(0, 0, 128, 64);
    x.globalCompositeOperation = "multiply"; const gy = x.createLinearGradient(0, 0, 0, 64); gy.addColorStop(0, "#000"); gy.addColorStop(0.25, "#fff"); gy.addColorStop(0.75, "#fff"); gy.addColorStop(1, "#000"); x.fillStyle = gy; x.fillRect(0, 0, 128, 64); return new THREE.CanvasTexture(c); }, [feather]);
  useEffect(() => () => { t.dispose(); fade?.dispose(); }, [t, fade]);
  return (
    <mesh position={[0, y, 0]}>
      <cylinderGeometry args={[r, r, h, 64, 1, true, facing - arc / 2, arc]} />
      <meshBasicMaterial map={t} side={THREE.BackSide} fog={false} toneMapped={false} color={new THREE.Color(k, k, k)} alphaMap={fade} transparent={!!fade} depthWrite={!fade} />
    </mesh>
  );
}
