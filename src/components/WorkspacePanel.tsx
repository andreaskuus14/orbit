"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtSize } from "@/lib/vault-pure";

// WORKSPACES: the real files CORE built (ask CORE "build me a website"). Browse, read, move to trash, open the live preview.
type Ws = { slug: string; files: number; bytes: number; mtime: number; preview: string };
type WsFile = { path: string; size: number; mtime: number };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export function WorkspacePanel() {
  const [list, setList] = useState<Ws[]>([]);
  const [ws, setWs] = useState<string | null>(null);
  const [files, setFiles] = useState<{ files: WsFile[]; preview: string } | null>(null);
  const [view, setView] = useState<{ path: string; text: string } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { setList((await call<{ workspaces: Ws[] }>("/api/workspace")).workspaces); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openWs = useCallback(async (slug: string) => {
    setWs(slug); setView(null); setFiles(null);
    try { setFiles(await call(`/api/workspace?ws=${encodeURIComponent(slug)}`)); setErr(""); } catch (e) { setErr((e as Error).message); }
  }, []);

  const openFile = async (path: string) => {
    try { setView({ path, ...(await call<{ text: string }>(`/api/workspace?ws=${encodeURIComponent(ws!)}&file=${encodeURIComponent(path)}`)) }); setErr(""); } catch (e) { setErr((e as Error).message); }
  };

  const trash = async (path: string) => {
    if (!confirm(`Move ${path} to this workspace's trash?`)) return;
    try {
      await call("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", ws, path }) });
      setView(null); void openWs(ws!); void load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="space-y-2" aria-label="Workspaces">
      <h3 className="h3">Workspaces</h3>
      <p className="muted text-xs">Real files CORE builds for you. Ask CORE &ldquo;build me a website about…&rdquo;, then open the preview. Previews run sandboxed and offline: external CDNs, fonts and APIs are blocked, so sites must use their own files.</p>
      {err && <p className="error">{err}</p>}
      {!ws ? (
        list.length === 0 ? <p className="muted">No workspaces yet.</p> : (
          <ul className="space-y-1">
            {list.map((w) => (
              <li key={w.slug} className="card flex items-center gap-3">
                <button className="min-w-0 flex-1 truncate text-left" onClick={() => openWs(w.slug)}>{w.slug}</button>
                <span className="muted shrink-0 text-xs">{w.files} files · {fmtSize(w.bytes)}</span>
                <a className="chip" href={w.preview} target="_blank" rel="noopener noreferrer">▶ Open</a>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button className="chip" onClick={() => { setWs(null); void load(); }}>← All workspaces</button>
            <span className="min-w-0 flex-1 truncate">{ws}</span>
            {files && <a className="chip" href={files.preview} target="_blank" rel="noopener noreferrer">▶ Open preview</a>}
          </div>
          {!files ? <p className="muted">Loading…</p> : files.files.length === 0 ? <p className="muted">Empty.</p> : (
            <ul className="space-y-1">
              {files.files.map((f) => (
                <li key={f.path} className="card flex items-center gap-3">
                  <button className="min-w-0 flex-1 truncate text-left font-mono text-xs" aria-pressed={view?.path === f.path} onClick={() => openFile(f.path)}>{f.path}</button>
                  <span className="muted shrink-0 text-xs">{fmtSize(f.size)}</span>
                  <a className="chip" href={files.preview.replace(/index\.html$/, "") + f.path.split("/").map(encodeURIComponent).join("/")} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.path}`}>▶</a>
                  <button className="chip" onClick={() => trash(f.path)} aria-label={`Move ${f.path} to trash`}>🗑</button>
                </li>
              ))}
            </ul>
          )}
          {view && <pre className="card max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs" aria-label={view.path}>{view.text}</pre>}
        </div>
      )}
    </section>
  );
}
