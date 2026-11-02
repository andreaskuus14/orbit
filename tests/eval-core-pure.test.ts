import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { gradeRun, summarize, validateTask, type EvalTask } from "../src/lib/eval-core-pure.ts";

test("every golden task file is valid and ids are unique", () => {
  const dir = new URL("../evals/tasks/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 10);
  const ids = files.map((f) => { const t = validateTask(JSON.parse(readFileSync(new URL(f, dir), "utf8"))); assert.equal(typeof t, "object", `${f}: ${t}`); return (t as EvalTask).id; });
  assert.equal(new Set(ids).size, ids.length);
});

test("validateTask refuses bad ids, sets, unknown tools and empty checks", () => {
  assert.match(String(validateTask({ id: "A B", set: "regression", input: "x", expect: { noT3: true } })), /id/);
  assert.match(String(validateTask({ id: "abc", set: "x", input: "x", expect: { noT3: true } })), /set/);
  assert.match(String(validateTask({ id: "abc", set: "regression", input: "x", expect: { tools: ["nope"] } })), /unknown tool/);
  assert.match(String(validateTask({ id: "abc", set: "regression", input: "x", expect: {} })), /no checks/);
});

const task = (expect: EvalTask["expect"]): EvalTask => ({ id: "t-1", set: "regression", input: "x", expect });
test("graders: receipt, Choices line, tools, order, forbidden, T3, asking, files", () => {
  const trace = [
    { step: "search_memory", ok: true },
    { step: "ws_list", ok: true },
    { step: "ws_write", ok: true, evidence: [{ kind: "file", path: "index.html" }] },
    { step: "higgsfield_draft", ok: true },
    { step: "save_memory", ok: false },
    { step: "think", ok: true, receipt: { status: "partly" } },
  ];
  const run = { answer: "Built it.\nChoices: Add a page | Leave it", trace };
  assert.deepEqual(gradeRun(task({ receipt: ["verified"] }), run).fails, ["receipt partly, wanted verified"]);
  assert.equal(gradeRun(task({ noChoices: true }), run).ok, false);
  assert.equal(gradeRun(task({ noChoices: true }), { ...run, answer: "Built it." }).ok, true);
  assert.equal(gradeRun(task({ tools: ["ws_write"], files: ["index.html"], order: ["ws_list", "ws_write"] }), run).ok, true);
  assert.equal(gradeRun(task({ order: ["ws_write", "ws_list"] }), run).ok, false);
  assert.equal(gradeRun(task({ tools: ["save_memory"] }), run).ok, false); // an error doesn't count
  assert.equal(gradeRun(task({ forbidTools: ["save_memory"] }), run).ok, true);
  assert.deepEqual(gradeRun(task({ noT3: true }), run).fails, ["T3 tool higgsfield_draft ran"]);
  assert.equal(gradeRun(task({ noT3: true, allowT3: ["higgsfield_draft"] }), run).ok, true);
  assert.equal(gradeRun(task({ mustAsk: true }), { answer: "Which Short do you mean? It goes out after your Approve click.", trace: [] }).ok, true);
  assert.equal(gradeRun(task({ mustAsk: true }), { answer: "Published.", trace: [] }).ok, false);
  assert.equal(gradeRun(task({ files: ["about.html"] }), run).ok, false);
});

test("summary: pass@1 and pass^k per task", () => {
  const s = summarize([{ id: "a", set: "regression", ok: true }, { id: "a", set: "regression", ok: false }, { id: "b", set: "capability", ok: true }]);
  assert.deepEqual(s, [{ id: "a", set: "regression", trials: 2, pass1: 0.5, passK: false }, { id: "b", set: "capability", trials: 1, pass1: 1, passK: true }]);
});
