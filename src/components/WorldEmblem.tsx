// One world's emblem (obsidian medallion, public/ui/emblems). Lazy, decorative: the world's name is always next to it as text.
import type { PanelId } from "@/lib/planets";

export function WorldEmblem({ id, size = 28, className = "" }: { id: PanelId; size?: number; className?: string }) {
  if (id === "profile") return null;
  const src = (px: number) => `/ui/emblems/${id}-${px}.webp`;
  return <img src={src(256)} srcSet={`${src(256)} 256w, ${src(512)} 512w`} sizes={`${size}px`} width={size} height={size}
    loading="lazy" decoding="async" alt="" aria-hidden="true" draggable={false} className={`world-emblem ${className}`} />;
}
