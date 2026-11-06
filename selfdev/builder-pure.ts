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
    if (a && (a.blocker || a.tries >= maxAttempts)) { skipped.push(`${c.key}: blocked after ${a.tries} tries${a.blocker ? ` (${a.blocker})` : ""}`); return false; }
    return true;
  }).map((c) => ({ ...c, score: c.score - 10 * (attempts[c.key]?.tries ?? 0) }));
  open.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const best = open[0];
  if (!best) return { pick: null, why: cands.length ? "every candidate is blocked" : "no errors, failing tests, perf regressions or open backlog items", skipped };
  if (best.score < MIN_SCORE) return { pick: null, why: `best candidate "${best.title}" scores ${best.score} < ${MIN_SCORE}; not worth a change`, skipped };
  return { pick: best, why: `${best.source}: ${best.evidence}`, skipped };
}

/** Ways a diff games its checks: deleted tests, fewer assertions, new skips/todos, changed test scripts. */
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
  }
  if (numstat.some((c) => c.path === "package.json")) out.push("package.json changed (test scripts are protected)");
  return out;
}

/** A bug fix (error / failing test) must come with a test change. */
export function missingRegressionTest(source: Source, numstat: { path: string }[]): boolean {
  return (source === "error" || source === "failing-test") && !numstat.some((c) => /^tests\/.+\.test\.tsx?$/.test(c.path));
}

export const touchesUi = (numstat: { path: string }[]) => numstat.some((c) => /\.(tsx|css)$/.test(c.path));

export type TaskStep = "selected" | "prepared" | "edited" | "verified" | "submitted" | "done";
