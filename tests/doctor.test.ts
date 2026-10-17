import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCheck, check, diskCheck, envCheck, factsCheck, launcherCheck, lifeCheck, modelCheck, nightCheck, quotaCheck, summarize, validModel, vaultCheck, ytdlpCheck,
} from "../src/lib/doctor-pure.ts";

const GB = 1024 ** 3, DAY = 86_400_000;

test("summary: all ok, worst first, spoken top problems", () => {
  const ok = summarize([check("a", "A", "ok", "fine"), check("b", "B", "ok", "fine")], 120);
  assert.equal(ok.status, "ok");
  assert.equal(ok.headline, "Everything is working (2 checks).");
  assert.match(ok.speech, /working fine/);
  const r = summarize([check("a", "A", "ok", "fine"), check("w", "Disk", "warn", "Low. More text", "Empty the bin."), check("f", "Claude", "fail", "Won't start", "Install it.")], 5);
  assert.equal(r.status, "fail");
  assert.equal(r.headline, "1 problem and 1 warning out of 3 checks.");
  assert.deepEqual(r.checks.map((c) => c.id), ["f", "w", "a"]);
  assert.equal(r.speech, "I found 1 problem and 1 warning. Claude: Won't start. Install it. Disk: Low. Empty the bin.");
  assert.equal(summarize([check("w", "W", "warn", "x"), check("v", "V", "warn", "y")], 1).headline, "2 warnings out of 2 checks.");
});

test("model names", () => {
  for (const m of ["sonnet", "opus", "haiku", "claude-sonnet-4-5", "sonnet[1m]", "claude-opus-4-1-20250805", "fable", "claude-fable-1"]) assert.ok(validModel(m), m);
  for (const m of ["", "gpt-4", "sonet", "claude"]) assert.ok(!validModel(m), m);
  assert.equal(modelCheck("sonnet", "opus").status, "ok");
  const bad = modelCheck("sonet", "opus");
  assert.equal(bad.status, "fail");
  assert.match(bad.detail, /ORBIT_MODEL="sonet"/);
  assert.doesNotMatch(bad.detail, /ORBIT_MODEL_SMART/);
  assert.match(modelCheck("sonnet", "opus", "haiku", "opsu").detail, /ORBIT_MODEL_DEEP="opsu"/);
  assert.equal(modelCheck("sonnet", "opus", "haiku", "fable", "high").status, "ok");
  assert.equal(modelCheck("sonnet", "opus", "haiku", "opus", "turbo").status, "warn");
});

test("disk thresholds", () => {
  assert.equal(diskCheck(3 * GB, "drive D:").status, "fail");
  assert.equal(diskCheck(10 * GB, "drive D:").status, "warn");
  assert.equal(diskCheck(50 * GB, "drive D:").status, "ok");
  assert.match(diskCheck(10 * GB, "drive D:").detail, /10\.0 GB free on drive D:/);
});

test("env: names only, never values", () => {
  const env = { A: "secret-value-1", B: " ", OPT: "secret-value-2" };
  const c = envCheck(env, ["A", "B"], { OPT: "x", NOPE: "the nope feature" });
  assert.equal(c.status, "fail");
  assert.match(c.detail, /Missing: B/);
  const ok = envCheck(env, ["A"], { OPT: "x", NOPE: "the nope feature" });
  assert.equal(ok.status, "ok");
  assert.match(ok.detail, /NOPE \(the nope feature\)/);
  for (const x of [c, ok]) assert.doesNotMatch(JSON.stringify(x), /secret-value/);
});

test("yt-dlp: missing, old, paused, fine", () => {
  const now = Date.UTC(2026, 9, 16);
  assert.equal(ytdlpCheck(false, null, 0, now).status, "warn");
  assert.match(ytdlpCheck(false, null, 0, now).fix!, /winget install yt-dlp\.yt-dlp/);
  const old = ytdlpCheck(true, "2026.03.01", 0, now);
  assert.equal(old.status, "warn");
  assert.match(old.fix!, /winget upgrade yt-dlp\.yt-dlp/);
  assert.equal(ytdlpCheck(true, "2026.10.01", 0, now).status, "ok");
  assert.equal(ytdlpCheck(true, null, 0, now).status, "ok");
  assert.match(ytdlpCheck(true, "2026.10.01", now + 3600_000, now).detail, /paused until/);
  assert.equal(ytdlpCheck(true, "2026.10.01", now - 1, now).status, "ok"); // pause over
});

