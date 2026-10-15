import { test } from "node:test";
import assert from "node:assert/strict";
import { takeLines, parseStreamJsonLine, partialAnswer } from "../src/lib/streamjson.ts";

test("takeLines keeps partial lines across chunks", () => {
  let buf = "";
  const got: string[] = [];
  for (const chunk of ['{"a":1}\n{"b"', ':2}\r\n\n{"c', '":3}']) {
    const { lines, rest } = takeLines(buf + chunk);
    got.push(...lines);
    buf = rest;
  }
  assert.deepEqual(got, ['{"a":1}', '{"b":2}']);
  assert.equal(buf, '{"c":3}');
});

test("parseStreamJsonLine reads text deltas and the final result, ignores the rest", () => {
  const delta = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } } });
  assert.deepEqual(parseStreamJsonLine(delta), { delta: "Hi" });
  const result = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Hi there", usage: { input_tokens: 5, output_tokens: 2 } });
  assert.deepEqual(parseStreamJsonLine(result), { result: { text: "Hi there", isError: false, inputTokens: 5, outputTokens: 2 } });
  assert.equal(parseStreamJsonLine(JSON.stringify({ type: "system", subtype: "init" })), null);
  assert.equal(parseStreamJsonLine(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{" } } })), null);
  assert.equal(parseStreamJsonLine("not json"), null);
});

test("partialAnswer decodes the growing final string of CORE's JSON reply", () => {
  const full = JSON.stringify({ thought: 'say "final"', final: 'Line 1\n"quoted" \\ é é done' });
  let prev = "";
  for (let i = 1; i <= full.length; i++) {
    const shown = partialAnswer(full.slice(0, i)) ?? "";
    assert.ok(shown.startsWith(prev), `not monotonic at ${i}`);
    prev = shown;
  }
  assert.equal(prev, 'Line 1\n"quoted" \\ é é done');
  assert.equal(partialAnswer('{"thought": "x", "tool": "fetch_url", "input": {"url": "https://a"}}'), null);
  assert.equal(partialAnswer('```json\n{"thought":"","final":"ok'), "ok");
  assert.equal(partialAnswer("  Plain prose answer"), "Plain prose answer");
  assert.equal(partialAnswer("   "), null);
  assert.equal(partialAnswer('{"final":"a\\u00e9b"}'), "a\u00e9b");
  assert.equal(partialAnswer('{"final":"a\\u00'), "a");
  assert.equal(partialAnswer('{"final":"a\\'), "a");
});
