// Self-development builder, pure half: turn signals into candidate tasks, pick one (or decide nothing is worth
// changing), and judge a candidate diff before it goes to the supervisor. Logs, notes and pages are DATA here:
// nothing in them can add a task source, widen scope or change these rules.

export type Source = "failing-test" | "error" | "perf" | "backlog" | "improve";
export type Candidate = { key: string; source: Source; title: string; evidence: string; score: number; acceptance: string[] };
export type BacklogItem = { id: string; title: string; detail?: string; priority?: "high" | "medium" | "low"; acceptance?: string[]; done?: boolean };
export type PerfItem = { metric: string; value: number; budget: number; unit?: string };
/** The weekly "Make ORBIT better" ranking (src/lib/self-improve-pure.ts Task): health/perf issues, scorecard regressions, slow calls, failed night tasks, corrections. */
export type ImproveTask = { key: string; source: string; title: string; problem: string; goal: string; evidence: string[]; detail: string[]; impact: number };

export const MIN_SCORE = 40;

/** Same error with different ids/numbers/paths → one key. */
export function normalizeError(line: string): string {
  return line
    .replace(/^\S*\d{4}-\d\d-\d\dT?\S*\s*/, "")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/([A-Za-z]:)?[\\/][\w .\\/-]+\.(t|j)sx?(:\d+)*/g, "<path>")
    .replace(/\s+/g, " ").trim().slice(0, 200);
}

const ERROR_LINE = /\b(error|unhandled|uncaught|fatal|failed)\b/i;
const IGNORE = /\[orbit\] (isolated instance|no )|ECONNREFUSED 127\.0\.0\.1:9\b|Stop-all is on|usage limit/i;

