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
    "src/lib/isolation-pure.ts", "src/app/api/selfdev/", "src/lib/selfdev", ".env",
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
    const denied = p.deny.find((d) => path === d || path.startsWith(d) || (d.endsWith(".md") && path.endsWith("/" + d)));
    if (denied) out.push(`${path}: protected (${denied})`);
    else if (!p.allow.some((a) => path.startsWith(a))) out.push(`${path}: outside the allowed paths`);
  }
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

const SECRET = /(bearer\s+\S+|basic\s+[a-z0-9+/=]{8,}|sk-[a-z0-9-]{8,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]+|(?:key|token|secret|password|authorization)["'=: ]+(?:bearer\s+|basic\s+)?\S{6,})/gi;
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
