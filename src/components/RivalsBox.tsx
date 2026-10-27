"use client";
import { useCallback, useEffect, useState } from "react";
import type { RivalReport } from "@/lib/rivals-pure";

// BUSINESS → Niches: a kept niche's competitor links (≤5) and the weekly Rivals report. ORBIT only reads those public pages.
type Board = { urls: Record<string, string[]>; reports: Record<string, RivalReport & { at: string }>; lastOk: string | null; lastError: string | null; busy: boolean };

async function call(body?: object) {
  const res = await fetch("/api/business/rivals", { method: body ? "POST" : "GET", cache: "no-store", ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export default function RivalsBox({ id }: { id: string }) {
  const [b, setB] = useState<Board | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => call().then((j: Board) => { setB(j); setErr(""); }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!b?.busy) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => clearInterval(t);
  }, [b?.busy, load]);
  const act = async (body: object) => { setErr(""); try { await call(body); setDraft(null); } catch (e) { setErr((e as Error).message); } await load(); };
  const urls = b?.urls[id] ?? [], r = b?.reports[id];
  return (
    <details className="text-xs">
      <summary className="cursor-pointer"><b>Rivals</b> ({urls.length}/5 competitor links{r ? `, checked ${new Date(r.at).toLocaleDateString()}` : ""})</summary>
      <div className="space-y-1.5 pt-1">
        {r ? <ul className="list-disc pl-5">{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          : <p className="muted">{urls.length ? "Not checked yet: it runs weekly in the night shift, or click Check now." : "Add up to 5 public competitor pages (shop pages, YouTube channel videos pages)."}</p>}
        {b?.lastError && !b.busy && <p className="muted">Last attempt: {b.lastError}</p>}
        {err && <p className="error" role="alert">{err}</p>}
        {draft === null ? (
          <div className="flex flex-wrap gap-1.5">
            <button className="chip" onClick={() => setDraft(urls.join("\n"))}>Edit links</button>
            {urls.length > 0 && <button className="chip" disabled={b?.busy} onClick={() => void act({ action: "check" })}>{b?.busy ? "Reading competitor pages…" : "Check now"}</button>}
          </div>
        ) : (
          <div className="space-y-1">
            <label className="block muted" htmlFor={`rivals-${id}`}>One public link per line (max 5). Read-only: no logins, robots.txt respected.</label>
            <textarea id={`rivals-${id}`} className="w-full rounded border border-white/10 bg-transparent p-1.5" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex gap-1.5">
              <button className="chip" onClick={() => void act({ action: "save", id, urls: draft.split(/\s+/).filter(Boolean) })}>Save</button>
              <button className="chip" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
