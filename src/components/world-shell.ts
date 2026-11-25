"use client";
// A planet world (PlanetWorld) tells the panel inside it how to close the world, so a panel that brings its own PlanetShell
// (header with its own close button) can drop the world's old header and back chip. SHELL_WORLDS lists those planets.
import { createContext, useContext } from "react";
import type { PlanetWorldId } from "@/lib/planet-worlds-pure";

export const SHELL_WORLDS: readonly PlanetWorldId[] = ["operations", "life", "analytics", "business"]; // vault is "bare"
export const WorldShellContext = createContext<{ onClose: () => void; summary: string | null } | null>(null);
export const useWorldShell = () => useContext(WorldShellContext);
/** The OPERATIONS world's hall names in his language (the scene builder names them in English). */
export const ZONE_WORDS: Record<"en" | "et", Record<string, string>> = {
  en: { running: "Working", queued: "Waiting", waiting: "Needs you", done: "Done", failed: "Didn't work" },
  et: { running: "Töös", queued: "Ootab", waiting: "Vajab sind", done: "Valmis", failed: "Ei õnnestunud" },
};
