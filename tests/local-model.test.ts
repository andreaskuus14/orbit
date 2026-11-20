import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_NOTE, claudeDown, localAllowed, localLlmUrl, localModelName, localStatus, ollamaAnswer, ollamaRequest, pickLocalModel, installedModels, DEFAULT_LOCAL_MODEL, SMALL_LOCAL_MODEL } from "../src/lib/local-model-pure.ts";

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
  assert.equal(localStatus("llama3.1:8b", { models: [{ name: "nomic-embed-text" }] }).state, "missing");
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

test("the default is qwen3.5:9b with qwen3.5:4b as the small one, and both get think:false", () => {
  assert.deepEqual([DEFAULT_LOCAL_MODEL, SMALL_LOCAL_MODEL], ["qwen3.5:9b", "qwen3.5:4b"]);
  for (const m of [DEFAULT_LOCAL_MODEL, SMALL_LOCAL_MODEL, "qwen3:8b"]) assert.equal(ollamaRequest(m, "S", "p").think, false, m);
  assert.equal("think" in ollamaRequest("gemma3:4b", "S", "p"), false);
});

const have = (...n: string[]) => n;
test("pickLocalModel: configured model when present, smaller sibling only while the GPU is tight", () => {
  const all = have("qwen3.5:9b", "qwen3.5:4b");
  assert.deepEqual(pickLocalModel({ configured: "qwen3.5:9b", installed: all }), { model: "qwen3.5:9b" });
  assert.equal(pickLocalModel({ configured: "qwen3.5:9b", installed: all, tight: true }).model, "qwen3.5:4b");
  assert.match(pickLocalModel({ configured: "qwen3.5:9b", installed: all, tight: true }).note!, /stepped down/);
  assert.equal(pickLocalModel({ configured: "qwen3.5:9b", installed: have("qwen3.5:9b"), tight: true }).model, "qwen3.5:9b"); // no 4b pulled: stay
  assert.equal(pickLocalModel({ configured: "qwen3.5:4b", installed: all, tight: true }).model, "qwen3.5:4b"); // already small
  assert.equal(pickLocalModel({ configured: "gemma3:4b", installed: have("gemma3:4b", "qwen3.5:4b"), tight: true }).model, "gemma3:4b"); // other models are never swapped
  assert.equal(pickLocalModel({ configured: "qwen3.5:9b", installed: have("qwen3.5:9b:latest") }).model, "qwen3.5:9b:latest");
  assert.equal(pickLocalModel({ configured: "", installed: all }).model, "");
});

test("pickLocalModel: configured model missing falls back to what is installed, with the pull command; never cloud or embeddings", () => {
  const p = pickLocalModel({ configured: "qwen3.5:9b", installed: have("qwen3:8b", "nomic-embed-text") });
  assert.equal(p.model, "qwen3:8b");
  assert.equal(p.hint, "Run: ollama pull qwen3.5:9b");
  assert.equal(pickLocalModel({ configured: "qwen3.5:9b", installed: have("qwen3:8b", "qwen3.5:4b") }).model, "qwen3.5:4b"); // newer family first
  assert.equal(pickLocalModel({ configured: "qwen3.5:9b", installed: have("qwen3:8b", "qwen3.5:4b"), tight: true }).model, "qwen3.5:4b");
  assert.equal(pickLocalModel({ configured: "llama3.1:8b", installed: have("mistral:7b")}).model, "mistral:7b"); // any installed chat model
  const none = pickLocalModel({ configured: "qwen3.5:9b", installed: have("gpt-oss:120b-cloud", "nomic-embed-text:latest", "bge-m3") });
  assert.deepEqual(none, { model: "", hint: "Run: ollama pull qwen3.5:9b" });
  assert.deepEqual(installedModels(null), []);
  assert.deepEqual(installedModels({ models: [{ name: "a" }, {}] }), ["a"]);
});

test("localStatus: a missing model with a stand-in is 'fallback' and carries the pull command", () => {
  const s = localStatus("qwen3.5:9b", { models: [{ name: "qwen3:8b" }] });
  assert.equal(s.state, "fallback");
  assert.match(s.text, /ollama pull qwen3\.5:9b/);
  assert.match(s.text, /qwen3:8b/);
  assert.equal(localStatus("qwen3.5:9b", { models: [{ name: "gpt-oss:120b-cloud" }] }).state, "missing");
});

test("localAllowed: a risky core turn never falls back to the local model", () => {
  assert.equal(localAllowed({ model: "llama3.1:8b", images: 0, mcp: false, purpose: "core", risky: true }), false);
  assert.equal(localAllowed({ model: "llama3.1:8b", images: 0, mcp: false, purpose: "core" }), true);
});
