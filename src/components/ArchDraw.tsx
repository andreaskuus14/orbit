"use client";
// ARCH studio: sketch photo / reference picture / a few words → a clean, editable floor plan (lib/arch-floorplan-pure) → the 3D
// model, walk-through with the real sun, and files: plan SVG + JSON, measured-drawing PDF, glTF and IFC. Progress shows on the
// shared "Working on it" card. The model only reads the picture (POST /api/arch/plan, on his click); everything else is local.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPE } from "react";
import { ProgressCard } from "./ProgressCard";
import { useT } from "./i18n";
import { cleanPlan, checkPlan, findRooms, nodeMap, openingPoint, planFromRaw, planJson, planStats, planToScene, samplePlan, toSegment, wallEnds, inPoly, FP, type FloorPlan, type FpOpeningKind } from "@/lib/arch-floorplan-pure";
import { drawPlan, planPdf, planSvg, SVG_STYLE, type Shape } from "@/lib/arch-drawing-pure";
import { studioProgress, studioSteps, type StudioInput, type StudioRun } from "@/lib/arch-sketch-pure";
import { toGlb } from "@/lib/arch-gltf-pure";
import { toIfc } from "@/lib/arch-ifc-pure";
import type { Scene } from "@/lib/arch-pure";

type P = [number, number];
const UI_K = 0.14; // metres of drawing per millimetre of label text on screen
const GOLD = "#c9a227";
const save = (name: string, data: BlobPart, type: string) => {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
const css = (s: string): CSSProperties => Object.fromEntries(s.split(";").filter(Boolean).map((kv) => { const [k, v] = kv.split(":"); return [k.trim().replace(/-(\w)/g, (_, c: string) => c.toUpperCase()), v.trim()]; }));
const fileBase = (plan: FloorPlan) => plan.name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "plan";

/** A phone photo shrunk to ≤1600 px JPEG (fits the model's image limit; Safari also turns HEIC into JPEG here). */
async function shrink(f: File): Promise<File> {
  const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return new File([await c.convertToBlob({ type: "image/jpeg", quality: 0.85 })], "picture.jpg", { type: "image/jpeg" });
}

export function ArchDraw({ storeKey, onBuild, onWalk }: { storeKey: string; onBuild: (s: Scene) => void; onWalk: () => void }) {
  const { t, lang } = useT();
  const [kind, setKind] = useState<StudioInput>("sketch");
  const [file, setFile] = useState<File | null>(null), [note, setNote] = useState("");
  const [run, setRun] = useState<StudioRun | null>(null), [now, setNow] = useState(() => Date.now());
  const [plan, setPlan] = useState<FloorPlan | null>(null), [past, setPast] = useState<FloorPlan[]>([]);
  const [msg, setMsg] = useState("");
  const abort = useRef<AbortController | null>(null);
  const key = `orbit.arch.studio.${storeKey}`;
  useEffect(() => { try { const s = localStorage.getItem(key); if (s) setPlan(planFromRaw(JSON.parse(s), "file")); } catch { /* none or private mode */ } }, [key]);
  useEffect(() => { try { if (plan) localStorage.setItem(key, planJson(plan)); } catch { /* private mode */ } }, [key, plan]);
  useEffect(() => { if (run && !run.failed && run.stage === 0) { const i = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(i); } }, [run]);
  useEffect(() => () => abort.current?.abort(), []);

  const edit = (next: FloorPlan, prev: FloorPlan | null = plan) => { if (prev) setPast((p) => [...p.slice(-40), prev]); setPlan(next); };
  const build = (p: FloorPlan) => { const b = planToScene(p); onBuild(b.scene); setMsg([t("as.built"), ...b.notes].join(" ")); };

  /** The local steps after the plan exists: each one is quick, but the card shows them so he sees what was done. */
  async function finish(r: StudioRun, p: FloorPlan) {
    const n = studioSteps(r.kind, lang).length, first = r.kind === "sample" || r.kind === "file" ? 0 : 1;
    for (let s = first; s < n; s++) { setRun({ ...r, stage: s, plan: p }); await new Promise((ok) => setTimeout(ok, 180)); }
    setPast([]); setPlan(p); build(p);
    setRun({ ...r, stage: n, plan: p });
  }
  async function go() {
    abort.current?.abort();
    const r: StudioRun = { kind, stage: 0, startedAt: new Date().toISOString() };
    setRun(r); setMsg(""); setNow(Date.now());
    const fd = new FormData();
    fd.append("kind", kind); fd.append("note", note);
    try {
      if (kind !== "brief") { if (!file) throw new Error(t("as.needPicture")); fd.append("file", await shrink(file).catch(() => file)); }
      const ac = new AbortController(); abort.current = ac;
      const res = await fetch("/api/arch/plan", { method: "POST", body: fd, signal: ac.signal });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.plan) throw new Error(j.error ?? `HTTP ${res.status}`);
      await finish(r, planFromRaw(j.plan, kind));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setRun({ ...r, failed: e instanceof Error ? e.message : String(e) });
    }
  }
  const sample = () => void finish({ kind: "sample", stage: 0, startedAt: new Date().toISOString() }, samplePlan());
  async function openFile(f: File) {
    try { await finish({ kind: "file", stage: 0, startedAt: new Date().toISOString() }, planFromRaw(JSON.parse(await f.text()), "file")); }
    catch { setMsg(t("as.badFile")); }
  }

  const progress = run ? studioProgress(run, lang, now) : null;
  const rooms = useMemo(() => (plan ? findRooms(plan) : []), [plan]);
  const checks = useMemo(() => (plan ? checkPlan(plan, rooms) : []), [plan, rooms]);
  const st = plan ? planStats(plan, rooms) : null;
  const bad = checks.filter((c) => c.level === "fail" || c.level === "warn"), good = checks.filter((c) => c.level === "ok" || c.level === "info");
  const date = new Date().toISOString().slice(0, 10);

  return (
    <section className="card space-y-2" aria-labelledby="arch-draw-h">
      <h3 id="arch-draw-h" className="h3">{t("as.title")}</h3>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("as.from")}>
        {(["sketch", "photo", "brief"] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} className="chip text-xs" onClick={() => setKind(k)}>{t(`as.${k}`)}</button>)}
      </div>
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        {kind !== "brief" && <label className="block text-xs">{t(kind === "sketch" ? "as.pickSketch" : "as.pickPhoto")}
          <input className="field mt-0.5 w-full text-xs" type="file" accept="image/*" capture={kind === "sketch" ? "environment" : undefined} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
        <textarea className="field w-full text-xs" rows={kind === "brief" ? 3 : 1} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={t(kind === "brief" ? "as.briefPh" : "as.notePh")} aria-label={t(kind === "brief" ? "as.brief" : "as.note")} />
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn" disabled={(kind !== "brief" && !file) || (kind === "brief" && note.trim().length < 3) || (!!run && !run.failed && run.stage < studioSteps(run.kind, lang).length)}>{t("as.go")}</button>
          <button type="button" className="link text-xs" onClick={sample}>{t("as.sample")}</button>
          <label className="link cursor-pointer text-xs">{t("as.load")}<input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} /></label>
        </div>
      </form>
      {progress && <ProgressCard p={progress} onAction={(a) => (a.kind === "retry" ? void go() : onWalk())} />}
      {msg && <p className="muted text-xs" aria-live="polite">{msg}</p>}
      {plan && st && <>
        <PlanEditor plan={plan} onChange={edit} onPreview={setPlan} />
        <p className="text-xs num">{t("as.stats", { rooms: st.rooms, net: st.net.toFixed(1), gross: st.gross.toFixed(1) })}</p>
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" disabled={!past.length} onClick={() => { setPlan(past[past.length - 1]); setPast((p) => p.slice(0, -1)); }}>↶ {t("as.undo")}</button>
          <button className="chip" onClick={() => build(plan)}>▣ {t("as.build")}</button>
          <button className="chip" onClick={() => { build(plan); onWalk(); }}>🚶 {t("as.walk")}</button>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label={t("as.files")}>
          <button className="chip text-xs" onClick={() => save(`${fileBase(plan)}-plan.svg`, planSvg(plan), "image/svg+xml")}>⬇ {t("as.svg")}</button>
          <button className="chip text-xs" onClick={() => save(`${fileBase(plan)}-plan.json`, planJson(plan), "application/json")}>⬇ {t("as.json")}</button>
          <button className="chip text-xs" onClick={() => { const r = planPdf(plan, { date, sourceLine: t(`as.src.${plan.source}`) }); save(`${fileBase(plan)}-plan-1-${r.scale}.pdf`, r.bytes as Uint8Array<ArrayBuffer>, "application/pdf"); }}>⬇ {t("as.pdf")}</button>
          <button className="chip text-xs" onClick={() => save(`${fileBase(plan)}.glb`, toGlb(planToScene(plan).scene, plan.name) as Uint8Array<ArrayBuffer>, "model/gltf-binary")}>⬇ {t("as.glb")}</button>
          <button className="chip text-xs" onClick={() => save(`${fileBase(plan)}.ifc`, toIfc(planToScene(plan).scene, { name: plan.name }), "application/x-step")}>⬇ {t("as.ifc")}</button>
        </div>
        {plan.unsure.length > 0 && <details className="text-xs" open><summary className="cursor-pointer">{t("as.unsure")}</summary><ul className="muted list-disc pl-4">{plan.unsure.map((u, i) => <li key={i}>{u}</li>)}</ul></details>}
        <div className="text-xs" aria-label={t("as.checks")}>
          <ul className="space-y-0.5">{bad.map((c) => <li key={c.id} className={c.level === "fail" ? "error" : ""}>{c.level === "fail" ? "✕" : "!"} {c.text}{c.source && <> · <a className="underline" href={c.source.url} target="_blank" rel="noopener noreferrer" title={c.source.title}>{t("as.source")}</a></>}</li>)}</ul>
          <details><summary className="muted cursor-pointer">{t("as.okN", { n: good.length })}</summary>
            <ul className="muted space-y-0.5 pl-3">{good.map((c) => <li key={c.id}>✓ {c.text}{c.source && <> · <a className="underline" href={c.source.url} target="_blank" rel="noopener noreferrer" title={c.source.title}>{t("as.source")}</a></>}</li>)}</ul></details>
          <p className="muted text-[11px]">{t("as.notLaw")}</p>
        </div>
      </>}
    </section>
  );
}

