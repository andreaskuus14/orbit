"use client";
// GAME DEV → Build → Files: export Studio scripts to a Rojo project on his PC, check them with Selene, and run Rojo's live sync.
// Tools come from tools/roblox/setup.ps1. Data: /api/rojo. Rules: lib/rojo-pure.ts.
import { useCallback, useEffect, useState } from "react";
import { SETUP_HINT, type Lint } from "@/lib/rojo-pure";
import { PINK } from "./RobloxBuild";

type Project = { name: string; dir: string; at: string };
type Serve = { port: number; running: boolean; ours: string | null; log: string };
type Info = { root: string; projects: Project[]; serve: Serve };
type Exported = { name: string; dir: string; scripts: number; committed: boolean; first: boolean };

async function api<T>(body?: object): Promise<T> {
  const res = await fetch("/api/rojo", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error || `Request failed (error ${res.status}).`);
  return j;
}
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const vscode = (dir: string, file: string, line: number, col: number) => `vscode://file/${`${dir}/${file}`.replace(/\\/g, "/")}:${line}:${col}`;

export default function RojoPanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [place, setPlace] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Exported | null>(null);
  const [lint, setLint] = useState<{ name: string; dir: string; lint: Lint } | null>(null);
  const load = useCallback(() => { void api<Info>().then(setInfo, (e) => setErr(msg(e))); }, []);
  useEffect(load, [load]);
  const go = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr("");
    try { await fn(); } catch (e) { setErr(msg(e)); } finally { setBusy(""); load(); }
  };
  const chosen = project || info?.projects[0]?.name || "";
  const serve = info?.serve;
  return (
    <section className="glass grid gap-3 rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label="Script files">
      <h3 className="brand text-sm" style={{ color: PINK }}>Script files (Rojo + Selene, on your PC)</h3>
      <p className="muted text-xs">Rojo copies scripts between files on your PC and Studio. Selene checks Luau code for mistakes. Git keeps every version so you can see what changed. First time: {SETUP_HINT}</p>

      <div className="card space-y-1.5">
        <div className="hud-title">1. Export scripts to files</div>
        <p className="muted text-xs">In Studio: File → Save to File As… (.rbxl). Then paste that file&apos;s path here (Shift + right-click → Copy as path). Scripts go to {info?.root ?? "Documents\\RobloxProjects"}\&lt;place name&gt;, with a git commit each time. Scripts inside Workspace are not exported.</p>
        <div className="flex gap-1.5">
          <input className="field min-w-0 flex-1" placeholder="C:\Users\you\Documents\PetSim.rbxl" aria-label="Place file path" value={place} onChange={(e) => setPlace(e.target.value)} />
          <button className="btn" disabled={!!busy || !place.trim()} onClick={() => go("export", async () => { const r = await api<Exported>({ action: "export", place }); setDone(r); setProject(r.name); })}>{busy === "export" ? "Exporting…" : "Export scripts to files"}</button>
        </div>
        {done && <p className="text-xs" style={{ color: "#4ade80" }}>Exported {done.scripts} script file(s) to {done.dir}. {done.committed ? (done.first ? "First git commit made." : "Changes committed: run git log -p there to review them.") : "Nothing changed since the last export."}</p>}
      </div>

      <div className="card space-y-1.5">
        <div className="hud-title">2. Check code (Selene)</div>
        {info && !info.projects.length ? <p className="muted text-xs">No exported project yet.</p> : (
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="field py-1" aria-label="Project" value={chosen} onChange={(e) => setProject(e.target.value)}>{info?.projects.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select>
            <button className="btn" disabled={!!busy || !chosen} onClick={() => go("lint", async () => setLint(await api({ action: "lint", project: chosen })))}>{busy === "lint" ? "Checking…" : "Check code"}</button>
          </div>
        )}
        {lint && (
          <div className="space-y-1.5 text-xs">
            <p><b>{lint.lint.total ? `${lint.lint.total} issue(s)` : "No issues"}</b> in {lint.name}: {lint.lint.errors} error(s), {lint.lint.warnings} warning(s){lint.lint.parseErrors ? `, ${lint.lint.parseErrors} file(s) that don't parse` : ""}{lint.lint.clipped ? " (first 500 shown)" : ""}.</p>
            {lint.lint.files.map((f) => (
              <details key={f.file} className="card" open={lint.lint.files.length <= 3}>
                <summary className="cursor-pointer">{f.file} <span className="muted">({f.issues.length})</span></summary>
                <ul className="mt-1 space-y-1">
                  {f.issues.map((i, n) => (
                    <li key={n}>
                      <a href={vscode(lint.dir, f.file, i.line, i.col)} title="Open in VS Code" className="underline">line {i.line}</a>{" "}
                      <span style={{ color: i.severity === "error" ? "#ef4444" : "#f59e0b" }}>{i.severity}</span>{i.code && <span className="muted"> [{i.code}]</span>}: {i.message}
                      {i.text !== undefined && <pre className="muted mt-0.5 overflow-x-auto whitespace-pre">{i.text}</pre>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-1.5">
        <div className="hud-title">3. Live sync with Studio (rojo serve)</div>
        <p className="text-xs" style={{ color: serve?.running ? "#4ade80" : "#94a3b8" }}>
          {serve?.running ? `Rojo is serving on port ${serve.port}${serve.ours ? ` (${serve.ours}, started by ORBIT)` : " (started outside ORBIT)"}.` : "Rojo is not running."}
        </p>
        <div className="flex gap-1.5">
          <button className="btn" disabled={!!busy || !chosen || !!serve?.running} onClick={() => go("serve", () => api({ action: "serve", project: chosen }).then(() => {}))}>{busy === "serve" ? "Starting…" : `Start sync${chosen ? ` (${chosen})` : ""}`}</button>
          <button className="btn" disabled={!!busy || !serve?.ours} onClick={() => go("stop", () => api({ action: "stop" }).then(() => {}))}>Stop sync</button>
        </div>
        <p className="muted text-xs">Then in Studio: Plugins tab → Rojo → Connect (localhost, port {serve?.port ?? 34872}). Rojo shows the changes it wants to make: read the list and press Accept only if it looks right. While connected, edit scripts in the files (VS Code); saved files appear in Studio at once.</p>
      </div>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </section>
  );
}
