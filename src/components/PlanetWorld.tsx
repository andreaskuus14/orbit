"use client";
// One explorable world for each of the six workspace planets (OPERATIONS, LIFE, VAULT, ANALYTICS, MARKETS, BUSINESS):
// the planet's live data as places (planet-worlds-pure), drawn as instanced shapes in one light canvas, with the
// planet's own workspace panel beside it. Same shell as the other worlds (MemoryWorld): mount-later canvas, warm
// compile, lean quality, GL recovery, paused frameloop. LIFE data is read from ORBIT's own API and never leaves it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, Stars, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { useGlRecovery } from "./useGlRecovery";
import { useLeanQuality } from "./useLeanQuality";
import { useMountLater, WarmCompile } from "./WarmCompile";
import type { QualityMode } from "@/lib/quality-pure";
import { planetById } from "@/lib/planets";
import { placeAt, worldScene, WORLD_SOURCE, type Place, type PlanetWorldId, type Shape } from "@/lib/planet-worlds-pure";
import { useT } from "./i18n";

const BG = "#020308";
const FRESH = new THREE.Color("#ffe6b0"); // the galaxy's "work" white-gold: new in the last 24 h
const GEO: Record<Shape, () => THREE.BufferGeometry> = {
  ship: () => new THREE.ConeGeometry(0.35, 1.2, 5).rotateX(Math.PI / 2), // a hull pointing out of its pier
  crystal: () => new THREE.OctahedronGeometry(0.5, 0).scale(0.6, 1, 0.6),
  column: () => new THREE.BoxGeometry(0.7, 1, 0.7),
  moon: () => new THREE.IcosahedronGeometry(0.5, 1),
  machine: () => new THREE.CylinderGeometry(0.45, 0.55, 0.8, 6),
  tree: () => new THREE.ConeGeometry(0.4, 1, 7),
  bloom: () => new THREE.DodecahedronGeometry(0.5, 0),
  seed: () => new THREE.SphereGeometry(0.5, 8, 6),
};

/** One instanced mesh per shape: a world is a handful of draw calls however many places it has. */
function Group({ shape, items, base, reduced, onHover, onPick }: {
  shape: Shape; items: Place[]; base: number; reduced: boolean; onHover: (i: number | null) => void; onPick: (i: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geo = useMemo(() => GEO[shape](), [shape]);
  useEffect(() => () => geo.dispose(), [geo]);
  const m = useMemo(() => new THREE.Object3D(), []);
  const moving = !reduced && items.some((p) => p.orbit || p.spin);
  const place = (t: number) => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((p, i) => {
      m.position.set(...placeAt(p, reduced ? 0 : t));
      m.rotation.set(0, p.spin && !reduced ? t * 1.6 : shape === "ship" ? 0 : (p.at[0] * 7) % Math.PI, 0);
      if (shape === "column") m.scale.set(1, p.size, 1); else m.scale.setScalar(p.size); // a column's size is its height
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate(); // reduced motion renders on demand
  };
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    items.forEach((p, i) => mesh.setColorAt(i, c.set(p.color).lerp(FRESH, p.fresh ? 0.45 : 0).multiplyScalar(p.fresh ? 1.6 : 1)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    place(0);
  }, [items, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => { if (moving) place(clock.elapsedTime); });
  const id = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? null : base + e.instanceId);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, items.length]} frustumCulled={false}
      onPointerMove={(e) => { e.stopPropagation(); onHover(id(e)); }} onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); const i = id(e); if (i !== null) onPick(i); }}>
      <meshStandardMaterial roughness={0.35} metalness={0.2} flatShading />
    </instancedMesh>
  );
}

/** The moving places' hover label follows them; still ones just sit at their spot. */
function Label({ p, reduced }: { p: Place; reduced: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { ref.current?.position.set(...placeAt(p, reduced ? 0 : clock.elapsedTime)); });
  return (
    <group ref={ref} position={p.at}>
      <Html style={{ pointerEvents: "none", transform: "translate(14px, -50%)" }} zIndexRange={[12, 0]}>
        <div className="memory-star-label"><b>{p.label}</b><span>{p.sub}{p.fresh ? " · new today" : ""}</span></div>
      </Html>
    </group>
  );
}

