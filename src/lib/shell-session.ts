// Persistent terminal sessions for CORE and OPERATIONS → Terminal (server only). Pure parts: command-policy-pure.ts (levels),
// shell-session-pure.ts (wrapping, env, caps, CORE's result text). Sessions live in memory (gone after an ORBIT restart);
// level-2 snapshots live in <ORBIT data dir>/terminal-snapshots (private data folder: no command can read them).
// No node-pty: each command is its own child process (no shell), started in the session's folder with the session's env, and the
// wrapper hands back the new folder + env. That keeps cd / venv / set between commands, gives clean output and real exit codes,
// and needs no native build on Windows.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { copyFile, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { classifyCommand, normPath, usableFolders, type CmdVerdict, type Shell } from "./command-policy-pure.ts";
import {
  BUFFER_MAX, MAX_RUNS, MAX_SESSIONS, SNAP_MAX_BYTES, SNAP_MAX_FILES, SNAP_SKIP, appendCapped, cleanEnv, cleanOutput, coreResult, deactivateEnv,
  isSnapId, parseState, snapshotPlan, undoPlan, wrap, type Run, type SessionView, type SnapFile, type SnapManifest,
} from "./shell-session-pure.ts";
import { redactText } from "./trace-export-pure.ts";
import { stopAllOn } from "./stop-all.ts";
import { logActivity } from "./activity.ts";
import { gitRepos } from "./git.ts";
import { parseFolders } from "./pc-policy-pure.ts";

const WINDOWS = process.platform === "win32";
type Session = { id: string; name: string; shell: Shell; cwd: string; env: Record<string, string>; runs: Run[]; proc: ChildProcess | null; createdAt: string };
type Store = { sessions: Map<string, Session>; procs: Map<string, ChildProcess>; done: Map<string, Promise<void>>; seq: number };
const g = globalThis as unknown as { __orbitTerm?: Store };
const S = (g.__orbitTerm ??= { sessions: new Map(), procs: new Map(), done: new Map(), seq: 0 });

const snapRoot = () => path.join(orbitDataDir(), "terminal-snapshots");
const newId = (p: string) => `${p}${Date.now().toString(36)}${(S.seq++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 6)}`;

/** Connected folders (ORBIT_PC_FOLDERS, his git repos, his workspaces) and private ones (ORBIT's data folder, ORBIT_PRIVATE_FOLDERS). */
export async function termConfig(userId: string) {
  const privatePaths = [orbitDataDir(), ...(process.env.ORBIT_PRIVATE_FOLDERS ?? "").split(";").map((s) => s.trim()).filter(Boolean)];
  const ws = /^[0-9a-f-]{36}$/i.test(userId) ? [path.join(orbitDataDir(), "workspaces", userId)] : [];
  const raw = [...parseFolders(process.env.ORBIT_PC_FOLDERS), ...(await gitRepos().catch(() => [])), ...ws];
  const folders = usableFolders(raw, privatePaths);
  const dropped = raw.filter((f) => !folders.includes(f.trim()));
  return { folders, privatePaths, dropped, home: os.homedir(), defaultShell: (WINDOWS ? "powershell" : "bash") as Shell };
}
type Cfg = Awaited<ReturnType<typeof termConfig>>;

const view = (s: Session): SessionView => ({ id: s.id, name: s.name, shell: s.shell, cwd: s.cwd, venv: s.env.VIRTUAL_ENV ? path.basename(s.env.VIRTUAL_ENV) : "", busy: !!s.proc, runs: s.runs, createdAt: s.createdAt });
export const listSessions = (): SessionView[] => [...S.sessions.values()].map(view);
const byName = (name: string) => [...S.sessions.values()].find((s) => s.name === name);
const findRun = (id: string): { s: Session; r: Run } | null => { for (const s of S.sessions.values()) { const r = s.runs.find((x) => x.id === id); if (r) return { s, r }; } return null; };

function openSession(name: string, shell: Shell, cwd: string): Session | string {
  const have = byName(name);
  if (have) return have;
  if (S.sessions.size >= MAX_SESSIONS) {
    const idle = [...S.sessions.values()].filter((x) => !x.proc && !x.runs.some((r) => r.status === "waiting")).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!idle) return `there are already ${MAX_SESSIONS} busy sessions; close one in OPERATIONS → Terminal`;
    S.sessions.delete(idle.id);
  }
  const s: Session = { id: newId("s"), name, shell, cwd, env: cleanEnv(process.env), runs: [], proc: null, createdAt: new Date().toISOString() };
  S.sessions.set(s.id, s);
  return s;
}
export function closeSession(name: string): boolean {
  const s = byName(name);
  if (!s) return false;
  if (s.proc) killTree(s.proc);
  S.sessions.delete(s.id);
  return true;
}

