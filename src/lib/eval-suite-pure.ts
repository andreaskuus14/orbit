// Phase 4 (#11 + #12): Real Deterministic ORBIT Capability Scorecard & Skill Quality/Retirement Loop (pure, zero I/O).
import { auditRemotes } from "./playtesters-pure.ts";
import { simulateModel, type Model } from "./economy-sim-pure.ts";
import { classifySpace, generatePlans } from "./arch-plan-pure.ts";
import {
  createOutcomeFromTemplate,
  deriveOutcomeStatus,
  distillOutcomeToSkill,
  recordCheckResult,
  updateStepStatus,
  type OutcomeProject,
} from "./outcome-cockpit-pure.ts";
import { assembleCorePrompt, pickContextBudget } from "./core-context-pure.ts";
import { DEFAULT_PC_PERMS, canAutoApproveTerminal } from "./pc-permissions-pure.ts";

export type CapabilityCheckResult = {
  id: string;
  area: "roblox" | "arch" | "outcomes" | "core" | "security" | "skills";
  pass: boolean;
  detail: string;
  ms: number;
};

export type CapabilitySuiteReport = {
  total: number;
  passed: number;
  failed: number;
  totalMs: number;
  checks: CapabilityCheckResult[];
};

export type SkillHealthAction = "promote" | "healthy" | "retire";
export type SkillHealthReport = {
  name: string;
  runs: number;
  passRate: number;
  action: SkillHealthAction;
  reason: string;
};

/** Phase 4 (#12): Score a Skill Forge skill's observed eval/run health for promotion or retirement. */
export function evaluateSkillHealth(input: {
  name: string;
  runs: number;
  passes: number;
  fails: number;
}): SkillHealthReport {
  const evaluated = Math.max(0, input.passes) + Math.max(0, input.fails);
  const runs = Math.max(input.runs, evaluated);
  const passRate = evaluated > 0 ? input.passes / evaluated : 1;
  if (evaluated >= 3 && passRate < 0.5) {
    return { name: input.name, runs, passRate, action: "retire", reason: `Low pass rate (${Math.round(passRate * 100)}% over ${evaluated} evals) — flag for retirement or edit.` };
  }
  if (runs >= 3 && evaluated >= 3 && passRate >= 0.8) {
    return { name: input.name, runs, passRate, action: "promote", reason: `High reliability (${Math.round(passRate * 100)}% over ${evaluated} evals) — ready to promote.` };
  }
  return { name: input.name, runs, passRate, action: "healthy", reason: evaluated > 0 ? `${Math.round(passRate * 100)}% over ${evaluated} evals.` : "New skill — collecting runs." };
}

function runCheck(id: string, area: CapabilityCheckResult["area"], fn: () => { pass: boolean; detail: string }): CapabilityCheckResult {
  const t0 = performance.now();
  try {
    const r = fn();
    return { id, area, pass: r.pass, detail: r.detail, ms: Math.round((performance.now() - t0) * 10) / 10 };
  } catch (e) {
    return { id, area, pass: false, detail: e instanceof Error ? e.message : String(e), ms: Math.round((performance.now() - t0) * 10) / 10 };
  }
}

