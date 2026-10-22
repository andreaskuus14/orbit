"use client";
import { useCallback, useEffect, useState } from "react";
import { leanWorldQuality, worldQuality, type QualityMode } from "@/lib/quality-pure";

/** One-way Auto fallback per mounted world; changing presets starts a fresh measurement. */
export function useLeanQuality(mode: QualityMode) {
  const [lean, setLean] = useState(false);
  useEffect(() => setLean(false), [mode]);
  const onDecline = useCallback(() => { if (mode === "auto") setLean(true); }, [mode]);
  return { ...worldQuality(mode), ...leanWorldQuality(mode, lean), onDecline };
}
