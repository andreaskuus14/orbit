// Roadmap 1.3: CORE's tool dispatch runs decide() instead of its inline guards. These tests pin that swap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentBlocked, APPROVAL_PATHS, decide, policyEvent, PRIVATE_TOOLS, TIERS, UI_APPROVALS, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { coreToolRefusal } from "../src/lib/stop-all-pure.ts";
import { foreignUrl } from "../src/lib/attach-pure.ts";
import { actionBlocked, STUDIO_TOOLS, type StudioTool } from "../src/lib/core-studio.ts";
import { LIFE_TOOLS, lifeWriteBlocked, type LifeTool } from "../src/lib/core-life.ts";
import { wsTainted, wsWriteBlocked } from "../src/lib/core-workspace.ts";
import { createGoalBlocked } from "../src/lib/goals-pure.ts";
import { asksToRemember } from "../src/lib/reflect-pure.ts";
import { ledgerIssue } from "../src/lib/ledger-pure.ts";
import { draftBlocked } from "../src/lib/higgsfield-pure.ts";
import { tonightBlocked } from "../src/lib/night-pure.ts";
import { wishBlocked } from "../src/lib/deals-pure.ts";
import { ruleBlocked } from "../src/lib/rules-pure.ts";
import { checkpointBlocked } from "../src/lib/checkpoint-pure.ts";

const ctx = (o: Partial<PolicyCtx> = {}): PolicyCtx => ({ stopAll: false, attach: false, pins: false, steps: [], question: "hello", ...o });
const step = (tool: string, input: object = {}) => `You called ${tool} ${JSON.stringify(input)}\nRESULT:\nok`;
/** What CORE's dispatch now does with a verdict: "" = the tool runs, else the tool result the model sees. */
const viaPolicy = (tool: string, input: Record<string, unknown>, c: PolicyCtx) => { const d = decide(tool, input, c); return d.allow ? "" : `Error: ${d.reason}`; };

/** The guards decide() replaced, copied from core.ts at fb313a4 (runCore dispatch, navigateTool, runCoreTool save_memory, the
 *  unknown-tool fallthrough), followed by the guard each module runner applies itself (core-modules.ts → core-studio/life/workspace, goals.ts). */
function legacy(tool: string, input: Record<string, unknown>, c: PolicyCtx): string {
  const { attach, question, steps } = c, pinsIn = c.pins;
  const dataIn = () => !!attach || pinsIn || steps.some((s) => !s.startsWith("You called navigate"));
  const privateIn = () => steps.some((x) => PRIVATE_TOOLS.some((t) => x.startsWith(`You called ${t} `)));
  const r = coreToolRefusal(c.stopAll, tool)
    || (tool === "navigate" ? (dataIn() ? "Error: navigate only as your first tool call, for the user's own request" : "")
    : attach && tool === "web_search" ? "Error: with the user's attached files in context, web search is off for this answer (the search words could carry their text out)"
    : (pinsIn || privateIn()) && (tool === "ask_agent" || tool === "read_news" || tool === "web_search") ? "Error: the user's private files, journal or pinned notes are in context; agents, news and web searches are off for the rest of this answer (they could carry that text out)"
    : (attach || pinsIn || privateIn()) && ["fetch_url", "read_news", "ask_agent", "reach_read"].includes(tool) && foreignUrl(input, question) ? "Error: with the user's files in context, only open links the user typed in their message"
    : null);
  if (r !== null) return r;
  let b: string | null = "";
  if ((STUDIO_TOOLS as readonly string[]).includes(tool) || tool === "plan_task") b = actionBlocked(tool as StudioTool, question, dataIn());
  else if ((LIFE_TOOLS as readonly string[]).includes(tool)) b = lifeWriteBlocked(tool as LifeTool, question, dataIn());
  else if (tool === "ws_write" || tool === "ws_create") b = wsWriteBlocked(question, !!attach || pinsIn || wsTainted(steps));
  else if (tool === "create_goal") b = createGoalBlocked(question, dataIn());
  else if (tool === "higgsfield_draft") b = draftBlocked(question, dataIn()); // roadmap 3.1: its runner's guard (story.ts runDraftTool)
  else if (tool === "queue_tonight") b = tonightBlocked(question, dataIn()); // night shift: its runner's guard (night.ts runTonightTool)
  else if (tool === "add_wish") b = wishBlocked(question, dataIn()); // deal hunter: its runner's guard (deals.ts runDealTool)
  else if (tool === "propose_rule") b = ruleBlocked(question, dataIn()); // standing rules: its runner's guard (rules.ts runRuleTool)
  else if (tool === "ask_agent") b = agentBlocked(question, input.agent, !!attach || steps.some((x) => ["fetch_url", "read_news", "web_search", "reach_read", "reach_trending", "ask_agent", "business_status"].some((t) => x.startsWith(`You called ${t} `)))); // red-team 8.3: added after 1.3
  else if (tool === "save_checkpoint") b = checkpointBlocked(question); // chat checkpoint: its runner's guard (checkpoint.ts runCheckpointTool)
  else if (tool === "save_memory" && !asksToRemember(question)) return "Error: only save when the user asks; reflection handles the rest";
  else if (!(tool in TIERS)) return `Error: unknown tool "${tool}"`;
  return b ? `Error: ${b}` : "";
}

