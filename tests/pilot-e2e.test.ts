// Mocked end-to-end demo of PROJECT AUTOPILOT: the runner loop of goals.ts advance() / sync() / pilotStep() replayed on the pure
// state machine with a fake Opus (plan + replan JSON), fake agent task rows, a fake GPU lock and a fake clock over several days.
// No Supabase, no Claude, no GPU. PILOT_DEMO=1 prints every card and the final card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReflection, applyTask, charge, finish, newGoal, okStep, startStep, validateGoal, type Goal } from "../src/lib/goals-pure.ts";
import { acceptProposal, applyPilotReplan, chargeCalls, fromPilot, pilotInput, pilotLine, pilotMove, pilotSteps, retryStep, startPlan, waitCalls } from "../src/lib/pilot-pure.ts";
import { leftText } from "../src/lib/progress-pure.ts";

const ROSTER = ["nova", "atlas", "scout", "forge", "qa", "muse", "plinth", "closer", "prospector", "outreach"];
const OPUS_PLAN = { steps: [
  { what: "Look up what the top 5 pet simulator games put in their first update", agent: "atlas", planet: "intelligence", expected: "notes with sources", day: 1, minutes: 20 },
  { what: "Make 3 thumbnail pictures for the game page", agent: "forge", planet: "creation", expected: "3 pictures in VAULT", day: 1, minutes: 15, gpu: true },
  { what: "Write the daily-reward script and test it in a copy of the place", agent: "forge", planet: "creation", expected: "a tested script", day: 2, minutes: 40 },
  { what: "Write the update notes and the new game description", agent: "muse", planet: "creation", expected: "text drafts", day: 2, minutes: 10 },
  { what: "Publish the update to Roblox", agent: "forge", planet: "creation", expected: "the update is live", day: 3, minutes: 5, outside: "publish" },
] };
const OPUS_REPLAN = { reason: "Studio was closed, so test the script with the offline checker instead", steps: [
  { what: "Write the daily-reward script and check it with the offline Luau checker", agent: "forge", planet: "creation", expected: "a checked script", day: 2, minutes: 30 },
  { what: "Write the update notes and the new game description", agent: "muse", planet: "creation", expected: "text drafts", day: 2, minutes: 10 },
  { what: "Publish the update to Roblox", agent: "forge", planet: "creation", expected: "the update is live", day: 3, minutes: 5, outside: "publish" },
] };
// What each agent run "returns": keyed by a word in the step.
const AGENT = (what: string, attempt: number): { status: string; result?: string; error?: string } =>
  /Look up/.test(what) ? { status: "done", result: "Top games ship a daily reward and a trading board in week one." }
  : /thumbnail/.test(what) ? { status: "done", result: "3 thumbnails saved to VAULT/pet-game." }
  : /test it in a copy/.test(what) ? { status: "failed", error: `Roblox Studio isn't open (try ${attempt})` }
  : /offline Luau/.test(what) ? { status: "done", result: "Daily reward script passes the checker (0 errors)." }
  : /update notes/.test(what) ? { status: "done", result: "Update notes and description drafted." }
  : /Publish/.test(what) ? { status: "done", result: "Update 1.1 is live." } : { status: "failed", error: "unknown" };