/** Group new log lines into error signatures with counts (already redacted by the caller). */
export function errorSignals(log: string): { sig: string; count: number; sample: string }[] {
  const m = new Map<string, { sig: string; count: number; sample: string }>();
  for (const raw of log.split("\n")) {
    const line = raw.trim();
    if (!line || !ERROR_LINE.test(line) || IGNORE.test(line)) continue;
    const sig = normalizeError(line);
    const e = m.get(sig) ?? { sig, count: 0, sample: line.slice(0, 400) };
    e.count++;
    m.set(sig, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

/** Failing test names from `node --test` output. */
export function failingTests(out: string): string[] {
  return [...new Set([...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim()))];
}

const PRIO = { high: 75, medium: 55, low: 35 } as const;

export function candidates(sig: {
  failing: string[]; errors: ReturnType<typeof errorSignals>; perf: PerfItem[]; backlog: BacklogItem[]; improve?: ImproveTask[];
}): Candidate[] {
  const out: Candidate[] = [];
  for (const t of sig.failing.slice(0, 5))
    out.push({ key: `test:${t}`, source: "failing-test", title: `Fix failing test: ${t}`, evidence: `npm test on main fails: "${t}"`, score: 90,
      acceptance: [`"${t}" passes`, "no other test fails", "no assertion removed or weakened"] });
  for (const e of sig.errors.slice(0, 5))
    out.push({ key: `error:${e.sig}`, source: "error", title: `Stop the error: ${e.sig.slice(0, 80)}`, evidence: `${e.count}× in the server log since the last check; sample: ${e.sample}`,
      score: 55 + Math.min(30, Math.round(10 * Math.log10(1 + e.count))),
      acceptance: ["a regression test reproduces the error before the fix and passes after it", "the gate passes"] });
  for (const p of sig.perf.filter((x) => x.value > x.budget).slice(0, 3))
    out.push({ key: `perf:${p.metric}`, source: "perf", title: `Bring ${p.metric} under budget`, evidence: `${p.metric} = ${p.value}${p.unit ?? ""}, budget ${p.budget}${p.unit ?? ""}`,
      score: 45 + Math.min(30, Math.round((30 * (p.value - p.budget)) / Math.max(p.budget, 1))),
      acceptance: [`${p.metric} measured ≤ ${p.budget}${p.unit ?? ""} by the same measurement`, "the gate passes"] });
  for (const i of (sig.improve ?? []).slice(0, 5))
    out.push({ key: `improve:${i.key}`, source: "improve", title: i.title, evidence: `${i.source}: ${i.problem}\nEvidence: ${i.evidence.join(", ")}\n${i.detail.join("\n")}`,
      score: 40 + Math.round(Math.max(0, Math.min(100, i.impact)) * 0.4), acceptance: [i.goal, "covered by a test", "the gate passes"] });
  for (const b of sig.backlog.filter((x) => !x.done))
    out.push({ key: `backlog:${b.id}`, source: "backlog", title: b.title, evidence: b.detail ?? "owner backlog", score: PRIO[b.priority ?? "medium"],
      acceptance: b.acceptance?.length ? b.acceptance : ["the described behaviour is covered by a test", "the gate passes"] });
  return out;
}

export type Attempts = Record<string, { tries: number; last: string; blocker?: string }>;

/** The best candidate, or why nothing is warranted. Keys at the attempt limit are skipped (their blocker stays recorded). */
export function select(cands: Candidate[], attempts: Attempts, maxAttempts: number): { pick: Candidate | null; why: string; skipped: string[] } {
  const skipped: string[] = [];
  const open = cands.filter((c) => {
    const a = attempts[c.key];
    // shortcut: a released key is done for good; an error that comes back after its fix needs a new signature or the owner.
    if (a?.last === "released") { skipped.push(`${c.key}: already released`); return false; }
    if (a && (a.blocker || a.tries >= maxAttempts)) { skipped.push(`${c.key}: blocked after ${a.tries} tries${a.blocker ? ` (${a.blocker})` : ""}`); return false; }
    return true;
  }).map((c) => ({ ...c, score: c.score - 10 * (attempts[c.key]?.tries ?? 0) }));
  open.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const best = open[0];
  if (!best) return { pick: null, why: cands.length ? "every candidate is blocked" : "no errors, failing tests, perf regressions or open backlog items", skipped };
  if (best.score < MIN_SCORE) return { pick: null, why: `best candidate "${best.title}" scores ${best.score} < ${MIN_SCORE}; not worth a change`, skipped };
  return { pick: best, why: `${best.source}: ${best.evidence}`, skipped };
}

// Enforced again by the supervisor on the real diff (the builder's own checks are self-reported).
export { weakenedTests } from "../supervisor/policy.ts";

/** A bug fix (error / failing test) must come with a test change. */
export function missingRegressionTest(source: Source, numstat: { path: string }[]): boolean {
  return (source === "error" || source === "failing-test") && !numstat.some((c) => /^tests\/.+\.test\.tsx?$/.test(c.path));
}

export const touchesUi = (numstat: { path: string }[]) => numstat.some((c) => /\.(tsx|css)$/.test(c.path));

export type TaskStep = "selected" | "prepared" | "edited" | "verified" | "submitted" | "done";

/** Hold the builder? It can't read ORBIT's data folder, so Stop-all reaches it through the supervisor's status. A missing or stale
 *  status (supervisor not running, or busy for longer than `maxAgeMs`) holds too: a Stop-all switched on meanwhile wouldn't show. */
export function supervisorHolds(st: { stopped?: boolean; orbitStopAll?: boolean; at?: string } | null, now: number, maxAgeMs = 5 * 60_000): string | null {
  if (!st) return "no supervisor status";
  if (st.stopped) return "supervisor emergency stop";
  if (st.orbitStopAll !== false) return "ORBIT Stop-all is on (or unknown)";
  const age = now - Date.parse(st.at ?? "");
  if (!(age >= -60_000 && age <= maxAgeMs)) return "supervisor status is stale";
  return null;
}

// ---------- edit-session tool policy ----------
// The edit session's process holds the model credential, so nothing it runs may execute repo-controlled code: no tests, package
// scripts, binaries under node_modules, git hooks or diff drivers, and nothing that hands a command line to another program.
// Bash keeps read-only commands on files; tests go through run_tests, which runs them as orbit-test (supervisor/test-run.ts).
export const EDIT_BASH_OK = /^(git (diff|status|log|show)|ls|cat|head|tail|grep|rg|wc)( |$)/;
// Shell syntax (chaining, substitution, redirection, globs), paths leaving the worktree, and flags that run another program.
export const EDIT_BASH_BAD = /[;&|`$<>\\(){}*?!\n\r]|\.\.|(^|\s)[\/~]|[A-Za-z]:|--output|--ext-diff|--textconv|--pre\b|--pre-glob|--search-zip|\s-z\b|--exec|\s-o\b|--open-files-in-pager|--no-index/;
export const RUN_TESTS_TOOL = "mcp__orbit__run_tests";

/** May the edit session use this tool with this input? Writes and reads stay in the worktree, never node_modules or .git. */
export function editToolDecision(tool: string, input: Record<string, unknown>, worktree: string, resolve: (a: string, b: string) => string, sep: string): string | null {
  const inside = (p: unknown) => {
    if (typeof p !== "string" || p.includes("..")) return false;
    const abs = resolve(worktree, p);
    if (!abs.startsWith(worktree + sep)) return false;
    const first = abs.slice(worktree.length + 1).split(/[\\/]/)[0].toLowerCase();
    return first !== "node_modules" && first !== ".git";
  };
  if (["Read", "Edit", "Write", "MultiEdit"].includes(tool)) return inside(input.file_path) ? null : "only files inside this checkout (not node_modules or .git)";
  if (["Glob", "Grep"].includes(tool))
    return (input.path == null || inside(input.path)) && !/^[\/~]|^[A-Za-z]:|\.\./.test(String(input.pattern ?? "")) ? null : "only inside this checkout";
  if (tool === "Bash") {
    const c = String(input.command ?? "").trim().replace(/ 2>&1$/, "");
    return EDIT_BASH_OK.test(c) && !EDIT_BASH_BAD.test(c) ? null : "read-only git and file commands only; run tests with the run_tests tool";
  }
  if (tool === RUN_TESTS_TOOL) return null; // its own handler validates kind and files
  return `${tool} isn't available to the builder`;
}

// Test runner requests: the shape lives with the supervisor, which brokers them (its installed copy imports nothing from here).
export { TEST_FILE, TEST_KINDS, testRequestProblem, type TestKind, type TestRequest } from "../supervisor/policy.ts";
