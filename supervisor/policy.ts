// Release supervisor, pure half: which candidates may ship unattended, and when to stop or roll back.
// No imports from src/: the supervisor must keep working when the app is broken, and the builder can't change it
// (the running copy is installed outside the repo; see supervisor/README.md).

export type Policy = {
  /** Paths a candidate may touch (prefixes). Anything else blocks an unattended release. */
  allow: string[];
  /** Paths a candidate must never touch, even inside an allowed prefix. */
  deny: string[];
  maxFiles: number;
  maxLines: number;
  maxReleasesPerDay: number;
  /** Rollbacks before the supervisor halts and waits for the owner. */
  maxRollbackAttempts: number;
  /** Builder spend per UTC day, as reported by the builder (the API key's console limit is the hard cap). */
  maxCostUsdPerDay: number;
};

export const DEFAULT_POLICY: Policy = {
  allow: ["src/", "tests/", "docs/"],
  deny: [
    "supervisor/", ".github/", "AGENTS.md", "CLAUDE.md", "supabase/migrations/", "package.json", "package-lock.json",
    "next.config.ts", "scripts/", "restart-orbit.cmd", "src/app/api/rea/", "src/lib/rea", "src/middleware.ts",
    "src/lib/authority", "src/lib/autonomy", "src/lib/stop-all", "src/lib/csrf", "src/lib/allow", "src/instrumentation.ts",
    "src/lib/isolation-pure.ts", "src/app/api/selfdev/", "src/lib/selfdev", ".env", "selfdev/",
    "src/app/api/health/", // the supervisor's own health signal: a release must not be able to vouch for itself
    // Code that eval:ai loads into its own process (CI's required check): a change there could report the eval as passed.
    // tests/supervisor-policy.test.ts fails if the eval starts loading a file this list doesn't cover.
    "src/lib/memory-retrieval-pure.ts", "src/lib/agent-scorecard-pure.ts", "src/lib/pure.ts", "src/lib/passages.ts",
  ],
  maxFiles: 8,
  maxLines: 300,
  maxReleasesPerDay: 3,
  maxRollbackAttempts: 2,
  maxCostUsdPerDay: 5,
};

export type FileChange = { path: string; added: number; removed: number };

/** Reasons this diff can't ship unattended; empty = allowed. Renames arrive as two paths and are checked as both. */
export function policyViolations(changes: FileChange[], p: Policy): string[] {
  const out: string[] = [];
  if (!changes.length) out.push("empty change");
  if (changes.length > p.maxFiles) out.push(`${changes.length} files > limit ${p.maxFiles}`);
  const lines = changes.reduce((n, c) => n + c.added + c.removed, 0);
  if (lines > p.maxLines) out.push(`${lines} changed lines > limit ${p.maxLines}`);
  for (const c of changes) {
    const path = c.path.replace(/\\/g, "/");
    if (path.includes("..") || path.startsWith("/")) { out.push(`${path}: path outside the repository`); continue; }
    const odd = windowsAlias(path);
    if (odd) { out.push(`${path}: ${odd}`); continue; }
    // The PC's checkout is case-insensitive: "Scripts/stop.ps1" or "Package.json" would overwrite the protected file there.
    const lc = path.toLowerCase();
    const denied = p.deny.find((d) => { const x = d.toLowerCase(); return lc === x || lc.startsWith(x) || (x.endsWith(".md") && lc.endsWith("/" + x)); });
    if (denied) out.push(`${path}: protected (${denied})`);
    else if (!p.allow.some((a) => path.startsWith(a))) out.push(`${path}: outside the allowed paths`);
  }
  return out;
}

/** `git diff --raw --no-renames` → links, submodules, mode changes and git metadata files, none of which ship unattended. */
/** Names Windows would resolve to a different file than they say: 8.3 short names (SCRIPT~1), trailing dots/spaces,
 *  reserved characters (alternate streams via ':'), device names. Null when the path is plain. */