async function branchOf(cwd: string): Promise<string> {
  return new Promise((res) => execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 5000, windowsHide: true, env: cleanEnv(process.env) as unknown as NodeJS.ProcessEnv }, (e, out) => res(e ? "" : String(out).trim())));
}

export type Submit = { userId: string; session?: string; command: string; source: "core" | "owner"; shell?: Shell; cwd?: string; timeoutS: number; outside?: boolean };
/** Classify and start (level 1/2) or queue for his click (level 3). Returns the run (still running, waiting or finished). */
export async function submit(req: Submit): Promise<{ run: Run; session: SessionView } | { error: string }> {
  if (stopAllOn()) return { error: "ORBIT is paused (Stop-all is on): the terminal runs nothing until you resume" };
  const cfg = await termConfig(req.userId);
  if (!cfg.folders.length) return { error: "no project folders are connected: add them to ORBIT_PC_FOLDERS in .env.local (separated by ;) or as git repos in STUDIO → Devlog" };
  const name = req.session ?? "main";
  let s = byName(name);
  if (!s) {
    const cwd = req.cwd ? path.resolve(req.cwd) : cfg.folders[0];
    const shell = req.shell ?? cfg.defaultShell;
    const pre = classifyCommand("pwd", { shell, cwd, folders: cfg.folders, privatePaths: cfg.privatePaths, home: cfg.home });
    if (pre.level === 3) return { error: `a new session can only start in a connected folder (${cfg.folders.join("; ")})` };
    const o = openSession(name, shell, cwd);
    if (typeof o === "string") return { error: o };
    s = o;
  }
  if (s.proc) return { error: `session "${s.name}" is still running a command: wait for it, stop it, or use another session name` };
  const command = req.command.trim();
  const git = /^git\b/i.test(command) && /\bcommit\b/i.test(command) && !/\s-C\s/.test(command);
  const v = classifyCommand(command, { shell: s.shell, cwd: s.cwd, folders: cfg.folders, privatePaths: cfg.privatePaths, home: cfg.home, branch: git ? await branchOf(s.cwd) : "", outside: req.outside });
  const run: Run = { id: newId("r"), session: s.id, command, source: req.source, level: v.level, what: v.what, reason: v.reason, private: v.private, status: "waiting", exit: null,
    startedAt: null, endedAt: null, createdAt: new Date().toISOString(), output: "", outLen: 0, timeoutS: req.timeoutS };
  s.runs = [...s.runs, run].slice(-MAX_RUNS);
  if (v.level === 3) {
    logActivity({ area: "core", title: `Terminal: waiting for your OK: ${v.what}`, detail: v.reason });
    return { run, session: view(s) };
  }
  if (v.level === 2) {
    const snap = await takeSnapshot(v, s, cfg, command).then((id) => ({ id }), (e) => ({ error: e instanceof Error ? e.message : "snapshot failed" }));
    if ("error" in snap) { Object.assign(run, { level: 3, reason: `no snapshot possible (${snap.error}), so it waits for your OK` }); return { run, session: view(s) }; }
    run.snapshot = snap.id;
  }
  start(s, run);
  return { run, session: view(s) };
}

/** His click on a waiting run. The approval covers this exact command in this exact folder. */
export async function approveRun(id: string, cwd: string, command: string): Promise<Run | string> {
  if (stopAllOn()) return "ORBIT is paused (Stop-all is on)";
  const f = findRun(id);
  if (!f || f.r.status !== "waiting") return "That command isn't waiting any more";
  if (f.r.command !== command || f.s.cwd !== cwd) return "The command or its folder changed since you saw it; ask again";
  if (f.s.proc) return "That session is busy; wait or stop it first";
  start(f.s, f.r);
  logActivity({ area: "core", title: `Terminal: you OK'd ${f.r.what}`, detail: f.r.command.slice(0, 200) });
  return f.r;
}
export function skipRun(id: string): boolean {
  const f = findRun(id);
  if (!f || f.r.status !== "waiting") return false;
  Object.assign(f.r, { status: "skipped", endedAt: new Date().toISOString() });
  return true;
}

function killTree(p: ChildProcess) {
  if (!p.pid || p.exitCode !== null) return;
  try {
    if (WINDOWS) spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-p.pid, "SIGKILL");
  } catch { try { p.kill("SIGKILL"); } catch { /* gone */ } }
}

