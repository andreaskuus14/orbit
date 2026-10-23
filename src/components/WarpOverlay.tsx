"use client";
// Warp jump (plan #5): during the 1.2 s flight into a world, light streaks rush out from the centre and the screen flashes in
// the planet's colour as the world mounts underneath, then clears. CSS only (conic streaks + radial mask): no shader, no NaN risk.
import { useEffect, useState } from "react";
import { planetById, type PanelId } from "@/lib/planets";

export function WarpOverlay({ target, landed, reduced }: { target: PanelId | null; landed: PanelId | null; reduced: boolean }) {
  const [shown, setShown] = useState<{ id: PanelId; out: boolean } | null>(null);
  useEffect(() => {
    if (reduced) return;
    if (target) { setShown({ id: target, out: false }); return; }
    // the flight ended (world mounted, or cancelled): play the exit half, then unmount
    setShown((s) => (s && s.id === landed ? { ...s, out: true } : null)); // cancelled flights just vanish, no flash
    const t = setTimeout(() => setShown(null), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- landed is read when the flight ends
  }, [target, reduced]);
  if (!shown) return null;
  const color = planetById(shown.id)?.color ?? "#7dd3fc";
  return <div aria-hidden className={`warp${shown.out ? " warp-out" : ""}`} style={{ ["--warp" as string]: color }} />;
}

/** Clicking into a world: a 420 ms iridescent burst of light streaks over the world as it mounts. CSS only, and
 *  pointer-events: none, so it never blocks input; re-keyed per world so each entry replays it. */
export function WarpBurst({ id, reduced }: { id: PanelId | null; reduced: boolean }) {
  if (!id || reduced) return null;
  return <div key={id} aria-hidden className="warp-burst" style={{ ["--warp" as string]: planetById(id)?.color ?? "#7dd3fc" }} />;
}
