"use client";
// Agents as ships (The Expanse tactical display): each agent task flies from AGENTS to the planet its work concerns,
// docks while working, blinks amber awaiting approval, flies home and fades when done (red flash on failure).
// Instanced: one draw call for hulls, one for engine glows, one for trails. No allocations per frame; every value finite (bloom NaN rule).
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { planetById } from "@/lib/planets";
import { MAX_SHIPS, reconcileShips, shipFrame, type Ship, type ShipTask } from "@/lib/ships-pure";

type Positions = Record<string, THREE.Vector3>;
const TRAIL = 10; // points per trail
const HULL = new THREE.Color("#dbeafe"), AMBER = new THREE.Color("#fbbf24"), RED = new THREE.Color("#f43f5e"), ENGINE = new THREE.Color("#7dd3fc");

export function Ships({ tasks, onOpen, positions, reduced }: { tasks: ShipTask[]; onOpen?: (id: string) => void; positions: Positions; reduced: boolean }) {
  const fleet = useRef<Ship[]>([]);
  useEffect(() => { fleet.current = reconcileShips(fleet.current, tasks, Date.now()); }, [tasks]);
  useEffect(() => { // prune ships that finished flying home even when no new snapshot arrives
    const t = setInterval(() => { fleet.current = reconcileShips(fleet.current, tasks, Date.now()); }, 5000);
    return () => clearInterval(t);
  }, [tasks]);

  const hull = useRef<THREE.InstancedMesh>(null), glow = useRef<THREE.InstancedMesh>(null), hit = useRef<THREE.InstancedMesh>(null);
  const hullGeo = useMemo(() => new THREE.ConeGeometry(0.055, 0.3, 4).rotateX(Math.PI / 2), []); // tip along +z, lookAt aims it
  const trail = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_SHIPS * (TRAIL - 1) * 2 * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_SHIPS * (TRAIL - 1) * 2 * 3), 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    l.frustumCulled = false;
    return l;
  }, []);
  useEffect(() => () => { hullGeo.dispose(); trail.geometry.dispose(); (trail.material as THREE.Material).dispose(); }, [hullGeo, trail]);

  const s = useMemo(() => ({ o: new THREE.Object3D(), a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Vector3(), c: new THREE.Color(), v: new THREE.Vector3() }), []);
  const hover = useRef(""), ids = useRef<string[]>([]);
  const { gl, camera, size } = useThree();
  const label = useMemo(() => {
    const el = document.createElement("span");
    el.className = "planet-label absolute left-0 top-0";
    Object.assign(el.style, { color: "#fde68a", letterSpacing: "0.12em", pointerEvents: "none", zIndex: "5" });
    return el;
  }, []);
  useEffect(() => { gl.domElement.parentElement?.appendChild(label); return () => label.remove(); }, [gl, label]);

  /** Point on ship i's path at u (0 = AGENTS, 1 = dock), into `out`. Quadratic Bézier arcing over the plane. */
  const pathAt = (ship: Ship, i: number, u: number, t: number, out: THREE.Vector3) => {
    const p = planetById(ship.target)!, home = positions.agents, to = positions[ship.target] ?? home;
    const ang = i * 2.4 + t * 0.15, r = p.size * 1.25 + 0.45; // dock: hover beside the planet, drifting slowly round it
    s.b.set(to.x + Math.cos(ang) * r, to.y + 0.25 + (i % 3) * 0.12, to.z + Math.sin(ang) * r);
    s.a.copy(home); s.a.y += 0.6;
    s.m.addVectors(s.a, s.b).multiplyScalar(0.5); s.m.y += 1.2 + s.a.distanceTo(s.b) * 0.12;
    const k = 1 - u;
    return out.set(k * k * s.a.x + 2 * k * u * s.m.x + u * u * s.b.x, k * k * s.a.y + 2 * k * u * s.m.y + u * u * s.b.y, k * k * s.a.z + 2 * k * u * s.m.z + u * u * s.b.z);
  };

  useFrame(({ clock }) => {
    const H = hull.current, G = glow.current, X = hit.current;
    if (!H || !G || !X) return;
    const now = Date.now(), t = reduced ? 0 : clock.elapsedTime, ships = fleet.current;
    const pos = trail.geometry.attributes.position as THREE.BufferAttribute, col = trail.geometry.attributes.color as THREE.BufferAttribute;
    let n = 0;
    for (let i = 0; i < ships.length && n < MAX_SHIPS; i++) {
      const ship = ships[i], f = shipFrame(ship, now, reduced);
      if (f.phase === "gone" || f.alpha <= 0) continue;
      pathAt(ship, i, f.u, t, s.p);
      // Heading: along the path while moving (backwards on the way home), tangent to the drift while docked.
      const dir = f.phase === "return" ? -1 : 1;
      pathAt(ship, i, Math.min(1, Math.max(0, f.u + dir * 0.02)), t + (f.u >= 1 ? 0.5 : 0), s.q);
      if (s.q.distanceToSquared(s.p) < 1e-8) s.q.set(s.p.x, s.p.y, s.p.z + 1);
      s.o.position.copy(s.p); s.o.lookAt(s.q);
      const sc = 0.4 + 0.6 * f.alpha;
      s.o.scale.setScalar(sc); s.o.updateMatrix();
      H.setMatrixAt(n, s.o.matrix); X.setMatrixAt(n, s.o.matrix);
      s.c.copy(HULL).lerp(AMBER, f.amber).lerp(RED, f.red).multiplyScalar(f.alpha);
      H.setColorAt(n, s.c);
      // Engine glow sits just behind the hull; brighter while burning, a soft idle glow when docked.
      s.v.subVectors(s.p, s.q).normalize().multiplyScalar(0.17 * sc).add(s.p);
      s.o.position.copy(s.v); s.o.scale.setScalar((f.phase === "dock" ? 0.06 : 0.1) * sc); s.o.updateMatrix();
      G.setMatrixAt(n, s.o.matrix);
      s.c.copy(ENGINE).lerp(AMBER, f.amber).lerp(RED, f.red).multiplyScalar(f.alpha * (f.phase === "dock" ? 0.6 : 1.2));
      G.setColorAt(n, s.c);
      // Trail: the path just behind the ship, fading out; none when docked or with reduced motion.
      const tl = f.phase === "dock" || reduced ? 0 : 1;
      for (let j = 0; j < TRAIL - 1; j++) {
        const base = (n * (TRAIL - 1) + j) * 2;
        for (let e = 0; e < 2; e++) {
          const uu = Math.min(1, Math.max(0, f.u - dir * (j + e) * 0.012));
          pathAt(ship, i, uu, t, s.v);
          pos.setXYZ(base + e, s.v.x, s.v.y, s.v.z);
          const k = tl * f.alpha * 0.45 * (1 - (j + e) / (TRAIL - 1));
          col.setXYZ(base + e, ENGINE.r * k, ENGINE.g * k, ENGINE.b * k);
        }
      }
      ids.current[n] = ship.id;
      n++;
    }
    ids.current.length = n;
    H.count = G.count = X.count = n;
    H.instanceMatrix.needsUpdate = G.instanceMatrix.needsUpdate = X.instanceMatrix.needsUpdate = true;
    if (H.instanceColor) H.instanceColor.needsUpdate = true;
    if (G.instanceColor) G.instanceColor.needsUpdate = true;
    trail.geometry.setDrawRange(0, n * (TRAIL - 1) * 2);
    pos.needsUpdate = col.needsUpdate = true;
    // Hover label: the task title next to the ship.
    const h = hover.current ? ids.current.indexOf(hover.current) : -1; // by id: instance indexes shift when the fleet changes
    if (h >= 0 && h < n) {
      H.getMatrixAt(h, s.o.matrix); s.v.setFromMatrixPosition(s.o.matrix).project(camera);
      label.style.opacity = s.v.z < 1 ? "1" : "0";
      label.style.transform = `translate(12px, -50%) translate(${((s.v.x + 1) / 2) * size.width}px, ${((1 - s.v.y) / 2) * size.height}px)`;
    } else if (label.style.opacity !== "0") label.style.opacity = "0";
  });

  const titleOf = (id: string) => fleet.current.find((x) => x.id === id)?.title ?? "";
  const over = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined) return;
    e.stopPropagation();
    hover.current = ids.current[e.instanceId] ?? "";
    label.textContent = titleOf(hover.current);
    document.body.style.cursor = "pointer";
  };
  const out = () => { hover.current = ""; document.body.style.cursor = ""; };
  useEffect(() => () => { document.body.style.cursor = ""; }, []);
  const click = (e: ThreeEvent<MouseEvent>) => {
    const id = e.instanceId === undefined ? undefined : ids.current[e.instanceId];
    if (!id || !onOpen) return;
    e.stopPropagation();
    onOpen(id);
  };

  return (
    <>
      <instancedMesh ref={hull} args={[hullGeo, undefined, MAX_SHIPS]} count={0} frustumCulled={false}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={glow} args={[undefined, undefined, MAX_SHIPS]} count={0} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {/* Invisible, larger hit targets: a 0.3-unit hull is too small to hover. */}
      <instancedMesh ref={hit} args={[undefined, undefined, MAX_SHIPS]} count={0} frustumCulled={false} onPointerOver={over} onPointerOut={out} onClick={click}>
        <sphereGeometry args={[0.4, 8, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </instancedMesh>
      <primitive object={trail} />
    </>
  );
}
