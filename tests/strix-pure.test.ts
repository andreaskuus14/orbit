import { test } from "node:test";
import assert from "node:assert/strict";
import { envProblem, summarize, targetProblem } from "../src/lib/strix-pure.ts";

test("target guard: only the isolated server on this machine", () => {
  assert.equal(targetProblem("http://127.0.0.1:3100"), "");
  assert.equal(targetProblem("http://localhost:3100/login"), "");
  for (const bad of ["http://127.0.0.1:3000", "http://192.168.1.20:3100", "https://127.0.0.1:3100", "http://orbit.example.com:3100", "http://u:p@127.0.0.1:3100", "http://127.0.0.1.nip.io:3100", "nope"])
    assert.notEqual(targetProblem(bad), "", bad);
});

test("env guard: local Supabase and the throwaway account, or refuse", () => {
  assert.equal(envProblem({ apiUrl: "http://127.0.0.1:54321", email: "orbit-test@example.test" }), "");
  assert.notEqual(envProblem(null), "");
  assert.notEqual(envProblem({ apiUrl: "https://abc.supabase.co", email: "orbit-test@example.test" }), "");
  assert.notEqual(envProblem({ apiUrl: "http://127.0.0.1:54321", email: "andreas@gmail.com" }), "");
});

test("summary counts severities in markdown and JSON reports", () => {
  const s = summarize(["## SSRF via redirect\nSeverity: High\n", '{"title":"x","severity":"critical"}', "**Severity:** low\nseverity: Informational"]);
  assert.deepEqual([s.critical, s.high, s.medium, s.low, s.info], [1, 1, 0, 1, 1]);
  assert.deepEqual(s.titles, ["SSRF via redirect"]);
});
