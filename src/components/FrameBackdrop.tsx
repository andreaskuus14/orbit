"use client";
// v10: a plate as a parallax backdrop behind a tool (ARCH's editor, CORE's orb). Never takes a pointer event, no labels. Shows only
// when the saved quality is not Low and the viewer has not asked for reduced motion to be off-screen; otherwise renders nothing
// and the tool looks exactly as before.
import { lazy, Suspense, useEffect, useState } from "react";
import { PlanetBoundary } from "./PlanetBoundary";
import { parseQualityMode, worldQuality } from "@/lib/quality-pure";
import { worldTier } from "@/lib/world-realism-pure";
import type { FrameId } from "@/lib/frame-scene-pure";

const FrameScene = lazy(() => import("./FrameScene"));
export function useBackdropOn() {
  const [on, setOn] = useState(false);
  useEffect(() => { try { const w = worldQuality(parseQualityMode(localStorage.getItem("orbit.quality"))); setOn(worldTier(w.bloom, w.msaa) > 0); } catch { setOn(false); } }, []);
  return on;
}
export default function FrameBackdrop({ id, glow, reduced = false, paused = false, dim = 1 }: { id: FrameId; glow: string; reduced?: boolean; paused?: boolean; dim?: number }) {
  return <div className="pointer-events-none absolute inset-0" style={{ opacity: dim }} aria-hidden="true"><PlanetBoundary name={`${id}-backdrop`} quiet><Suspense fallback={null}>
    <FrameScene id={id} chips={[]} onPick={() => {}} reduced={reduced} paused={paused} glow={glow} back="" backdrop /></Suspense></PlanetBoundary></div>;
}