/** Run ORBIT's deterministic end-to-end capability suite across real engines (zero mocks, zero network). */
export function runOrbitCapabilitySuite(): CapabilitySuiteReport {
  const checks: CapabilityCheckResult[] = [
    runCheck("roblox_exploit_audit", "roblox", () => {
      const vuln = auditRemotes([{
        file: "src/server/Shop.server.luau",
        text: `Buy.OnServerEvent:Connect(function(p, qty)\n  if typeof(qty) == "number" then\n    p.leaderstats.Coins.Value -= qty\n  end\nend)`,
      }]);
      const safe = auditRemotes([{
        file: "src/server/Safe.server.luau",
        text: `local cd = {}\nBuy.OnServerEvent:Connect(function(p, qty)\n  local now = os.clock()\n  if cd[p] and now - cd[p] < 0.5 then return end\n  cd[p] = now\n  if typeof(qty) ~= "number" or qty ~= qty or math.abs(qty) == math.huge or qty <= 0 or qty > 100 then return end\n  p.leaderstats.Coins.Value -= qty\nend)`,
      }]);
      const pass = vuln.some((f) => f.severity === "high") && safe.length === 0;
      return { pass, detail: `vuln=${vuln.length}, safe=${safe.length}` };
    }),
    runCheck("roblox_economy_sim", "roblox", () => {
      const m: Model = {
        currency: "Coins",
        sources: [{ name: "Clicking", amount: 20, every: 1 }],
        rewards: [],
        sinks: [
          { name: "Speed", price: 200, growth: 1.6, boost: 20 },
          { name: "Gate", price: 1200, growth: 1, boost: 0 },
        ],
        rebirth: { name: "Rebirth 1", price: 5000, growth: 2.5, mult: 2 },
        session: 60,
        sessions: 1,
      };
      const res = simulateModel(m, { players: 30, seed: 42, strategy: "save_for_goal" });
      const gate = res.sinks.find((x) => x.name === "Gate");
      const pass = Boolean(gate && gate.reached >= 50 && (res.rebirthRate ?? 0) >= 50);
      return { pass, detail: `gate=${gate?.reached ?? 0}%, rebirthRate=${res.rebirthRate ?? 0}%` };
    }),
    runCheck("arch_plan_connectivity", "arch", () => {
      const opts = generatePlans({
        plot: { w: 24, d: 20 },
        floors: 2,
        adj: [],
        rooms: [
          { name: "Living", area: 28, floor: 1 },
          { name: "Kitchen", area: 14, floor: 1 },
          { name: "Hall", area: 10, floor: 1 },
          { name: "Terrace", area: 18, floor: 1 },
          { name: "Bedroom 1", area: 16, floor: 2 },
          { name: "Bedroom 2", area: 14, floor: 2 },
          { name: "Bathroom", area: 8, floor: 2 },
        ],
      });
      const best = opts[0];
      const unreachable = best?.unreachableRooms?.length ?? -1;
      const terraceZone = classifySpace("Terrace");
      const pass = Boolean(best && unreachable === 0 && terraceZone === "outdoor");
      return { pass, detail: `unreachable=${unreachable}, terraceZone=${terraceZone}` };
    }),
    runCheck("outcome_honest_gate", "outcomes", () => {
      let p = createOutcomeFromTemplate("client-shop", { id: "eval-1", now: "2026-11-22T00:00:00Z" }) as OutcomeProject;
      p = recordCheckResult(p, "c1", false, "broken mobile nav", "2026-11-22T00:01:00Z") as OutcomeProject;
      const blockedWhenFailed = deriveOutcomeStatus(p) !== "verified" && distillOutcomeToSkill(p) === null;
      for (const s of p.steps) {
        if (!s.requiresApproval) p = updateStepStatus(p, s.id, "verified", { now: "2026-11-22T00:02:00Z" }) as OutcomeProject;
      }
      for (const c of p.checks) {
        p = recordCheckResult(p, c.id, true, "verified ok", "2026-11-22T00:03:00Z") as OutcomeProject;
      }
      const draft = distillOutcomeToSkill(p);
      const pass = blockedWhenFailed && draft !== null && draft.name.startsWith("outcome-");
      return { pass, detail: `blockedWhenFailed=${blockedWhenFailed}, distilled=${draft?.name ?? "null"}` };
    }),
    runCheck("outcome_rule6_privacy", "security", () => {
      const rej = createOutcomeFromTemplate("custom", { id: "eval-priv", title: "Export my private diary", now: "2026-11-22T00:00:00Z" });
      const pass = typeof rej === "string";
      return { pass, detail: pass ? "private outcome refused" : "LEAK: private outcome allowed" };
    }),
    runCheck("core_context_budget", "core", () => {
      const q = pickContextBudget("hi there");
      const d = pickContextBudget("short", { deep: true });
      const prompt = assembleCorePrompt({
        now: "2026-11-22 20:00", memories: "M", chats: "", known: "", world: "W", people: "", live: "",
        hint: "", controlHints: "", style: "", project: "", transcript: "", attachBlock: "", caps: "",
        moduleTools: "", ongoing: false, question: "hi",
      });
      const pass = q.tier === "quick" && q.skipHeavySideContext && d.tier === "deep" && prompt.indexOf("WORLD MODEL") < prompt.indexOf("NOW:");
      return { pass, detail: `quick=${q.topMemoryChars}, deep=${d.topMemoryChars}` };
    }),
    runCheck("pc_permissions_hard_locks", "security", () => {
      const perms = { ...DEFAULT_PC_PERMS, terminal: true, terminalAuto: true };
      const okBuild = canAutoApproveTerminal("npm run test", { level: 3 }, false, perms, false);
      const blockEnv = !canAutoApproveTerminal("cat .env.local", { level: 3, private: true }, false, perms, false);
      const blockPush = !canAutoApproveTerminal("git push origin main", { level: 3 }, false, perms, false);
      const pass = okBuild && blockEnv && blockPush;
      return { pass, detail: `build=${okBuild}, blockEnv=${blockEnv}, blockPush=${blockPush}` };
    }),
    runCheck("skill_health_loop", "skills", () => {
      const promo = evaluateSkillHealth({ name: "roblox-ship", runs: 5, passes: 5, fails: 0 });
      const ret = evaluateSkillHealth({ name: "flaky-skill", runs: 4, passes: 1, fails: 3 });
      const fresh = evaluateSkillHealth({ name: "new-skill", runs: 1, passes: 1, fails: 0 });
      const pass = promo.action === "promote" && ret.action === "retire" && fresh.action === "healthy";
      return { pass, detail: `promo=${promo.action}, ret=${ret.action}, fresh=${fresh.action}` };
    }),
  ];

  const passed = checks.filter((c) => c.pass).length;
  return {
    total: checks.length,
    passed,
    failed: checks.length - passed,
    totalMs: Math.round(checks.reduce((s, c) => s + c.ms, 0) * 10) / 10,
    checks,
  };
}
