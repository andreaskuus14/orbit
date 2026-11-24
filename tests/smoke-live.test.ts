import { test } from "node:test";
import assert from "node:assert/strict";
import { commitCheck, cookieHeader, httpVerdict, parseCookieFile, privateKeys, realConsoleErrors, runFolder, summarize, tileOf } from "../src/lib/smoke-live-pure.ts";

test("cookie file: raw header, Cookie: prefix, BOM, CRLF lines, JSON array and {cookies}", () => {
  assert.deepEqual(parseCookieFile("a=1; sb-x-auth-token=base64-eyJ=="), [{ name: "a", value: "1" }, { name: "sb-x-auth-token", value: "base64-eyJ==" }]);
  assert.deepEqual(parseCookieFile("﻿Cookie: a=1\r\nb=2\r\n"), [{ name: "a", value: "1" }, { name: "b", value: "2" }]);
  assert.deepEqual(parseCookieFile('[{"name":"a","value":"1","domain":"127.0.0.1"},{"bad":1}]'), [{ name: "a", value: "1" }]);
  assert.deepEqual(parseCookieFile('{"cookies":[{"name":"a","value":"x"}]}'), [{ name: "a", value: "x" }]);
  assert.deepEqual(parseCookieFile("[not json"), []);
  assert.deepEqual(parseCookieFile(""), []);
  assert.equal(cookieHeader([{ name: "a", value: "1" }, { name: "b", value: "2" }]), "a=1; b=2");
});

test("commit check: short vs full, mismatch, unstamped, no git", () => {
  const full = "457602f0123456789abcdef0123456789abcdef0";
  assert.equal(commitCheck("457602f", full).verdict, "pass");
  assert.equal(commitCheck(full, full.toUpperCase()).verdict, "pass");
  assert.equal(commitCheck("abcdef1", full).verdict, "fail");
  assert.equal(commitCheck(null, full).verdict, "fail");
  assert.equal(commitCheck("457602f", null).verdict, "warn");
  assert.equal(commitCheck("4576", full).verdict, "fail");
});

test("LIFE lite: journal-like keys found anywhere, journalDays allowed", () => {
  assert.deepEqual(privateKeys({ habits: [{ name: "run" }], journalDays: 3 }), []);
  assert.deepEqual(privateKeys({ journal: {}, review: { notes: "x" }, list: [{ entry: "y" }] }), ["journal", "review.notes", "list[0].entry"]);
  assert.deepEqual(privateKeys(null), []);
});

test("http verdicts", () => {
  assert.equal(httpVerdict(200), "pass");
  assert.equal(httpVerdict(401), "fail");
  assert.equal(httpVerdict(404), "warn");
  assert.equal(httpVerdict(503), "fail");
  assert.equal(httpVerdict(0), "fail");
});

test("Tallinn tile at z14 and run folder name", () => {
  assert.deepEqual(tileOf(24.745, 59.437, 14), { x: 9318, y: 4808 });
  assert.equal(runFolder(new Date(2026, 10, 4, 9, 5)), "live-2026-11-04_0905");
});

test("console errors: blocked writes and favicon dropped", () => {
  assert.deepEqual(realConsoleErrors(["GET /favicon.ico 404", "Failed to fetch", "TypeError: x is undefined"], ["/api/presence"]), ["TypeError: x is undefined"]);
  assert.deepEqual(realConsoleErrors(["Failed to fetch"], []), ["Failed to fetch"]);
});

test("summary table and exit code", () => {
  const s = summarize([{ name: "a", verdict: "pass", status: 200 }, { name: "b", verdict: "warn" }, { name: "c", verdict: "fail", status: 500, detail: "boom" }]);
  assert.equal(s.exitCode, 1);
  assert.deepEqual([s.pass, s.warn, s.fail], [1, 1, 1]);
  assert.match(s.table, /FAIL {2}c +500 {2}boom/);
  assert.match(s.table, /1 pass, 1 warn, 1 fail$/);
  assert.equal(summarize([{ name: "a", verdict: "warn" }]).exitCode, 0);
});
