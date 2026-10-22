"use client";
import { PLANETS, type PanelId } from "@/lib/planets";

// Intent loading: share Next's module cache without downloading every world at startup.
export function warmWorld(id: PanelId) {
  const load = id === "intelligence" ? () => import("./NewsGlobe").then((m) => { m.warmGlobe(); })
    : id === "studio" ? () => import("./StudioWorld")
    : id === "creation" ? () => import("./DevWorld")
    : id === "agents" ? () => import("./AgentsStation")
    : id === "theater" ? () => import("./TheaterWorld")
    : id === "arch" ? () => import("./ArchWorld")
    : id === "memory" ? () => import("./MemoryWorld") : null;
  if (load) void load().catch(() => {}); // opening the world still owns loading/error handling
}

export function WorldLoading() {
  return <div className="world-loading" role="status"><span className="world-loading-ring" aria-hidden="true" /><p>Opening workspace…</p></div>;
}

export function OrbitExplore({ selected, onSelect }: { selected: PanelId | null; onSelect: (id: PanelId) => void }) {
  return <>
    <button className="chip explore-trigger" popoverTarget="orbit-explore">Explore <span aria-hidden="true">↗</span></button>
    <nav id="orbit-explore" popover="auto" className="orbit-explore" aria-label="Explore workspaces">
      <div className="explore-heading"><span>Your universe</span><button className="chip" popoverTarget="orbit-explore" popoverTargetAction="hide" aria-label="Close workspace navigation">Close</button></div>
      <button className="explore-core" popoverTarget="orbit-explore" popoverTargetAction="hide" onClick={() => onSelect("core")} aria-current={selected === "core" ? "page" : undefined}>
        <span><b>CORE</b><small>Start with a question.</small></span><span aria-hidden="true">↗</span>
      </button>
      <div className="explore-grid">{PLANETS.map((p) => <button key={p.id} popoverTarget="orbit-explore" popoverTargetAction="hide"
        onPointerEnter={() => warmWorld(p.id)} onFocus={() => warmWorld(p.id)} onClick={() => onSelect(p.id)} aria-current={selected === p.id ? "page" : undefined}>
        <b>{p.name}</b><small>{p.blurb}</small><span aria-hidden="true">↗</span>
      </button>)}</div>
    </nav>
  </>;
}
