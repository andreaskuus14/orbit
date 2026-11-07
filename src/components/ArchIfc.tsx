"use client";
// ARCH: open an .ifc from another program as a read-only reference model in the 3D view. web-ifc runs in this tab, so the file
// never leaves the PC. The file's site and true north feed the sun, and the shadow-study sheet exports what the sun does to it.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { RootState } from "@react-three/fiber";
import type { IfcAPI } from "web-ifc";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-pure";
import { checkIfcSize, GROUP_COLOR, IFC_GROUPS, shadowStudyTimes } from "@/lib/arch-ifc-import-pure";
import type { IfcModel } from "@/lib/arch-ifc-read";
import { sunDirection } from "@/lib/sun-pure";
import { toModel } from "@/lib/arch-site-pure";

let api: Promise<IfcAPI> | null = null;
/** web-ifc's single-threaded WASM, fetched on first use (the multi-threaded build needs cross-origin isolation). */
function ifcApi(): Promise<IfcAPI> {
  return (api ??= (async () => {
    const { IfcAPI } = await import("web-ifc");
    const a = new IfcAPI(), wasm = new URL("web-ifc/web-ifc.wasm", import.meta.url).href;
    await a.Init(() => wasm, true);
    return a;
  })().catch((e) => { api = null; throw e; }));
}
async function openIfc(file: File): Promise<IfcModel> {
  checkIfcSize(file.size);
  const [{ readIfc }, a, bytes] = await Promise.all([import("@/lib/arch-ifc-read"), ifcApi(), file.arrayBuffer()]);
  return readIfc(a, new Uint8Array(bytes));
}

/** The model as one mesh per group. Glass is see-through and casts no shadow (direct sun passes it). */
export function IfcModelView({ model }: { model: IfcModel }) {
  const parts = useMemo(() => IFC_GROUPS.flatMap((g) => {
    const m = model.meshes[g];
    if (!m) return [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
    geo.computeBoundingSphere();
    return [{ g, geo }];
  }), [model]);
  useEffect(() => () => parts.forEach((p) => p.geo.dispose()), [parts]);
  return <group>{parts.map(({ g, geo }) => <mesh key={g} geometry={geo} castShadow={g !== "window"} receiveShadow>
    <meshStandardMaterial color={GROUP_COLOR[g]} roughness={0.9} side={THREE.DoubleSide} transparent={g === "window"} opacity={g === "window" ? 0.45 : 1} depthWrite={g !== "window"} />
  </mesh>)}</group>;
}

/** Renders the current view at the 9 shadow-study sun positions (moving the scene's shadow-casting light) into one PNG sheet. */
async function shadowSheet(st: RootState, o: { lat: number; lon: number; north: number; year: number; title: string }): Promise<Blob> {
  let light: THREE.DirectionalLight | null = null;
  st.scene.traverse((x) => { if (!light && x instanceof THREE.DirectionalLight && x.castShadow) light = x; });
  const sun = light as THREE.DirectionalLight | null;
  if (!sun) throw new Error("No sun light in the view.");
  const { gl, scene, camera } = st, src = gl.domElement, w = 640, h = Math.round((w * src.height) / Math.max(1, src.width)), head = 56, cap = 26;
  const out = document.createElement("canvas"); out.width = 3 * w; out.height = head + 3 * (h + cap);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out.width, out.height); ctx.fillStyle = "#222";
  ctx.font = "bold 20px sans-serif"; ctx.fillText(o.title, 12, 26);
  ctx.font = "14px sans-serif"; ctx.fillText(`${o.lat.toFixed(4)}°, ${o.lon.toFixed(4)}° · true north ${o.north}° clockwise from model −Z · local solar time · ${o.year}`, 12, 46);
  const keep = sun.position.clone(), keepI = sun.intensity, R = keep.length() || 40;
  try {
    shadowStudyTimes(o.year, o.lon).forEach(({ label, at }, i) => {
      const d = toModel(sunDirection(o.lat, o.lon, at), o.north), up = d.y > 0, x = (i % 3) * w, y = head + Math.floor(i / 3) * (h + cap);
      sun.position.set(d.x * R, Math.max(0.5, d.y * R), d.z * R); sun.intensity = up ? 1.6 : 0.05;
      gl.render(scene, camera);
      ctx.drawImage(src, x, y + cap, w, h);
      ctx.fillStyle = "#222"; ctx.fillText(up ? label : `${label} · sun below the horizon`, x + 8, y + 18);
    });
  } finally { sun.position.copy(keep); sun.intensity = keepI; gl.render(scene, camera); }
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error("Could not make the PNG."))), "image/png"));
}

