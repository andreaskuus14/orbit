"use client";
// ARCH "model city" (roadmap 3): his building on a real plot among neighbour blocks. The 3D layer draws the plot, the setback line,
// the street edge, a north arrow and the neighbours (they cast and take the sun study's shadows); the panel edits it all and shows
// coverage, FAR, fit and who shades whom. All maths in arch-site-pure.ts; no model calls.
import { useMemo } from "react";
import { Edges, Line } from "@react-three/drei";
import { isStraightWall, type Face, type Part } from "@/lib/arch-pure";
import { blockPrism, buildingPrisms, edgeRoles, PRESETS, rect, shadedShare, siteStats, wound, type Block, type Pt, type Site } from "@/lib/arch-site-pure";

type SetSite = (f: (s: Site) => Site) => void;
const Y = 0.04;
const loop = (p: Pt[]) => [...p, p[0]].map(([x, z]) => [x, Y, z] as [number, number, number]);

export function SiteLayer({ site, set, parts }: { site: Site; set: SetSite; parts: Part[] }) {
  const st = useMemo(() => siteStats(parts, site), [parts, site]);
  const plot = useMemo(() => wound(site.plot), [site.plot]);
  const street = edgeRoles(plot, site.street).indexOf("street");
  const c = plot.reduce<Pt>((s, [x, z]) => [s[0] + x / plot.length, s[1] + z / plot.length], [0, 0]);
  const r = (site.north * Math.PI) / 180, nx = Math.sin(r), nz = -Math.cos(r); // true north in model axes
  const draft = site.draft;
  return <>
    {/* the town around the plot; while drawing, a click on it adds a plot corner */}
    <mesh rotation-x={-Math.PI / 2} position-y={-0.03} receiveShadow onClick={draft ? (e) => { e.stopPropagation(); set((s) => ({ ...s, draft: [...(s.draft ?? []), [e.point.x, e.point.z]] })); } : undefined}>
      <planeGeometry args={[240, 240]} /><meshStandardMaterial color="#d6d1c7" roughness={1} />
    </mesh>
    <Line points={loop(plot)} color="#1c1917" lineWidth={2} />
    {st.zone && <Line points={loop(st.zone)} color="#c2410c" lineWidth={1.5} dashed dashSize={0.6} gapSize={0.4} />}
    {street >= 0 && <Line points={[plot[street], plot[(street + 1) % plot.length]].map(([x, z]) => [x, Y + 0.01, z] as [number, number, number])} color="#57534e" lineWidth={7} />}
    <Line points={[[c[0], Y, c[1]], [c[0] + nx * 6, Y, c[1] + nz * 6]]} color="#b91c1c" lineWidth={3} />
    <mesh position={[c[0] + nx * 6, Y, c[1] + nz * 6]} rotation={[-Math.PI / 2, 0, -r]}><coneGeometry args={[0.6, 1.4, 3]} /><meshBasicMaterial color="#b91c1c" /></mesh>
    {draft && draft.length > 0 && <Line points={draft.map(([x, z]) => [x, Y + 0.02, z] as [number, number, number])} color="#2563eb" lineWidth={2} />}
    {draft?.map(([x, z], i) => <mesh key={i} position={[x, Y, z]}><sphereGeometry args={[0.25, 10, 8]} /><meshBasicMaterial color="#2563eb" /></mesh>)}
    {site.neighbours.map((b) => <mesh key={b.id} position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
      <boxGeometry args={[b.w, b.h, b.d]} /><meshStandardMaterial color="#bdb6aa" roughness={0.95} /><Edges threshold={20} color="#57534e" />
    </mesh>)}
  </>;
}

function Num({ label, value, on, min = 0, step = 0.5 }: { label: string; value: number; on: (v: number) => void; min?: number; step?: number }) {
  return <label className="flex items-center gap-1 text-xs"><span className="muted">{label}</span>
    <input className="field w-16" type="number" step={step} min={min} value={Math.round(value * 100) / 100} aria-label={label}
      onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(v) && v >= min) on(v); }} /></label>;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
let seq = Date.now();

