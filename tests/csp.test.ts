import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { csp, cspApplies, newNonce } from "../src/lib/csp-pure.ts";

test("CSP: scripts only by nonce (no unsafe-inline/eval in production); the rest keeps ORBIT's features working", () => {
  const p = csp("abc");
  assert.match(p, /script-src 'self' 'nonce-abc' 'strict-dynamic' 'wasm-unsafe-eval'(;|$)/);
  assert.doesNotMatch(p.split("; ").find((d) => d.startsWith("script-src"))!, /unsafe-inline|'unsafe-eval'/);
  for (const d of ["object-src 'self'", "base-uri 'self'", "form-action 'self'", "worker-src 'self' blob:", "default-src 'self'"]) assert.ok(p.includes(d), d);
  assert.match(csp("abc", true), /'unsafe-eval'/, "dev only");
});

test("CSP applies to pages, not to API routes or the sandboxed previews; nonces are fresh 128-bit values", () => {
  for (const p of ["/", "/login", "/remote", "/screen"]) assert.ok(cspApplies(p), p);
  for (const p of ["/api/tasks", "/w", "/w/abc/index.html", "/p/tok", "/_next/static/x.js"]) assert.ok(!cspApplies(p), p);
  const a = newNonce(), b = newNonce();
  assert.notEqual(a, b); assert.equal(Buffer.from(a, "base64").length, 16);
});

test("middleware sets the policy on the request (Next stamps its scripts) and the response; pages render per request", () => {
  const mw = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8"), layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.match(mw, /request\.headers\.set\("content-security-policy", policy\)/);
  assert.match(mw, /return withCsp\(response\)/);
  assert.match(layout, /export const dynamic = "force-dynamic"/);
});

test("the configured Supabase origin is allowed even over plain http; junk adds nothing", () => {
  const p = csp("n", false, "http://127.0.0.1:54321/");
  assert.match(p, /connect-src [^;]*http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321/);
  assert.doesNotMatch(csp("n", false, "nope"), /undefined|nope/);
});
