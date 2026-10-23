import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coreAnswerEval, coreToolEvidence, type CoreEvalTool } from "../src/lib/core-answer-eval-pure.ts";

const tool = (name: string, output: string, extra: Partial<CoreEvalTool> = {}): CoreEvalTool => ({ tool: name, input: {}, output, evidence: [], ...extra });
const inspect = (answer: string, tools: readonly CoreEvalTool[] = [], rules: string[] = []) => coreAnswerEval({ question: "What happened?", answer, tools, playbookRules: rules });

test("successful answers have advisory metadata and no server log", () => {
  assert.deepEqual(inspect("The sky looks teal."), { evaluation: { score: 1, flags: [], pass: true }, log: null });
});

test("failed checks return one bounded server line, never a replacement answer", () => {
  const result = inspect("I sent the email.");
  assert.deepEqual(result.evaluation, { score: 0.4, flags: ["unsupported_action:send"], pass: false });
  assert.equal(result.log, "[core] answer-eval score=0.40 flags=unsupported_action:send");
  assert.deepEqual(Object.keys(result).sort(), ["evaluation", "log"]);
  assert.equal(result.log.split("\n").length, 1);
  assert.equal(inspect("👍", [], ["no emoji"]).evaluation.pass, false);
});

test("memory writes need real receipts; duplicate saves or prose alone do not count", () => {
  const saved = tool("save_memory", 'Saved memory "Garden" [m:memory-1].', { input: { title: "Garden" }, evidence: [{ kind: "memory", id: "memory-1" }] });
  assert.equal(inspect('I saved "Garden".', [saved]).evaluation.pass, true);
  assert.equal(inspect('I saved "Garden".', [{ ...saved, evidence: [] }]).evaluation.pass, false);
  assert.equal(inspect('I saved "Garden".', [tool("save_memory", 'Already in memory: "Garden"; nothing saved.')]).evaluation.pass, false);
  assert.equal(inspect('I saved "Other".', [saved]).evaluation.pass, false);
});

test("partial workspace writes only prove the individual receipted files", () => {
  const write = tool("ws_write", "Error: workspace write is incomplete.\nWorkspace site:\n- notes.md created (0.1 KB)\n- missing.txt: Error: locked", {
    evidence: [{ kind: "file", id: "site", path: "notes.md", bytes: 30 }], input: { files: [{ path: "notes.md", content: "Private file text" }, { path: "missing.txt", content: "Other text" }] },
  });
  assert.equal(inspect("I created notes.md.", [write]).evaluation.pass, true);
  assert.equal(inspect("I saved site/notes.md.", [write]).evaluation.pass, true);
  assert.equal(inspect("I saved missing.txt.", [write]).evaluation.pass, false);
  assert.equal(inspect("I updated notes.md.", [write]).evaluation.pass, false);
});

test("successful direct module writes and reads are mapped; background starts aren't completed work", () => {
  assert.equal(inspect('I created "Garden".', [tool("life_add_habit", 'Done: added the habit "Garden".', { input: { name: "Garden" } })]).evaluation.pass, true);
  assert.equal(inspect('I scheduled "Garden".', [tool("life_remind", 'Done: reminder "Garden" set for tomorrow.', { input: { text: "Garden" } })]).evaluation.pass, true);
  assert.equal(inspect("I created a goal.", [tool("create_goal", "Done: goal created as a draft.")]).evaluation.pass, true);
  assert.equal(inspect("I searched the web.", [tool("web_search", "No results.")]).evaluation.pass, true);
  assert.equal(inspect("I read notes.md.", [tool("ws_read", "File site/notes.md: data", { input: { path: "notes.md" } })]).evaluation.pass, true);
  assert.equal(inspect("I read notes.md.", [tool("ws_read", "Error: no file", { input: { path: "notes.md" } })]).evaluation.pass, false);
  assert.equal(inspect("I scheduled the clips.", [tool("schedule_approved", "Done: scheduling approved clips into free slots.")]).evaluation.pass, false);
  assert.equal(inspect("I ran the research.", [tool("run_scout", "Done: the scout started.")]).evaluation.pass, false);
  assert.equal(inspect("I sent the email.", [tool("ask_agent", "Agent proposed sending an email.")]).evaluation.pass, false);
});

