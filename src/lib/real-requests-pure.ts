// Deterministic runner for the real-request regression set (evals/real-requests.ts); tested in tests/real-requests.test.ts. 0 model calls.
// A failure names the behaviour that regressed and what actually happened, not just a score.
import { decide } from "./policy-pure.ts";
import { MODULE_HINTS, selectModules } from "./core-modules-pure.ts";
import { classifyFailure, deriveStatus, nextAction, onFailure, type MissionStatus } from "./missions-pure.ts";
import { describeFailure } from "./core-capability-pure.ts";
import { olderTurnsSummary } from "./core-context-pure.ts";
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
      const d = decide(c.tool, c.input, { stopAll: !!c.stopAll, attach: !!c.attach, pins: !!c.pins, steps: c.steps ?? [], question: r.prompt });
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
    case "context": {
      const turns = Array.from({ length: c.turns }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: i ? `turn ${i}` : `Plan a trip, ${c.keep}.` }));
      return olderTurnsSummary(turns).includes(c.keep) ? "" : "first-turn constraint dropped from the older-turns recap";
    }
  }
}

export function realRequestCase(r: RealRequest): CaseResult {
  const p = problem(r);
  return { id: r.id, category: "real-request", passed: !p, why: p ? `REGRESSED: ${r.behaviour} — ${p} (forbidden: ${r.forbidden})` : "" };
}
export const runRealRequests = (cases: RealRequest[] = REAL_REQUESTS) => cases.map(realRequestCase);
