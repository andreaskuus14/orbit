"use client";
// Planet workspace frame (G01): header (planet name, one line of context, one primary action), a tab row of views, then the
// chosen view. Secondary views sit behind a "More" menu at the end of the row (every view stays one click away). Inside a drawer the shell already shows the planet name, so CSS hides this title (.drawer .ws-title). The last view per planet is remembered on this device. Pure rules: lib/planet-view-pure.ts.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { planetById } from "@/lib/planets";
import { pickView, viewKey } from "@/lib/view-key-pure";
import { withView } from "@/lib/deeplink-pure";
import { nextTab, splitTabs } from "@/lib/ui-state-pure";
import { useT } from "./i18n";

export type View<V extends string> = { id: V; label: string; secondary?: boolean };

export function useWorkspaceView<V extends string>(planet: string, views: readonly View<V>[]) {
  const ids = views.map((v) => v.id);
  const [view, setView] = useState<V>(ids[0]);
  useEffect(() => { try { setView(pickView(localStorage.getItem(viewKey(planet)), ids)); } catch { /* no storage: first view */ } }, [planet]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (v: V) => {
    setView(v); try { localStorage.setItem(viewKey(planet), v); } catch { /* this session only */ }
    const h = withView(location.hash, planet, v); // the link's view and the remembered view stay the same
    if (h !== location.hash) history.replaceState(history.state, "", location.pathname + location.search + h);
  };
  return [view, choose] as const;
}

export default function WorkspaceFrame<V extends string>({ planet, title, context, action, views, view, onView, children }: {
  planet: string; title: string; context?: ReactNode; action?: ReactNode; views: readonly View<V>[]; view: V; onView: (v: V) => void; children: ReactNode;
}) {
  const { t } = useT();
  const { row, more } = splitTabs(views, view);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => { // close on a click outside the menu
    if (!menu) return;
    const off = (e: PointerEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMenu(false); };
    addEventListener("pointerdown", off);
    return () => removeEventListener("pointerdown", off);
  }, [menu]);
  const move = (e: KeyboardEvent, i: number) => {
    const j = nextTab(e.key, i, row.length);
    if (j === null) return;
    e.preventDefault();
    const next = row[j].id;
    onView(next); document.getElementById(`${planet}-tab-${next}`)?.focus();
  };
  const pick = (v: V) => { setMenu(false); onView(v); requestAnimationFrame(() => document.getElementById(`${planet}-tab-${v}`)?.focus()); };
  // The selected tab's pill slides to it (one element measured after layout) instead of the border jumping between chips.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const box = tabsRef.current, el = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !el) { setPill(null); return; }
    const measure = () => setPill({ x: el.offsetLeft, w: el.offsetWidth });
    measure();
    const ro = new ResizeObserver(measure); ro.observe(box);
    return () => ro.disconnect();
  }, [view, row.length]);
  // Switching tabs: the new view rises in (no remount, so nothing the views share refetches). Skipped on first paint and with reduced motion.
  const panelRef = useRef<HTMLDivElement>(null), first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = panelRef.current;
    if (!el?.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  }, [view]);
  const tone = { "--planet": planetById(planet)?.color ?? "#22d3ee" } as CSSProperties;
  return (
    <div className="ws space-y-3 text-sm" data-ws={planet} style={tone}>
      <header className="ws-head flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><h2 className="ws-title text-[12px] font-medium muted">{title}</h2>{context && <div className="ws-ctx muted text-[12px]">{context}</div>}</div>
        {action}
      </header>
      <div ref={moreRef} className="space-y-1.5" onKeyDown={(e) => { if (e.key === "Escape" && menu) { e.stopPropagation(); setMenu(false); document.getElementById(`${planet}-more`)?.focus(); } }}>
        <div className="flex items-center gap-1.5">
          <div ref={tabsRef} role="tablist" aria-label={title} className="ws-tabs flex min-w-0 gap-1.5">
            {pill && <span className="ws-pill" aria-hidden="true" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
            {row.map((v, i) => (
              <button key={v.id} id={`${planet}-tab-${v.id}`} role="tab" aria-selected={view === v.id} aria-controls={`${planet}-tabpanel`} tabIndex={view === v.id ? 0 : -1}
                className="chip ws-tab" onClick={() => onView(v.id)} onKeyDown={(e) => move(e, i)}>
                {v.label}
              </button>
            ))}
          </div>
          {more.length > 0 && (
            <button id={`${planet}-more`} type="button" className="chip ws-more muted shrink-0" aria-expanded={menu} aria-controls={`${planet}-more-menu`} onClick={() => setMenu((m) => !m)}>
              {t("ws.more")} {menu ? "▴" : "▾"}
            </button>
          )}
        </div>
        {menu && more.length > 0 && (
          <ul id={`${planet}-more-menu`} className="ws-menu glass flex flex-wrap gap-1.5 rounded-lg p-1.5" aria-label={t("ws.moreAria", { title })}>
            {more.map((v, i) => (
              <li key={v.id}><button type="button" className="chip" autoFocus={i === 0} onClick={() => pick(v.id)}>{v.label}</button></li>
            ))}
          </ul>
        )}
      </div>
      <div ref={panelRef} id={`${planet}-tabpanel`} role="tabpanel" aria-labelledby={`${planet}-tab-${view}`} className="ws-panel space-y-3">{children}</div>
    </div>
  );
}