/** sun: the sun study's direction already in model axes (toModel), or null while the sun study is off. */
export function SitePanel({ site, set, parts, sun }: { site: Site; set: SetSite; parts: Part[]; sun: { x: number; y: number; z: number } | null }) {
  const st = useMemo(() => siteStats(parts, site), [parts, site]);
  const xs = site.plot.map((p) => p[0]), zs = site.plot.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs), bd = Math.max(...zs) - Math.min(...zs);
  const shade = useMemo(() => {
    if (!sun) return null;
    const shell = parts.filter((p) => p.kind === "wall" && !isStraightWall(p)).sort((a, b) => a.y - b.y)[0];
    const me = buildingPrisms(parts), nb = site.neighbours.map(blockPrism);
    const onMe = shell ? shadedShare(rect(shell.x, shell.z, shell.w, shell.d), shell.y + 1.5, nb, sun) : null;
    if (onMe === null && sun.y <= 0) return { night: true as const };
    const onThem = site.neighbours.map((b) => ({ name: b.name, s: shadedShare(rect(b.x, b.z, b.w, b.d), 1.5, me, sun) ?? 0 })).filter((x) => x.s > 0);
    return { night: false as const, onMe, onThem };
  }, [sun, parts, site.neighbours]);
  const setN = (id: string, k: keyof Block, v: number) => set((s) => ({ ...s, neighbours: s.neighbours.map((b) => (b.id === id ? { ...b, [k]: v } : b)) }));
  const m2 = (n: number) => `${Math.round(n)} m²`;

  return (
    <div className="card space-y-2" aria-label="Site: model city">
      <div className="muted text-[10px] uppercase tracking-widest">Site · your building among neighbours</div>
      <div className="flex flex-wrap gap-1">{PRESETS.map((p) => <button key={p.key} className="chip" onClick={() => set((s) => ({ ...s, ...p.site, draft: null }))}>{p.label}</button>)}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Num label="Plot W" value={bw} min={5} on={(w) => set((s) => ({ ...s, plot: rect(0, 0, w, bd) }))} />
        <Num label="D" value={bd} min={5} on={(d) => set((s) => ({ ...s, plot: rect(0, 0, bw, d) }))} />
        {site.draft ? <>
          <button className="chip" disabled={site.draft.length < 3} onClick={() => set((s) => ({ ...s, plot: s.draft!, draft: null }))}>✓ Use {site.draft.length} corners</button>
          <button className="chip" onClick={() => set((s) => ({ ...s, draft: null }))}>Cancel</button>
        </> : <button className="chip" onClick={() => set((s) => ({ ...s, draft: [] }))} title="Click the plot's corners on the ground, in order">✎ Click corners</button>}
      </div>
      {site.draft && <p className="muted text-[11px]" aria-live="polite">Click each corner of the plot on the ground in order ({site.draft.length} so far).</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Num label="North °" value={site.north} min={-360} step={5} on={(v) => set((s) => ({ ...s, north: v }))} />
        <label className="flex items-center gap-1 text-xs"><span className="muted">Street</span>
          <select className="field" value={site.street} aria-label="Street side" onChange={(e) => set((s) => ({ ...s, street: e.target.value as Face }))}>
            {(["n", "e", "s", "w"] as const).map((f) => <option key={f} value={f}>{{ n: "−Z side", e: "+X side", s: "+Z side", w: "−X side" }[f]}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-center gap-2"><span className="muted text-xs">Setbacks, m</span>
        {(["street", "side", "rear"] as const).map((k) => <Num key={k} label={k} value={site.setback[k]} on={(v) => set((s) => ({ ...s, setback: { ...s.setback, [k]: v } }))} />)}
      </div>
      <table className="w-full text-xs"><tbody>
        <tr><td>Plot</td><td className="num text-right">{m2(st.plotArea)}</td><td>Buildable zone</td><td className="num text-right">{m2(st.zoneArea)}</td></tr>
        <tr><td>Footprint</td><td className="num text-right">{m2(st.footprint)}</td><td>Coverage</td><td className="num text-right">{st.coverage.toFixed(1)}%</td></tr>
        <tr><td>Floor area</td><td className="num text-right">{m2(st.floorArea)}</td><td>FAR</td><td className="num text-right">{st.far.toFixed(2)}</td></tr>
      </tbody></table>
      <p className={`text-xs ${st.fits ? "" : "error"}`} aria-live="polite">{st.fits ? "✓ Fits inside the setback line." : !st.zone ? "✗ The setbacks leave no buildable area." : `✗ Outside the setback line: ${st.outside.join(", ")}.`}</p>
      <p className="text-xs" aria-live="polite">{!shade ? "Turn on ☀ Sun study to see shadows at a date and time." : shade.night ? "Sun below the horizon: no shadows." : <>
        Neighbours shade {shade.onMe === null ? "—" : pct(shade.onMe)} of your sunlit ground-floor walls.{" "}
        {shade.onThem.length ? <>You shade {shade.onThem.map((x) => `${x.name} (${pct(x.s)})`).join(", ")}.</> : "You shade no neighbour."}</>}</p>
      <ul className="space-y-1">{site.neighbours.map((b) => <li key={b.id} className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs">{b.name}</span>
        {(["x", "z", "w", "d", "h"] as const).map((k) => <Num key={k} label={k.toUpperCase()} value={b[k]} min={k === "x" || k === "z" ? -200 : 0.5} on={(v) => setN(b.id, k, v)} />)}
        <button className="chip error" onClick={() => set((s) => ({ ...s, neighbours: s.neighbours.filter((x) => x.id !== b.id) }))} aria-label={`Remove ${b.name}`}>×</button>
      </li>)}</ul>
      <button className="chip" onClick={() => set((s) => ({ ...s, neighbours: [...s.neighbours, { id: `n${(seq++).toString(36)}`, name: `Neighbour ${s.neighbours.length + 1}`, x: Math.max(...s.plot.map((p) => p[0])) + 8, z: 0, w: 10, d: 10, h: 8 }] }))}>+ Neighbour block</button>
      <p className="muted text-[11px]">Red dashed line = setbacks, thick grey edge = street, red arrow = north. Setbacks, coverage and FAR limits come from the local detailed plan (detailplaneering): check yours. A study model, not a planning check.</p>
    </div>
  );
}
