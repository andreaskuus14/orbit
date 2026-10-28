"use client";
// ARCH portfolio (roadmap 8, 6.2): pick saved versions (time machine), give each a title and brief, and ORBIT lays out an A4 landscape
// PDF: render, plan, key numbers, crit highlights, contents. Built in this browser and downloaded; nothing is uploaded or published.
import { useState } from "react";
import { useT } from "./i18n";
import type { Snapshot } from "@/lib/arch-time-pure";
import type { Scene } from "@/lib/arch-pure";
import { APF_MAX, archPortfolioPdf, critHighlights, type ArchProject } from "@/lib/arch-portfolio-pure";

const UI = {
  en: { head: "Portfolio PDF · pick versions", open: "Load saved versions", none: "No saved versions yet: edit the model and the time machine saves them.",
    title: "Portfolio title", name: "Your name", ptitle: "Project title", brief: "Brief: site, programme, the main idea", make: "⬇ Make PDF", making: "Rendering {i}/{n}…",
    picked: "{n} picked (max {max})", done: "Downloaded. Nothing was uploaded.", fail: "Couldn't make the PDF: ", noView: "3D view not ready; the PDF has plans only.", v: "Version" },
  et: { head: "Portfoolio PDF · vali versioonid", open: "Laadi salvestatud versioonid", none: "Salvestatud versioone veel pole: muuda mudelit ja ajamasin salvestab need.",
    title: "Portfoolio pealkiri", name: "Sinu nimi", ptitle: "Projekti pealkiri", brief: "Lähteülesanne: krunt, programm, põhiidee", make: "⬇ Tee PDF", making: "Renderdan {i}/{n}…",
    picked: "{n} valitud (kuni {max})", done: "Alla laaditud. Midagi ei laaditud üles.", fail: "PDF-i ei õnnestunud teha: ", noView: "3D-vaade pole valmis; PDF-is on ainult plaanid.", v: "Versioon" },
} as const;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));
const SETTLE_MS = 900; // blocks ease to a new version in ~0.5 s; wait them out before reading the canvas
const MAX_PX = 1600;

/** Canvas → baseline JPEG bytes for the PDF (the PDF writer embeds JPEG as is; PNG would need its own deflate step). */
function jpegOf(c: HTMLCanvasElement) {
  const k = Math.min(1, MAX_PX / Math.max(c.width, c.height)), o = document.createElement("canvas");
  o.width = Math.round(c.width * k); o.height = Math.round(c.height * k);
  const g = o.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height);
  g.drawImage(c, 0, 0, o.width, o.height);
  const url = o.toDataURL("image/jpeg", 0.88);
  return { w: o.width, h: o.height, bytes: atob(url.slice(url.indexOf(",") + 1)) };
}

/** grab() renders the 3D view and returns its canvas; onPreview shows a version in it (null = back to the live model). */
export function ArchPortfolio({ grab, onPreview }: { grab: () => HTMLCanvasElement | null; onPreview: (s: Scene | null) => void }) {
  const { lang } = useT(), T = UI[lang];
  const [versions, setVersions] = useState<Snapshot[] | null>(null), [msg, setMsg] = useState("");
  const [pick, setPick] = useState<Record<string, { title: string; brief: string }>>({});
  const [title, setTitle] = useState(""), [name, setName] = useState(""), [busy, setBusy] = useState("");
  const picked = (versions ?? []).filter((v) => pick[v.at]);

  async function load() {
    const r = await fetch("/api/arch/versions").catch(() => null), j = await r?.json().catch(() => null);
    if (Array.isArray(j?.versions)) setVersions(j.versions); else setMsg(j?.error ?? T.fail);
  }
  async function make() {
    setMsg("");
    try {
      const r = await fetch("/api/arch/studio").catch(() => null), j = await r?.json().catch(() => null);
      const rows: { content: string; tags: string[] | null }[] = Array.isArray(j?.rows) ? j.rows : []; // no crits → just no highlights
      const projects: ArchProject[] = [];
      for (const [i, v] of picked.entries()) {
        setBusy(fill(T.making, { i: i + 1, n: picked.length }));
        onPreview(v.scene);
        await new Promise((ok) => setTimeout(ok, SETTLE_MS));
        const c = grab();
        let shot = null;
        try { shot = c ? jpegOf(c) : null; } catch { /* tainted or lost context: plan only */ }
        if (!shot && !i) setMsg(T.noView);
        projects.push({ ...pick[v.at], at: v.at, scene: v.scene, shot, crits: critHighlights(rows, v.scene) });
      }
      const pdf = archPortfolioPdf({ title, name, lang, projects });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
      a.download = `${(title || "arch-portfolio").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "arch-portfolio"}.pdf`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setMsg((m) => (m ? `${m} ${T.done}` : T.done));
    } catch (e) { setMsg(T.fail + (e instanceof Error ? e.message : "")); } finally { onPreview(null); setBusy(""); }
  }
  const when = (at: string) => new Date(at).toLocaleString(lang === "et" ? "et-EE" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <details className="card space-y-2" aria-label={T.head} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !versions) void load(); }}>
      <summary className="muted cursor-pointer text-[10px] uppercase tracking-widest">{T.head}</summary>
      {!versions ? <p className="muted text-xs">{msg || "…"}</p> : !versions.length ? <p className="muted text-xs">{T.none}</p> : <>
        <div className="flex flex-wrap gap-1.5">
          <input className="field flex-1" value={title} maxLength={APF_MAX.title} placeholder={T.title} aria-label={T.title} onChange={(e) => setTitle(e.target.value)} />
          <input className="field flex-1" value={name} maxLength={APF_MAX.title} placeholder={T.name} aria-label={T.name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">{[...versions].reverse().map((v) => {
          const n = versions.indexOf(v) + 1, p = pick[v.at], full = !p && picked.length >= APF_MAX.projects;
          return <li key={v.at} className="space-y-1">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!p} disabled={full || !!busy} onChange={(e) => setPick((x) => { const y = { ...x }; if (e.target.checked) y[v.at] = { title: `${T.v} ${n}`, brief: "" }; else delete y[v.at]; return y; })} />
              <span className="num">{T.v} {n} · {when(v.at)}</span><span className="muted">{v.scene.parts.length} · {v.scene.plot.w}×{v.scene.plot.d} m</span>
            </label>
            {p && <div className="space-y-1 pl-5">
              <input className="field w-full text-xs" value={p.title} maxLength={APF_MAX.title} aria-label={T.ptitle} onChange={(e) => setPick((x) => ({ ...x, [v.at]: { ...p, title: e.target.value } }))} />
              <textarea className="field w-full text-xs" rows={3} value={p.brief} maxLength={APF_MAX.brief} placeholder={T.brief} aria-label={T.brief} onChange={(e) => setPick((x) => ({ ...x, [v.at]: { ...p, brief: e.target.value } }))} />
            </div>}
          </li>;
        })}</ul>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn" disabled={!picked.length || !!busy} onClick={() => void make()}>{busy || T.make}</button>
          <span className="muted num text-[10px]">{fill(T.picked, { n: picked.length, max: APF_MAX.projects })}</span>
        </div>
        {msg && <p className="text-xs" aria-live="polite">{msg}</p>}
      </>}
    </details>
  );
}
