"use client";
// Empty, loading and error, the same on every planet. Empty says what to do next (one action). Loading is a skeleton of
// the rows that will come (no spinner wall, no layout jump). Error says what happened in plain words + Try again.
import type { ReactNode } from "react";
import { Button } from "./Button";

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <div className="pu-state" data-kind="empty"><p className="pu-state-title">{title}</p>{text && <p className="pu-state-text">{text}</p>}{action}</div>;
}
export function Loading({ rows = 3, label }: { rows?: number; label: string }) {
  return <div className="pu-skel" role="status" aria-label={label}>{Array.from({ length: Math.max(1, Math.min(6, rows)) }, (_, i) => <i key={i} />)}</div>;
}
export function ErrorState({ title, text, retryLabel, onRetry }: { title: string; text?: string; retryLabel?: string; onRetry?: () => void }) {
  return (
    <div className="pu-state" data-kind="error" role="alert">
      <p className="pu-state-title">{title}</p>{text && <p className="pu-state-text">{text}</p>}
      {onRetry && retryLabel && <Button size="sm" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}
