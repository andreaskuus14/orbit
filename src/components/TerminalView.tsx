"use client";
import { useCallback, useEffect, useState } from "react";
import { useWorldPaused } from "./world-paused";
import { useT } from "./i18n";
import { contentHash, termContent } from "@/lib/approval-pure";
import { statusWords, type Run, type SessionView } from "@/lib/shell-session-pure";

/** OPERATIONS → Terminal: CORE's shell sessions with live output, his OK for level-3 commands, Undo for level-2 ones, and his own commands. */
export function TerminalView() {
  const { t } = useT();
  const [data, setData] = useState<{ sessions: SessionView[]; folders: string[]; dropped: string[]; shell: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [cmd, setCmd] = useState("");
  const [session, setSession] = useState("main");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/terminal");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setData(j); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  const paused = useWorldPaused();
  const live = !!data?.sessions.some((s) => s.busy || s.runs.some((r) => r.status === "waiting"));
  useEffect(() => {
    if (paused) return;
    void load();
    const h = setInterval(() => { if (!document.hidden) void load(); }, live ? 1000 : 10_000);
    return () => clearInterval(h);
  }, [load, paused, live]);

  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const r = await fetch("/api/terminal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setErr(""); await load();
      return true;
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); return false; } finally { setBusy(""); }
  };
  const approve = async (r: Run, s: SessionView) => post(r.id, { action: "approve", id: r.id, approved: await contentHash(termContent(r.id, r.command, s.cwd)) });
  const badge = (r: Run) => (r.level === 1 ? t("term.l1") : r.level === 2 ? t("term.l2") : t("term.l3"));

  return (
    <div className="space-y-3">
      <p className="muted text-sm">{t("term.about")}</p>
      {err && <p className="error">{err}</p>}
      {data && !data.folders.length && <p className="card text-sm">{t("term.noFolders")}</p>}
      {data && data.folders.length > 0 && <p className="muted text-xs">{t("term.folders")}: {data.folders.join(" · ")}</p>}
      {data && data.dropped.length > 0 && <p className="muted text-xs">{t("term.dropped")}: {data.dropped.join(" · ")}</p>}
      <form className="flex flex-wrap gap-1.5" onSubmit={(e) => { e.preventDefault(); if (cmd.trim()) void post("run", { action: "run", command: cmd, session }).then((ok) => ok && setCmd("")); }}>
        <input className="input w-24" value={session} onChange={(e) => setSession(e.target.value)} aria-label={t("term.session")} />
        <input className="input flex-1 font-mono text-sm" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={t("term.placeholder")} aria-label={t("term.command")} />
        <button className="btn" disabled={busy === "run" || !cmd.trim()}>{t("term.run")}</button>
      </form>
      {!data ? <p className="muted">Loading…</p> : !data.sessions.length ? <p className="muted text-sm">{t("term.none")}</p> : data.sessions.map((s) => (
        <section key={s.id} className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <b>{s.name}</b><span className="muted text-xs">{s.shell} · {s.cwd}{s.venv ? ` · venv ${s.venv}` : ""}</span>
            <button className="chip ml-auto" disabled={!!busy} onClick={() => void post(`close:${s.id}`, { action: "close", session: s.name })}>{t("term.close")}</button>
          </div>
          <ul className="space-y-2">
            {[...s.runs].reverse().slice(0, 8).map((r) => (
              <li key={r.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="chip text-xs">{badge(r)}</span>
                  <span>{r.what}</span>
                  <span className="muted text-xs">· {statusWords(r)}{r.source === "owner" ? ` · ${t("term.you")}` : " · CORE"}{r.undone ? ` · ${t("term.undone")}` : ""}</span>
                </div>
                <code className="block text-xs muted break-all">{r.command}</code>
                {r.status === "waiting" && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs">{t("term.needsOk")}: {r.reason}</span>
                    <button className="btn" disabled={!!busy} onClick={() => void approve(r, s)}>{t("term.ok")}</button>
                    <button className="chip" disabled={!!busy} onClick={() => void post(r.id, { action: "skip", id: r.id })}>{t("term.skip")}</button>
                  </div>
                )}
                {r.status === "running" && <button className="chip" disabled={!!busy} onClick={() => void post(r.id, { action: "stop", id: r.id })}>{t("term.stop")}</button>}
                {r.snapshot && !r.undone && r.status !== "running" && <button className="chip" disabled={!!busy} onClick={() => void post(r.id, { action: "undo", snapshot: r.snapshot })}>{t("act.undo")}</button>}
                {r.private && <p className="muted text-xs">{t("term.private")}</p>}
                {r.output && <pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto p-2 rounded" style={{ background: "rgba(0,0,0,.35)" }}>{r.output.slice(-20_000)}</pre>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
