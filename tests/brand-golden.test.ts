import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { goldenCases } from "./brand-golden-cases.ts";

// The default brand kit must reproduce, byte for byte, what ORBIT drew before the kit existed.
const golden = JSON.parse(readFileSync(new URL("./fixtures/brand-golden.json", import.meta.url), "utf8")) as Record<string, string>;
const now = goldenCases();

test("default kit: every fixture render equals the pre-kit snapshot", () => {
  assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  for (const k of Object.keys(golden)) assert.equal(now[k], golden[k], `${k} changed`);
});
