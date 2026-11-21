"use client";
// GAME DEV → Build → Files: connect his game's folder (or export Studio scripts) as a Rojo project on his PC, check the code with Selene +
// StyLua, run Rojo's live sync, Undo ORBIT's edits and make backups. Tools come from tools/roblox/setup.ps1. Data: /api/rojo.
// Rules: lib/rojo-pure.ts + lib/rojo-sync-pure.ts. Publishing to Roblox is never here: that stays his click in Studio.
import { useCallback, useEffect, useState } from "react";
import { SETUP_HINT, type Lint } from "@/lib/rojo-pure";
import { PINK } from "./RobloxBuild";

type Project = { name: string; dir: string; at: string; connected?: boolean };
type Serve = { port: number; running: boolean; ours: string | null; log: string; state: string; text: string };
type Check = { name: string; lint: Lint; verdict: { blocking: boolean; text: string; rows: string[] } };
type Connected = { name: string; dir: string; created: string[]; paths: string[]; problems: string[] };
type Info = { root: string; projects: Project[]; serve: Serve };
type Exported = { name: string; dir: string; scripts: number; committed: boolean; first: boolean; selene?: { status: string; text: string } };

class ApiError extends Error { constructor(m: string, public check?: Check) { super(m); } }
async function api<T>(body?: object): Promise<T> {
  const res = await fetch("/api/rojo", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; check?: Check };
  if (!res.ok) throw new ApiError(j.error || `Request failed (error ${res.status}).`, j.check);
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
  const [folder, setFolder] = useState("");
  const [conn, setConn] = useState<Connected | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [blocked, setBlocked] = useState<Check | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => { void api<Info>().then(setInfo, (e) => setErr(msg(e))); }, []);
  useEffect(load, [load]);
  const serve = info?.serve;
  const live = !!serve?.ours;
  useEffect(() => { // while ORBIT's sync runs, refresh its status (skipped in a hidden tab)
    if (!live) return;
    const t = setInterval(() => { if (!document.hidden) void api<Info>().then(setInfo, () => {}); }, 5000);
    return () => clearInterval(t);
  }, [live]);
  const go = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(""); setNote(""); setBlocked(null);
    try { await fn(); } catch (e) { setErr(msg(e)); if (e instanceof ApiError && e.check) setBlocked(e.check); } finally { setBusy(""); load(); }
  };
  const chosen = project || info?.projects[0]?.name || "";
  const chosenP = info?.projects.find((p) => p.name === chosen);
  const startSync = (force: boolean) => go("serve", async () => { await api({ action: "serve", project: chosen, force }); });
  return (
    <section className="glass grid gap-3 rounded-xl p-3 text-sm" style={{ borderColor: `${PINK}44` }} aria-label="Script files">
      <h3 className="brand text-sm" style={{ color: PINK }}>Script files (Rojo + Selene + StyLua, on your PC)</h3>
      <p className="muted text-xs">Rojo copies scripts between files on your PC and Studio. Selene checks Luau code for mistakes, StyLua keeps it tidy. Git keeps every version so you can see what changed. First time: {SETUP_HINT}</p>

      <div className="card space-y-1.5">
        <div className="hud-title">1. Connect project folder</div>
        <p className="muted text-xs">Your game&apos;s folder on this PC. ORBIT uses its default.project.json, or makes one (scripts go in src\ServerScriptService, src\ReplicatedStorage…). It also starts a git history, so every change ORBIT makes can be undone.</p>
        <div className="flex gap-1.5">
          <input className="field min-w-0 flex-1" placeholder="C:\Users\you\Documents\RobloxProjects\PetSim" aria-label="Project folder path" value={folder} onChange={(e) => setFolder(e.target.value)} />
          <button className="btn" disabled={!!busy || !folder.trim()} onClick={() => go("connect", async () => { const r = await api<Connected>({ action: "connect", dir: folder }); setConn(r); setProject(r.name); })}>{busy === "connect" ? "Connecting…" : "Connect project folder"}</button>
        </div>
        {conn && <p className="text-xs" style={{ color: "#4ade80" }}>Connected &quot;{conn.name}&quot;. Script folders: {conn.paths.join(", ") || "none"}.{conn.created.length ? ` Made: ${conn.created.join(", ")}.` : " Nothing new was needed."}</p>}
        {conn?.problems.map((p) => <p key={p} className="text-xs" style={{ color: "#facc15" }}>{p}</p>)}
      </div>

      <div className="card space-y-1.5">
        <div className="hud-title">Or: export scripts from a saved place</div>
        <p className="muted text-xs">In Studio: File → Save to File As… (.rbxl). Then paste that file&apos;s path here (Shift + right-click → Copy as path). Scripts go to {info?.root ?? "Documents\\RobloxProjects"}\&lt;place name&gt;, with a git commit each time. Scripts inside Workspace are not exported.</p>
        <div className="flex gap-1.5">
          <input className="field min-w-0 flex-1" placeholder="C:\Users\you\Documents\PetSim.rbxl" aria-label="Place file path" value={place} onChange={(e) => setPlace(e.target.value)} />
          <button className="btn" disabled={!!busy || !place.trim()} onClick={() => go("export", async () => { const r = await api<Exported>({ action: "export", place }); setDone(r); setProject(r.name); })}>{busy === "export" ? "Exporting…" : "Export scripts to files"}</button>
        </div>
        {done && <p className="text-xs" style={{ color: "#4ade80" }}>Exported {done.scripts} script file(s) to {done.dir}. {done.committed ? (done.first ? "First git commit made." : "Changes committed: run git log -p there to review them.") : "Nothing changed since the last export."}</p>}
        {done?.selene && <p className="muted whitespace-pre-wrap text-xs" style={done.selene.status === "ok" ? undefined : { color: "#facc15" }}>{done.selene.text}</p>}
      </div>

      <div className="card space-y-1.5">
        <div className="hud-title">2. Check code (Selene + StyLua)</div>
        {info && !info.projects.length ? <p className="muted text-xs">No project yet: connect a folder or export a place first.</p> : (
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="field py-1" aria-label="Project" value={chosen} onChange={(e) => setProject(e.target.value)}>{info?.projects.map((p) => <option key={p.name} value={p.name}>{p.name}{p.connected ? " (connected)" : ""}</option>)}</select>
            <button className="btn" disabled={!!busy || !chosen} onClick={() => go("lint", async () => { const c = await api<Check>({ action: "check", project: chosen }); setCheck(c); setLint({ name: c.name, dir: chosenP?.dir ?? "", lint: c.lint }); })}>{busy === "lint" ? "Checking…" : "Check code"}</button>
            <button className="btn" disabled={!!busy || !chosen} title="StyLua tidies spacing and layout. Undo puts it back." onClick={() => go("format", async () => { const r = await api<{ changed: boolean }>({ action: "format", project: chosen }); setNote(r.changed ? "Code tidied (one git commit). Undo puts it back." : "The code was already tidy."); })}>{busy === "format" ? "Tidying…" : "Format code"}</button>
            <button className="btn" disabled={!!busy || !chosen} title="Reverts ORBIT's newest change to your scripts. Your own changes stay." onClick={() => go("undo", async () => { const r = await api<{ undone?: string; none?: boolean }>({ action: "undo", project: chosen }); setNote(r.undone ? `Undone: ${r.undone}.` : "There is no ORBIT change left to undo."); })}>{busy === "undo" ? "Undoing…" : "Undo ORBIT's last change"}</button>
            <button className="btn" disabled={!!busy || !chosen} title="rojo build: a place file with the scripts from these files" onClick={() => go("backup", async () => { const r = await api<{ file: string }>({ action: "backup", project: chosen }); setNote(`Backup saved: ${r.file}. It holds the scripts only, not parts or terrain (save the place in Studio for those).`); })}>{busy === "backup" ? "Saving…" : "Back up scripts (.rbxl)"}</button>
            {chosenP?.connected && <button className="btn" disabled={!!busy} title="ORBIT forgets this folder. The files stay." onClick={() => go("disconnect", async () => { await api({ action: "disconnect", project: chosen }); setProject(""); })}>Forget folder</button>}
          </div>
        )}
        {check && <p className="text-xs" style={{ color: check.verdict.blocking ? "#ef4444" : "#4ade80" }}>{check.verdict.text}</p>}
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
        <p className="text-xs" role="status" style={{ color: serve?.state === "on" ? "#4ade80" : serve?.state === "stopped" || serve?.state === "outside" ? "#facc15" : "#94a3b8" }}>{serve?.text ?? "…"}</p>
        <p className="muted text-xs">ORBIT checks the code first. Rojo only listens on this PC (127.0.0.1), never the network.</p>
        <div className="flex gap-1.5">
          <button className="btn" disabled={!!busy || !chosen || !!serve?.running} onClick={() => startSync(false)}>{busy === "serve" ? "Checking and starting…" : `Start sync${chosen ? ` (${chosen})` : ""}`}</button>
          <button className="btn" disabled={!!busy || !serve?.ours} onClick={() => go("stop", () => api({ action: "stop" }).then(() => {}))}>Stop sync</button>
        </div>
        {blocked && (
          <div className="space-y-1 text-xs">
            <p style={{ color: "#ef4444" }}>Sync didn&apos;t start. {blocked.verdict.text}</p>
            <ul className="list-disc pl-4">{blocked.verdict.rows.map((r) => <li key={r}>{r}</li>)}</ul>
            <button className="btn" disabled={!!busy} onClick={() => startSync(true)}>Start anyway (Studio gets the code as it is)</button>
          </div>
        )}
        <p className="muted text-xs">Then in Studio: Plugins tab → Rojo → Connect (localhost, port {serve?.port ?? 34872}). Rojo shows the changes it wants to make: read the list and press Accept only if it looks right. While connected, edit scripts in the files (VS Code); saved files appear in Studio at once.</p>
      </div>
      <p className="muted text-xs">Nothing here publishes your game. Publishing to Roblox is always your own click in Studio (File → Publish to Roblox).</p>
      {note && <p className="text-xs" style={{ color: "#4ade80" }}>{note}</p>}
      {err && !blocked && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </section>
  );
}