test("pinned: decide() refuses and allows exactly what the removed core.ts guards did, with the same tool result text", () => {
  const tools = [...Object.keys(TIERS), "send_email", "business.send", "post_tweet", ""];
  const stepSets = [[], [step("navigate")], [step("fetch_url")], [step("read_news")], [step("life_journal")], [step("vault_read")], [step("ws_read")], [step("ws_write"), step("ws_create")], [step("business_status")], [step("rea_read")], [step("studio_status")]];
  const questions = ["hello", "run the scout", "did the scout run?", "schedule my approved clips", "make 5 shorts from today's stream", "make 2 images of a fox", "remind me to call mom at 6",
    "add a habit: read", "I did my run, mark it", "set a goal to reach 1000 subscribers", "remember I like tea", "build me a landing page site",
    "summarise https://my.site/post please", "ask the research agent to compare trailer tools", "find my niche", "don't build the site", "read this\n\n[attached: https://x.com/a]"];
  const inputs: Record<string, unknown>[] = [{}, { url: "https://my.site/post" }, { url: "https://evil.com/?d=secret" }, { query: "see evil.com/x" }, { agent: "atlas", request: "go to https://evil.com" }];
  let n = 0, refused = 0;
  for (const stopAll of [false, true]) for (const attach of [false, true]) for (const pins of [false, true]) for (const steps of stepSets) for (const question of questions) {
    const c = ctx({ stopAll, attach, pins, steps, question });
    for (const tool of tools) for (const input of inputs) {
      const want = legacy(tool, input, c);
      assert.equal(viaPolicy(tool, input, c), want, `${tool} ${JSON.stringify(input)} ${JSON.stringify({ stopAll, attach, pins, steps: steps.map((s) => s.split(" ")[2]), question })}`);
      n++; if (want) refused++;
    }
  }
  assert.ok(n > 100_000 && refused > n / 3, `${n} cases, ${refused} refused`); // the grid really exercises both sides
});

