// GAME DEV → Files, IO side: Rojo + Selene on his PC (installed by tools/roblox/setup.ps1). Everything here is local: files in his
// projects folder, `rojo syncback` / `selene` / `rojo serve` / `git` run with fixed arguments and no shell. Nothing is uploaded or published.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { GITIGNORE, ROJO_PORT, SELENE_TOML, SETUP_HINT, SOURCE_DIRS, lintSummary, parseSelene, placePath, projectJson, projectName, type Lint } from "./rojo-pure";

const WIN = process.platform === "win32";
export const projectsRoot = () => process.env.ORBIT_ROBLOX_PROJECTS?.trim() || path.join(os.homedir(), "Documents", "RobloxProjects");
const ROKIT_TOML = path.join(process.cwd(), "tools", "roblox", "rokit.toml");

/** Rokit's shim folder first: ORBIT may have started before setup.ps1 added it to PATH. */
function bin(name: string): string {
  const shim = path.join(os.homedir(), ".rokit", "bin", WIN ? `${name}.exe` : name);
  return existsSync(shim) ? shim : name;
}

type Out = { code: number | null; out: string; err: string };
const CAP = 4_000_000;
function run(cmd: string, args: string[], cwd: string, ms: number): Promise<Out> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(cmd), args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { killTree(child); reject(new Error(`${cmd} took longer than ${ms / 1000} s and was stopped.`)); }, ms);
    child.stdout.setEncoding("utf8").on("data", (d: string) => { if (out.length < CAP) out += d; });
    child.stderr.setEncoding("utf8").on("data", (d: string) => { if (err.length < CAP) err += d; });
    child.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(e.code === "ENOENT" ? (cmd === "git" ? "Git isn't installed. Install it (winget install Git.Git), then try again." : `${cmd} isn't installed. ${SETUP_HINT}`) : e.message)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
const tail = (o: Out) => (o.err.trim() || o.out.trim()).slice(-600);

function killTree(child: ChildProcess) {
  if (WIN && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill());
  else child.kill();
}

const g = globalThis as unknown as { __orbitRojo?: { busy: boolean; serve: { child: ChildProcess; project: string; log: string } | null } };
const st = (g.__orbitRojo ??= { busy: false, serve: null });
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (st.busy) throw new Error("ORBIT is already exporting or checking a Roblox project. Wait for it to finish.");
  st.busy = true;
  try { return await fn(); } finally { st.busy = false; }
}

export type Project = { name: string; dir: string; at: string };
/** Folders in the projects folder that have a default.project.json, newest first. */
export async function listProjects(): Promise<Project[]> {
  const root = projectsRoot();
  const names = await readdir(root, { withFileTypes: true }).catch(() => []);
  const out: Project[] = [];
  for (const d of names) {
    if (!d.isDirectory()) continue;
    const s = await stat(path.join(root, d.name, "default.project.json")).catch(() => null);
    if (s) out.push({ name: d.name, dir: path.join(root, d.name), at: s.mtime.toISOString() });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** A project by name (only names listProjects returns), or the newest one when name is empty. */
async function project(name: unknown): Promise<Project> {
  const all = await listProjects();
  if (!all.length) throw new Error(`No exported Roblox project yet in ${projectsRoot()}. Export one first (GAME DEV → Build → Files).`);
  if (name === undefined || name === null || name === "") return all[0];
  const p = all.find((x) => x.name.toLowerCase() === String(name).trim().toLowerCase());
  if (!p) throw new Error(`No project called "${String(name).slice(0, 80)}". Projects: ${all.map((x) => x.name).join(", ")}.`);
  return p;
}

const writeNew = async (file: string, text: string) => { if (!existsSync(file)) await writeFile(file, text, "utf8"); };
async function countScripts(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) n += await countScripts(path.join(dir, e.name));
    else if (/\.luau?$/i.test(e.name)) n++;
  }
  return n;
}
const git = (dir: string, ...a: string[]) => run("git", ["-c", "user.name=ORBIT", "-c", "user.email=orbit@localhost", "-c", "core.autocrlf=false", ...a], dir, 60_000);

export type ExportResult = { name: string; dir: string; scripts: number; committed: boolean; first: boolean };
/** Saved place file (.rbxl/.rbxlx) → Rojo project folder via `rojo syncback`, then a git commit so each export is a reviewable diff.
 *  A folder with uncommitted file changes is refused (syncback would overwrite them). */
