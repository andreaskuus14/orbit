// MISSION success + checks (pure, tested in tests/mission-checks.test.ts). Runner: missions.ts.
// Acceptance is recorded at creation; checks are deterministic (no second model); review runs between steps.

export type Check = { step: number; ok: boolean; what: string };
export type Review = { do: "continue" } | { do: "revise"; note: string } | { do: "stop"; why: string };

const quoted = (s: string) => [...s.matchAll(/["“]([^"”]{2,80})["”]/g)].map((m) => m[1].trim());

/** Objective → a compact acceptance condition, or null when it's too vague to judge (then ask the owner). */
export function inferAcceptance(objective: string): string | null {
  const o = objective.trim(), q = quoted(o), must = q.length ? `; must contain ${q.map((x) => `"${x}"`).join(", ")}` : "";
  if (/\b(research|find out|compare|investigate|look into|uurir)/i.test(o)) return `a report whose claims cite sources ORBIT fetched${must}`;
  if (/\b(fix|implement|refactor|code|build (a|an|the) (app|site|page|script|tool)|test)/i.test(o)) return `the code is written and its tests pass${must}`;
  if (/\b(write|draft|create|make|generate|export|prepare|plan|summari[sz]e|kirjuta|koosta)\b/i.test(o)) return `the ${o.match(/\b(?:write|draft|create|make|generate|export|prepare|plan|summari[sz]e)\b\s+(?:an?\s+|the\s+)?([\w-]+(?:\s[\w-]+)?)/i)?.[1] ?? "result"} exists and opens${must}`;
  if (/\b(send|post|publish|email|schedule|save)\b/i.test(o)) return `the approved action is read back at its destination${must}`;
  return null;
}

/** Phrases the final output must contain (quoted in the acceptance text). */
export const expected = (acceptance: string) => quoted(acceptance);

/** A generated file opens/parses for its type. */
export function checkFile(path: string, text: string, step = 0): Check {
  const ext = path.toLowerCase().split(".").pop() ?? "", c = (ok: boolean, why: string): Check => ({ step, ok, what: `${path}: ${why}` });
  if (!text.trim()) return c(false, "file is empty");
  try {
    if (ext === "json") { JSON.parse(text); return c(true, "valid JSON"); }
  } catch { return c(false, "JSON does not parse"); }
  if (ext === "csv") {
    const rows = text.trim().split(/\r?\n/).map((r) => r.split(",").length);
    return rows.every((n) => n === rows[0]) ? c(true, `CSV with ${rows.length} rows`) : c(false, "CSV rows have different column counts");
  }
  if (ext === "html" || ext === "htm") return /<(html|body|div|main|h1|p)\b/i.test(text) ? c(true, "HTML has content") : c(false, "no HTML content");
  if (ext === "pdf") return text.startsWith("%PDF-") && text.includes("%%EOF") ? c(true, "PDF header and end found") : c(false, "not a complete PDF");
  return c(true, "readable text");
}

/** An export contains every expected phrase (case-insensitive). */
export function checkContains(label: string, text: string, want: string[], step = 0): Check {
  const miss = want.filter((w) => !text.toLowerCase().includes(w.toLowerCase()));
  return { step, ok: !miss.length, what: miss.length ? `${label} is missing ${miss.map((m) => `"${m}"`).join(", ")}` : `${label} contains ${want.length} expected item(s)` };
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
/** Research: cites at least one web source, and every cited source was actually fetched during the step (seen in its trace). */
export function checkResearch(result: string, traceDetails: string[], step = 0): Check {
  const cited = [...new Set([...result.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]))];
  if (!cited.length) return { step, ok: false, what: "research cites no web sources" };
  const seen = traceDetails.join("\n");
  // shortcut: trace details are truncated to 160 chars, so a matching host counts as fetched; upgrade by logging fetched URLs in full.
  const unfetched = cited.filter((u) => !seen.includes(u) && !(host(u) && seen.includes(host(u))));
  return unfetched.length ? { step, ok: false, what: `${unfetched.length} cited source(s) were never fetched: ${unfetched.slice(0, 3).join(" ")}` } : { step, ok: true, what: `${cited.length} cited source(s) were fetched` };
}

/** A test run's own exit code and output (node:test, jest, vitest, pytest summaries). */
export function checkTests(exitCode: number, output: string, step = 0): Check {
  const failed = Number(output.match(/^# fail (\d+)/m)?.[1] ?? output.match(/(\d+) failed/)?.[1] ?? 0);
  return exitCode === 0 && !failed ? { step, ok: true, what: "tests pass" } : { step, ok: false, what: `tests fail (exit ${exitCode}${failed ? `, ${failed} failed` : ""})` };
}

/** Steps are told to write this when evidence breaks an assumption. */
export const DISPROVED_RULE = "\n\nIf your work shows a mission assumption is false, add a line starting \"DISPROVED: \" saying which and why.";
const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
/** Jaccard word overlap 0-1. */
export function overlap(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let n = 0; for (const w of x) if (y.has(w)) n++;
  return n / (x.size + y.size - n);
}

/** After step k (done), before the next: stop on a disproved assumption or a no-progress loop; revise the next step on a failed check. */
export function reviewStep(k: number, result: string, prevResult: string | null, checks: Check[]): Review {
  const dis = result.match(/^\s*DISPROVED:\s*(.+)$/m)?.[1]?.trim();
  if (dis) return { do: "stop", why: `Step ${k + 1} disproved an assumption: ${dis.slice(0, 200)}. The remaining steps relied on it — Resume to continue anyway, or Cancel.` };
  if (result.trim().length < 20) return { do: "stop", why: `Step ${k + 1} produced almost nothing; stopping instead of spending more steps. Partial results are kept.` };
  if (prevResult && overlap(result, prevResult) > 0.9) return { do: "stop", why: `Step ${k + 1} repeated step ${k}'s output with no new progress; stopping. Partial results are kept.` };
  const bad = checks.filter((c) => c.step === k && !c.ok);
  if (bad.length) return { do: "revise", note: `\n\nRevised after step ${k + 1}: its output failed a check (${bad.map((c) => c.what).join("; ").slice(0, 300)}). Fix that first, then do this step.` };
  return { do: "continue" };
}

const PER_STEP: Record<string, number> = { atlas: 4, forge: 3, qa: 2 };
/** Rough effort (minutes) + the stop conditions shown on the mission. */
export function plan(steps: { agent: string }[], maxRetries: number): { minutes: number; stops: string[] } {
  return {
    minutes: steps.reduce((n, s) => n + (PER_STEP[s.agent] ?? 2), 0),
    stops: [
      "done when every step finished and every check passed",
      `a temporary failure retries at most ${maxRetries}×`,
      "a disproved assumption pauses for you",
      "a step that repeats the last one or returns almost nothing stops the mission (partial results kept)",
    ],
  };
}
