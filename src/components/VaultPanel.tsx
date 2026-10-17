"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VOICE_ASK } from "./voice/bus";
import { WorkspacePanel } from "./WorkspacePanel";
import { MAX_FILE, MEMORY_MAX, fmtSize, memoryType, type CloudFile, type Kind } from "@/lib/vault-pure";

type Usage = { bytes: number; count: number };
type Sort = "newest" | "name" | "size";
const ICON: Record<Kind, string> = { image: "IMG", video: "VID", audio: "AUD", pdf: "PDF", text: "TXT", doc: "DOC", other: "FILE" };
const cloudWarn = (r: unknown) => (typeof r === "string" && r.startsWith("failed") ? `Saved on this PC; cloud copy failed: ${r.replace(/^failed: /, "")}` : "");
const JSON_POST = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const raw = (name: string) => `/api/vault?file=${encodeURIComponent(name)}&raw=1`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export function VaultPanel() {
  const [files, setFiles] = useState<CloudFile[]>([]);
  const [use, setUse] = useState<Usage>({ bytes: 0, count: 0 });
  const [cloudOnly, setCloudOnly] = useState<{ name: string; size: number }[]>([]);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [q, setQ] = useState("");
  const [inside, setInside] = useState(false);
  const [hits, setHits] = useState<Record<string, string> | null>(null);
  const [open, setOpen] = useState<CloudFile | null>(null);
  const [text, setText] = useState<{ text: string; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await call<{ files: CloudFile[]; usage: Usage; cloudOnly: { name: string; size: number }[]; cloudError: string | null }>("/api/vault");
      setFiles(r.files); setUse(r.usage); setCloudOnly(r.cloudOnly ?? []); setCloudError(r.cloudError ?? null);
    }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load the vault"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // "Search inside": server searches extracted text (debounced); names are always filtered locally.
  useEffect(() => {
    if (!inside || !q.trim()) { setHits(null); return; }
    const ac = new AbortController(); // a slow older search must not overwrite newer results
    const t = setTimeout(() => {
      call<{ results: { name: string; snippet: string }[] }>(`/api/vault?content=1&q=${encodeURIComponent(q.trim())}`, { signal: ac.signal })
        .then((r) => { if (!ac.signal.aborted) { setErr(""); setHits(Object.fromEntries(r.results.map((x) => [x.name, x.snippet]))); } })
        .catch((e) => { if (!ac.signal.aborted) setErr(e instanceof Error ? e.message : "Search failed"); });
    }, 350);
    return () => { clearTimeout(t); ac.abort(); };
  }, [inside, q, files]); // files: re-run after upload/rename/delete

  useEffect(() => {
    setText(null);
    if (open?.type !== "text") return;
    call<{ text: string; truncated: boolean }>(`/api/vault?file=${encodeURIComponent(open.name)}&preview=1`).then(setText)
      .catch((e) => setErr(e instanceof Error ? e.message : "Preview failed"));
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = files.filter((f) => !needle || f.name.toLowerCase().includes(needle) || (hits && f.name in hits));
    return list.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.size - a.size : b.mtime - a.mtime);
  }, [files, q, hits, sort]);

  async function upload(list: FileList | File[]) {
    const arr = [...list];
    if (!arr.length) return;
    setErr(""); setNote("");
    const saved: string[] = [], errors: string[] = [];
    let pending = false;
    // One file per request: the middleware caps request bodies at 45 MB.
    for (const [i, f] of arr.entries()) {
      if (f.size > MAX_FILE) { errors.push(`${f.name}: files can be at most 40 MB (${fmtSize(f.size)})`); continue; }
      setBusy(`Uploading ${i + 1}/${arr.length}: ${f.name}`);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/vault", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({})) as { saved?: string[]; errors?: string[]; error?: string; cloud?: string };
        saved.push(...(j.saved ?? []));
        if (j.cloud === "pending") pending = true;
        if (cloudWarn(j.cloud)) errors.push(`${f.name}: ${cloudWarn(j.cloud)}`);
        errors.push(...(j.errors ?? []), ...(j.error ? [`${f.name}: ${j.error}`] : []));
        if (!r.ok && !j.error && !j.errors?.length) errors.push(`${f.name}: upload failed (${r.status})`);
      } catch { errors.push(`${f.name}: upload failed`); }
    }
    setBusy("");
    if (saved.length) setNote(`Saved ${saved.length} file${saved.length > 1 ? "s" : ""}: ${saved.join(", ")}${pending ? ". Large files are copied to the cloud in the background." : ""}`);
    if (errors.length) setErr(errors.join("\n"));
    if (fileRef.current) fileRef.current.value = "";
    await load();
  }

  async function rename(f: CloudFile) {
    const to = prompt("New name (the extension is kept unless you type one):", f.name);
    if (!to || to.trim() === f.name) return;
    try {
      const r = await call<{ name: string; cloud?: string }>("/api/vault", JSON_POST({ action: "rename", name: f.name, to }));
      await load();
      if (open?.name === f.name) setOpen({ ...f, name: r.name });
      setNote(`Renamed to ${r.name}`);
      setErr(cloudWarn(r.cloud).replace("Saved on this PC", "Renamed on this PC"));
    } catch (e) { setErr(e instanceof Error ? e.message : "Rename failed"); }
  }

  async function remove(f: CloudFile) {
    if (!confirm(`Permanently delete "${f.name}"? This can't be undone.`)) return;
    try {
      const r = await call<{ cloud?: string }>("/api/vault", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name }) });
      if (open?.name === f.name) setOpen(null);
      setErr(cloudWarn(r.cloud).replace("Saved on this PC; cloud copy failed", "Deleted on this PC; removing the cloud copy failed"));
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Delete failed"); }
  }

  async function sync() {
    setErr(""); setNote(""); setBusy("Copying files to the cloud…");
    try {
      const r = await call<{ uploaded: number; failed: number; remaining: number; firstError: string | null }>("/api/vault", JSON_POST({ action: "sync" }));
      setNote(`Cloud sync: ${r.uploaded} uploaded${r.failed ? `, ${r.failed} failed` : ""}${r.remaining ? `, ${r.remaining} still to go (press Sync now again)` : ""}.`);
      if (r.firstError) setErr(`Cloud copy failed for ${r.firstError}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); await load(); }
  }

  async function restore(name: string) {
    setErr(""); setNote(""); setBusy(`Downloading ${name} from the cloud…`);
    try { const r = await call<{ name: string }>("/api/vault", JSON_POST({ action: "restore", name })); setNote(`Downloaded ${r.name} to this PC.`); }
    catch (e) { setErr(e instanceof Error ? e.message : "Download failed"); }
    finally { setBusy(""); await load(); }
  }

  // Same request the MEMORY panel's "Upload file" makes.
  async function toMemory(f: CloudFile) {
    if (!confirm(`Upload a copy of "${f.name}" to MEMORY? It will be stored in ORBIT's cloud memory (your Supabase project), not only on this PC.`)) return;
    setErr(""); setNote(""); setBusy(`Saving ${f.name} to MEMORY…`);
    try {
      const blob = await (await fetch(raw(f.name))).blob();
      const fd = new FormData();
      fd.set("file", new File([blob], f.name, { type: memoryType(f.name) ?? "" }));
      const res = await fetch("/api/memories/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setNote(`Saved ${f.name} to MEMORY${json.extractedChars ? ` (${Number(json.extractedChars).toLocaleString()} characters of text read)` : ""}.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save to MEMORY"); }
    finally { setBusy(""); }
  }

  // On both views' root: always preventDefault so a drop never navigates the tab to the file; upload only real file drops.
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDrag(true); },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setDrag(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); if (!e.dataTransfer.files.length) return; if (busy) setErr("Wait for the current upload to finish, then drop again."); else void upload(e.dataTransfer.files); },
  };
  const rootCls = `rounded${drag ? " outline outline-2 outline-dashed" : ""}`;

  if (open) {
    const src = raw(open.name);
    return (
      <div className={`space-y-3 ${rootCls}`} {...dropProps}>
        <button className="link" onClick={() => setOpen(null)}>← Back</button>
        <h3 className="h3 break-all">{open.name}</h3>
        <p className="muted text-xs">{fmtSize(open.size)} · modified {new Date(open.mtime).toLocaleString()}</p>
        {open.type === "image" && <img src={src} alt={open.name} className="max-h-[60vh] max-w-full rounded" />}
        {open.type === "video" && <video src={src} controls className="max-h-[60vh] w-full" />}
        {open.type === "audio" && <audio src={src} controls className="w-full" />}
        {open.type === "pdf" && <p><a className="link" href={src} target="_blank" rel="noreferrer noopener">Open PDF in a new tab</a></p>}
        {open.type === "text" && (text
          ? <pre className="card max-h-[60vh] overflow-auto whitespace-pre-wrap break-words text-xs">{text.text}{text.truncated && "\n\n… (first 20 KB shown)"}</pre>
          : <p className="muted">Loading preview…</p>)}
        {(open.type === "doc" || open.type === "other") && <p className="muted">No preview for this type. Download it to open.</p>}
        {err && <p className="error whitespace-pre-line">{err}</p>}
        {note && <p className="muted">{note}</p>}
        <div className="flex flex-wrap gap-2">
          <a className="btn" href={src} download={open.name}>Download</a>
          <button className="btn" onClick={() => rename(open)}>Rename</button>
          {memoryType(open.name) && <button className="btn" disabled={!!busy || open.size > MEMORY_MAX} title={open.size > MEMORY_MAX ? "MEMORY accepts files up to 4 MB" : undefined} onClick={() => toMemory(open)}>Save copy to MEMORY (cloud)</button>}
          {(open.type === "text" || open.type === "pdf" || open.type === "doc") && (
            <button className="btn" onClick={() => dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text: `Read my VAULT file "${open.name}" and give me a short summary.` } }))}>Ask CORE</button>)}
          <button className="btn danger" onClick={() => remove(open)}>Delete</button>
        </div>
        {busy && <p className="muted">{busy}</p>}
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${rootCls}`} {...dropProps}>
      <p className="muted text-xs">Files are kept on this PC, with a private copy in your Supabase cloud (free plan: 1 GB total).</p>
      <p className="muted text-xs">
        {cloudError ? <>Cloud unavailable: {cloudError}</> : <>{files.filter((f) => f.cloud).length} of {files.length} files in the cloud</>}
        {" · "}<button className="link" disabled={!!busy} onClick={sync}>Sync now</button>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`chip cursor-pointer${busy ? " opacity-50" : ""}`}>
          Upload files
          <input ref={fileRef} type="file" multiple className="sr-only" disabled={!!busy} onChange={(e) => { if (e.target.files) void upload(e.target.files); }} />
        </label>
        <span className="muted text-xs">or drop files here · {use.count} files · {fmtSize(use.bytes)} of 5 GB · max 40 MB each</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder={inside ? "Search names and contents…" : "Filter by name…"} aria-label="Search vault" />
        <label className="chip cursor-pointer"><input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> Search inside</label>
        <select className="field" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="newest">Newest</option><option value="name">Name</option><option value="size">Size</option>
        </select>
      </div>
      {busy && <p className="muted">{busy}</p>}
      {err && <p className="error whitespace-pre-line">{err}</p>}
      {note && <p className="muted">{note}</p>}
      {shown.length === 0 ? <p className="muted">{files.length ? "No matches." : "The vault is empty. Upload or drop files to keep them here."}</p> : (
        <ul className="space-y-1">
          {shown.map((f) => (
            <li key={f.name}>
              <button className="card flex w-full items-center gap-3 text-left" onClick={() => { setErr(""); setNote(""); setOpen(f); }}>
                <span className="pill w-12 shrink-0 text-center text-xs">{ICON[f.type]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{f.name}</span>
                  {hits?.[f.name] && <span className="muted block truncate text-xs">{hits[f.name]}</span>}
                </span>
                <span className="muted shrink-0 text-xs">{fmtSize(f.size)} · {new Date(f.mtime).toLocaleDateString()}</span>
                {f.cloud === true && <span className="shrink-0 text-xs" role="img" aria-label="Cloud copy saved" title="Cloud copy saved">☁</span>}
                {f.cloud === false && <span className="shrink-0 text-xs" role="img" aria-label="Not in the cloud yet" title="Not in the cloud yet (Sync now)">⚠</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cloudOnly.length > 0 && (
        <div className="space-y-1">
          <h3 className="h3">Only in the cloud</h3>
          <ul className="space-y-1">
            {cloudOnly.map((c) => (
              <li key={c.name} className="card flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="muted shrink-0 text-xs">{fmtSize(c.size)}</span>
                <button className="chip" disabled={!!busy} onClick={() => restore(c.name)}>Download to this PC</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <WorkspacePanel />
    </div>
  );
}