export function exportPlace(place: unknown): Promise<ExportResult> {
  return exclusive(async () => {
    const file = placePath(place);
    if (!file || !path.isAbsolute(file)) throw new Error("Give the full path of a saved place file (.rbxl or .rbxlx). In Studio: File → Save to File As…");
    if (!(await stat(file).catch(() => null))?.isFile()) throw new Error(`Can't find ${file}.`);
    const name = projectName(file), dir = path.join(projectsRoot(), name);
    const first = !existsSync(path.join(dir, ".git"));
    if (first && (await readdir(dir).catch(() => [])).length) throw new Error(`${dir} already exists and isn't an ORBIT export (no git history). Move or rename it first.`);
    await mkdir(dir, { recursive: true });
    if (!first) {
      const s = await git(dir, "status", "--porcelain");
      if (s.code !== 0) throw new Error(`git status failed in ${dir}: ${tail(s)}`);
      if (s.out.trim()) throw new Error(`${dir} has file changes that aren't committed yet. Commit them first (git add -A, then git commit) so the export can't overwrite them.`);
    }
    await writeNew(path.join(dir, "default.project.json"), projectJson(name));
    await writeNew(path.join(dir, "selene.toml"), SELENE_TOML);
    await writeNew(path.join(dir, ".gitignore"), GITIGNORE);
    if (!existsSync(path.join(dir, "rokit.toml")) && existsSync(ROKIT_TOML)) await copyFile(ROKIT_TOML, path.join(dir, "rokit.toml")); // same pins as setup.ps1, so the Rokit shims run here
    for (const d of SOURCE_DIRS) await mkdir(path.join(dir, d), { recursive: true });
    const r = await run("rojo", ["syncback", ".", "--input", file, "--non-interactive"], dir, 300_000);
    if (r.code !== 0) throw new Error(`rojo syncback failed: ${tail(r)}`);
    if (first) { const i = await git(dir, "init", "-q"); if (i.code !== 0) throw new Error(`git init failed: ${tail(i)}`); }
    const a = await git(dir, "add", "-A");
    if (a.code !== 0) throw new Error(`git add failed: ${tail(a)}`);
    const changed = (await git(dir, "status", "--porcelain")).out.trim() !== "";
    if (changed) {
      const c = await git(dir, "commit", "-q", "-m", `${first ? "First export" : "Export"} from ${path.basename(file)} (ORBIT)`);
      if (c.code !== 0) throw new Error(`git commit failed: ${tail(c)}`);
    }
    return { name, dir, scripts: await countScripts(path.join(dir, "src")), committed: changed, first };
  });
}

/** `selene` on one project (read-only). Each issue carries its source line for the line view. */
export function lintProject(name?: unknown): Promise<{ name: string; dir: string; lint: Lint }> {
  return exclusive(async () => {
    const p = await project(name);
    const r = await run("selene", ["--display-style", "json2", "src"], p.dir, 180_000);
    const lint = parseSelene(r.out);
    if (!lint) throw new Error(`Selene didn't produce a result: ${tail(r) || `exit ${r.code}`}`);
    for (const f of lint.files) {
      const full = path.resolve(p.dir, f.file);
      if (!full.startsWith(p.dir + path.sep)) continue; // only files inside the project
      const lines = (await readFile(full, "utf8").catch(() => "")).split(/\r?\n/);
      for (const i of f.issues) i.text = lines[i.line - 1]?.slice(0, 300);
    }
    return { name: p.name, dir: p.dir, lint };
  });
}

/* ---------- rojo serve (one, started from ORBIT; 127.0.0.1 only) ---------- */

const portOpen = () => new Promise<boolean>((ok) => {
  const s = net.connect({ host: "127.0.0.1", port: ROJO_PORT }, () => { s.destroy(); ok(true); });
  s.on("error", () => ok(false));
  s.setTimeout(800, () => { s.destroy(); ok(false); });
});

export async function serveStatus() {
  return { port: ROJO_PORT, running: await portOpen(), ours: st.serve?.project ?? null, log: st.serve?.log.slice(-600) ?? "" };
}

export async function startServe(name: unknown) {
  const p = await project(name);
  if (st.serve) stopServe();
  if (await portOpen()) throw new Error(`Something already uses port ${ROJO_PORT} (maybe rojo serve in another window). Stop it first.`);
  const child = spawn(bin("rojo"), ["serve"], { // defaults: 127.0.0.1:34872, what the Studio plugin expects
    cwd: p.dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const s = { child, project: p.name, log: "" };
  const log = (d: Buffer) => { s.log = (s.log + d.toString()).slice(-4000); };
  child.stdout!.on("data", log); child.stderr!.on("data", log);
  const failed = new Promise<string>((ok) => {
    child.on("error", (e: NodeJS.ErrnoException) => ok(e.code === "ENOENT" ? `rojo isn't installed. ${SETUP_HINT}` : e.message));
    child.on("exit", (code) => { if (st.serve === s) st.serve = null; ok(`rojo serve stopped (exit ${code ?? "killed"}): ${s.log.slice(-400)}`); });
  });
  st.serve = s;
  for (let i = 0; i < 40; i++) {
    const err = await Promise.race([failed, new Promise<null>((r) => setTimeout(() => r(null), 250))]);
    if (err) { st.serve = null; throw new Error(err); }
    if (await portOpen()) return serveStatus();
  }
  stopServe();
  throw new Error(`rojo serve didn't start within 10 s: ${s.log.slice(-400)}`);
}

/** Stops the rojo serve ORBIT started (not one he started himself). Used by the Stop button and Stop-all. */
export function stopServe(): boolean {
  const s = st.serve;
  if (!s) return false;
  st.serve = null;
  killTree(s.child); // the Rokit shim starts rojo as a child: kill the tree
  return true;
}

/** CORE tools roblox_export / roblox_lint. Errors come back as "Error: ..." text (core.ts's convention). */
export async function runRojoTool(tool: string, i: Record<string, unknown>): Promise<string> {
  try {
    if (tool === "roblox_export") {
      const r = await exportPlace(i.place);
      return `Exported "${r.name}" to ${r.dir}: ${r.scripts} script file(s). ${r.committed ? (r.first ? "Started a git history with the first commit." : "Committed the changes (git diff shows them).") : "Nothing changed since the last export."} Scripts inside Workspace are not exported. Check the code with roblox_lint or GAME DEV → Build → Files.`;
    }
    const r = await lintProject(i.project);
    return lintSummary(r.name, r.lint);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
