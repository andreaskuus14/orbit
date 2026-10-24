"use client";
// The DOM side of the one-canvas spike (see Stage.tsx), without three or R3F: Orbit imports useStageActive at first load,
// and importing Stage.tsx there put three + R3F (~880 KB of JS) into the boot bundle, parsed before the first paint.
import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";

let flag: boolean | null = null;
/** Read once per page load; storage can throw (private mode, blocked site data). */
export function oneCanvasOn(): boolean {
  if (flag === null) { try { flag = localStorage.getItem("orbit.oneCanvas") === "1"; } catch { flag = false; } }
  return flag;
}

// A one-slot tunnel (same idea as tunnel-rat behind drei <View>): a world's DOM component renders 3D into another React root.
let slot: ReactNode = null;
export const getSlot = () => slot;
const subs = new Set<() => void>();
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const put = (n: ReactNode) => { slot = n; subs.forEach((f) => f()); };

/** In a world's DOM tree: send children (R3F elements) to the shared canvas. Only one world at a time. */
export function StageIn({ children }: { children: ReactNode }) {
  useLayoutEffect(() => put(children));
  useLayoutEffect(() => () => put(null), []);
  return null;
}

/** True while a world is staged in the shared canvas (re-renders only when that flips, not on every world render). */
export function useStageActive() { return useSyncExternalStore(subscribe, () => slot !== null, () => false); }
