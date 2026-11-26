"use client";
// One explorable world for each of the six workspace planets (OPERATIONS, LIFE, VAULT, ANALYTICS, BUSINESS):
// the planet's live data as places (planet-worlds-pure), drawn as instanced shapes in one light canvas, with the
// planet's own workspace panel beside it. Same shell as the other worlds (MemoryWorld): mount-later canvas, warm
// compile, lean quality, GL recovery, paused frameloop. LIFE data is read from ORBIT's own API and never leaves it.
import { WorldEmblem } from "./WorldEmblem";
import { WorldHeaderArt } from "./WorldHeaderArt";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars, PerformanceMonitor } from "@react-three/drei";
import { ChipLayer, ChipProjector, ShiftForPanel, WorldFX, WorldLights, useChipRig } from "./world-kit";
import { CAMERA, SceneFor, THEME, buildModel, sceneChips } from "./PlanetScenes";
import { SCENE_SOURCE } from "@/lib/planet-scenes-pure";
import { useGlRecovery } from "./useGlRecovery";
import { useLeanQuality } from "./useLeanQuality";
import { useMountLater, WarmCompile } from "./WarmCompile";
import { worldTier } from "@/lib/world-realism-pure";
import type { QualityMode } from "@/lib/quality-pure";
import { planetById } from "@/lib/planets";
import type { PlanetWorldId } from "@/lib/planet-worlds-pure";
import { useT } from "./i18n";
import { PlanetBoundary } from "./PlanetBoundary";
import { SHELL_WORLDS, WorldShellContext, ZONE_WORDS } from "./world-shell";

export default function PlanetWorld({ id, flat, reduced, quality = "auto", onClose, paused = false, bare = false, children }: {
  id: PlanetWorldId; flat?: boolean; reduced: boolean; quality?: QualityMode; onClose: () => void; paused?: boolean; children: ReactNode; // children: the planet's workspace panel
  bare?: boolean; // the child is a whole planet shell (design language: header, close, sheet): no glass, header or back chip of our own
}) {
  const glr = useGlRecovery();
  const later = useMountLater();
  const q = useLeanQuality(quality);
  const { t, lang } = useT();
  const planet = planetById(id)!;
  const [json, setJson] = useState<unknown>(null);
  const [err, setErr] = useState("");

  useEffect(() => { // the panel edits the same data: refresh the scene every 30 s while visible
    if (paused) return;
    let live = true;
    const load = () => fetch(SCENE_SOURCE[id], { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Could not load ${planet.name} (${r.status})`);
      if (live) { setJson(j); setErr(""); }
    }).catch((e: Error) => { if (live) setErr(e.message); });
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [id, paused, planet.name]);

  const model = useMemo(() => (json ? buildModel(id, json, Date.now()) : null), [id, json]);
  const chips = useMemo(() => (model ? sceneChips(model, t as never, (k) => ZONE_WORDS[lang][k] ?? k) : []), [model, t, lang]);
  const rig = useChipRig();
  const summary = model?.m.summary ?? null;
  const shell = SHELL_WORLDS.includes(id);
  const shellCtx = useMemo(() => ({ onClose, summary }), [onClose, summary]);
  const cam = CAMERA[id], th = THEME[id];

  return (
    <div role="region" className="absolute inset-0 globe-in" aria-label={`${planet.name}: ${t(`planet.${id}.blurb`)}`} style={{ background: th.bg }}>
      {!flat && later && (<PlanetBoundary name={`${id}-scene`} quiet>
        <Canvas key={glr.key} onCreated={glr.onCreated} frameloop={paused ? "never" : reduced ? "demand" : "always"} camera={{ position: cam.pos, fov: 45, near: 0.1, far: 300 }}
          dpr={[1, q.dpr]} gl={{ antialias: false, powerPreference: "high-performance" }}>
          {quality === "auto" && <PerformanceMonitor onDecline={q.onDecline} />}
          <WarmCompile world={id} />
          <color attach="background" args={[th.bg]} />
          <fog attach="fog" args={[th.bg, 26, 70]} />
          <WorldLights color={th.glow} keyLight={th.key} tier={worldTier(q.bloomScale, q.msaa)} />
          {id !== "life" && <Stars radius={90} depth={40} count={reduced ? 600 : Math.min(1500, q.stars)} factor={2} fade speed={reduced ? 0 : 0.15} />}
          {model && <SceneFor s={model} reduced={reduced} />}
          <ShiftForPanel />
          <ChipProjector rig={rig} chips={chips} />
          <OrbitControls makeDefault target={cam.target} enableDamping dampingFactor={0.08} minDistance={cam.min} maxDistance={cam.max} maxPolarAngle={Math.PI * 0.47}
            autoRotate={!reduced} autoRotateSpeed={0.18} />
          <WorldFX scale={q.bloomScale} msaa={q.msaa} reduced={reduced} />
        </Canvas>
        <ChipLayer rig={rig} chips={chips} />
      </PlanetBoundary>)}

      {bare ? (
        <div className="world-shell absolute inset-x-3 bottom-32 z-[14] flex max-h-[45dvh] min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[27.5rem]">{children}</div>
      ) : shell ? ( // the panel brings its own PlanetShell (header, close, status): no second header, no back chip
        <WorldShellContext.Provider value={shellCtx}>
          <div className="world-shell-slot panel-in absolute inset-x-3 bottom-32 z-[14] flex h-[55dvh] flex-col min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:top-[4.5rem] min-[900px]:right-3 min-[900px]:h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]">{children}</div>
        </WorldShellContext.Provider>
      ) : <>
        <section className="glass hud-panel world-panel panel-in absolute inset-x-3 bottom-32 z-[14] flex max-h-[45dvh] flex-col gap-3 overflow-y-auto p-3 text-sm min-[900px]:inset-x-auto min-[900px]:bottom-auto min-[900px]:right-3 min-[900px]:top-[4.5rem] min-[900px]:max-h-[calc(100dvh-11rem)] min-[900px]:w-[30rem]" aria-label={`${planet.name} workspace`}>
          <h2 className="brand world-header flex items-center gap-2 text-base"><WorldEmblem id={id} size={28} />{t(`planet.${id}`)}<WorldHeaderArt id={id} /></h2>
          {!flat && <div className="planet-world-head" style={{ borderColor: planet.color }} aria-live="polite">
            {err ? <span className="error" role="alert">{err}</span> : !model ? <span className="muted" role="status">{t("common.loading")}</span> : <>
              <span>{summary}</span>
            </>}
          </div>}
          {children}
        </section>

        <button className="chip world-back absolute bottom-28 right-3 z-[15] min-[900px]:bottom-24 min-[900px]:right-[32rem]" onClick={onClose}>{t("arch.backGalaxy")}</button>
      </>}
    </div>
  );
}
