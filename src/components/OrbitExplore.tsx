"use client";
import { PLANETS, type PanelId } from "@/lib/planets";
import { WorldEmblem } from "./WorldEmblem";
import { useT } from "./i18n";
import { isPlanetWorld } from "@/lib/planet-worlds-pure";

// Intent loading: share Next's module cache without downloading every world at startup.
export function warmWorld(id: PanelId) {
  const load = id === "intelligence" ? () => import("./NewsGlobe").then((m) => { m.warmGlobe(); })
    : id === "studio" ? () => import("./StudioWorld")
    : id === "creation" ? () => import("./DevWorld")
    : id === "agents" ? () => import("./AgentsStation")
    : id === "arch" ? () => import("./ArchWorld")
    : id === "memory" ? () => import("./MemoryWorld")
    : isPlanetWorld(id) ? () => import("./PlanetWorld") : null;
  if (load) void load().catch(() => {}); // opening the world still owns loading/error handling
}

export function WorldLoading() {
  return <div className="world-loading" role="status"><span className="world-loading-ring" aria-hidden="true" /><p>Opening workspace…</p></div>;
}

export function OrbitExplore({ selected, onSelect }: { selected: PanelId | null; onSelect: (id: PanelId) => void }) {
  const { t } = useT();
  return <>
    <button className="chip explore-trigger" popoverTarget="orbit-explore">{t("explore.open")} <span aria-hidden="true">↗</span></button>
    <nav id="orbit-explore" popover="auto" className="orbit-explore" aria-label={t("explore.label")}>
      <div className="explore-heading"><span>{t("explore.heading")}</span><button className="chip" popoverTarget="orbit-explore" popoverTargetAction="hide" aria-label={t("explore.close")}>{t("common.close")}</button></div>
      <button className="explore-core" popoverTarget="orbit-explore" popoverTargetAction="hide" onClick={() => onSelect("core")} aria-current={selected === "core" ? "page" : undefined}>
        <WorldEmblem id="core" size={36} /><span><b>CORE</b><small>{t("explore.core")}</small></span><span aria-hidden="true">↗</span>
      </button>
      <div className="explore-grid">{PLANETS.map((p) => <button key={p.id} popoverTarget="orbit-explore" popoverTargetAction="hide"
        onPointerEnter={() => warmWorld(p.id)} onFocus={() => warmWorld(p.id)} onClick={() => onSelect(p.id)} aria-current={selected === p.id ? "page" : undefined}>
        <WorldEmblem id={p.id} size={36} /><b>{t(`planet.${p.id}`)}</b><small>{t(`planet.${p.id}.blurb`)}</small><span aria-hidden="true">↗</span>
      </button>)}</div>
    </nav>
  </>;
}