test("existing workspace creation doesn't claim a new workspace was made", () => {
  assert.equal(inspect('I created "garden".', [tool("ws_create", 'Done: workspace "garden" created. Preview /w/garden')]).evaluation.pass, true);
  assert.equal(inspect('I created "garden".', [tool("ws_create", 'Done: workspace "garden" already exists. Preview /w/garden')]).evaluation.pass, false);
});

test("structured numeric evidence is forwarded, while facts in failed calls and prose aren't invented", () => {
  assert.equal(inspect("Subscribers: 99.", [tool("studio_status", '{"subscribers":1840}')]).evaluation.flags[0], "numeric_contradiction");
  assert.equal(inspect("Subscribers: 1840.", [tool("studio_status", '{"subscribers":1840}')]).evaluation.pass, true);
  assert.equal(coreToolEvidence(tool("studio_status", "Subscribers: 1840"))[0].facts, undefined);
  assert.equal(coreToolEvidence(tool("studio_status", 'Error: {"subscribers":1840}'))[0].facts, undefined);
});

test("no answer, private block, numeric fact label, tool output or style phrase enters logs/metadata", () => {
  const secret = "PRIVATE diary sentence for the privacy regression";
  const out = inspect(`<life>${secret}</life> I sent the email.`, [tool("life_journal", `<life>${secret}</life>`)], [`ban: ${secret}`]);
  assert.ok(out.evaluation.flags.includes("life_leak"));
  assert.ok(!JSON.stringify(out).includes(secret)); assert.ok(!JSON.stringify(out).includes("<life>"));
  const numeric = inspect(`${secret}: 99.`, [tool("life_status", JSON.stringify({ [secret]: 42 }))]);
  assert.deepEqual(numeric.evaluation.flags, ["numeric_contradiction"]);
  assert.equal(numeric.log, "[core] answer-eval score=0.30 flags=numeric_contradiction");
});

test("adapter/evaluator exceptions fail open without logging their private message or throwing", () => {
  const broken = Object.defineProperty({}, "type", { get() { throw new Error("PRIVATE <life>exception</life>"); } });
  const result = coreAnswerEval({ question: "Hi", answer: "Hello", playbookRules: [broken as never] });
  assert.deepEqual(result.evaluation, { score: 0, flags: ["evaluation_error"], pass: false });
  assert.equal(result.log, "[core] answer-eval score=0.00 flags=evaluation_error");
  assert.deepEqual(inspect("Hello", [tool("ws_read", null as never)]), result);
});

test("wiring is deterministic and does not mutate inputs", () => {
  const tools = Object.freeze([Object.freeze(tool("web_search", "No results."))]);
  const input = Object.freeze({ question: "Search the web", answer: "I searched the web.", tools, playbookRules: Object.freeze(["no emoji"]) });
  const before = JSON.stringify(input); assert.deepEqual(coreAnswerEval(input), coreAnswerEval(input)); assert.equal(JSON.stringify(input), before);
});

test("CORE uses the advisory on the final full and reflex paths without retries or extra tool steps", () => {
  const core = readFileSync(new URL("../src/lib/core.ts", import.meta.url), "utf8");
  assert.match(core, /inspectAnswer\(question, answer, trace, playbookRules, evalTools\)/);
  assert.match(core, /inspectAnswer\(question, text, trace, rules\)/);
  assert.ok(core.indexOf("inspectAnswer(question, answer") > core.indexOf("answer = rv.text"));
  const helper = core.slice(core.indexOf("function inspectAnswer("), core.indexOf("function styleBlock("));
  assert.match(helper, /last\.answerEval =/); assert.match(helper, /setImmediate\(/); assert.match(helper, /console\.info\(log\)/);
  assert.doesNotMatch(helper, /\bawait\b|askClaude|onReset|trace\.push|answer\s*=/);
});
