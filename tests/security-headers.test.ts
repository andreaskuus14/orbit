import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// next.config.ts imports next/constants, which plain node can't resolve; check the source, which is what Next reads.
const src = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("security headers: no X-Powered-By; pages send nosniff, no framing, a safe CSP", () => {
  assert.match(src, /poweredByHeader: false/);
  assert.match(src, /"X-Frame-Options", value: "DENY"/);
  assert.match(src, /"X-Content-Type-Options", value: "nosniff"/);
  // the CSP itself now comes per request from middleware.ts (nonce): tests/csp.test.ts
  assert.doesNotMatch(src, /"Content-Security-Policy"/, "one CSP only (two would both have to pass)");
});
