"use client";
import { useCallback, useEffect, useState } from "react";
import { shotUrl, type DevSession } from "@/lib/dev-session-pure";

// GAME DEV → Sessions: every Roblox Studio session ORBIT took part in (Luau helper, builds, scans, playtests) as a timeline with drill-down.
// Reading only: nothing here changes the place. Data: /api/devsession (dev-session.ts).
const PINK = "#f472b6";
type View = DevSession & { line: string; stats: { open: boolean } };
const ICON = { luau: "📝", build: "🏗", scan: "🔍", playtest: "🤖" } as const;
const time = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function DevSessions() {
  const [list, setList] = useState<View[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/devsession", { cache: "no-store" }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) { setMsg({ ok: false, text: j?.error ?? "Couldn't load the session log" }); return; }
    setList(j.sessions);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "end" | "summarize" | "idea", extra: Record<string, unknown> = {}) {
    setBusy(`${action}:${id}`); setMsg(null);
    try {
      const r = await fetch("/api/devsession", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      if (action === "idea") setMsg({ ok: true, text: j.title ? `Added to IDEA RADAR in STUDIO: “${j.title}”` : "Already in IDEA RADAR." });
      await load();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); } finally { setBusy(""); }
  }

  return (
    <section className="w-full space-y-2" aria-labelledby="ds-title">
      <div className="flex items-center justify-between">
        <h2 id="ds-title" className="text-base font-semibold" style={{ color: PINK }}>🕒 Studio sessions</h2>
        <button className="chip" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="muted text-xs">Logged when ORBIT runs Luau, builds, scans or playtests. A session ends after 30 idle minutes or when you end it.</p>
      {msg && <p role="status" className={msg.ok ? "ok text-sm" : "error text-sm"}>{msg.text}</p>}
      {list && !list.length && <p className="muted text-sm">No sessions yet. Use Code, Build or Playtest and they show up here.</p>}
      <ol className="space-y-2">
        {list?.map((s) => (
          <li key={s.id} className="card space-y-1">
            <button className="w-full text-left text-sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
              {s.stats.open && <span className="mr-1 text-xs" style={{ color: PINK }}>● live</span>}{s.line}
              <span className="muted block text-xs">{new Date(s.start).toLocaleDateString()} {time(s.start)}{s.end ? `–${time(s.end)}` : ""}</span>
            </button>
            {s.summary && <p className="text-xs">{s.summary}</p>}
            {open === s.id && <>
              <ol className="space-y-1 border-l border-white/15 pl-2 text-xs">
                {s.events.map((e, i) => (
                  <li key={i} className="space-y-0.5">
                    <p><span className="muted">{time(e.at)}</span> {ICON[e.source]} {e.label}{e.ok ? "" : " · failed"}</p>
                    {e.changes.map((c, k) => (
                      <details key={k}><summary className="cursor-pointer">{c.kind === "script" ? "📄" : "🧱"} {c.name}</summary>
                        {c.diff && <pre className="max-h-48 overflow-auto rounded bg-black/40 p-1 text-[11px]">{c.diff}</pre>}
                      </details>
                    ))}
                    {e.errors.map((x, k) => <p key={`e${k}`} className="error">✖ {x}</p>)}
                    {e.warnings.map((x, k) => <p key={`w${k}`} className="text-amber-300">⚠ {x}</p>)}
                    {!!e.shots.length && <div className="flex gap-1">{e.shots.map((r) => (
                      <a key={r} href={shotUrl(r)} target="_blank" rel="noopener noreferrer"><img src={shotUrl(r)} alt={`Screenshot from ${e.label}`} className="h-16 rounded" loading="lazy" /></a>
                    ))}</div>}
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-1.5">
                {s.stats.open && <>
                  <button className="chip" disabled={!!busy} onClick={() => void act(s.id, "end")}>End session</button>
                  <button className="chip" disabled={!!busy} onClick={() => void act(s.id, "end", { summarize: true })}>End + summary</button>
                </>}
                {!s.stats.open && !s.summary && <button className="chip" disabled={!!busy} onClick={() => void act(s.id, "summarize")}>{busy === `summarize:${s.id}` ? "Summarising…" : "Summarise"}</button>}
                <button className="chip" disabled={!!busy || !!s.ideaId} onClick={() => void act(s.id, "idea")}>{s.ideaId ? "✓ Short idea in STUDIO" : "🎬 Day N Short idea"}</button>
              </div>
            </>}
          </li>
        ))}
      </ol>
    </section>
  );
}
