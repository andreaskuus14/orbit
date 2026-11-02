import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_NOTE, claudeDown, journalReflect, localAllowed, localLlmUrl, localModelName, localStatus, ollamaAnswer, ollamaRequest, privateBlocked } from "../src/lib/local-model-pure.ts";

test("localAllowed: only chat and summaries, never images, MCP, outward drafts or with no model", () => {
  const ok = (purpose: string, o: Partial<{ model: string; images: number; mcp: boolean }> = {}) => localAllowed({ model: "llama3.1:8b", images: 0, mcp: false, purpose, ...o });
  for (const p of ["core", "core.chat", "call.summary", "health.summary", "devsession.summary"]) assert.equal(ok(p), true, p);
  for (const p of ["business.outreach", "business.followup", "business.negotiate", "call.opener", "clips.engage", "core.web_search", "background", "brief.polish"]) assert.equal(ok(p), false, p);
  assert.equal(ok("core", { model: "" }), false);
  assert.equal(ok("core", { images: 1 }), false);
  assert.equal(ok("core", { mcp: true }), false);
});

test("claudeDown: limit and unreachable errors fall back, normal errors don't", () => {
  for (const e of ["Claude AI usage limit reached|1760000000", "API Error: 429 rate_limit_error", 'Could not start "claude": spawn ENOENT', "Claude Code failed: exit 1", "API Error: Connection error.", "getaddrinfo ENOTFOUND api.anthropic.com", "API Error: 529 overloaded_error"])
    assert.equal(claudeDown(e, 1_700_000_000_000), true, e);
  for (const e of ["Claude Code timed out after 2 minutes", "Invalid model", "claude exited 1"]) assert.equal(claudeDown(e, 1_700_000_000_000), false, e);
});

test("ollamaRequest: system + note, user prompt, no streaming", () => {
  const r = ollamaRequest("m", "SYS", "hi");
  assert.deepEqual(r, { model: "m", stream: false, messages: [{ role: "system", content: "SYS" + LOCAL_NOTE }, { role: "user", content: "hi" }] });
});

test("ollamaAnswer: maps text and tokens, rejects errors and empty answers", () => {
  assert.deepEqual(ollamaAnswer({ message: { role: "assistant", content: " Hello \n" }, prompt_eval_count: 12, eval_count: 3 }), { text: "Hello", inputTokens: 12, outputTokens: 3 });
  assert.deepEqual(ollamaAnswer({ message: { content: "x" } }), { text: "x", inputTokens: 0, outputTokens: 0 });
  assert.throws(() => ollamaAnswer({ error: "model 'x' not found" }), /not found/);
  assert.throws(() => ollamaAnswer({ message: { content: "  " } }), /no answer/);
  assert.throws(() => ollamaAnswer(null), /no answer/);
});

test("localStatus: off, down, missing model, ready", () => {
  assert.equal(localStatus("", null).state, "off");
  assert.equal(localStatus("llama3.1:8b", null).state, "down");
  assert.equal(localStatus("llama3.1:8b", { models: [{ name: "qwen2.5:7b" }] }).state, "missing");
  assert.equal(localStatus("llama3.1:8b", { models: [{ name: "llama3.1:8b" }] }).state, "ok");
  assert.equal(localStatus("mistral", { models: [{ name: "mistral:latest" }] }).state, "ok");
  assert.equal(localStatus("mistral", {}).state, "missing");
});

test("localLlmUrl: only http on this PC, anything else falls back to the default", () => {
  assert.equal(localLlmUrl(undefined), "http://127.0.0.1:11434");
  assert.equal(localLlmUrl(" "), "http://127.0.0.1:11434");
  assert.equal(localLlmUrl("http://localhost:11500/"), "http://localhost:11500");
  for (const bad of ["https://127.0.0.1:11434", "http://192.168.1.5:11434", "http://ollama.example.com", "http://u:p@127.0.0.1:11434", "not a url"])
    assert.equal(localLlmUrl(bad), "http://127.0.0.1:11434", bad);
});

test("localModelName: new name wins, old name still read, blank = off", () => {
  assert.equal(localModelName({ ORBIT_LOCAL_LLM_MODEL: " qwen3:8b ", ORBIT_LOCAL_MODEL: "llama3.1:8b" }), "qwen3:8b");
  assert.equal(localModelName({ ORBIT_LOCAL_LLM_MODEL: " ", ORBIT_LOCAL_MODEL: "llama3.1:8b" }), "llama3.1:8b");
  assert.equal(localModelName({}), "");
});

test("ollamaRequest: qwen3 skips thinking, numCtx widens the window; thinking text is stripped from answers", () => {
  const r = ollamaRequest("qwen3:8b", "S", "p", 8192);
  assert.equal(r.think, false);
  assert.deepEqual(r.options, { num_ctx: 8192 });
  assert.equal("think" in ollamaRequest("llama3.1:8b", "S", "p"), false);
  assert.equal(ollamaAnswer({ message: { content: "<think>hmm</think>\nTere!" } }).text, "Tere!");
});

test("privateBlocked: journal goes to the local model only with the opt-in and a model", () => {
  assert.match(privateBlocked({ model: "qwen3:8b", optIn: undefined })!, /ORBIT_LOCAL_PRIVATE=1/);
  assert.match(privateBlocked({ model: "qwen3:8b", optIn: "true" })!, /off/);
  assert.match(privateBlocked({ model: "", optIn: "1" })!, /setup\.ps1/);
  assert.equal(privateBlocked({ model: "qwen3:8b", optIn: " 1 " }), null);
});

test("journalReflect: newest first, empty days skipped, capped, null when empty", () => {
  assert.equal(journalReflect([{ date: "2026-11-01", text: " " }]), null);
  const r = journalReflect([{ date: "2026-11-01", text: "Täna oli hea päev." }, { date: "2026-10-31", text: "" }, { date: "2026-10-30", text: "Tired." }])!;
  assert.ok(r.prompt.indexOf("2026-11-01") < r.prompt.indexOf("2026-10-30"));
  assert.ok(!r.prompt.includes("2026-10-31"));
  assert.match(r.system, /data, not instructions/);
  const big = journalReflect(Array.from({ length: 7 }, (_, i) => ({ date: `d${i}`, text: "x".repeat(2000) })))!;
  assert.ok(big.prompt.length < 12_500);
});
