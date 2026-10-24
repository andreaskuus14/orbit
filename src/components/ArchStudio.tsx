"use client";
// ARCH studio panel (roadmap 5.1, 5.3, 5.4): import an iPhone splat scan, get a sketch critique, browse the precedent library.
// Heavy work stays off the main thread: scans parse in the splat worker, photos shrink via createImageBitmap/OffscreenCanvas.
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_MAX_SPLATS } from "@/lib/splat-pure";
import { scanNote, searchStudio, studioItems, studioLinks, type Critique, type StudioItem, type StudioMemory } from "@/lib/arch-studio-pure";
import type { ScanData, SplatWorker } from "./SplatCloud";

const BRIEF_KEY = "orbit.arch.brief";
const MAX_SCAN_BYTES = 1024 ** 3; // a bigger .ply won't fit in a browser tab's memory anyway
const ICON: Record<StudioItem["kind"], string> = { lesson: "📚", scan: "◍", critique: "✎", note: "·" };
const ASPECTS = ["proportion", "circulation", "light", "structure"] as const;

/** A phone photo shrunk to ≤1600 px JPEG (fits the model's image limit; Safari also turns HEIC into JPEG here). */
async function shrink(f: File): Promise<File> {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new File([await c.convertToBlob({ type: "image/jpeg", quality: 0.85 })], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

export function ArchStudio({ worker, lesson, lessonKey, onScan, onTeach, bump }: {
  worker: SplatWorker; lesson: { building: string; text: string } | null; lessonKey: string;
  onScan: (s: ScanData) => void; onTeach: (topic: string) => void; bump: number;
}) {
  const [scanMsg, setScanMsg] = useState(""), [scanBusy, setScanBusy] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null), [brief, setBrief] = useState("");
  const [crit, setCrit] = useState<Critique | null>(null), [critMsg, setCritMsg] = useState(""), [critBusy, setCritBusy] = useState(false);
  const [rows, setRows] = useState<StudioMemory[]>([]), [q, setQ] = useState(""), [open, setOpen] = useState<string | null>(null), [libMsg, setLibMsg] = useState("");
  useEffect(() => { try { setBrief(localStorage.getItem(BRIEF_KEY) ?? ""); } catch { /* private mode */ } }, []);
  useEffect(() => { try { localStorage.setItem(BRIEF_KEY, brief); } catch { /* private mode */ } }, [brief]);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/arch/studio").catch(() => null);
    const j = await r?.json().catch(() => null);
    if (r?.ok && Array.isArray(j?.rows)) { setRows(j.rows); setLibMsg(""); } else setLibMsg(j?.error ?? "Couldn't load the library.");
  }, []);
  useEffect(() => { void refresh(); }, [refresh, bump]);

  const items = useMemo(() => studioItems(rows), [rows]);
  const links = useMemo(() => studioLinks(items), [items]);
  const shown = useMemo(() => searchStudio(items, q), [items, q]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const linked = (id: string) => links.flatMap((l) => (l.a === id ? [l.b] : l.b === id ? [l.a] : [])).map((x) => byId.get(x)!).filter(Boolean);

  async function importScan(f: File) {
    if (f.size > MAX_SCAN_BYTES) return setScanMsg("That scan is over 1 GB; export a smaller one (Scaniverse: lower quality, or crop).");
    setScanBusy(true); setScanMsg(`Reading ${f.name}…`);
    try {
      const r = await worker.call({ parse: f, max: DEFAULT_MAX_SPLATS, store: true });
      const vault = `${f.name.replace(/\.[^.]+$/, "") || "scan"}.splat`;
      onScan({ ...r, name: vault, bytes: null });
      setScanMsg(`${r.count.toLocaleString("en")} splats${r.count < r.total ? ` (of ${r.total.toLocaleString("en")}, downsampled)` : ""}. Saving to VAULT…`);
      const fd = new FormData();
      fd.append("file", new File([r.bytes as Uint8Array<ArrayBuffer>], vault, { type: "application/octet-stream" }));
      const up = await fetch("/api/vault", { method: "POST", body: fd });
      const uj = await up.json().catch(() => ({}));
      const saved: string | undefined = uj.saved?.[0];
      if (!up.ok || !saved) throw new Error(uj.errors?.[0] ?? uj.error ?? "VAULT refused the scan");
      const { lo, hi } = r.bounds;
      const note = scanNote({ file: f.name, vault: saved, format: r.format, total: r.total, count: r.count, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] }, lessonKey);
      const m = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "document", ...note }) });
      setScanMsg(m.ok ? `Saved as ${saved} in VAULT, linked in MEMORY.` : `Saved as ${saved} in VAULT; the MEMORY note failed.`);
      void refresh();
    } catch (e) { setScanMsg((e as Error).message); } finally { setScanBusy(false); }
  }

  async function openScan(name: string) {
    setScanBusy(true); setScanMsg(`Opening ${name}…`);
    try {
      const r = await fetch(`/api/vault?file=${encodeURIComponent(name)}&raw=1`);
      if (!r.ok) throw new Error(r.status === 404 ? `${name} isn't on this PC (restore it in VAULT if it's cloud-only).` : `Couldn't open ${name} (${r.status}).`);
      const buf = await r.arrayBuffer();
      const s = await worker.call({ parse: buf, max: DEFAULT_MAX_SPLATS, store: false }, [buf]);
      onScan({ ...s, name, bytes: null });
      setScanMsg(`${name}: ${s.count.toLocaleString("en")} splats.`);
    } catch (e) { setScanMsg((e as Error).message); } finally { setScanBusy(false); }
  }

  async function critique() {
    if (!photo || critBusy) return;
    setCritBusy(true); setCritMsg("Reading the sketch…"); setCrit(null);
    try {
      const fd = new FormData();
      fd.append("file", await shrink(photo).catch(() => { throw new Error("This browser can't read that photo; use JPEG or PNG."); }));
      fd.append("brief", brief);
      if (lesson) fd.append("lesson", JSON.stringify(lesson));
      if (lessonKey) fd.append("lessonTag", lessonKey);
      const r = await fetch("/api/arch/critique", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setCrit(j.critique);
      setCritMsg(j.memoryId ? `Saved to MEMORY as a study note${lessonKey ? `, linked to ${lesson?.building}` : ""}.` : `Not saved: ${j.saveError ?? "unknown error"}.`);
      void refresh();
    } catch (e) { setCritMsg((e as Error).message); } finally { setCritBusy(false); }
  }

  return (
    <details className="card space-y-2" aria-label="ARCH studio">
      <summary className="muted cursor-pointer text-[10px] uppercase tracking-widest">Studio · scans · sketch critique · precedents</summary>

      <div className="space-y-1.5">
        <div className="muted text-[10px] uppercase tracking-widest">Scan</div>
        <label className={`chip inline-flex cursor-pointer${scanBusy ? " opacity-50" : ""}`} title="A Gaussian-splat export (.ply or .splat) from Scaniverse or Polycam">
          ◍ Import scan (.ply / .splat)
          <input type="file" accept=".ply,.splat" className="sr-only" disabled={scanBusy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importScan(f); }} />
        </label>
        {scanMsg && <p className="text-xs" aria-live="polite">{scanMsg}</p>}
        <p className="muted text-[11px]">Scaniverse: Share → Export → Splat (.ply). Up to {DEFAULT_MAX_SPLATS.toLocaleString("en")} splats are kept; the file is stored in VAULT.</p>
      </div>

      <div className="space-y-1.5">
        <div className="muted text-[10px] uppercase tracking-widest">Sketch critique</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="chip inline-flex cursor-pointer">✎ {photo ? photo.name.slice(0, 28) : "Photo of a sketch"}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setCrit(null); setCritMsg(""); }} />
          </label>
          <button className="btn" disabled={!photo || critBusy} onClick={() => void critique()}>{critBusy ? "Critiquing…" : "Critique"}</button>
        </div>
        <textarea className="field w-full text-xs" rows={2} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Brief (optional): a 60 m² studio house on a north slope, one bedroom…" aria-label="Design brief" />
        {lesson && <p className="muted text-[11px]">Judged against the open lesson: {lesson.building}.</p>}
        {critMsg && <p className="text-xs" aria-live="polite">{critMsg}</p>}
        {crit && <div className="space-y-1 text-xs">
          <p>{crit.summary}</p>
          {ASPECTS.map((a) => crit[a] && <p key={a}><span className="font-semibold capitalize">{a}. </span>{crit[a]}</p>)}
          {crit.precedent.name && <p><span className="font-semibold">Precedent. </span>{crit.precedent.name}{crit.precedent.why ? `: ${crit.precedent.why}` : ""}{" "}
            <button className="chip" onClick={() => onTeach(crit.precedent.name)}>📚 Teach me this</button></p>}
          {crit.next.length > 0 && <ul className="list-disc pl-4">{crit.next.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>}
      </div>

      <div className="space-y-1.5">
        <div className="muted text-[10px] uppercase tracking-widest">Precedent library · {items.length}</div>
        <input className="field w-full" type="search" placeholder="Search lessons, scans, critiques…" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} aria-label="Search the precedent library" />
        {libMsg && <p className="muted text-xs">{libMsg}</p>}
        {!items.length && !libMsg && <p className="muted text-xs">Saved lessons, imported scans and sketch critiques land here, linked by building.</p>}
        <ul className="space-y-0.5">{shown.slice(0, 60).map((it) => {
          const near = linked(it.id), isOpen = open === it.id;
          return <li key={it.id}>
            <button className="chip w-full justify-between text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.id)}>
              <span><span aria-hidden className="mr-1">{ICON[it.kind]}</span>{it.title}</span>
              <span className="muted num text-[10px]">{near.length ? `${near.length} link${near.length === 1 ? "" : "s"} · ` : ""}{it.created_at.slice(0, 10)}</span>
            </button>
            {isOpen && <div className="space-y-1 px-1 py-1 text-xs">
              <p className="muted whitespace-pre-line">{it.content.slice(0, 700)}{it.content.length > 700 ? "…" : ""}</p>
              <div className="flex flex-wrap gap-1">
                {it.vault && <button className="chip" disabled={scanBusy} onClick={() => void openScan(it.vault!)}>◍ Open scan</button>}
                {it.image && <a className="chip" href={`/api/memories/${it.id}/file`} target="_blank" rel="noreferrer">Sketch ↗</a>}
                {near.map((n) => <button key={n.id} className="chip" onClick={() => setOpen(n.id)} title="Linked by building">{ICON[n.kind]} {n.title.slice(0, 40)}</button>)}
              </div>
            </div>}
          </li>;
        })}</ul>
      </div>
    </details>
  );
}
