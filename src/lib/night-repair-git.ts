// Night repair: git worktrees and child processes (no Next imports, so tests/night-repair-git.test.ts runs it on Linux in a temp repo).
// git is the same binary scripts/launch.ps1 uses: "git" on PATH. Fixed argument lists via execFile/spawn (no shell; a shell only for
// npm.cmd on Windows, with fixed arguments). No prompts (GIT_TERMINAL_PROMPT=0, Git Credential Manager non-interactive, ssh BatchMode).
import { spawn } from "node:child_process";
import { lstat, mkdir, rm, symlink, unlink } from "node:fs/promises";
import path from "node:path";

const WIN = process.platform === "win32";
export type Run = { code: number; out: string; ms: number; timedOut?: boolean };
type RunOpts = { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number; signal?: AbortSignal; max?: number };

function killTree(pid: number | undefined, child: { kill: (s?: NodeJS.Signals) => boolean }) {
  if (WIN && pid) spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill("SIGKILL"));
  else if (pid) { try { process.kill(-pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
}

/** Runs a program; stdout+stderr together (last `max` chars kept). Never rejects: code -1 = couldn't start, timed out or aborted. */
export function run(cmd: string, args: string[], o: RunOpts = {}): Promise<Run> {
  const t0 = Date.now(), max = o.max ?? 400_000;
  return new Promise((resolve) => {
    let out = "", done = false;
    const shell = WIN && /\.cmd$/i.test(cmd); // npm.cmd needs a shell on Windows; arguments are fixed strings, never user text
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv | undefined, windowsHide: true, shell, detached: !WIN, stdio: ["ignore", "pipe", "pipe"] });
    const add = (d: Buffer) => { out += d.toString("utf8"); if (out.length > max * 2) out = out.slice(-max); };
    child.stdout?.on("data", add); child.stderr?.on("data", add);
    const finish = (code: number, extra?: Partial<Run>) => { if (done) return; done = true; clearTimeout(timer); o.signal?.removeEventListener("abort", onAbort); resolve({ code, out: out.slice(-max), ms: Date.now() - t0, ...extra }); };
    const onAbort = () => { killTree(child.pid, child); finish(-1, { out: out + "\n[stopped]" } as Partial<Run>); };
    const timer = setTimeout(() => { killTree(child.pid, child); finish(-1, { timedOut: true }); }, o.timeoutMs ?? 120_000);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    if (o.signal?.aborted) onAbort();
    child.on("error", (e) => { out += `\n${e.message}`; finish(-1); });
    child.on("close", (code) => finish(code ?? -1));
  });
}

