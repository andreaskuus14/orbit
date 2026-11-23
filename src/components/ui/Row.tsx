"use client";
// List row: lead (icon/dot), title + one line under it, trailing meta or one action. Clickable rows are one <button>
// (whole row is the target); a row with its own trailing button is a plain <div> so buttons never nest.
import type { ReactNode } from "react";

export function Row({ title, sub, lead, leadTone, trail, onClick, current }: {
  title: ReactNode; sub?: ReactNode; lead?: ReactNode; leadTone?: "accent"; trail?: ReactNode; onClick?: () => void; current?: boolean;
}) {
  const inner = <>
    {lead !== undefined && <span className="pu-row-lead" data-tone={leadTone} aria-hidden="true">{lead}</span>}
    <span className="pu-row-text"><span className="pu-row-title">{title}</span>{sub && <span className="pu-row-sub">{sub}</span>}</span>
    {trail && <span className="pu-row-trail">{trail}</span>}
  </>;
  if (onClick) return <button type="button" className="pu-row" onClick={onClick} aria-current={current || undefined}>{inner}</button>;
  return <div className="pu-row">{inner}</div>;
}