test("build: marker, dev fallback, first error line", () => {
  assert.equal(buildCheck(false, "", true).status, "ok");
  assert.equal(buildCheck(false, "", false).status, "warn");
  const log = "> orbit@0.1.0 build\n> next build\nCompiling...\nType error: Property 'x' does not exist\nmore";
  const w = buildCheck(true, log, true);
  assert.equal(w.status, "warn");
  assert.match(w.detail, /previous version.*Type error: Property 'x'/);
  assert.match(w.fix!, /npm run app:rebuild/);
  assert.equal(buildCheck(true, log, false).status, "fail");
});

test("launcher log: crashes and give-ups in the last 24 h only", () => {
  const now = new Date(2026, 9, 16, 12, 0, 0);
  const line = (d: Date, m: string) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00:00  [orbit] ${m}`;
  const recent = new Date(2026, 9, 16, 9), old = new Date(2026, 9, 14, 9);
  assert.equal(launcherCheck("", now).status, "ok");
  assert.equal(launcherCheck(line(old, "ORBIT server exited unexpectedly (code 1) after 3 s."), now).status, "ok");
  const w = launcherCheck([line(recent, "ORBIT server exited unexpectedly (code 1)"), line(recent, "ORBIT server exited unexpectedly (code 1)")].join("\r\n"), now);
  assert.equal(w.status, "warn");
  assert.match(w.detail, /2 times/);
  assert.equal(launcherCheck(line(recent, "GAVE UP: the server stopped 6 times"), now).status, "fail");
});

test("overnight run recency", () => {
  const now = Date.now();
  assert.match(nightCheck(null, now).detail, /Not seen/);
  assert.equal(nightCheck(null, now).status, "ok");
  assert.equal(nightCheck(now - 5 * 3600_000, now).status, "ok");
  assert.match(nightCheck(now - 5 * 3600_000, now).detail, /5 h ago/);
  assert.equal(nightCheck(now - 4 * DAY, now).status, "warn");
});

test("scout quota", () => {
  assert.equal(quotaCheck(1500, 200).status, "ok");
  assert.match(quotaCheck(1500, 200).detail, /1300 of 1500/);
  assert.equal(quotaCheck(1500, 1450).status, "warn");
  assert.match(quotaCheck(1500, 2000).detail, /^0 of/);
});

test("life data", () => {
  assert.equal(lifeCheck("missing").status, "ok");
  assert.match(lifeCheck("missing").detail, /Not used yet/);
  assert.equal(lifeCheck("ok").status, "ok");
  const bad = lifeCheck("bad", "broken JSON");
  assert.equal(bad.status, "fail");
  assert.equal(bad.fix, "Fix or move %LOCALAPPDATA%\\orbit\\life.json, then reload LIFE.");
});

test("vault: missing, read-only, 90% thresholds", () => {
  const T = 5 * GB, F = 2000;
  assert.equal(vaultCheck(false, false, 0, 0, T, F).status, "ok");
  assert.equal(vaultCheck(true, false, 0, 0, T, F).status, "fail");
  assert.equal(vaultCheck(true, true, 1 * GB, 10, T, F).status, "ok");
  assert.equal(vaultCheck(true, true, 4.5 * GB, 10, T, F).status, "ok"); // exactly 90%
  assert.equal(vaultCheck(true, true, 4.6 * GB, 10, T, F).status, "warn");
  assert.equal(vaultCheck(true, true, 0, 1801, T, F).status, "warn");
  assert.match(vaultCheck(true, true, 1 * GB, 10, T, F).detail, /1\.00 of 5 GB, 10 of 2000 files/);
});

test("belief memory migration", () => {
  assert.equal(factsCheck(false, null).status, "ok");
  const miss = factsCheck(true, "relation does not exist");
  assert.equal(miss.status, "warn");
  assert.match(miss.fix!, /0008_memory_facts\.sql in the Supabase SQL editor/);
  assert.match(factsCheck(false, "timeout").detail, /timeout/);
});
