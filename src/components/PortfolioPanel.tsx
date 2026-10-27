"use client";
// Portfolio builder (roadmap 3): captures from the ARCH 3D view plus STUDIO/game pictures he picks → an A4 landscape PDF and one
// static HTML page, both downloaded for him to send or upload himself. Saved locally via /api/portfolio; ORBIT publishes nothing.
import { useEffect, useRef, useState } from "react";
import { KIND_LABEL, PMAX, PROJECT_KINDS, draftInput, emptyPortfolio, portfolioHtml, portfolioPdf, type Portfolio, type Project, type ProjectKind, type Shot } from "@/lib/portfolio-pure";

const MAX_PX = 1800; // long side: sharp in print at A4, small enough to keep the saved file sane
/** Any drawable (the WebGL canvas, an uploaded picture) → a JPEG data URL no bigger than MAX_PX. */
function toJpeg(src: CanvasImageSource, w: number, h: number) {
  const k = Math.min(1, MAX_PX / Math.max(w, h)), c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // JPEG has no alpha
  g.drawImage(src, 0, 0, c.width, c.height);
  return { src: c.toDataURL("image/jpeg", 0.88), w: c.width, h: c.height };
}
const save = (name: string, data: BlobPart, type: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const uid = () => Math.random().toString(36).slice(2, 10);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "portfolio";

/** grab() renders the 3D view once and returns its canvas (null while no view is up); caption describes what is on screen. */
export function PortfolioPanel({ grab, caption }: { grab: () => HTMLCanvasElement | null; caption: string }) {
  const [p, setP] = useState<Portfolio | null>(null), [sel, setSel] = useState(""), [msg, setMsg] = useState("");
  const [draft, setDraft] = useState(""), [drafting, setDrafting] = useState(false);
  const dirty = useRef(false);

  async function load() {
    if (p) return;
    const r = await fetch("/api/portfolio").catch(() => null), j = await r?.json().catch(() => null);
    if (r?.ok && j?.portfolio) { setP(j.portfolio); setSel(j.portfolio.projects[0]?.id ?? ""); } else setMsg(j?.error ?? "Couldn't load the portfolio.");
  }
  // autosave a second after the last change
  useEffect(() => {
    if (!p || !dirty.current) return;
    const t = setTimeout(async () => {
      dirty.current = false;
      const r = await fetch("/api/portfolio", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolio: p }) }).catch(() => null);
      const j = await r?.json().catch(() => null);
      setMsg(r?.ok ? "Saved on this PC." : `Not saved: ${j?.error ?? "ORBIT isn't reachable"}`);
    }, 1000);
    return () => clearTimeout(t);
  }, [p]);
  const edit = (fn: (p: Portfolio) => Portfolio) => { dirty.current = true; setP((x) => fn(x ?? emptyPortfolio())); };
  const editProject = (id: string, fn: (pr: Project) => Project) => edit((x) => ({ ...x, projects: x.projects.map((pr) => (pr.id === id ? fn(pr) : pr)) }));
  const project = p?.projects.find((x) => x.id === sel);

  const newProject = (kind: ProjectKind, title = "") => {
    const pr: Project = { id: uid(), kind, title: title || `${KIND_LABEL[kind]} project`, year: String(new Date().getFullYear()), text: "", shots: [] };
    edit((x) => ({ ...x, projects: [...x.projects, pr].slice(0, PMAX.projects) })); setSel(pr.id); setDraft("");
    return pr.id;
  };
  const addShot = (img: { src: string; w: number; h: number }, cap: string) => {
    const id = project?.id ?? newProject("arch", "ARCH model");
    if (project && project.shots.length >= PMAX.shots) return setMsg(`A project holds ${PMAX.shots} pictures; start a new one or remove some.`);
    const s: Shot = { id: uid(), ...img, caption: cap.slice(0, PMAX.caption), at: new Date().toISOString().slice(0, 10) };
    editProject(id, (pr) => ({ ...pr, shots: [...pr.shots, s] }));
    setMsg(`Added to ${project?.title ?? "a new ARCH project"}.`);
  };
  function capture() {
    const c = grab();
    if (!c) return setMsg("Open the 3D view first.");
    try { addShot(toJpeg(c, c.width, c.height), caption); } catch { setMsg("This browser couldn't read the 3D view."); }
  }
  async function upload(files: FileList) {
    for (const f of Array.from(files)) {
      try { const b = await createImageBitmap(f); addShot(toJpeg(b, b.width, b.height), f.name.replace(/\.[^.]+$/, "")); b.close(); } catch { setMsg(`${f.name}: use a JPEG or PNG.`); }
    }
  }
  async function askDraft() {
    if (!project || drafting) return;
    setDrafting(true); setDraft(""); setMsg("");
    try {
      const r = await fetch("/api/portfolio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: draftInput(project) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setDraft(j.text);
    } catch (e) { setMsg((e as Error).message); } finally { setDrafting(false); }
  }
  const move = <T,>(a: T[], i: number, d: number) => { const b = [...a], j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; };

  return (
    <details className="card space-y-2" aria-label="Portfolio builder" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) void load(); }}>
      <summary className="muted cursor-pointer text-[10px] uppercase tracking-widest">Portfolio · captures → PDF and web page</summary>
      {!p ? <p className="muted text-xs">{msg || "Loading…"}</p> : <>
        <div className="flex flex-wrap gap-1.5">
          <input className="field flex-1" value={p.title} maxLength={PMAX.title} onChange={(e) => edit((x) => ({ ...x, title: e.target.value }))} aria-label="Portfolio title" placeholder="Portfolio" />
          <input className="field flex-1" value={p.name} maxLength={PMAX.title} onChange={(e) => edit((x) => ({ ...x, name: e.target.value }))} aria-label="Your name" placeholder="Your name" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button className="btn" onClick={capture} title="Saves what the 3D view shows now into the selected project">📷 Capture for portfolio</button>
          <label className="chip inline-flex cursor-pointer" title="Screenshots of STUDIO or game work, renders, sketches">+ Pictures
            <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
          </label>
          {PROJECT_KINDS.map((k) => <button key={k} className="chip" onClick={() => newProject(k)}>+ {KIND_LABEL[k]}</button>)}
        </div>
        {msg && <p className="text-xs" aria-live="polite">{msg}</p>}

        <ul className="space-y-0.5">{p.projects.map((pr, i) => <li key={pr.id} className="flex gap-1">
          <button className="chip flex-1 justify-between text-left" aria-pressed={pr.id === sel} onClick={() => { setSel(pr.id); setDraft(""); }}>
            <span>{String(i + 1).padStart(2, "0")} {pr.title}</span><span className="muted num text-[10px]">{KIND_LABEL[pr.kind]} · {pr.shots.length} pic</span></button>
          <button className="chip" aria-label={`Move ${pr.title} up`} disabled={!i} onClick={() => edit((x) => ({ ...x, projects: move(x.projects, i, -1) }))}>↑</button>
        </li>)}</ul>
        {!p.projects.length && <p className="muted text-xs">Capture the 3D view or add pictures to start a project. Each project becomes one page.</p>}

        {project && <div className="space-y-1.5" aria-label={`Project ${project.title}`}>
          <div className="flex flex-wrap gap-1.5">
            <input className="field flex-1" value={project.title} maxLength={PMAX.title} aria-label="Project title" onChange={(e) => editProject(project.id, (x) => ({ ...x, title: e.target.value }))} />
            <select className="field" value={project.kind} aria-label="Project kind" onChange={(e) => editProject(project.id, (x) => ({ ...x, kind: e.target.value as ProjectKind }))}>
              {PROJECT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
            <input className="field w-16" value={project.year} maxLength={20} aria-label="Year" onChange={(e) => editProject(project.id, (x) => ({ ...x, year: e.target.value }))} />
          </div>
          <textarea className="field w-full text-xs" rows={5} maxLength={PMAX.text} value={project.text} aria-label="Project text"
            placeholder="What it is, the main idea, what you learned. Or write a few notes and press Draft text."
            onChange={(e) => editProject(project.id, (x) => ({ ...x, text: e.target.value }))} />
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="chip" disabled={drafting} onClick={() => void askDraft()} title="One quick-model call; uses the title, captions and your notes">{drafting ? "Drafting…" : "✎ Draft text"}</button>
            <span className="muted num text-[10px]">{project.text.length}/{PMAX.text}</span>
            <button className="chip error ml-auto" onClick={() => { if (confirm(`Delete “${project.title}” and its pictures?`)) { edit((x) => ({ ...x, projects: x.projects.filter((y) => y.id !== project.id) })); setSel(""); } }}>Delete project</button>
          </div>
          {draft && <div className="card space-y-1 text-xs">
            <p className="whitespace-pre-line">{draft}</p>
            <div className="flex gap-1.5">
              <button className="chip" onClick={() => { editProject(project.id, (x) => ({ ...x, text: draft })); setDraft(""); }}>Use this (then edit)</button>
              <button className="chip" onClick={() => setDraft("")}>Discard</button>
            </div>
          </div>}
          <ul className="grid grid-cols-2 gap-1.5">{project.shots.map((s, i) => <li key={s.id} className="space-y-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, nothing for next/image to optimise */}
            <img src={s.src} alt={s.caption} className="w-full rounded" />
            <input className="field w-full text-[11px]" value={s.caption} maxLength={PMAX.caption} aria-label="Caption" onChange={(e) => editProject(project.id, (x) => ({ ...x, shots: x.shots.map((y) => (y.id === s.id ? { ...y, caption: e.target.value } : y)) }))} />
            <div className="flex gap-1">
              <button className="chip" disabled={!i} aria-label="Move picture earlier" onClick={() => editProject(project.id, (x) => ({ ...x, shots: move(x.shots, i, -1) }))}>←</button>
              <button className="chip error" aria-label="Remove picture" onClick={() => editProject(project.id, (x) => ({ ...x, shots: x.shots.filter((y) => y.id !== s.id) }))}>✕</button>
            </div>
          </li>)}</ul>
        </div>}

        <div className="flex flex-wrap gap-1.5">
          <button className="chip" disabled={!p.projects.length} onClick={() => save(`${slug(p.title)}.pdf`, portfolioPdf(p) as Uint8Array<ArrayBuffer>, "application/pdf")}>⬇ PDF (A4 landscape)</button>
          <button className="chip" disabled={!p.projects.length} onClick={() => save(`${slug(p.title)}.html`, portfolioHtml(p), "text/html")}>⬇ Web page (.html)</button>
        </div>
        <p className="muted text-[11px]">The first picture of a project is its hero. Files download to this PC; ORBIT doesn&apos;t upload or send them.</p>
      </>}
    </details>
  );
}