export default function PlanetWorld({ id, flat, reduced, quality = "auto", onClose, paused = false, children }: {
  id: PlanetWorldId; flat?: boolean; reduced: boolean; quality?: QualityMode; onClose: () => void; paused?: boolean; children: ReactNode; // children: the planet's workspace panel
}) {
  const glr = useGlRecovery();
  const later = useMountLater();
  const q = useLeanQuality(quality);
  const { t } = useT();
  const planet = planetById(id)!;
  const [json, setJson] = useState<unknown>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => { // the panel edits the same data: refresh the scene every 30 s while visible
    if (paused) return;
    let live = true;
    const load = () => fetch(WORLD_SOURCE[id], { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Could not load ${planet.name} (${r.status})`);
      if (live) { setJson(j); setErr(""); }
    }).catch((e: Error) => { if (live) setErr(e.message); });
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [id, paused, planet.name]);

  const scene = useMemo(() => (json ? worldScene(id, json, Date.now()) : null), [id, json]);
  const groups = useMemo(() => {
    const out: { shape: Shape; items: Place[]; base: number }[] = [];
    const all = scene?.places ?? [];
    for (const shape of [...new Set(all.map((p) => p.shape))]) out.push({ shape, items: all.filter((p) => p.shape === shape), base: 0 });
    let base = 0;
    for (const g of out) { g.base = base; base += g.items.length; }
    return out;
  }, [scene]);
  const flatPlaces = useMemo(() => groups.flatMap((g) => g.items), [groups]); // indexes match each group's base
  useEffect(() => { setSel(null); setHover(null); }, [scene]);
  const shown = hover ?? sel;
  const fresh = flatPlaces.filter((p) => p.fresh).length;

  return (
    <div role="region" className="absolute inset-0 globe-in" aria-label={`${planet.name}: ${t(`planet.${id}.blurb`)}`} style={{ background: BG }}>
      {!flat && later && (
        <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={paused ? "never" : reduced ? "demand" : "always"} camera={{ position: [0, 9, 16], fov: 50, near: 0.1, far: 300 }}
          dpr={[1, q.dpr]} gl={{ antialias: false }} onPointerMissed={() => setSel(null)} style={{ cursor: hover !== null ? "pointer" : undefined }}>
          {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
          <WarmCompile world={id} />
          <color attach="background" args={[BG]} />
          <fog attach="fog" args={[BG, 22, 60]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[6, 10, 4]} intensity={1.1} />
          <pointLight position={[0, 3, 0]} intensity={18} distance={22} color={planet.color} />
          <Stars radius={90} depth={40} count={reduced ? 600 : Math.min(1500, q.stars)} factor={2} fade speed={reduced ? 0 : 0.15} />
          <gridHelper args={[40, 40, planet.color, "#13202f"]} position={[0, 0.001, 0]} />
          {id === "markets" && <mesh><icosahedronGeometry args={[1.1, 2]} /><meshStandardMaterial color={planet.color} emissive={planet.color} emissiveIntensity={0.6} flatShading /></mesh>}
          {groups.map((g) => <Group key={g.shape} {...g} reduced={reduced} onHover={setHover} onPick={setSel} />)}
          {scene?.zones.map((z) => (
            <Html key={z.label} position={z.at} center zIndexRange={[11, 0]} style={{ pointerEvents: "none" }}>
              <span className="planet-world-zone" style={{ color: planet.color }}>{z.label}</span>
            </Html>
          ))}
          {shown !== null && flatPlaces[shown] && <Label p={flatPlaces[shown]} reduced={reduced} />}
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={4} maxDistance={45} maxPolarAngle={Math.PI * 0.48}
            autoRotate={!reduced && hover === null && sel === null} autoRotateSpeed={0.25} />
          {q.bloomScale > 0 && (
            <EffectComposer multisampling={q.msaa}>
              <Bloom intensity={(reduced ? 0.3 : 0.55) * q.bloomScale} luminanceThreshold={0.65} luminanceSmoothing={0.3} mipmapBlur />
              <Vignette offset={0.3} darkness={0.7} />
            </EffectComposer>
          )}
        </Canvas>
      )}

      <section className="glass hud-panel world-panel panel-in absolute inset-x-3 bottom-32 z-[14] flex max-h-[45dvh] flex-col gap-3 overflow-y-auto p-3 text-sm min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]" aria-label={`${planet.name} workspace`}>
        {!flat && <div className="planet-world-head" style={{ borderColor: planet.color }} aria-live="polite">
          {err ? <span className="error" role="alert">{err}</span> : !scene ? <span className="muted" role="status">{t("common.loading")}</span> : <>
            <span>{scene.summary}{fresh ? `, ${fresh} new today` : ""}</span>
            {sel !== null && flatPlaces[sel] && <span className="muted">{flatPlaces[sel].label}: {flatPlaces[sel].sub}</span>}
          </>}
        </div>}
        {children}
      </section>

      <button className="chip world-back absolute bottom-28 right-3 z-[15] min-[900px]:bottom-24 min-[900px]:right-[32rem]" onClick={onClose}>{t("arch.backGalaxy")}</button>
    </div>
  );
}
