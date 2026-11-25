"use client";
// GAME DEV → Build → Files: connect his game's folder (or export Studio scripts) as a Rojo project on his PC, check the code with Selene +
// StyLua, run Rojo's live sync, Undo ORBIT's edits and make backups. Tools come from tools/roblox/setup.ps1. Data: /api/rojo.
// Rules: lib/rojo-pure.ts + lib/rojo-sync-pure.ts. Publishing to Roblox is never here: that stays his click in Studio.
import { useCallback, useEffect, useState } from "react";
import type { Lint } from "@/lib/rojo-pure";
import { PINK } from "./RobloxBuild";
import { useT } from "./i18n";

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
  const { t } = useT();
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
    const iv = setInterval(() => { if (!document.hidden) void api<Info>().then(setInfo, () => {}); }, 5000);
    return () => clearInterval(iv);
  }, [live]);
  const go = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(""); setNote(""); setBlocked(null);
    try { await fn(); } catch (e) { setErr(msg(e)); if (e instanceof ApiError && e.check) setBlocked(e.check); } finally { setBusy(""); load(); }
  };
  const chosen = project || info?.projects[0]?.name || "";
  const chosenP = info?.projects.find((p) => p.name === chosen);
  const startSync = (force: boolean) => go("serve", async () => { await api({ action: "serve", project: chosen, force }); });
  return (
    <section className="glass grid min-w-0 gap-3 rounded-xl p-3 text-sm [&>*]:min-w-0" style={{ borderColor: `${PINK}44` }} aria-label={t("rj.files")}>
      <h3 className="brand text-sm" style={{ color: PINK }}>{t("rj.title")}</h3>
      <p className="muted text-xs">{t("rj.help")} {t("rj.setupHint")}</p>

      <div className="card space-y-1.5">
        <div className="hud-title">1. {t("rj.connectHead")}</div>
        <p className="muted text-xs">{t("rj.connectHelp")}</p>
        <div className="flex flex-wrap gap-1.5">
          <input className="field min-w-0 flex-1" placeholder={t("rj.folderPh")} aria-label={t("rj.folder")} value={folder} onChange={(e) => setFolder(e.target.value)} />
          <button className="btn" disabled={!!busy || !folder.trim()} onClick={() => go("connect", async () => { const r = await api<Connected>({ action: "connect", dir: folder }); setConn(r); setProject(r.name); })}>{busy === "connect" ? t("rj.connecting") : t("rj.connectHead")}</button>
        </div>
        {conn && <p className="text-xs" style={{ color: "#4ade80" }}>{t("rj.connected", { name: conn.name, paths: conn.paths.join(", ") || t("rj.none") })} {conn.created.length ? t("rj.made", { list: conn.created.join(", ") }) : t("rj.nothingNew")}</p>}
        {conn?.problems.map((p) => <p key={p} className="text-xs" style={{ color: "#facc15" }}>{p}</p>)}
      </div>

      <div className="card space-y-1.5">
        <div className="hud-title">{t("rj.exportHead")}</div>
        <p className="muted text-xs">{t("rj.exportHelp", { root: info?.root ?? "Documents\\RobloxProjects" })}</p>
        <div className="flex flex-wrap gap-1.5">
          <input className="field min-w-0 flex-1" placeholder={t("rj.placePh")} aria-label={t("rj.place")} value={place} onChange={(e) => setPlace(e.target.value)} />
          <button className="btn" disabled={!!busy || !place.trim()} onClick={() => go("export", async () => { const r = await api<Exported>({ action: "export", place }); setDone(r); setProject(r.name); })}>{busy === "export" ? t("rj.exporting") : t("rj.export")}</button>
        </div>
        {done && <p className="text-xs" style={{ color: "#4ade80" }}>{t("rj.exported", { n: done.scripts, dir: done.dir })} {done.committed ? (done.first ? t("rj.firstCommit") : t("rj.committed")) : t("rj.unchanged")}</p>}
        {done?.selene && <p className="muted whitespace-pre-wrap text-xs" style={done.selene.status === "ok" ? undefined : { color: "#facc15" }}>{done.selene.text}</p>}
      </div>

      <div className="card space-y-1.5">
        <div className="hud-title">2. {t("rj.checkHead")}</div>
        {info && !info.projects.length ? <p className="muted text-xs">{t("rj.noProject")}</p> : (
          <div className="flex flex-wrap items-center gap-1.5">
            <select className="field py-1" aria-label={t("rj.project")} value={chosen} onChange={(e) => setProject(e.target.value)}>{info?.projects.map((p) => <option key={p.name} value={p.name}>{p.name}{p.connected ? ` ${t("rj.connectedTag")}` : ""}</option>)}</select>
            <button className="btn" disabled={!!busy || !chosen} onClick={() => go("lint", async () => { const c = await api<Check>({ action: "check", project: chosen }); setCheck(c); setLint({ name: c.name, dir: chosenP?.dir ?? "", lint: c.lint }); })}>{busy === "lint" ? t("rj.checking") : t("rj.check")}</button>
            <button className="btn" disabled={!!busy || !chosen} title={t("rj.formatTip")} onClick={() => go("format", async () => { const r = await api<{ changed: boolean }>({ action: "format", project: chosen }); setNote(r.changed ? t("rj.tidied") : t("rj.alreadyTidy")); })}>{busy === "format" ? t("rj.tidying") : t("rj.format")}</button>
            <button className="btn" disabled={!!busy || !chosen} title={t("rj.undoTip")} onClick={() => go("undo", async () => { const r = await api<{ undone?: string; none?: boolean }>({ action: "undo", project: chosen }); setNote(r.undone ? t("rj.undone", { what: r.undone }) : t("rj.nothingUndo")); })}>{busy === "undo" ? t("rj.undoing") : t("rj.undo")}</button>
            <button className="btn" disabled={!!busy || !chosen} title={t("rj.backupTip")} onClick={() => go("backup", async () => { const r = await api<{ file: string }>({ action: "backup", project: chosen }); setNote(t("rj.backupSaved", { file: r.file })); })}>{busy === "backup" ? t("rj.saving") : t("rj.backup")}</button>
            {chosenP?.connected && <button className="btn" disabled={!!busy} title={t("rj.forgetTip")} onClick={() => go("disconnect", async () => { await api({ action: "disconnect", project: chosen }); setProject(""); })}>{t("rj.forget")}</button>}
          </div>
        )}
        {check && <p className="text-xs" style={{ color: check.verdict.blocking ? "#ef4444" : "#4ade80" }}>{check.verdict.text}</p>}
        {lint && (
          <div className="space-y-1.5 text-xs">
            <p><b>{lint.lint.total ? t("rj.issues", { n: lint.lint.total }) : t("rj.noIssues")}</b> {t("rj.lintSummary", { name: lint.name, e: lint.lint.errors, w: lint.lint.warnings })}{lint.lint.parseErrors ? `, ${t("rj.parseErrors", { n: lint.lint.parseErrors })}` : ""}{lint.lint.clipped ? ` ${t("rj.first500")}` : ""}.</p>
            {lint.lint.files.map((f) => (
              <details key={f.file} className="card" open={lint.lint.files.length <= 3}>
                <summary className="cursor-pointer">{f.file} <span className="muted">({f.issues.length})</span></summary>
                <ul className="mt-1 space-y-1">
                  {f.issues.map((i, n) => (
                    <li key={n}>
                      <a href={vscode(lint.dir, f.file, i.line, i.col)} title={t("rj.openVs")} className="underline">{t("rj.line", { n: i.line })}</a>{" "}
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
        <div className="hud-title">3. {t("rj.syncHead")}</div>
        <p className="text-xs" role="status" style={{ color: serve?.state === "on" ? "#4ade80" : serve?.state === "stopped" || serve?.state === "outside" ? "#facc15" : "#94a3b8" }}>{serve?.text ?? "…"}</p>
        <p className="muted text-xs">{t("rj.syncHelp")}</p>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn" disabled={!!busy || !chosen || !!serve?.running} onClick={() => startSync(false)}>{busy === "serve" ? t("rj.starting") : `${t("rj.start")}${chosen ? ` (${chosen})` : ""}`}</button>
          <button className="btn" disabled={!!busy || !serve?.ours} onClick={() => go("stop", () => api({ action: "stop" }).then(() => {}))}>{t("rj.stop")}</button>
        </div>
        {blocked && (
          <div className="space-y-1 text-xs">
            <p style={{ color: "#ef4444" }}>{t("rj.notStarted")} {blocked.verdict.text}</p>
            <ul className="list-disc pl-4">{blocked.verdict.rows.map((r) => <li key={r}>{r}</li>)}</ul>
            <button className="btn" disabled={!!busy} onClick={() => startSync(true)}>{t("rj.startAnyway")}</button>
          </div>
        )}
        <p className="muted text-xs">{t("rj.thenStudio", { port: serve?.port ?? 34872 })}</p>
      </div>
      <p className="muted text-xs">{t("rj.noPublish")}</p>
      {note && <p className="text-xs" style={{ color: "#4ade80" }}>{note}</p>}
      {err && !blocked && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </section>
  );
}
