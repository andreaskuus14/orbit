"use client";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { ReaJob } from "@/lib/rea";
import type { ReaView } from "@/lib/rea-pure";

type Status = { installed: boolean; targets: string[]; jobs: ReaJob[]; note: string };
type Page = { text: string; next_offset: number | null; offset: number; total_chars: number; evidence_id: string; query: string; view: ReaView; snapshot: { policy: string; files: number } };
const panel: CSSProperties = { padding: 20, border: "1px solid #334155", borderRadius: 16, background: "#101827", marginBottom: 16 };
const button: CSSProperties = { border: "1px solid #475569", borderRadius: 8, padding: "8px 14px", background: "#1e293b", color: "#f1f5f9", cursor: "pointer" };
async function json(url: string, init?: RequestInit) { const r = await fetch(url, { cache: "no-store", ...init }); const body = await r.json(); if (!r.ok) throw new Error(body.error ?? "Request failed"); return body; }

export default function ReaPage() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(""), [target, setTarget] = useState("orbit"), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(""), [view, setView] = useState<ReaView>("summary"), [query, setQuery] = useState(""), [page, setPage] = useState<Page | null>(null);
  const refresh = useCallback(async () => { try { setStatus(await json("/api/rea")); setError(""); } catch (e) { setError(String(e instanceof Error ? e.message : e)); } }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 3000); return () => clearInterval(timer); }, [refresh]);
  async function action(action: string, job?: string) {
    setBusy(true);
    try { await json("/api/rea", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, target, job }) }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function read(id: string, nextView: ReaView, offset = 0) {
    setBusy(true);
    try { const p = new URLSearchParams({ job: id, view: nextView, offset: String(offset), query }); setPage(await json(`/api/rea?${p}`)); setSelected(id); setView(nextView); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const active = status?.jobs.some((j) => j.state === "snapshotting" || j.state === "analyzing");
  return <main style={{ minHeight: "100vh", background: "#080e1b", color: "#e2e8f0", padding: "32px 20px", fontFamily: "system-ui, sans-serif" }}>
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <a href="/" style={{ color: "#93c5fd" }}>← Back to ORBIT</a>
      <h1 style={{ fontSize: 32, marginTop: 24 }}>Project analysis</h1>
      <p>Understand your code with REA. Analysis reads a source-only copy and leaves the original project unchanged.</p>
      {error && <p role="alert" style={{ ...panel, borderColor: "#f87171" }}>{error}</p>}
      <section style={panel}>
        <h2>Start an analysis</h2>
        <p>Hidden files, dependency folders, generated builds and media are excluded. Source code can still contain hardcoded secrets. Evidence stays on this PC; asking CORE about it sends the selected pages to Claude.</p>
        <label>Project <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...button, margin: 8 }}>{(status?.targets ?? ["orbit"]).map((t) => <option key={t}>{t}</option>)}</select></label>
        <button style={button} disabled={busy || active || !status?.installed} onClick={() => void action("analyze")}>Analyze project</button>
        {status && !status.installed && <p>REA is not installed yet. Run <code>npm run rea:setup</code> in the ORBIT folder, then restart ORBIT.</p>}
        <p><small>The latest ten jobs per account are retained. Long analyses continue when this page closes.</small></p>
      </section>
      <section style={panel} aria-live="polite">
        <h2>Recent analyses</h2>
        {status?.jobs.length === 0 && <p>No analyses yet.</p>}
        {status?.jobs.map((j) => <article key={j.id} style={{ padding: "14px 0", borderTop: "1px solid #334155" }}>
          <strong>{j.target} · {j.state}</strong><p>{j.progress}</p>
          <small>{new Date(j.created_at).toLocaleString()} · {j.id}</small>
          {j.error && <p>{j.error}</p>}
          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            {(j.state === "snapshotting" || j.state === "analyzing") && <button style={button} disabled={busy} onClick={() => void action("cancel", j.id)}>Cancel analysis</button>}
            {j.state === "done" && <><button style={button} disabled={busy} onClick={() => void read(j.id, "summary")}>Read findings</button><a style={{ ...button, textDecoration: "none" }} href={`/api/rea?job=${j.id}&download=1`}>Download full evidence</a></>}
          </div>
        </article>)}
      </section>
      {selected && <section style={panel}>
        <h2>Analysis evidence</h2>
        {page && <><p>{page.snapshot?.files} source files · <code style={{ overflowWrap: "anywhere" }}>{page.evidence_id}</code></p>
        <p>{page.snapshot?.policy}</p></>}
        <label>View <select style={button} value={view} onChange={(e) => { setView(e.target.value as ReaView); setPage(null); }}>{["summary", "modules", "edges", "evidence"].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label style={{ margin: 8 }}>Filter <input style={button} value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} placeholder="File name or symbol" /></label>
        <button style={button} disabled={busy} onClick={() => void read(selected, view)}>Read from start</button>
        {page && <><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13, padding: 16, background: "#080e1b", borderRadius: 8 }}>{page.text}</pre>
        <p>Characters {page.offset}–{Math.min(page.offset + 4000, page.total_chars)} of {page.total_chars}. JSON can continue on the next page.</p>
        <button style={button} disabled={busy || page.next_offset === null || query !== page.query || view !== page.view} onClick={() => void read(selected, view, page.next_offset!)}>Next page</button></>}
      </section>}
    </div>
  </main>;
}
