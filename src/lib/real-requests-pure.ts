// Deterministic runner for the real-request regression set (evals/real-requests.ts); tested in tests/real-requests.test.ts. 0 model calls.
// A failure names the behaviour that regressed and what actually happened, not just a score.
import { decide } from "./policy-pure.ts";
import { MODULE_HINTS, selectModules } from "./core-modules-pure.ts";
import { classifyFailure, deriveStatus, nextAction, onFailure, type MissionStatus } from "./missions-pure.ts";
import { describeFailure } from "./core-capability-pure.ts";
import { olderTurnsSummary } from "./core-context-pure.ts";
import { afterBudget } from "./long-work-pure.ts";
import { EXACT, goalHint, isVague, mayAsk } from "./goal-card-pure.ts";
import type { ChainStatus, ChainView } from "./chains-pure.ts";
import type { CaseResult } from "./self-eval-pure.ts";
import { REAL_REQUESTS, type RealRequest } from "../../evals/real-requests.ts";

const MODS = Object.keys(MODULE_HINTS).map((name) => ({ name, prompt: "", tools: [] }));

function problem(r: RealRequest): string {
  const c = r.check;
  switch (c.kind) {
    case "route": {
      const got = selectModules(MODS, r.prompt).map((m) => m.name);
      const miss = c.has.filter((m) => !got.includes(m)), extra = (c.not ?? []).filter((m) => got.includes(m));
      return miss.length || extra.length ? `routed to [${got.join(", ")}]${miss.length ? `, missing ${miss.join(", ")}` : ""}${extra.length ? `, wrongly ${extra.join(", ")}` : ""}` : "";
    }
    case "policy": {
      const d = decide(c.tool, c.input, { stopAll: !!c.stopAll, attach: !!c.attach, pins: !!c.pins, steps: c.steps ?? [], question: r.prompt, autonomy: { "operator-build": "ask", "operator-organize": "ask" } }); // guard pairs pin the per-action ask path (operator grants off)
      return d.allow === c.allow ? "" : `${c.tool} was ${d.allow ? "ALLOWED" : `refused (${d.reason})`}`;
    }
    case "failure": {
      const cls = classifyFailure(c.error);
      if (cls !== c.cls) return `classified as ${cls}, expected ${c.cls}`;
      if (!c.status) return "";
      const o = onFailure({ index: 0, error: c.error }, {}, !!c.acted), got = o.do === "retry" ? "retry" : o.status;
      return got === c.status ? "" : `failure handling was ${got}, expected ${c.status}`;
    }
    case "core-failure": { const s = describeFailure(c.error); return s.includes(c.says) ? "" : `told the owner "${s.slice(0, 80)}"`; }
    case "mission": {
      const chain: ChainView | null = c.chain ? { chainId: "c", goal: "g", status: c.chain as ChainStatus,
        steps: c.steps.map((status, index) => ({ index, agent: "nova", request: "r", taskId: null, status: status as ChainView["steps"][number]["status"] })) } : null;
      const s = deriveStatus({ status: c.doc as MissionStatus }, chain), next = nextAction(s, chain);
      return s === c.status && next.includes(c.next) ? "" : `mission became ${s} ("${next}")`;
    }
    case "idea": {
      const h = goalHint(r.prompt);
      if (!isVague(r.prompt) || !h.includes("```goal")) return "treated as a finished goal (no Goal card hint)";
      if (mayAsk(r.prompt) !== c.ask) return `question gate ${c.ask ? "closed" : "open"}, expected ${c.ask ? "open" : "closed"}`;
      return EXACT.test(h) ? "" : "hint lost its no-exact-wording rule";
    }
    case "run": {
      const good = leadRunProblems(c.good.steps, c.good.answer, c.notFit), live = leadRunProblems(c.live.steps, c.live.answer, c.notFit);
      if (good) return `the fixed run failed the grader: ${good}`;
      if (!live) return "the grader passed the live failing run";
      return afterBudget(c.live.answer, { background: false, extra: 0, leftMs: 200_000 }) === "handoff" ? "" : "the live run's 'not done' answer would not continue in the background";
    }
    case "context": {
      const turns = Array.from({ length: c.turns }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: i ? `turn ${i}` : `Plan a trip, ${c.keep}.` }));
      return olderTurnsSummary(turns).includes(c.keep) ? "" : "first-turn constraint dropped from the older-turns recap";
    }
  }
}

const host = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
const call = (s: string) => { const m = s.match(/^You called (\w+) (.*)\nRESULT:/s); try { return m ? { tool: m[1], input: JSON.parse(m[2]) as Record<string, unknown> } : null; } catch { return { tool: m![1], input: {} }; } };
/** A "find N matching X and add as leads" run, judged on its steps: every saved site was fetched first, nothing from notFit was
 *  saved, and the answer never hands the rest to "your next message". "" = fine. */
export function leadRunProblems(steps: string[], answer: string, notFit: string[]): string {
  const fetched = new Set<string>(), bad: string[] = [];
  for (const s of steps) {
    const c = call(s);
    if (!c) continue;
    if (c.tool === "fetch_url" && typeof c.input.url === "string") fetched.add(host(c.input.url));
    if (c.tool !== "lead_create") continue;
    if (!steps.slice(0, steps.indexOf(s)).some((x) => /^You called (?:fetch_url|web_search) /.test(x)) || !fetched.size) bad.push("lead_create before any site check");
    for (const l of (Array.isArray(c.input.leads) ? c.input.leads : [c.input]) as Record<string, unknown>[]) {
      const site = typeof l.website === "string" ? host(l.website) : "";
      if (site && notFit.includes(site)) bad.push(`saved a non-fit (${site})`);
      else if (site && !fetched.has(site)) bad.push(`saved ${site} without fetching it`);
    }
  }
  if (/continue on (?:your|his) next message/i.test(answer)) bad.push('"continue on your next message"');
  return [...new Set(bad)].join("; ");
}

export function realRequestCase(r: RealRequest): CaseResult {
  const p = problem(r);
  return { id: r.id, category: "real-request", passed: !p, why: p ? `REGRESSED: ${r.behaviour} — ${p} (forbidden: ${r.forbidden})` : "" };
}
export const runRealRequests = (cases: RealRequest[] = REAL_REQUESTS) => cases.map(realRequestCase);
