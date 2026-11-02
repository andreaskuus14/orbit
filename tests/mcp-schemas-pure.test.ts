import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEMAS, fixHint, prepareArgs, signature } from "../src/lib/mcp-schemas-pure.ts";

test("schemas: every one is a valid object schema whose required props exist", () => {
  assert.ok(Object.keys(SCHEMAS).length >= 15);
  for (const [n, s] of Object.entries(SCHEMAS)) {
    assert.equal(s.type, "object", n);
    for (const r of s.required) assert.ok(s.properties[r], `${n}.${r}`);
  }
  assert.equal(signature("read_news"), 'read_news {"query": string, "hours"?: number, "country"?: string}');
  assert.equal(signature("nope"), "");
});

test("args: JSON-string arrays/objects/numbers coerced (the live lead_create `leads` string), others untouched", () => {
  const leads = [{ name: "A", source_url: "https://a.ee" }];
  assert.deepEqual(prepareArgs("lead_create", { leads: JSON.stringify(leads) }), { args: { leads } });
  assert.deepEqual(prepareArgs("read_more", { ref: "r1", offset: "4000" }), { args: { ref: "r1", offset: 4000 } });
  const files = [{ path: "data.json", content: '{"a":1}' }];
  assert.deepEqual(prepareArgs("ws_write", { workspace: "w", files: JSON.stringify(files) }), { args: { workspace: "w", files } }); // nested content stays a string
  assert.deepEqual(prepareArgs("plugin__x__y", { a: "[1]" }), { args: { a: "[1]" } }); // no schema: pass-through
});

test("args: missing, wrong-typed and off-enum props come back with how to call it", () => {
  const miss = prepareArgs("web_search", {}) as { error: string };
  assert.match(miss.error, /^Error: web_search is missing "query"\. Call it as: web_search \{"query": string\}/);
  const bad = prepareArgs("lead_create", { leads: "not json" }) as { error: string };
  assert.match(bad.error, /"leads" must be a JSON array, not string/);
  assert.match((prepareArgs("navigate", { target: "memory", zoom: "far" }) as { error: string }).error, /must be one of in, out, reset/);
});

test("runner errors about arguments get the call's shape; policy refusals and successes don't", () => {
  assert.match(fixHint("ws_write", "Error: files must be a non-empty list"), /\nCall it as: ws_write \{"workspace": string, "files": \[\{"path": string, "content": string\}\]\}/);
  assert.equal(fixHint("ws_write", "Error: this needs the owner's approval"), "Error: this needs the owner's approval");
  assert.equal(fixHint("ws_write", "Wrote 2 files."), "Wrote 2 files.");
  assert.equal(fixHint("other_tool", "Error: missing x"), "Error: missing x");
});