function start(s: Session, run: Run) {
  run.status = "running";
  run.startedAt = new Date().toISOString();
  const state = path.join(os.tmpdir(), "orbit-term", run.id, "state"); // its own folder: removed after the run
  const done = (async () => {
    await mkdir(path.dirname(state), { recursive: true });
    if (!existsSync(s.cwd)) { Object.assign(run, { status: "failed", endedAt: new Date().toISOString(), output: `The folder ${s.cwd} doesn't exist any more.` }); return; }
    if (s.shell === "bash" && /^deactivate$/.test(run.command) || (s.shell !== "bash" && /^deactivate$/i.test(run.command))) { // the venv's function doesn't survive between processes
      s.env = deactivateEnv(s.env);
      Object.assign(run, { status: "done", exit: 0, endedAt: new Date().toISOString(), output: "Left the Python environment." });
      return;
    }
    const w = wrap(s.shell, run.command, s.cwd, state, WINDOWS);
    if (w.batch) await writeFile(state + ".cmd", w.batch);
    const p = spawn(w.file, w.args, { cwd: s.cwd, env: s.env as unknown as NodeJS.ProcessEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !WINDOWS, windowsVerbatimArguments: s.shell === "cmd" });
    s.proc = p; S.procs.set(run.id, p);
    const onData = (b: Buffer) => { const t = cleanOutput(b.toString("utf8")); run.outLen += t.length; run.output = appendCapped(run.output, t, BUFFER_MAX); };
    p.stdout?.on("data", onData); p.stderr?.on("data", onData);
    const timer = setTimeout(() => { run.status = "timeout"; killTree(p); }, run.timeoutS * 1000);
    const code = await new Promise<number | null>((res) => { p.on("error", (e) => { onData(Buffer.from(`\n${e.message}\n`)); res(null); }); p.on("close", (c) => res(c)); });
    clearTimeout(timer);
    s.proc = null; S.procs.delete(run.id);
    run.exit = code; run.endedAt = new Date().toISOString();
    if (run.status === "running") run.status = code === 0 ? "done" : "failed";
    const [cwdText, envText] = await Promise.all([readFile(state + ".cwd", "utf8").catch(() => null), readFile(state + ".env", "utf8").catch(() => null)]);
    const st = parseState(s.shell, cwdText, envText);
    if (st.cwd && path.isAbsolute(st.cwd)) s.cwd = st.cwd; // checked again by the policy before the next command: outside a connected folder → nothing runs
    if (st.env) s.env = { ...cleanEnv({}), ...st.env };
  })().catch((e) => { Object.assign(run, { status: "failed", endedAt: new Date().toISOString() }); run.output += `\n${e instanceof Error ? e.message : e}`; s.proc = null; })
    .finally(() => { S.done.delete(run.id); void rm(path.dirname(state), { recursive: true, force: true }).catch(() => {}); if (run.level >= 2 || run.source === "core") logRun(run); });
  S.done.set(run.id, done);
}
function logRun(r: Run) {
  if (r.level === 1 && r.status === "done") return;
  logActivity({ area: "core", title: `Terminal: ${r.what}: ${r.status}`, detail: r.private ? "private output" : r.command.slice(0, 200), ...(r.snapshot && r.status !== "skipped" ? { undo: { kind: "term" as const, id: r.snapshot } } : {}) });
}

/** Wait up to `seconds` for a run to finish. */
export async function waitRun(id: string, seconds: number): Promise<Run | null> {
  const p = S.done.get(id);
  if (p && seconds > 0) await Promise.race([p, new Promise((r) => setTimeout(r, seconds * 1000))]);
  return findRun(id)?.r ?? null;
}
export function stopRun(id: string): boolean {
  const f = findRun(id);
  if (!f) return false;
  if (f.r.status === "waiting") return skipRun(id);
  const p = S.procs.get(id);
  if (!p) return false;
  f.r.status = "stopped";
  killTree(p);
  return true;
}
/** Stop-all: kill every running command and drop every waiting one. */
export function stopAllSessions(): number {
  let n = 0;
  for (const s of S.sessions.values()) {
    for (const r of s.runs) {
      if (r.status === "running") { r.status = "stopped"; n++; }
      if (r.status === "waiting") Object.assign(r, { status: "skipped", endedAt: new Date().toISOString(), note: "Stop-all" });
    }
    if (s.proc) killTree(s.proc);
  }
  return n;
}
export const runResult = (run: Run, session: SessionView) => coreResult(run, session, redactText);

/* ---------- snapshots ---------- */

