"use client";
// Knowledge graph overlay for MEMORY's constellation: soft halos with names around concept clusters, and the "Clusters" list
// with bridge memories. Clusters come precomputed with /api/memories/map (memory-graph.ts); positions are the stars'.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { halos, type Graph } from "@/lib/memory-graph-pure";

type Pt = { id: string; title: string; x: number; y: number; z: number };
const HUES = ["#7dc4ff", "#ffd27a", "#b8f0a8", "#ff9ec7", "#c3b4ff", "#7de3d0", "#ffb27a", "#f0a8ff", "#fff3a8", "#ff8f8f"];
const hue = (id: number) => HUES[id % HUES.length];

function useHalos(graph: Graph, items: Pt[]) {
  return useMemo(() => halos(graph.clusters, new Map(items.map((m) => [m.id, m]))), [graph, items]);
}

/** Inside the Canvas: one camera-facing soft glow per cluster plus its name. Never blocks picking (no raycast). */
export function ClusterHalos({ graph, items }: { graph: Graph; items: Pt[] }) {
  const hs = useHalos(graph, items);
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d")!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.5)"); grad.addColorStop(0.6, "rgba(255,255,255,0.18)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  return <>{hs.map((h) => (
    <group key={h.id} position={h.at}>
      <sprite scale={[h.r * 2.6, h.r * 2.6, 1]} raycast={() => null} renderOrder={-1}>
        <spriteMaterial map={tex} color={hue(h.id)} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <Html position={[0, h.r * 1.05, 0]} center style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
        <div className="memory-cluster-label" style={{ color: hue(h.id), fontSize: 10, letterSpacing: "0.18em", whiteSpace: "nowrap", opacity: 0.8, textShadow: "0 0 6px #000" }}>{h.name}</div>
      </Html>
    </group>
  ))}</>;
}

/** Side-panel list: each cluster flies the camera to its halo; each bridge selects the star that links two clusters. */
export function ClusterList({ graph, items, onFly, onSelect }: {
  graph: Graph; items: Pt[]; onFly: (at: [number, number, number], dist: number) => void; onSelect: (index: number) => void;
}) {
  const hs = useHalos(graph, items), index = useMemo(() => new Map(items.map((m, i) => [m.id, i])), [items]);
  const name = new Map(graph.clusters.map((c) => [c.id, c.name]));
  const bridges = graph.bridges.filter((b) => index.has(b.id)).slice(0, 8);
  if (!hs.length) return null;
  return (
    <details className="space-y-1.5">
      <summary className="muted cursor-pointer text-[10px] uppercase tracking-widest">Clusters · {hs.length}</summary>
      <ul className="flex flex-wrap gap-1.5">{[...hs].sort((a, b) => b.size - a.size).map((h) => (
        <li key={h.id}><button className="chip" title={graph.clusters.find((c) => c.id === h.id)?.keywords.join(", ")} onClick={() => onFly(h.at, Math.min(48, Math.max(9, h.r * 3)))}>
          <i aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9, background: hue(h.id) }} />{h.name} <span className="muted num">{h.size}</span></button></li>
      ))}</ul>
      {bridges.length > 0 && <ul className="space-y-0.5" aria-label="Bridge memories">{bridges.map((b) => (
        <li key={b.id}><button className="chip w-full justify-start text-left" onClick={() => onSelect(index.get(b.id)!)}>
          <span className="truncate">“{b.title}” connects <b>{name.get(b.a)}</b> and <b>{name.get(b.b)}</b></span></button></li>
      ))}</ul>}
    </details>
  );
}
