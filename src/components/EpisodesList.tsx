"use client";
import { useCallback, useEffect, useState } from "react";
import type { EpisodeView } from "@/lib/episodes-pure";

// MEMORY → Episodes: the moments ORBIT remembers (calls, decisions, wins, setbacks, milestones). Data: /api/memories/episodes (episodes.ts).

const ICON: Record<EpisodeView["type"], string> = { call: "📞", decision: "⚖️", win: "🏆", failure: "🌧️", milestone: "🚩" };

export function EpisodesList({ onOpen }: { onOpen: (id: string) => void }) {
  const [eps, setEps] = useState<EpisodeView[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/memories/episodes", { cache: "no-store" }).then((r) => r.json())
    .then((j) => (j.error ? setMsg(j.error) : setEps(j.episodes))).catch((e) => setMsg(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  async function build() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/memories/episodes", { method: "POST" }), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setMsg(j.added ? `${j.added} new episode${j.added === 1 ? "" : "s"}.` : "Nothing new to remember.");
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not build"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="muted text-xs">Built every night from calls, your decisions, wins, setbacks and milestones. Never from your journal. CORE brings one up when it fits.</p>
        <button type="button" className="chip shrink-0" disabled={busy} onClick={build}>{busy ? "Building…" : "Build now"}</button>
      </div>
      {msg && <p className="muted text-xs" role="status">{msg}</p>}
      <ul className="space-y-2">
        {(eps ?? []).map((e) => (
          <li key={e.id}>
            <button className="card w-full text-left" onClick={() => onOpen(e.id)}>
              <div className="font-medium"><span aria-hidden>{ICON[e.type]} </span>{e.what}</div>
              <div className="muted mt-1 text-[11px]">{e.type} · {e.when}{e.outcome ? ` · ${e.outcome}` : ""}</div>
              {e.feelings && <div className="muted mt-1 text-xs italic">{e.feelings}</div>}
            </button>
          </li>
        ))}
        {eps && !eps.length && <li className="muted">No episodes yet. They appear after tonight, or press Build now.</li>}
        {!eps && !msg && <li className="muted">Loading…</li>}
      </ul>
    </div>
  );
}
