"use client";
// v10: the owner's frame as a world's scene (FrameScene) with its own boundary, lazy load and "Back" label. Worlds render this
// instead of their procedural <Canvas> on tier > 0; any failure (texture, WebGL) renders nothing and the world's panel still works.
import { lazy, Suspense } from "react";
import { PlanetBoundary } from "./PlanetBoundary";
import { useT } from "./i18n";
import type { Chip } from "./world-kit";
import type { FrameId } from "@/lib/frame-scene-pure";

const FrameScene = lazy(() => import("./FrameScene"));
export default function FrameWorld({ id, chips, onPick, reduced, paused, glow }: { id: FrameId; chips: Chip[]; onPick: (id: string) => void; reduced: boolean; paused?: boolean; glow: string }) {
  const { t } = useT();
  return <PlanetBoundary name={`${id}-frame`} quiet><Suspense fallback={null}><FrameScene id={id} chips={chips} onPick={onPick} reduced={reduced} paused={paused} glow={glow} back={t("link.back")} /></Suspense></PlanetBoundary>;
}
