// Wide obsidian header art for a world's panel (public/ui/headers). Decorative and lazy; the .world-header scrim keeps the title at >= 4.5:1.
import type { PanelId } from "@/lib/planets";

export function WorldHeaderArt({ id }: { id: PanelId }) {
  if (id === "profile") return null;
  return <img src={`/ui/headers/${id}.webp`} width={1200} height={300} loading="lazy" decoding="async" alt="" aria-hidden="true" draggable={false} className="world-header-art" />;
}
