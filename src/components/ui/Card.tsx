"use client";
// Card: one thing that matters (a job in progress, something that needs him, a result). Title, one line, optional body,
// at most two actions (one primary). Tones: needs (amber edge), error (red edge), accent (the planet's colour).
import type { ReactNode } from "react";

export function Card({ title, sub, tone, actions, children, as = "article", label }: {
  title?: ReactNode; sub?: ReactNode; tone?: "needs" | "error" | "accent"; actions?: ReactNode; children?: ReactNode;
  as?: "article" | "div" | "li"; label?: string;
}) {
  const Tag = as;
  return (
    <Tag className="pu-card" data-tone={tone} aria-label={label}>
      {(title || sub) && <div>{title && <h4 className="pu-card-title">{title}</h4>}{sub && <p className="pu-card-sub">{sub}</p>}</div>}
      {children}
      {actions && <div className="pu-card-actions">{actions}</div>}
    </Tag>
  );
}
