"use client";
// Chips: a suggestion he can click (fills the ask box), a filter that toggles (`pressed`), or a static tag (`onClick` absent).
import type { ReactNode } from "react";
import { uiSound } from "./sound";

export function Chip({ children, onClick, pressed, icon, title }: {
  children: ReactNode; onClick?: () => void; pressed?: boolean; icon?: ReactNode; title?: string;
}) {
  if (!onClick) return <span className="pu-chip" data-static="" title={title}>{icon}{children}</span>;
  return (
    <button type="button" className="pu-chip" aria-pressed={pressed} title={title}
      onClick={() => { if (pressed !== undefined) uiSound(pressed ? "toggleOff" : "toggleOn"); else uiSound("tap"); onClick(); }}>
      {icon}{children}
    </button>
  );
}