test("mocked end-to-end: ask → Opus plan → days of steps → GPU wait → failure → retry → replan → his OK → done, one card throughout", () => {
  const days = ["2026-11-21", "2026-11-22", "2026-11-23"];
  let d = 0, gpuBusyTicks = 1, calls = 0, opsOk = 0;
  const day = () => days[d], nowMs = () => Date.parse(`${day()}T09:00:00Z`);
  const pi = pilotInput("Get my Roblox pet game ready for its first 100 players: daily rewards, nice thumbnails, then the update.", ROSTER, 20, day());
  if (typeof pi === "string") throw new Error(pi);
  const v = validateGoal(pi.input, ROSTER);
  if (typeof v === "string") throw new Error(v);
  const g: Goal = { ...newGoal(v, new Date(nowMs())), pilot: pi.pilot };
  const cards: string[] = [];
  const snap = (why: string) => { const c = fromPilot("demo", g, "en", { nowMs: nowMs(), day: day(), at: new Date(nowMs()).toISOString() }); cards.push(`${why}: ${c.phase} | ${c.steps.map((s) => ({ done: "✓", now: "●", next: "○", failed: "✕" })[s.state]).join("")} | ${c.now ?? "-"} | ${leftText(c.leftMin, "en") || "-"} | ${c.result?.text ?? "-"}`); return c; };

  // draftPlan: one Opus call against today's limit, then started without a separate Approve
  assert.ok(charge(g) && chargeCalls(g.pilot!, 1, day())); calls++;
  const plan = pilotSteps(OPUS_PLAN.steps, g.agents);
  assert.ok(typeof plan !== "string");
  assert.equal(startPlan(g, plan), "");
  snap("planned");

  const tries: Record<string, number> = {};
  for (let guard = 0; guard < 60; guard++) {
    const m = pilotMove(g, day(), gpuBusyTicks > 0);
    if (m.do === "finish") { assert.ok(finish(g)); break; }
    if (m.do === "run") {
      assert.ok(charge(g) && chargeCalls(g.pilot!, g.budget.callsPerStep, day())); calls += g.budget.callsPerStep;
      const s = g.steps[m.i];
      tries[s.what] = (tries[s.what] ?? 0) + 1;
      assert.equal(startStep(g, m.i, `task-${guard}`, s.id), "");
      snap(`running step ${m.i + 1}`);
      const out = applyTask(g, m.i, AGENT(s.what, tries[s.what]));
      if (out === "done") { applyReflection(g, m.i, { moved: "yes", note: "ok" }); continue; }
      continue; // failed: the next move is the recovery
    }
    if (m.do === "gpu") { snap("gpu busy"); g.status = "waiting"; g.waitingFor = "the GPU (another job is using it)"; gpuBusyTicks--; continue; }
    if (m.do === "later") { snap(`waits for ${m.day}`); d++; continue; } // the scheduler tick of the next day
    if (m.do === "calls") { waitCalls(g); snap("call limit"); d++; continue; }
    if (m.do === "retry") { assert.equal(retryStep(g, m.i), ""); snap("retry"); continue; }
    if (m.do === "replan") { assert.ok(chargeCalls(g.pilot!, 1, day())); calls++; assert.equal(applyPilotReplan(g, m.i, OPUS_REPLAN, day()), ""); snap("replanned"); continue; }
    if (m.do === "accept") { acceptProposal(g, day()); continue; }
    if (m.do === "ask_ok") { g.status = "waiting"; g.waitingFor = `your OK on step ${m.i + 1}`; snap("needs his OK"); assert.equal(okStep(g, m.i, g.steps[m.i].id), ""); opsOk++; continue; } // his click in Agents → Goals
    throw new Error(`unexpected move ${JSON.stringify(m)}`);
  }
  const final = snap("final");
  assert.equal(g.status, "done");
  assert.equal(final.phase, "done");
  assert.equal(final.result?.text, "Update 1.1 is live.");
  assert.equal(opsOk, 1); // exactly one outside action, and it waited for him
  assert.equal(g.pilot!.replans, 1);
  assert.equal(tries["Write the daily-reward script and test it in a copy of the place"], 2); // failed, retried once, then replanned
  assert.ok(g.pilot!.calls.used <= g.pilot!.callsPerDay); // the hard limit held every day
  assert.ok(cards.some((c) => c.startsWith("gpu busy")) && cards.some((c) => c.startsWith("call limit") || c.startsWith("waits for")));
  if (process.env.PILOT_DEMO) {
    console.log(cards.join("\n"));
    console.log(JSON.stringify(final, null, 2));
    console.log(pilotLine(g, "en", day(), nowMs(), leftText), `| calls total ${calls}`);
  }
});
