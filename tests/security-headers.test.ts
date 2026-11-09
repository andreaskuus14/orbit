import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// next.config.ts imports next/constants, which plain node can't resolve; check the source, which is what Next reads.
const src = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("security headers: no X-Powered-By; pages send nosniff, no framing, a safe CSP", () => {
  assert.match(src, /poweredByHeader: false/);
  assert.match(src, /"X-Frame-Options", value: "DENY"/);
  assert.match(src, /"X-Content-Type-Options", value: "nosniff"/);
  const csp = /"Content-Security-Policy", value: "([^"]+)"/.exec(src)?.[1] ?? "";
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /object-src 'none'|frame-ancestors/, "VAULT PDFs and the shop preview keep working");
});
