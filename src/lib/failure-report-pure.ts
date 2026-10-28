// FAILURE REPORT (pure, tested in tests/failure-report.test.ts). UI: components/FailureReport.tsx.
// Builds a reviewable diagnostic package from an existing trace. It is only shown, copied or downloaded: never sent anywhere.
// Credentials are always redacted; personal content (request, answer, tool inputs/outputs) is left out unless `includePersonal`.
import { redact } from "./health-pure.ts";

type Evidence = { kind: string; id: string; path?: string };
export type ReportStep = { step: string; detail?: string; ms?: number; ok?: boolean; evidence?: Evidence[]; policy?: { verdict?: string; turn?: string }; answerEval?: { pass?: boolean; flags?: string[] } };
export type ReportInput = {
  kind: "turn" | "task" | "mission";
  id: string | null; // message/conversation id for a turn, task id for a task/mission
  relatedIds?: string[]; // parent/child task ids, conversation id
  appVersion?: string | null; model?: string | null;
  toolsOffered?: string[];
  error?: string | null; status?: string | null;
  trace: unknown; // untrusted JSON
  request?: string; answer?: string; // personal: only with includePersonal
  at: string; // ISO, caller's clock
};

/** Not tools: bookkeeping steps the runners add around the tool calls. */
const META = new Set(["search_memory", "think", "review", "fallback", "reflex", "local", "verify", "error", "budget", "cancelled", "answer_eval"]);
const MAX_STEPS = 200; // bounded: a runaway trace can't make an unbounded package

export const CATEGORIES = ["policy", "cancelled", "budget", "timeout", "rate_limit", "auth", "network", "model", "tool", "unknown"] as const;
export type Category = typeof CATEGORIES[number];

/** Rough error class from the error text and failed steps. First match wins, most specific first. */
export function errorCategory(text: string): Category {
  const s = text.toLowerCase();
  if (/\b(policy|not allowed|blocked|stop-all|denied|needs (owner )?approval)\b/.test(s)) return "policy";
  if (/\bcancel+ed\b|\babort/.test(s)) return "cancelled";
  if (/\bbudget\b|\bcap reached\b|\btoo many (tool )?calls\b/.test(s)) return "budget";
  if (/time ?out|timed out|etimedout|time limit/.test(s)) return "timeout";
  if (/\b429\b|rate.?limit|overloaded|\b529\b/.test(s)) return "rate_limit";
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|not signed in|api key/.test(s)) return "auth";
  if (/econn\w*|enotfound|fetch failed|network|unreachable|socket/.test(s)) return "network";
  if (/\bmodel\b|claude|anthropic|parse|json/.test(s)) return "model";
  if (/^error:|\berror\b/.test(s)) return "tool";
  return "unknown";
}

const steps = (trace: unknown): ReportStep[] => (Array.isArray(trace) ? trace : [])
  .filter((r): r is ReportStep => !!r && typeof r === "object" && typeof (r as ReportStep).step === "string").slice(-MAX_STEPS);

export type ChainLink = { attempt: number; tool: string; ok: boolean; ms: number; receipts: string[]; policy?: string };
export type TraceChain = { intent: boolean; attempts: ChainLink[]; claim: { checked: boolean; pass: boolean | null; flags: string[] }; gaps: string[] };

/** 44: intent → tools → attempts → receipts → final claim, with the links that are missing named as gaps. */
export function traceChain(trace: unknown, hasIntent: boolean): TraceChain {
  const all = steps(trace);
  const attempts = all.filter((s) => !META.has(s.step)).map((s, i): ChainLink => {
    const detail = String(s.detail ?? "");
    // The runner's verdict flag when the trace has it (core.ts); word match only for traces written before the flag existed.
    const flagged = s.policy?.verdict === "refuse" || (!s.policy && s.ok === false && errorCategory(detail) === "policy");
    const pol = flagged ? redact(detail.split("→").pop()!.trim()).slice(0, 160) : undefined;
    return { attempt: i + 1, tool: s.step, ok: s.ok !== false, ms: typeof s.ms === "number" && s.ms > 0 ? Math.round(s.ms) : 0,
      receipts: (s.evidence ?? []).map((e) => `${e.kind}:${e.id}`), ...(pol ? { policy: pol } : {}) };
  });
  const ev = [...all].reverse().find((s) => s.answerEval)?.answerEval;
  const claim = { checked: !!ev, pass: ev ? ev.pass !== false : null, flags: (ev?.flags ?? []).map((f) => redact(String(f)).slice(0, 160)) };
  const gaps: string[] = [];
  if (!hasIntent) gaps.push("no intent (request) linked");
  if (!ev) gaps.push("final claim was not checked");
  else if (!claim.pass) gaps.push(`final claim failed its check: ${claim.flags.join("; ") || "no reason"}`);
  attempts.filter((a) => !a.ok).forEach((a) => gaps.push(`attempt ${a.attempt} (${a.tool}) failed${a.policy ? " by policy" : ""}`));
  if (ev && claim.flags.some((f) => /without|no (receipt|evidence)|unverified/i.test(f)) && !attempts.some((a) => a.receipts.length))
    gaps.push("claim of an action without any receipt");
  return { intent: hasIntent, attempts, claim, gaps };
}

export type FailureReport = ReturnType<typeof buildFailureReport>;

export function buildFailureReport(input: ReportInput, includePersonal = false) {
  const all = steps(input.trace);
  const chain = traceChain(all, !!input.request?.trim());
  const failText = [input.error ?? "", ...all.filter((s) => s.ok === false).map((s) => String(s.detail ?? ""))].join("\n");
  return {
    orbitFailureReport: 1,
    createdAt: input.at,
    kind: input.kind, id: input.id, status: input.status ?? null,
    relatedIds: [...new Set([...(input.relatedIds ?? []), ...all.map((s) => s.policy?.turn ?? "")].filter(Boolean))], // turn ids match policy.decision ledger rows
    appVersion: input.appVersion ?? null, model: input.model ?? null,
    errorCategory: all.some((s) => s.policy?.verdict === "refuse") ? "policy" as const : errorCategory(failText),
    error: input.error ? redact(input.error).slice(0, 500) : null,
    toolsOffered: input.toolsOffered ?? null,
    toolsCalled: chain.attempts.map(({ attempt, tool, ok, ms, receipts, policy }) => ({ attempt, tool, ok, ms, receipts, ...(policy ? { policy } : {}) })),
    policyDecisions: chain.attempts.filter((a) => a.policy).map((a) => ({ attempt: a.attempt, tool: a.tool, reason: a.policy })),
    claim: chain.claim, gaps: chain.gaps,
    truncated: Array.isArray(input.trace) && input.trace.length > MAX_STEPS,
    personalIncluded: includePersonal,
    ...(includePersonal ? {
      request: redact(input.request ?? ""), answer: redact(input.answer ?? ""),
      steps: all.map((s) => ({ step: s.step, ok: s.ok !== false, detail: redact(String(s.detail ?? "")) })),
    } : {}),
  };
}

export const reportJson = (r: FailureReport) => JSON.stringify(r, null, 2);
export const reportFileName = (r: FailureReport) => `orbit-failure-${r.kind}-${(r.id ?? "unknown").slice(0, 8)}-${r.createdAt.slice(0, 10)}.json`;
