"use client";
// Planet workspace frame (G01): header (planet name, one line of context, one primary action), a tab row of views, then the
// chosen view. The last view per planet is remembered on this device. Pure rules: lib/workspace-pure.ts.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { pickView, viewKey } from "@/lib/workspace-pure";

export type View<V extends string> = { id: V; label: string; secondary?: boolean };

export function useWorkspaceView<V extends string>(planet: string, views: readonly View<V>[]) {
  const ids = views.map((v) => v.id);
  const [view, setView] = useState<V>(ids[0]);
  useEffect(() => { try { setView(pickView(localStorage.getItem(viewKey(planet)), ids)); } catch { /* no storage: first view */ } }, [planet]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (v: V) => { setView(v); try { localStorage.setItem(viewKey(planet), v); } catch { /* this session only */ } };
  return [view, choose] as const;
}

export default function WorkspaceFrame<V extends string>({ planet, title, context, action, views, view, onView, children }: {
  planet: string; title: string; context?: ReactNode; action?: ReactNode; views: readonly View<V>[]; view: V; onView: (v: V) => void; children: ReactNode;
}) {
  const move = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = views[(i + d + views.length) % views.length].id;
    onView(next); document.getElementById(`${planet}-tab-${next}`)?.focus();
  };
  return (
    <div className="space-y-3 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><h2 className="text-[11px] uppercase tracking-widest muted">{title}</h2>{context && <div className="muted text-[12px]">{context}</div>}</div>
        {action}
      </header>
      <div role="tablist" aria-label={title} className="flex flex-wrap gap-1.5">
        {views.map((v, i) => (
          <button key={v.id} id={`${planet}-tab-${v.id}`} role="tab" aria-selected={view === v.id} aria-controls={`${planet}-tabpanel`} tabIndex={view === v.id ? 0 : -1}
            className={`chip ${v.secondary ? "muted" : ""}`} style={view === v.id ? { borderColor: "var(--cyan)" } : undefined} onClick={() => onView(v.id)} onKeyDown={(e) => move(e, i)}>
            {v.label}
          </button>
        ))}
      </div>
      <div id={`${planet}-tabpanel`} role="tabpanel" aria-labelledby={`${planet}-tab-${view}`} className="space-y-3">{children}</div>
    </div>
  );
}
