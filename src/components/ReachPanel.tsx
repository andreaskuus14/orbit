"use client";
import { useEffect, useState } from "react";
import { parseClipUrl } from "@/lib/clips/format";
import { startClip } from "./Herald";
import { REACH_SOURCES, SOURCE_NAME, statLine, type ReachSource, type ReachSources, type Scored } from "@/lib/reach/pure";

// Trend Radar → Rising → 🌐 Reach: latest per source from the cached server scan (anonymous Reddit/Kick/Bluesky, Twitch with the user's key)
// plus the editable watchlists. Third-party titles render as plain text; links are https only (checked server-side).
type Scan = { at: number; items: Scored[]; hints: Record<ReachSource, string[]>; running: boolean; stopped?: boolean; sources: ReachSources };
const PINK = "#f472b6";
const LABEL: Record<ReachSource, string> = { reddit: "Subreddits", kick: "Kick channels", twitch: "Twitch logins", bsky: "Bluesky searches" };

export default function ReachPanel() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<Record<ReachSource, string> | null>(null);
  const [saveMsg, setSaveMsg] = useState("");

  const load = () => fetch("/api/reach", { cache: "no-store" }).then(async (r) => {
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(j?.error ?? `Reach answered ${r.status}`);
    setScan(j); setErr("");
    return j as Scan;
  }).catch((e) => { setErr(e instanceof Error ? e.message : "Couldn't load Reach"); return null; });
  useEffect(() => { void load(); }, []);
  useEffect(() => { // a scan is running: check back every 15 s until it lands
    if (!scan?.running) return;
    const h = setTimeout(() => void load(), 15_000);
    return () => clearTimeout(h);
  }, [scan]);

  async function save() {
    if (!edit) return;
    setSaveMsg("Saving…");
    const body = Object.fromEntries(REACH_SOURCES.map((s) => [s, edit[s].split(/[,\n]/).map((x) => x.trim()).filter(Boolean)]));
    const r = await fetch("/api/reach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) { setSaveMsg(j?.error ?? "Couldn't save"); return; }
    setSaveMsg("Saved. Scanning with the new lists…"); setEdit(null);
    void load();
  }

  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold">🌐 Reach <span className="muted text-xs font-normal">clips exploding on Reddit, Kick, Twitch and Bluesky</span></h3>
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {!scan && !err && <p className="muted text-sm" aria-live="polite">Loading…</p>}
      {scan?.stopped && <p className="muted text-sm">Stop-all is on: Reach isn&apos;t scanning.</p>}
      {scan && !scan.at && scan.running && <p className="muted text-sm" aria-live="polite">First scan running (sites are asked slowly, a few seconds apart)…</p>}
      {scan && REACH_SOURCES.map((src) => {
        const xs = scan.items.filter((x) => x.source === src).slice(0, 5);
        if (!xs.length && !scan.hints[src].length) return null;
        return (
          <div key={src} className="space-y-1">
            <h4 className="text-xs font-semibold">{SOURCE_NAME[src]}</h4>
            {scan.hints[src].map((h) => <p key={h} className="muted text-xs">{h}</p>)}
            <ol className="space-y-1">
              {xs.map((x) => { const clip = x.media ? parseClipUrl(x.media) : null; return (
                <li key={x.id} className="card flex items-center gap-2.5">
                  {x.thumb && <img src={x.thumb} alt="" width={44} height={44} loading="lazy" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-lg object-cover" />}
                  <a href={x.open} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 no-underline" aria-label={`${x.title}, ${statLine(x)}, opens on ${SOURCE_NAME[src]}`}>
                    <span className="block truncate text-sm font-semibold">{x.hot ? "🔥 " : ""}{x.title}</span>
                    <span className="muted block truncate text-xs">{statLine(x)}</span>
                  </a>
                  {clip && <button className="chip shrink-0 text-xs" style={{ borderColor: PINK, color: PINK }} onClick={() => void startClip(clip)}>🎬 Clip it now</button>}
                </li>); })}
            </ol>
          </div>
        );
      })}
      {scan && !!scan.at && <p className="muted text-xs">Scanned {new Date(scan.at).toLocaleTimeString()} · refreshes every 3 h · 🔥 = 2× the batch&apos;s per-hour rate and over a minimum</p>}

      <div className="card space-y-1.5">
        <div className="flex items-center gap-2">
          <h4 className="flex-1 text-xs font-semibold">🌐 Reach sources</h4>
          {scan && !edit && <button className="chip text-xs" onClick={() => { setSaveMsg(""); setEdit(Object.fromEntries(REACH_SOURCES.map((s) => [s, scan.sources[s].join(", ")])) as Record<ReachSource, string>); }}>Edit</button>}
        </div>
        {scan && !edit && REACH_SOURCES.map((s) => <p key={s} className="muted truncate text-xs">{LABEL[s]}: {scan.sources[s].join(", ") || "none"}</p>)}
        {edit && (
          <>
            {REACH_SOURCES.map((s) => (
              <label key={s} className="block text-xs">
                {LABEL[s]} <span className="muted">(comma-separated, up to 20; letters, digits, _{s === "bsky" ? ", spaces" : ""})</span>
                <input className="field mt-0.5 w-full !text-sm" value={edit[s]} onChange={(e) => setEdit({ ...edit, [s]: e.target.value })} maxLength={900} />
              </label>
            ))}
            <div className="flex gap-1.5">
              <button className="btn text-xs" onClick={() => void save()}>Save</button>
              <button className="chip text-xs" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </>
        )}
        {saveMsg && <p className="muted text-xs" role="status">{saveMsg}</p>}
      </div>
    </div>
  );
}