/** Inherited GIT_* could redirect git (GIT_DIR, GIT_WORK_TREE…); never prompt for credentials. */
export function gitEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !/^GIT_/i.test(k)) out[k] = v;
  return { ...out, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes", GIT_OPTIONAL_LOCKS: "0" };
}
const BASE = ["-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "-c", "color.ui=false", "--no-pager"];
export const git = (repo: string, args: string[], o: Omit<RunOpts, "cwd"> = {}) => run("git", ["-C", repo, ...BASE, ...args], { timeoutMs: 120_000, ...o, env: gitEnv(o.env ?? process.env) });
const ok = async (p: Promise<Run>, what: string) => { const r = await p; if (r.code !== 0) throw new Error(`${what} failed: ${r.out.trim().slice(-300) || `exit ${r.code}`}`); return r.out.trim(); };

export const revParse = (repo: string, ref: string) => ok(git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]), `git rev-parse ${ref}`);
/** Fetch origin/main; its commit. */
export async function fetchMain(repo: string, signal?: AbortSignal): Promise<string> {
  await ok(git(repo, ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"], { signal }), "git fetch origin main");
  return revParse(repo, "origin/main");
}
export const nightBranches = async (repo: string) => (await ok(git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/night/"]), "git for-each-ref")).split(/\r?\n/).filter(Boolean);

/** A new worktree at `dir` on a NEW branch from `base` (fails if the branch exists). */
export async function addWorktree(repo: string, dir: string, branch: string, base: string) {
  await mkdir(path.dirname(dir), { recursive: true });
  await ok(git(repo, ["worktree", "add", "-b", branch, dir, base]), "git worktree add");
}
export async function addDetached(repo: string, dir: string, ref: string) {
  await mkdir(path.dirname(dir), { recursive: true });
  await ok(git(repo, ["worktree", "add", "--detach", dir, ref]), "git worktree add --detach");
}
/** Remove a worktree, then prune. The node_modules junction is unlinked FIRST (never followed: it points at the live checkout's
 *  node_modules); if it can't be unlinked the folder is left in place rather than risk deleting through it. Never throws. */
export async function removeWorktree(repo: string, dir: string): Promise<boolean> {
  const nm = path.join(dir, "node_modules");
  const st = await lstat(nm).catch(() => null);
  if (st?.isSymbolicLink()) await unlink(nm).catch(() => rm(nm, { force: true }).catch(() => {}));
  if ((await lstat(nm).catch(() => null))?.isSymbolicLink()) return false;
  await git(repo, ["worktree", "remove", "--force", "--force", dir]).catch(() => null);
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
  await git(repo, ["worktree", "prune"]).catch(() => null);
  return true;
}
/** node_modules from the live checkout, as a junction (Windows, no admin needed) / symlink. Only after the agent is done. */
export const linkModules = (wt: string, modules: string) => symlink(modules, path.join(wt, "node_modules"), WIN ? "junction" : "dir");

/** Ignored files the agent left behind (e.g. an .env.local the build would read), except node_modules. */
export async function strayIgnored(wt: string): Promise<string[]> {
  const out = await ok(git(wt, ["status", "--porcelain", "--ignored", "--untracked-files=all"]), "git status");
  return out.split(/\r?\n/).filter((l) => l.startsWith("!! ")).map((l) => l.slice(3)).filter((p) => !/^node_modules\/?$/.test(p));
}

const ID = ["-c", "user.name=ORBIT night repair", "-c", "user.email=orbit-night-repair@localhost", "-c", "commit.gpgsign=false"];
/** Stage everything and commit; null when nothing changed. */
export async function commitAll(wt: string, message: string): Promise<string | null> {
  await ok(git(wt, ["add", "-A"]), "git add");
  if ((await git(wt, ["diff", "--cached", "--quiet"])).code === 0) return null;
  await ok(git(wt, [...ID, "commit", "--no-verify", "-q", "-m", message]), "git commit");
  return revParse(wt, "HEAD");
}
/** The real diff the checks judge: base..head. */
export async function diffOf(repo: string, base: string, head: string) {
  const [numstat, raw, patch] = await Promise.all([
    ok(git(repo, ["diff", "--numstat", "--no-renames", `${base}..${head}`]), "git diff --numstat"),
    ok(git(repo, ["diff", "--raw", "--no-renames", "--no-abbrev", `${base}..${head}`]), "git diff --raw"),
    ok(git(repo, ["diff", "--no-renames", "--no-ext-diff", "--no-textconv", `${base}..${head}`], { max: 2_000_000 }), "git diff"),
  ]);
  return { numstat, raw, patch };
}
export const pushBranch = (repo: string, branch: string, signal?: AbortSignal) => ok(git(repo, ["push", "--no-verify", "origin", `refs/heads/${branch}:refs/heads/${branch}`], { signal, timeoutMs: 180_000 }), "git push");
export const deleteBranch = (repo: string, branch: string) => git(repo, ["branch", "-D", branch]);
export const remoteUrl = async (repo: string) => (await git(repo, ["remote", "get-url", "origin"])).out.trim();
/** The live checkout: on main, main an ancestor of `sha`, then fast-forward main to it. */
export async function fastForwardMain(repo: string, sha: string): Promise<void> {
  const branch = await ok(git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]), "git rev-parse");
  if (branch !== "main") throw new Error(`the ORBIT folder is on ${branch}, not main`);
  if ((await git(repo, ["merge-base", "--is-ancestor", "HEAD", sha])).code !== 0) throw new Error("main moved since this patch was made: it needs a rebase (reject it; tonight's repair can redo it)");
  await ok(git(repo, ["merge", "--ff-only", "-q", sha]), "git merge --ff-only");
}