async function walk(root: string, rel = "", out: SnapFile[] = [], budget = { files: 0, bytes: 0 }): Promise<SnapFile[]> {
  const dir = path.join(root, rel);
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue; // never followed: a link could point anywhere (also into private data)
    if (e.isDirectory()) { if (!SNAP_SKIP.has(e.name.toLowerCase())) await walk(root, r, out, budget); continue; }
    if (!e.isFile()) continue;
    const st = await stat(path.join(root, r)).catch(() => null);
    if (!st) continue;
    budget.files++; budget.bytes += st.size;
    if (budget.files > SNAP_MAX_FILES || budget.bytes > SNAP_MAX_BYTES) throw new Error(`the folder is too big to snapshot (over ${SNAP_MAX_FILES} files or ${SNAP_MAX_BYTES >> 20} MB, not counting node_modules, .git, .venv, build folders)`);
    out.push({ rel: r, size: st.size, mtime: st.mtimeMs });
  }
  return out;
}
/** Files for a named path (a file, a folder or not there yet). */
async function named(root: string, rel: string): Promise<SnapFile[] | null> {
  const abs = path.join(root, rel);
  const st = await lstat(abs).catch(() => null);
  if (!st) return null;
  if (st.isSymbolicLink()) return [];
  if (st.isDirectory()) return walk(root, rel);
  return [{ rel, size: st.size, mtime: st.mtimeMs }];
}
async function takeSnapshot(v: CmdVerdict, s: Session, cfg: Cfg, command: string): Promise<string> {
  const plan = snapshotPlan(v.writes, s.cwd, cfg.folders, normPath);
  if (!plan) throw new Error("it changes files in more than one folder");
  const id = newId("t");
  const files: SnapFile[] = [], missing: string[] = [];
  if (plan.whole) files.push(...(await walk(plan.root)));
  else for (const rel of plan.rels) {
    // rels are lowercase; find the real-case path on disk (Windows doesn't care, Linux does)
    const real = await realCase(plan.root, rel);
    const f = real ? await named(plan.root, real) : null;
    if (f) files.push(...f); else missing.push(rel);
  }
  const dir = path.join(snapRoot(), id);
  for (const f of files) {
    const to = path.join(dir, "files", f.rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(path.join(plan.root, f.rel), to);
  }
  const m: SnapManifest = { id, at: new Date().toISOString(), root: plan.root, whole: plan.whole, files, missing, command };
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(m));
  void pruneSnapshots();
  return id;
}
async function realCase(root: string, rel: string): Promise<string | null> {
  let cur = "";
  for (const part of rel.split("/")) {
    const names = await readdir(path.join(root, cur)).catch(() => null);
    const hit = names?.find((n) => n.toLowerCase() === part);
    if (!hit) return null;
    cur = cur ? `${cur}/${hit}` : hit;
  }
  return cur;
}
/** Keeps the newest 30 snapshots (ORBIT's own copies; his files are untouched). */
async function pruneSnapshots() {
  const ids = (await readdir(snapRoot()).catch(() => [] as string[])).filter(isSnapId).sort();
  for (const id of ids.slice(0, Math.max(0, ids.length - 30))) await rm(path.join(snapRoot(), id), { recursive: true, force: true }).catch(() => {});
}
/** Undo a level-2 run: files go back as they were; files it added are moved into the snapshot's "undone" folder (not deleted). */
export async function undoSnapshot(id: string): Promise<string> {
  if (!isSnapId(id)) throw new Error("Invalid snapshot");
  if (stopAllOn()) throw new Error("ORBIT is paused (Stop-all is on)");
  const dir = path.join(snapRoot(), id);
  const m = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8").catch(() => { throw new Error("That snapshot is gone (only the newest 30 are kept)"); })) as SnapManifest;
  for (const s of S.sessions.values()) if (s.proc && normPath(s.cwd)?.startsWith(normPath(m.root) ?? "\0")) throw new Error("A command is still running in that folder; stop it first");
  const now = m.whole ? await walk(m.root).catch(() => [] as SnapFile[]) : (await Promise.all(m.missing.map(async (r) => { const real = await realCase(m.root, r); return real ? [{ rel: real, size: 0, mtime: 0 }] : []; }))).flat();
  const plan = undoPlan(m, now);
  const away = path.join(dir, "undone", new Date().toISOString().replace(/[:.]/g, "-"));
  for (const rel of plan.moveAway) {
    const real = m.whole ? rel : (await realCase(m.root, rel.toLowerCase())) ?? rel;
    const to = path.join(away, real);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(path.join(m.root, real), to).catch(async () => { // another drive: copy, then remove the one ORBIT's run added
      await cp(path.join(m.root, real), to, { recursive: true });
      await rm(path.join(m.root, real), { recursive: true, force: true });
    });
  }
  for (const rel of plan.restore) {
    const to = path.join(m.root, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(path.join(dir, "files", rel), to);
  }
  for (const s of S.sessions.values()) for (const r of s.runs) if (r.snapshot === id) r.undone = true;
  return `Undone: ${plan.restore.length} file(s) put back, ${plan.moveAway.length} new file(s) moved to ORBIT's snapshot folder (${m.command.slice(0, 80)})`;
}
