// MISSION success + checks (pure, tested in tests/mission-checks.test.ts). Runner: missions.ts.
// Acceptance is recorded at creation; checks are deterministic (no second model); review runs between steps.

/** D01 evidence categories. A check proves only its own category; nothing here is a blanket "verified". */
export type EvidenceKind = "readBack" | "artifact" | "requirements" | "outcome";
export type TestRun = { command?: string; cwd?: string; revision?: string; exit: number; total: number; passed: number; failed: number; skipped: number };
export type Check = { step: number; ok: boolean; what: string; kind?: EvidenceKind; test?: TestRun };
export type Level = "yes" | "failed" | "unchecked";
export type Evidence = { executed: "yes" | "no"; readBack: Level; artifact: Level; requirements: Level; outcome: Level };
export const EVIDENCE_LABEL: Record<keyof Evidence, string> = { executed: "executed", readBack: "read back", artifact: "artifact valid", requirements: "requirements checked", outcome: "outcome observed" };

export function evidenceLevels(executed: boolean, checks: Check[]): Evidence {
  const lv = (k: EvidenceKind): Level => { const cs = checks.filter((c) => c.kind === k); return cs.some((c) => !c.ok) ? "failed" : cs.length ? "yes" : "unchecked"; };
  return { executed: executed ? "yes" : "no", readBack: lv("readBack"), artifact: lv("artifact"), requirements: lv("requirements"), outcome: lv("outcome") };
}
/** "executed ✓ · read back ✓ · artifact valid — not checked · …" for the completion report. */
export const evidenceLine = (e: Evidence) => (Object.keys(EVIDENCE_LABEL) as (keyof Evidence)[]).map((k) => `${EVIDENCE_LABEL[k]} ${e[k] === "yes" ? "✓" : e[k] === "failed" ? "✗" : e[k] === "no" ? "✗" : "— not checked"}`).join(" · ");
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

/** RFC 4180 CSV → rows; null on an unterminated quote or stray text after a closing quote. */
export function parseCsv(text: string): string[][] | null {
  const rows: string[][] = []; let row: string[] = [], f = "", i = 0, q = false, quoted = false;
  const t = text.replace(/\r?\n$/, "");
  for (; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') { if (f || quoted) return null; q = quoted = true; }
    else if (ch === ",") { row.push(f); f = ""; quoted = false; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; quoted = false; }
    else if (quoted) return null;
    else f += ch;
  }
  if (q) return null;
  row.push(f); rows.push(row);
  return rows;
}

/** Structural PDF check (bytes as latin1 text): startxref points at an xref table/stream, a /Root and at least one page object exist. */
function pdfStructure(t: string): string | null {
  if (!t.startsWith("%PDF-")) return "no %PDF- header";
  if (!/%%EOF\s*$/.test(t.slice(-1024))) return "no %%EOF at the end";
  const sx = [...t.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!sx) return "no startxref";
  const at = t.slice(Number(sx[1]), Number(sx[1]) + 40);
  if (!/^(xref\b|\d+\s+\d+\s+obj\b)/.test(at)) return "startxref does not point at a cross-reference table";
  if (!/\/Root\s+\d+\s+\d+\s+R/.test(t)) return "no document catalog (/Root)";
  if (!/\/Type\s*\/Page\b(?!s)/.test(t) && !/\/ObjStm/.test(t)) return "no pages";
  return null;
}

/** A generated file opens/parses for its type. PDFs: structural check here; checkPdf also opens it with pdf.js. */
export function checkFile(path: string, text: string, step = 0): Check {
  const ext = path.toLowerCase().split(".").pop() ?? "", c = (ok: boolean, why: string): Check => ({ step, ok, what: `${path}: ${why}`, kind: "artifact" });
  if (!text.trim()) return c(false, "file is empty");
  try {
    if (ext === "json") { JSON.parse(text); return c(true, "valid JSON"); }
  } catch { return c(false, "JSON does not parse"); }
  if (ext === "csv") {
    const rows = parseCsv(text);
    if (!rows) return c(false, "CSV has a broken quoted field");
    return rows.every((r) => r.length === rows[0].length) ? c(true, `CSV with ${rows.length} rows`) : c(false, "CSV rows have different column counts");
  }
  if (ext === "html" || ext === "htm") return /<(html|body|div|main|h1|p)\b/i.test(text) ? c(true, "HTML has content") : c(false, "no HTML content");
  if (ext === "pdf") { const bad = pdfStructure(text); return bad ? c(false, `not a valid PDF (${bad})`) : c(true, "PDF structure is valid"); }
  return c(true, "readable text");
}

/** Opens a PDF with pdf.js (unpdf) after the structural check; ok only when it has at least one page. */
export async function checkPdf(path: string, bytes: Uint8Array, step = 0): Promise<Check> {
  const s = checkFile(path, Buffer.from(bytes).toString("latin1"), step);
  if (!s.ok) return s;
  try {
    const { getDocumentProxy } = await import("unpdf"); // lazy: keeps pdf.js out of client bundles that import this file
    const doc = await getDocumentProxy(new Uint8Array(bytes));
    const n = doc.numPages; void doc.cleanup?.();
    return n > 0 ? { ...s, what: `${path}: PDF opens, ${n} page(s)` } : { ...s, ok: false, what: `${path}: PDF has no pages` };
  } catch (e) { return { ...s, ok: false, what: `${path}: PDF does not open (${e instanceof Error ? e.message.slice(0, 80) : "error"})` }; }
}