export type OpenIfc = { name: string; model: IfcModel };
/** Open / inspect / export card. `view` is the live R3F state (null while the canvas is off). */
export function IfcPanel({ ifc, onOpen, onClose, view, sun }: { ifc: OpenIfc | null; onOpen: (x: OpenIfc) => void; onClose: () => void;
  view: () => RootState | null; sun: { lat: number; lon: number; north: number; year: number } }) {
  const { t: tr } = useT();
  const [busy, setBusy] = useState<"" | "read" | "sheet">(""), [err, setErr] = useState("");
  const open = async (file: File | undefined) => {
    if (!file) return;
    setBusy("read"); setErr("");
    try { onOpen({ name: file.name, model: await openIfc(file) }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };
  const sheet = async () => {
    const st = view(); if (!st || !ifc) return;
    setBusy("sheet"); setErr("");
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await shadowSheet(st, { ...sun, title: `${ifc.model.info.project || ifc.name} · shadow study` }));
      a.download = `${ifc.name.replace(/\.ifc$/i, "")}-shadow-study-${sun.year}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };
  const i = ifc?.model.info;
  return (
    <div className="card space-y-1.5 text-xs" aria-label={tr("arch.ifc3d")}>
      <div className="muted text-[10px] uppercase tracking-widest">{tr("arch.ifc3d")}{ifc ? ` · ${ifc.name}` : ""}</div>
      {!ifc && <label className="block">{tr("arch.ifc3dOpen")}<input className="block" type="file" accept=".ifc" disabled={!!busy} aria-label={tr("arch.ifc3dOpen")} onChange={(e) => { void open(e.target.files?.[0]); e.target.value = ""; }} /></label>}
      {busy === "read" && <p className="muted" role="status">{tr("arch.ifc3dReading")}</p>}
      {i && <>
        <p><b>{i.project || ifc!.name}</b> · {i.schema} · {tr("arch.ifc3dSize", { w: i.size[0], d: i.size[2], h: i.size[1] })}</p>
        <p>{i.site ? tr("arch.ifc3dSite", { lat: i.site.lat.toFixed(4), lon: i.site.lon.toFixed(4), n: i.north }) : tr("arch.ifc3dNoSite")}</p>
        {i.storeys.length > 0 && <p>{tr("arch.ifc3dStoreys")}: {i.storeys.map((s) => `${s.name || "—"} ${s.elevation} m`).join(" · ")}</p>}
        <p>{tr("arch.ifc3dParts")}: {IFC_GROUPS.filter((g) => i.counts[g]).map((g) => `${i.counts[g]} ${tr(`arch.ifcG.${g}` as Key)}`).join(", ")} · {i.triangles.toLocaleString("en")} △</p>
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" disabled={!!busy} onClick={() => void sheet()}>⬇ {tr("arch.ifc3dSheet")}</button>
          <button className="chip" disabled={!!busy} onClick={onClose}>{tr("arch.ifc3dClose")}</button>
        </div>
        {busy === "sheet" && <p className="muted" role="status">{tr("arch.ifc3dSheetBusy")}</p>}
        <p className="muted text-[11px]">{tr("arch.ifc3dSheetNote")}</p>
      </>}
      {err && <p className="error" role="alert">{err}</p>}
      <p className="muted text-[11px]">{tr("arch.ifc3dHint")}</p>
    </div>
  );
}