type Sel = { kind: "wall" | "opening" | "room"; id: string } | null;
type Drag = { kind: "wall"; ids: string[]; axis: "x" | "z"; from: number; base: FloorPlan } | { kind: "opening"; id: string; base: FloorPlan };

/** The plan drawn the same way as the files, with hit targets: drag a wall to move it (the whole straight run moves, joined
 *  walls stretch), drag a door or window along its wall, click to select, then add/remove/rename from the small toolbar. */
function PlanEditor({ plan, onChange, onPreview }: { plan: FloorPlan; onChange: (p: FloorPlan, prev?: FloorPlan) => void; onPreview: (p: FloorPlan) => void }) {
  const { t } = useT();
  const svg = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<Sel>(null), [drag, setDrag] = useState<Drag | null>(null);
  const [adding, setAdding] = useState<P | null | false>(false); // false: not adding; null: waiting for the first point
  const [name, setName] = useState("");
  const d = useMemo(() => drawPlan(plan), [plan]), nm = useMemo(() => nodeMap(plan), [plan]);
  const { x0, z0, x1, z1 } = d.box;
  const at = (e: { clientX: number; clientY: number }): P => {
    const m = svg.current?.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const snapG = (v: number) => Math.round(v / FP.grid) * FP.grid;
  /** Nodes of the straight run through wall id (same line, joined end to end). */
  const run = (id: string): { ids: string[]; axis: "x" | "z" } | null => {
    const w = plan.walls.find((x) => x.id === id), e = w && wallEnds(plan, w, nm);
    if (!e) return null;
    const h = e[0][1] === e[1][1], v = e[0][0] === e[1][0];
    if (!h && !v) return null;
    const line = h ? e[0][1] : e[0][0], ids = new Set([w!.a, w!.b]);
    let grew = true;
    while (grew) { grew = false;
      for (const x of plan.walls) { const q = wallEnds(plan, x, nm)!; const on = h ? q[0][1] === line && q[1][1] === line : q[0][0] === line && q[1][0] === line;
        if (on && (ids.has(x.a) || ids.has(x.b)) && !(ids.has(x.a) && ids.has(x.b))) { ids.add(x.a); ids.add(x.b); grew = true; } } }
    return { ids: [...ids], axis: h ? "z" : "x" };
  };
  function down(e: RPE<SVGElement>, s: Sel) {
    e.stopPropagation();
    if (adding !== false) return;
    setSel(s);
    if (s?.kind === "room") setName(d.rooms.find((r) => r.id === s.id)?.name ?? "");
    if (s?.kind === "wall") { const r = run(s.id); if (r) { const p = at(e); setDrag({ kind: "wall", ids: r.ids, axis: r.axis, from: r.axis === "x" ? p[0] : p[1], base: plan }); } }
    if (s?.kind === "opening") setDrag({ kind: "opening", id: s.id, base: plan });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function move(e: RPE<SVGSVGElement>) {
    if (!drag) return;
    const p = at(e);
    if (drag.kind === "wall") {
      const dv = snapG((drag.axis === "x" ? p[0] : p[1]) - drag.from);
      onPreview({ ...drag.base, nodes: drag.base.nodes.map((n) => (drag.ids.includes(n.id) ? { ...n, [drag.axis]: Math.round((n[drag.axis] + dv) * 1000) / 1000 } : n)) });
    } else {
      const o = drag.base.openings.find((x) => x.id === drag.id)!, w = drag.base.walls.find((x) => x.id === o.wall)!, e2 = wallEnds(drag.base, w)!;
      const L = Math.hypot(e2[1][0] - e2[0][0], e2[1][1] - e2[0][1]), s = toSegment(p, e2[0], e2[1]).s * L;
      const a = Math.min(L - FP.end - o.w / 2, Math.max(FP.end + o.w / 2, snapG(s)));
      onPreview({ ...drag.base, openings: drag.base.openings.map((x) => (x.id === o.id ? { ...x, at: Math.round(a * 1000) / 1000 } : x)) });
    }
  }
  function up() {
    if (!drag) return;
    const base = drag.base; setDrag(null);
    if (plan !== base) onChange(cleanPlan(plan), base); // undo goes back to before the drag
  }
  function addOpening(kind: FpOpeningKind) {
    if (sel?.kind !== "wall") return;
    const w = plan.walls.find((x) => x.id === sel.id), e = w && wallEnds(plan, w, nm);
    if (!e) return;
    const used = plan.openings.filter((o) => o.wall === w!.id).map((o) => openingPoint(plan, o, nm)!);
    const mid: P = [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2], L = Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]);
    const spot = [0.5, 0.25, 0.75].map((k): P => [e[0][0] + (e[1][0] - e[0][0]) * k, e[0][1] + (e[1][1] - e[0][1]) * k]).find((p) => used.every((u) => Math.hypot(u[0] - p[0], u[1] - p[1]) > 1.4)) ?? mid;
    const next = cleanPlan(plan, [{ kind, p: spot, w: Math.min(kind === "door" ? FP.door.w : FP.window.w, L - 2 * FP.end) }]);
    if (next.openings.length === plan.openings.length) return;
    onChange(next);
  }
  function remove() {
    if (!sel) return;
    if (sel.kind === "wall") onChange(cleanPlan({ ...plan, walls: plan.walls.filter((w) => w.id !== sel.id), openings: plan.openings.filter((o) => o.wall !== sel.id) }));
    if (sel.kind === "opening") onChange(cleanPlan({ ...plan, openings: plan.openings.filter((o) => o.id !== sel.id) }));
    setSel(null);
  }
  function resize(dw: number) {
    if (sel?.kind !== "opening") return;
    onChange(cleanPlan({ ...plan, openings: plan.openings.map((o) => (o.id === sel.id ? { ...o, w: Math.max(0.4, Math.round((o.w + dw) * 100) / 100) } : o)) }));
  }
  function rename() {
    const r = sel?.kind === "room" ? d.rooms.find((x) => x.id === sel.id) : null;
    if (!r || !name.trim()) return;
    const labels = plan.labels.filter((l) => !inPoly([l.x, l.z], r.poly)); // one name per room
    onChange({ ...plan, labels: [...labels, { name: name.trim().slice(0, 40), x: r.centre[0], z: r.centre[1] }] });
  }
  function click(e: RPE<SVGSVGElement>) {
    if (adding === false) { setSel(null); return; }
    const p: P = at(e).map(snapG) as P;
    if (adding === null) { setAdding(p); return; }
    const a = adding, h = Math.abs(p[0] - a[0]) >= Math.abs(p[1] - a[1]), b: P = h ? [p[0], a[1]] : [a[0], p[1]]; // square to the stronger direction
    setAdding(false);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) return;
    const id = `n${plan.nodes.length + 1}x`, id2 = `${id}b`;
    onChange(cleanPlan({ ...plan, nodes: [...plan.nodes, { id, x: a[0], z: a[1] }, { id: id2, x: b[0], z: b[1] }], walls: [...plan.walls, { id: `w${plan.walls.length + 1}x`, a: id, b: id2, t: FP.innerT }] }));
  }
  const ref = sel?.id;
  const shape = (s: Shape, i: number) => {
    const hot = s.ref && s.ref === ref, st = { ...css(SVG_STYLE[s.cls]), ...(hot && s.cls === "wall" ? { fill: GOLD } : hot && s.t !== "text" ? { stroke: GOLD } : {}) };
    if (s.t === "poly") return <polygon key={i} points={s.pts.map((p) => p.join(",")).join(" ")} style={st} />;
    if (s.t === "line") return <line key={i} x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} style={st} />;
    if (s.t === "path") return <polyline key={i} points={s.pts.map((p) => p.join(",")).join(" ")} style={st} />;
    return <text key={i} x={s.p[0]} y={s.p[1]} fontSize={s.size * UI_K} textAnchor={s.anchor} style={{ ...st, fontFamily: "Helvetica, Arial, sans-serif", pointerEvents: "none" }} transform={s.rot ? `rotate(${s.rot} ${s.p[0]} ${s.p[1]})` : undefined}>{s.s}</text>;
  };
  return (
    <div className="space-y-1">
      <svg ref={svg} viewBox={`${x0} ${z0} ${x1 - x0} ${z1 - z0}`} className="w-full touch-none select-none rounded" style={{ background: "#fbfaf7", aspectRatio: `${x1 - x0} / ${z1 - z0}`, maxHeight: "60dvh", cursor: adding !== false ? "crosshair" : drag ? "grabbing" : "default" }}
        role="img" aria-label={t("as.planAria", { n: d.rooms.length })} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click}>
        {d.shapes.map(shape)}
        {plan.walls.map((w) => { const e = wallEnds(plan, w, nm); return e && <line key={w.id} x1={e[0][0]} y1={e[0][1]} x2={e[1][0]} y2={e[1][1]} stroke="transparent" strokeWidth={0.45} style={{ cursor: "grab", pointerEvents: "stroke" }} onPointerDown={(ev) => down(ev, { kind: "wall", id: w.id })} onClick={(ev) => ev.stopPropagation()} />; })}
        {plan.openings.map((o) => { const p = openingPoint(plan, o, nm); return p && <circle key={o.id} cx={p[0]} cy={p[1]} r={0.32} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={(ev) => down(ev, { kind: "opening", id: o.id })} onClick={(ev) => ev.stopPropagation()} />; })}
        {d.rooms.map((r) => <circle key={r.id} cx={r.centre[0]} cy={r.centre[1]} r={0.45} fill={ref === r.id ? "rgba(201,162,39,0.25)" : "transparent"} style={{ cursor: "pointer" }} onPointerDown={(ev) => down(ev, { kind: "room", id: r.id })} onClick={(ev) => ev.stopPropagation()} />)}
        {adding && <circle cx={adding[0]} cy={adding[1]} r={0.12} fill={GOLD} />}
      </svg>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button className="chip" aria-pressed={adding !== false} onClick={() => setAdding((v) => (v === false ? null : false))}>{adding === false ? `+ ${t("as.addWall")}` : t("as.addWallHow")}</button>
        {sel?.kind === "wall" && <><button className="chip" onClick={() => addOpening("door")}>+ {t("as.addDoor")}</button><button className="chip" onClick={() => addOpening("window")}>+ {t("as.addWindow")}</button><button className="chip" onClick={remove}>✕ {t("as.delWall")}</button></>}
        {sel?.kind === "opening" && <><button className="chip" onClick={() => resize(-0.1)}>− 10 cm</button><button className="chip" onClick={() => resize(0.1)}>+ 10 cm</button><button className="chip" onClick={remove}>✕ {t("as.delOpening")}</button>
          <span className="muted num">{Math.round((plan.openings.find((o) => o.id === sel.id)?.w ?? 0) * 1000)} mm</span></>}
        {sel?.kind === "room" && <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); rename(); }}><input className="field w-32 text-xs" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label={t("as.rename")} /><button className="chip">{t("as.rename")}</button></form>}
      </div>
      <p className="muted text-[11px]">{t("as.hint")}</p>
    </div>
  );
}
