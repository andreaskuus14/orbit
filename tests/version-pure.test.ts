import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationCheck, versionCheck } from "../src/lib/version-pure.ts";

const refs = { running: "abcdef1234", builtAt: "2026-10-28T10:00:00Z", head: "abcdef1234", main: "1234567aaa", dirty: false };

test("version ok when running matches checkout, lists experimental flags only when set", () => {
  const c = versionCheck(refs, { ORBIT_CORE_ENGINE: "sdk", ORBIT_LOCAL_MODEL: " " });
  assert.equal(c.status, "ok");
  assert.match(c.detail, /Running abcdef1.*origin\/main 1234567.*ORBIT_CORE_ENGINE=sdk/);
  assert.doesNotMatch(c.detail, /LOCAL_MODEL/);
});

test("version warns on unstamped build or checkout drift", () => {
  assert.equal(versionCheck({ ...refs, running: "unknown" }, {}).status, "warn");
  const d = versionCheck({ ...refs, head: "fff0000", dirty: true }, {});
  assert.equal(d.status, "warn");
  assert.match(d.detail, /uncommitted.*differs/);
});

test("migrations: missing, unprobeable and ok", () => {
  const files = ["0001_a.sql", "0009_b.sql", "0021_c.sql", "README.md"];
  const bad = migrationCheck(files, { "0001": true, "0021": false });
  assert.equal(bad.status, "fail");
  assert.match(bad.detail, /1 of 3 .*0021.*0009 can't be checked/);
  assert.equal(migrationCheck(files, { "0001": true, "0021": true }).detail, "2 of 3 confirmed applied; 0009 can't be checked without writing");
});
