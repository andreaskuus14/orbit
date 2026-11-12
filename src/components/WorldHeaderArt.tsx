"use client";
// Wide obsidian header art for a world's panel (public/ui/headers). Decorative and lazy; it fills only the space right of the title.
import { useEffect, useRef } from "react";
import type { PanelId } from "@/lib/planets";

export function WorldHeaderArt({ id }: { id: PanelId }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => el.toggleAttribute("data-thin", e.contentRect.width < 40)); // a sliver reads as a glitch
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (id === "profile") return null;
  return <img ref={ref} src={`/ui/headers/${id}.webp`} width={1200} height={300} loading="lazy" decoding="async" alt="" aria-hidden="true" draggable={false} className="world-header-art" />;
}