/** An export contains every expected phrase (case-insensitive). */
export function checkContains(label: string, text: string, want: string[], step = 0): Check {
  const miss = want.filter((w) => !text.toLowerCase().includes(w.toLowerCase()));
  return { step, ok: !miss.length, kind: "requirements", what: miss.length ? `${label} is missing ${miss.map((m) => `"${m}"`).join(", ")}` : `${label} contains ${want.length} expected item(s)` };
}

/** A page ORBIT actually read: full URL, when, and the start of its text (agents.ts records these as trace steps "source"). */
export type Fetched = { url: string; at: string; evidence: string };
export const EVIDENCE_CHARS = 4000;
/** Comparable URL: lowercase host without www, no fragment/tracking params/trailing slash. */
export function normUrl(u: string): string {
  try {
    const x = new URL(u); x.hash = ""; x.hostname = x.hostname.toLowerCase().replace(/^www\./, "");
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(k)) x.searchParams.delete(k);
    return `${x.protocol}//${x.host}${x.pathname.replace(/\/+$/, "")}${x.search}`;
  } catch { return u.trim(); }
}
export const fetchedFromTrace = (trace: unknown): Fetched[] => (Array.isArray(trace) ? trace : [])
  .filter((t) => t?.step === "source" && typeof t.url === "string")
  .map((t) => ({ url: t.url, at: String(t.at ?? ""), evidence: String(t.evidence ?? "") }));

const STOP = new Set("that this with from have were been they their there which about into than then also more most some such only over after before while where when what will would could should these those other being said says according report reports".split(" "));
const terms = (s: string) => [...new Set(s.toLowerCase().match(/\d+(?:[.,]\d+)*%?|\p{L}{4,}/gu) ?? [])].filter((w) => !STOP.has(w));
/** Claim support (heuristic): every number and ≥60% of the sentence's key words appear in the cited pages' recorded text. */
export function claimSupported(sentence: string, evidence: string): boolean {
  const ts = terms(sentence), ev = evidence.toLowerCase();
  if (!ts.length) return false;
  const nums = ts.filter((w) => /\d/.test(w));
  return nums.every((n) => ev.includes(n)) && ts.filter((w) => ev.includes(w)).length / ts.length >= 0.6;
}

/** Research: [0] every cited URL was itself fetched (normalized exact match; a known host is not enough),
 *  [1] each citing sentence's key terms appear in the cited text (supported vs unresolved; contradiction is not detected). */
export function checkResearch(result: string, fetched: Fetched[], step = 0): Check[] {
  const links = [...result.matchAll(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g)];
  const cited = [...new Set(links.map((m) => m[2]))];
  if (!cited.length) return [{ step, ok: false, kind: "readBack", what: "research cites no web sources" }];
  const byUrl = new Map(fetched.map((f) => [normUrl(f.url), f]));
  const unfetched = cited.filter((u) => !byUrl.has(normUrl(u)));
  const read: Check = unfetched.length
    ? { step, ok: false, kind: "readBack", what: `${unfetched.length} cited source(s) were never fetched: ${unfetched.slice(0, 3).join(" ")}` }
    : { step, ok: true, kind: "readBack", what: `${cited.length} cited source(s) were fetched (exact URL)` };
  const sentences = result.split(/(?<=[.!?])\s+|\n+/).filter((x) => /\]\(https?:/.test(x));
  const unresolved = sentences.filter((x) => {
    const ev = [...x.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => byUrl.get(normUrl(m[1]))?.evidence ?? "").join("\n");
    return !claimSupported(x.replace(/\[([^\]]*)\]\([^)]*\)/g, ""), ev);
  });
  const claims: Check = { step, ok: !unresolved.length, kind: "requirements",
    what: `claims (heuristic key-term match): ${sentences.length - unresolved.length} supported, ${unresolved.length} unresolved${unresolved.length ? ` — e.g. "${unresolved[0].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim().slice(0, 100)}"` : ""}` };
  return [read, claims];
}

/** A test run's own exit code and summary (node:test, jest, vitest, pytest). Zero tests found is inconclusive, never a pass. */
export function checkTests(exitCode: number, output: string, step = 0, ctx: { command?: string; cwd?: string; revision?: string } = {}): Check {
  const n = (...res: RegExp[]) => { for (const re of res) { const m = output.match(re); if (m) return Number(m[1]); } return null; };
  const failed = n(/^# fail (\d+)/m, /(\d+) failed/) ?? 0, skipped = n(/^# skipped (\d+)/m, /(\d+) skipped/) ?? 0;
  const passed = n(/^# pass (\d+)/m, /(\d+) passed/) ?? 0, total = n(/^# tests (\d+)/m, /(\d+) total/) ?? passed + failed + skipped;
  const test: TestRun = { ...ctx, exit: exitCode, total, passed, failed, skipped };
  const c = (ok: boolean, what: string): Check => ({ step, ok, what, kind: "outcome", test });
  if (exitCode !== 0 || failed) return c(false, `tests fail (exit ${exitCode}${failed ? `, ${failed} failed` : ""})`);
  if (!passed || /no tests? (found|ran)|ran 0 tests/i.test(output)) return c(false, "tests inconclusive: no tests ran");
  return c(true, `tests pass (${passed}/${total}${skipped ? `, ${skipped} skipped` : ""}${ctx.revision ? ` at ${ctx.revision.slice(0, 12)}` : ""})`);
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