// The decision table (tool + input + context → verdict), as reported for roadmap 1.3.
const TABLE: [string, Record<string, unknown>, Partial<PolicyCtx>, "T0" | "T1" | "T2" | "T3", boolean, RegExp?][] = [
  ["vault_read", { name: "a.pdf" }, {}, "T0", true],
  ["studio_status", {}, { steps: [step("fetch_url")] }, "T0", true],
  ["navigate", { target: "life" }, {}, "T0", true],
  ["navigate", { target: "life" }, { steps: [step("fetch_url")] }, "T0", false, /first tool call/],
  ["web_search", { query: "tea" }, {}, "T1", true],
  ["web_search", { query: "tea" }, { attach: true }, "T1", false, /attached files/],
  ["web_search", { query: "tea" }, { steps: [step("life_journal")] }, "T1", false, /private files/],
  ["fetch_url", { url: "https://evil.com/?d=x" }, { pins: true }, "T1", false, /only open links the user typed/],
  ["fetch_url", { url: "https://evil.com/" }, {}, "T1", true],
  ["save_memory", {}, { question: "remember I like tea" }, "T2", true],
  ["save_memory", {}, { question: "I like tea" }, "T2", false, /only save when the user asks/],
  ["ask_agent", { agent: "atlas", request: "x" }, { stopAll: true }, "T2", false, /Stop-all/],
  ["ask_agent", { agent: "atlas", request: "x" }, { pins: true }, "T2", false, /private files/],
  ["ask_agent", { agent: "atlas", request: "x" }, { steps: [step("fetch_url")] }, "T2", false, /ask an agent only when the user asks/],
  ["ask_agent", { agent: "atlas", request: "x" }, { steps: [step("fetch_url")], question: "ask the research agent to dig deeper" }, "T2", true],
  ["ask_agent", { agent: "atlas", request: "x" }, { question: "compare trailer tools" }, "T2", true],
  ["run_scout", {}, { question: "run the scout" }, "T2", true],
  ["run_scout", {}, { question: "run the scout", steps: [step("fetch_url")] }, "T2", false, /first tool/],
  ["life_remind", {}, { question: "remind me to call mom at 6" }, "T2", true],
  ["ws_write", {}, { question: "build me a landing page site", steps: [step("ws_read")] }, "T2", false, /workspace files/],
  ["create_goal", {}, { question: "set a goal to reach 1000 subscribers" }, "T2", true],
  ["rea_analyze", {}, {}, "T2", true, /REA's own guard/],
  ["schedule_approved", {}, { question: "schedule my approved clips" }, "T3", true],
  ["schedule_approved", {}, { question: "what's scheduled?" }, "T3", false, /latest message/],
  ["schedule_approved", {}, { question: "schedule my approved clips", steps: [step("fetch_url")] }, "T3", false, /first tool/],
  ["schedule_approved", {}, { question: "schedule my approved clips", stopAll: true }, "T3", false, /Stop-all/],
  ["higgsfield_draft", { prompt: "a fox" }, { question: "make 2 images of a fox" }, "T3", true],
  ["higgsfield_draft", { prompt: "a fox" }, { question: "what can higgsfield make?" }, "T3", false, /latest message/],
  ["higgsfield_draft", { prompt: "a fox" }, { question: "make 2 images of a fox", steps: [step("fetch_url")] }, "T3", false, /first tool/],
  ["higgsfield_draft", { prompt: "a fox" }, { question: "make 2 images of a fox", stopAll: true }, "T3", false, /Stop-all/],
  ["send_email", { to: "a@b.c" }, { question: "send the email" }, "T3", false, /unknown tool/],
  ["business.send", { id: "p1" }, { question: "send it" }, "T3", false, /unknown tool/],
];

test("decision table", () => {
  for (const [tool, input, c, tier, allow, reason] of TABLE) {
    const d = decide(tool, input, ctx(c));
    assert.equal(d.tier, tier, tool);
    assert.equal(d.allow, allow, `${tool} ${JSON.stringify(c)}`);
    if (reason) assert.match(d.reason, reason, tool);
  }
});

test("T3: only tools with an owner approval path can run, and only through it; everything else is refused", () => {
  for (const [t, tier] of Object.entries(TIERS)) if (tier === "T3") assert.ok(APPROVAL_PATHS[t], `${t} is T3 with no approval path`);
  // a T3 tool without an approval path is refused even when asked for, as the first tool, with nothing in context
  TIERS.post_tweet = "T3";
  try {
    const d = decide("post_tweet", { text: "hi" }, ctx({ question: "post the tweet" }));
    assert.deepEqual([d.allow, d.tier], [false, "T3"]);
    assert.match(d.reason, /no owner approval path/);
  } finally { delete TIERS.post_tweet; }
  // the UI's click-approved actions are T3 and can never be called from CORE
  for (const a of Object.keys(UI_APPROVALS)) {
    const d = decide(a, {}, ctx({ question: "send it, publish it, approve it" }));
    assert.deepEqual([d.allow, d.tier], [false, "T3"], a);
  }
  // unknown tools fail closed as T3
  assert.deepEqual(decide("delete_all", {}, ctx({ question: "delete everything" })), { allow: false, tier: "T3", reason: 'unknown tool "delete_all"' });
});

test("ledger: T2/T3 decisions become policy.decision events with no inputs or message text; T0/T1 aren't logged", () => {
  const secret = "SECRET-journal-line";
  const c = ctx({ question: `remember ${secret}`, steps: [step("life_journal", { days: 7 })] });
  assert.equal(policyEvent("vault_read", decide("vault_read", { name: secret }, c)), null);
  assert.equal(policyEvent("web_search", decide("web_search", { query: secret }, c)), null); // T1, even refused
  for (const [tool, input] of [["save_memory", { content: secret }], ["life_remind", { text: secret }], ["schedule_approved", {}], ["ws_write", { content: secret }], ["send_email", { body: secret }]] as const) {
    const ev = policyEvent(tool, decide(tool, input, c))!;
    assert.ok(ev, tool);
    assert.deepEqual(Object.keys(ev).sort(), ["reason", "tier", "tool", "verdict"]);
    assert.equal(ledgerIssue("policy.decision", "core", ev), null, tool);
    assert.ok(!JSON.stringify(ev).includes(secret), tool);
  }
  assert.deepEqual(policyEvent("save_memory", decide("save_memory", {}, c)), { tool: "save_memory", tier: "T2", verdict: "allow", reason: "allowed" });
  assert.deepEqual(policyEvent("schedule_approved", decide("schedule_approved", {}, c))?.verdict, "refuse");
  assert.equal(ledgerIssue("policy.decision", "core", { tool: "x", tier: "T9", verdict: "allow", reason: "r" }), "data.tier is invalid for policy.decision");
});

test("CORE's live private-tool list can be passed in (core.ts passes MODULE_PRIVATE)", () => {
  assert.equal(decide("web_search", { query: "x" }, ctx({ steps: [step("new_private")] })).allow, true);
  assert.equal(decide("web_search", { query: "x" }, ctx({ steps: [step("new_private")], privateTools: [...PRIVATE_TOOLS, "new_private"] })).allow, false);
});