export function windowsAlias(path: string): string | null {
  for (const part of path.split("/")) {
    if (/~\d/.test(part)) return "looks like a Windows short name (8.3)";
    if (/[. ]$/.test(part)) return "ends in a dot or space (Windows drops it)";
    if (/[:<>|"?*\x00-\x1f]/.test(part)) return "has a character Windows treats specially";
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) return "is a Windows device name";
  }
  return null;
}

export function modeViolations(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const m = /^:(\d{6}) (\d{6}) \S+ \S+ ([A-Z])\d*\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, from, to, status, file] = m;
    // Existing fixtures feed many tests; changing or deleting one could weaken them without touching an assertion. New ones are fine.
    if (/^tests\/fixtures\//i.test(file) && status !== "A") out.push(`${file}: existing test fixture changed`);
    for (const mode of [from, to]) if (mode !== "000000" && mode !== "100644" && mode !== "100755") out.push(`${file}: file mode ${mode} (links and submodules aren't allowed)`);
    if (/(^|\/)\.(gitattributes|gitmodules|gitignore)$/.test(file)) out.push(`${file}: git metadata file`);
  }
  return out;
}

/** Ways a diff games its checks: deleted tests, fewer assertions, new skips/todos/only, early exits, changed test scripts. */
export function weakenedTests(numstat: { path: string; added: number; removed: number }[], patch: string): string[] {
  const out: string[] = [];
  const files = patch.split(/^diff --git /m).slice(1);
  for (const f of files) {
    const name = /^a\/(\S+) b\/(\S+)/.exec(f)?.[2] ?? "";
    if (!/^tests\/|\.test\.tsx?$/.test(name)) continue;
    if (/^deleted file mode/m.test(f)) { out.push(`${name}: test file deleted`); continue; }
    const minus = f.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const plus = f.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const asserts = (ls: string[]) => ls.filter((l) => /\bassert\b|\bexpect\(/.test(l)).length;
    if (asserts(minus) > asserts(plus)) out.push(`${name}: ${asserts(minus) - asserts(plus)} fewer assertions`);
    if (plus.some((l) => /\b(test|it|describe)\.(skip|todo)\b|\{\s*skip:\s*true|\.only\(/.test(l))) out.push(`${name}: adds skip/todo/only`);
    // Tests are code that runs in CI and on the builder's account: no ending the run early, no spawning processes.
    if (plus.some((l) => /\bprocess\.(exit|kill|abort)\b|child_process|\b(execSync|spawnSync|execFile)\b/.test(l))) out.push(`${name}: test exits the process or spawns commands`);
  }
  // Switching typechecking off for a file weakens the gate's tsc step for it.
  for (const f of files) if (f.split("\n").some((l) => l.startsWith("+") && /@ts-nocheck/.test(l))) out.push(`${/^a\/\S+ b\/(\S+)/.exec(f)?.[1] ?? "?"}: adds @ts-nocheck`);
  if (numstat.some((c) => c.path === "package.json")) out.push("package.json changed (test scripts are protected)");
  return out;
}

/** Parse `git diff --numstat -z`-free plain numstat ("12\t3\tpath", binary = "-\t-\tpath", renames "a => b"). */
export function parseNumstat(text: string): FileChange[] {
  const out: FileChange[] = [];
  for (const line of text.split("\n")) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const n = (s: string) => (s === "-" ? 1000 : Number(s)); // binary files count as large
    const paths = m[3].includes(" => ") ? expandRename(m[3]) : [m[3]];
    for (const path of paths) out.push({ path, added: n(m[1]), removed: n(m[2]) });
  }
  return out;
}

function expandRename(s: string): string[] {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(s);
  if (brace) return [`${brace[1]}${brace[2]}${brace[4]}`.replace("//", "/"), `${brace[1]}${brace[3]}${brace[4]}`.replace("//", "/")];
  const [a, b] = s.split(" => ");
  return [a, b];
}

export type Day = { day: string; releases: number; costUsd: number };

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Why no new release may start now, or null. */
export function releaseBlocked(s: { halted: string | null; paused: boolean; stopped: boolean; day: Day }, now: number, p: Policy): string | null {
  if (s.stopped) return "emergency stop is on";
  if (s.halted) return `halted after a failed release: ${s.halted}`;
  if (s.paused) return "paused by the owner";
  const d = s.day.day === utcDay(now) ? s.day : { day: utcDay(now), releases: 0, costUsd: 0 };
  if (d.releases >= p.maxReleasesPerDay) return `daily release limit reached (${p.maxReleasesPerDay})`;
  if (d.costUsd >= p.maxCostUsdPerDay) return `daily builder spend limit reached ($${p.maxCostUsdPerDay})`;
  return null;
}

export type Probe = { ok: boolean; commit: string | null; uptimeSec: number | null; errors: number; failedChecks: string[] };

/** Judge one post-deploy probe. `prevUptime` catches a crash-and-restart between probes. */
export function probeProblems(p: Probe, expectCommit: string, prevUptime: number | null, maxErrors: number): string[] {
  const out: string[] = [];
  if (!p.ok) out.push("health check failed");
  else {
    if (p.commit && p.commit !== expectCommit) out.push(`running commit ${p.commit.slice(0, 7)} is not the released ${expectCommit.slice(0, 7)}`);
    if (prevUptime != null && p.uptimeSec != null && p.uptimeSec < prevUptime) out.push("server restarted during monitoring");
  }
  if (p.errors > maxErrors) out.push(`${p.errors} new error lines > limit ${maxErrors}`);
  out.push(...p.failedChecks);
  return out;
}

/** Next action after a failed release given rollbacks already tried. Never more than the limit: no oscillation. */
export function afterFailure(rollbacksTried: number, p: Policy): "rollback" | "halt" {
  return rollbacksTried < p.maxRollbackAttempts ? "rollback" : "halt";
}

/** Error lines in new server log text. Redaction happens before anything leaves the supervisor. */
export function countErrors(text: string): number {
  return text.split("\n").filter((l) => /\b(error|unhandled|uncaught|fatal)\b/i.test(l) && !/\[orbit\] (no |isolated)/.test(l)).length;
}

const SECRET = /(gh[opsur]_[a-z0-9]{20,}|bearer\s+\S+|basic\s+[a-z0-9+/=]{8,}|sk-[a-z0-9-]{8,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]+|(?:key|token|secret|password|authorization)["'=: ]+(?:bearer\s+|basic\s+)?\S{6,})/gi;
export function redact(s: string): string {
  return s.replace(SECRET, "[redacted]").replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]");
}

export type Submission = {
  id: string; taskId: string; branch: string; source: string; commit: string; base: string;
  title: string; why: string; acceptance: string[]; checks: { name: string; ok: boolean; detail?: string }[]; costUsd: number;
};

/** Shape check for an inbox submission (written by the builder: untrusted). */
export function submissionProblem(x: unknown): string | null {
  const s = x as Partial<Submission>;
  if (!s || typeof s !== "object") return "not an object";
  for (const k of ["id", "taskId", "branch", "source", "commit", "base", "title", "why"] as const)
    if (typeof s[k] !== "string" || !s[k]) return `missing ${k}`;
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(s.id!)) return "bad id";
  if (!/^selfdev\/[a-z0-9._/-]{1,80}$/.test(s.branch!) || s.branch!.includes("..")) return "branch must be selfdev/…";
  if (!/^[0-9a-f]{40}$/.test(s.commit!) || !/^[0-9a-f]{40}$/.test(s.base!)) return "commit/base must be full SHAs";
  if (!Array.isArray(s.checks) || !s.checks.every((c) => c && typeof c.name === "string" && typeof c.ok === "boolean")) return "bad checks";
  if (!s.checks.length || !s.checks.every((c) => c.ok)) return "builder checks did not all pass";
  if (typeof s.costUsd !== "number" || !(s.costUsd >= 0)) return "bad costUsd";
  return null;
}

/** ORBIT's own Stop-all (stop-all.json in its data folder), read the way src/lib/stop-all.ts does since #411: a missing file is
 *  off; one that can't be read or parsed counts as on. `raw` undefined = file missing, null = unreadable. Mirrored here because
 *  the supervisor runs from its own installed copy and imports nothing from src/. */
export function orbitStopAllOn(raw: string | null | undefined): boolean {
  if (raw === undefined) return false;
  try { const o = JSON.parse(raw ?? ""); if (o && typeof o === "object" && typeof o.on === "boolean") return o.on; } catch { /* damaged */ }
  return true;
}

/** Required CI check names (config) against the check runs on a commit: pending, failed or missing ones. */
export function checksVerdict(required: string[], runs: { name: string; status: string; conclusion: string | null }[]): { state: "pass" | "fail" | "pending"; detail: string } {
  const bad = runs.filter((c) => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion ?? ""));
  if (bad.length) return { state: "fail", detail: `failed: ${bad.map((c) => c.name).join(", ")}` };
  const missing = required.filter((n) => !runs.some((c) => c.name === n && c.status === "completed" && c.conclusion === "success"));
  if (!missing.length && runs.length && runs.every((c) => c.status === "completed")) return { state: "pass", detail: `passed: ${required.join(", ")}` };
  return { state: "pending", detail: missing.length ? `waiting for: ${missing.join(", ")}` : "checks still running" };
}
