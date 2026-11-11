// S07: a task run's trace, safe to share for debugging. Keeps the shape of the run (agents, steps, tools, timings, statuses, which
// actions waited for approval) and drops what could expose the owner: the request and result text are only counted, private tool
// output (memory, VAULT, journal/LIFE) is withheld, and every remaining string goes through the secret redactor (health-pure) plus
// phone numbers, IBANs, Supabase keys, private key blocks and home-folder paths. Tests: tests/trace-export.test.ts.
import { redact } from "./health-pure.ts";

type Step = { step: string; detail?: string; ms?: number; ok?: boolean; url?: string };
type Act = { tool: string; input?: Record<string, unknown>; status: string };
export type TaskRow = {
  id: string; parent_id: string | null; agent: string; title: string; request: string; status: string; result: string | null; error: string | null;
  trace: Step[] | null; pending: Act[] | null; created_at: string; started_at: string | null; finished_at: string | null;
};

/** Steps whose detail can quote the owner's private data (memories, files, journal, LIFE): only the step name survives. */
const PRIVATE = /memory|memories|recall|vault|journal|life|diary|note|mood|health/i;
const EXTRA: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "<private key>"],
  [/\b(?:sb_(?:secret|publishable)_[\w-]{10,}|sbp_[\w]{20,})/g, "<key>"],
  [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, "<iban>"],
  [/(?<![\w.-])\+?\d[\d ()-]{7,}\d(?![\w.-])/g, "<phone>"],
  [/(?:[A-Za-z]:\\(?:Users|Documents and Settings)\\|\/(?:home|Users)\/)[^\s"'<>]+/g, "<path>"],
  [/^\s*[A-Z][A-Z0-9_]{2,}\s*=\s*\S.*$/gm, "<env line>"],
];
export function redactText(s: string): string {
  let t = s;
  for (const [re, to] of EXTRA.slice(0, 1)) t = t.replace(re, to); // whole key blocks before the line-based redactor truncates them
  t = redact(t);
  for (const [re, to] of EXTRA.slice(1)) t = t.replace(re, to);
  return t;
}
const counted = (s: string | null) => (s ? `[${s.length} characters omitted]` : null);
const host = (u?: string) => { try { return u ? new URL(u).host : undefined; } catch { return undefined; } };

/** The shareable export for one run (root task first, then its delegated sub-tasks). */
export function traceExport(rows: TaskRow[], exportedAt: string) {
  return {
    orbit_trace: 1, exported_at: exportedAt, note: "Redacted: request/result text omitted, private tool output withheld, secrets and personal details replaced.",
    tasks: rows.map((r) => ({
      id: r.id, parent_id: r.parent_id, agent: r.agent, title: redactText(r.title), status: r.status,
      request: counted(r.request), result: counted(r.result), error: r.error ? redactText(r.error) : null,
      created_at: r.created_at, started_at: r.started_at, finished_at: r.finished_at,
      steps: (r.trace ?? []).map((s) => ({ step: s.step, ok: s.ok ?? null, ms: s.ms ?? null, site: host(s.url),
        detail: PRIVATE.test(s.step) || PRIVATE.test(s.detail ?? "") ? "[private tool output withheld]" : redactText(s.detail ?? "").slice(0, 300) })),
      pending: (r.pending ?? []).map((p) => ({ tool: p.tool, status: p.status, fields: Object.keys(p.input ?? {}) })), // which fields, never their values
    })),
  };
}
