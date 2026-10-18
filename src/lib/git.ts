import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { MAX_OUT, allowedRepo, gitArgs, isoDay, parseBase, parseLog, parseRepoList, repoName, trimStat, type RepoSummary } from "./git-pure";

// Read-only git on the owner's repos: ORBIT_GIT_REPOS (env) + git-repos.json in the data dir (STUDIO → Devlog field).
// Only the fixed argument lists from gitArgs, via execFile (no shell), 10 s timeout, output capped.

const file = () => path.join(orbitDataDir(), "git-repos.json");

export async function savedRepos(): Promise<string[]> {
  try { const j = JSON.parse(await readFile(file(), "utf8")); return Array.isArray(j?.repos) ? parseRepoList(j.repos.join("\n")) : []; } catch { return []; }
}
export async function saveRepos(raw: string): Promise<string[]> {
  const repos = parseRepoList(raw);
  await mkdir(orbitDataDir(), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify({ repos }));
  await rename(file() + ".tmp", file());
  return repos;
}
export const envRepos = () => parseRepoList(process.env.ORBIT_GIT_REPOS);
export const gitRepos = async () => parseRepoList([...envRepos(), ...(await savedRepos())].join("\n"));

// Inherited GIT_* (GIT_DIR, GIT_EXEC_PATH, GIT_SSH_COMMAND…) could redirect git; never prompt, never fetch lazily (partial clones).
const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))), GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" });

function git(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { timeout: 10_000, maxBuffer: 4 * MAX_OUT, windowsHide: true, encoding: "utf8", env: gitEnv() },
      (err, stdout) => (err ? reject(new Error((err as NodeJS.ErrnoException).code === "ENOENT" ? "git isn't installed or not on PATH" : "git failed (not a repo, or timed out)")) : resolve(String(stdout).slice(0, MAX_OUT))));
  });
}

async function summarize(repo: string, days: number, now: number): Promise<RepoSummary> {
  const since = isoDay(now - days * 86_400_000);
  try {
    const [log, base] = await Promise.all([git(gitArgs(repo, { kind: "log", since })), git(gitArgs(repo, { kind: "base", since })).catch(() => "")]);
    const commits = parseLog(log), b = parseBase(base);
    // No commit before the range (new repo) → no diffstat rather than guessing an empty-tree id (differs for SHA-256 repos).
    const stat = commits.length && b ? trimStat(await git(gitArgs(repo, { kind: "diffstat", base: b })).catch(() => "")) : "";
    return { repo, commits, stat };
  } catch (e) {
    return { repo, commits: [], stat: "", error: e instanceof Error ? e.message : "git failed" };
  }
}

/** One named repo (must be in the configured list) or all of them. Throws on a repo outside the list. */
export async function gitSummary(repo: string | undefined, days: number, now = Date.now()): Promise<RepoSummary[]> {
  const list = await gitRepos();
  const pick = repo?.trim() ? allowedRepo(list, repo) : null;
  if (repo?.trim() && !pick) throw new Error(`"${repo.slice(0, 80)}" isn't one of the configured repos (${list.map(repoName).join(", ") || "none"})`);
  return Promise.all((pick ? [pick] : list).map((r) => summarize(r, days, now)));
}
