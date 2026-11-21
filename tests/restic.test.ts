import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  BASE_EXCLUDES, backupArgs, backupCheck, cloudCopy, configErrors, defaultConfig, forgetArgs, journalCheck, resticEnv, restoreArgs, snapshotFromJson,
} from "../src/lib/restic-pure.ts";

const data = path.resolve("/x/orbit-data"), studio = path.resolve("/x/orbit-studio");
const cfg = defaultConfig({ dataDir: data, studioDir: studio, repo: path.resolve("/backups/orbit-restic"), keepDaily: 10 });

test("backup command: both folders, secrets and heavy media excluded, JSON output", () => {
  const a = backupArgs(cfg, ["/tmp/orbit-backup-supabase"]);
  assert.equal(a[0], "backup");
  assert.ok(a.includes("--json") && a.includes("--exclude-caches"));
  const ex = a.flatMap((x, i) => (a[i - 1] === "--exclude" ? [x] : []));
  for (const p of [".env", ".env.*", "keys", "*.tmp"]) assert.ok(ex.includes(p), p);
  assert.ok(ex.includes(path.join(studio, "clips")) && ex.includes(path.join(studio, "models")));
  assert.deepEqual(a.slice(-3), [data, studio, "/tmp/orbit-backup-supabase"]);
  assert.ok(BASE_EXCLUDES.length > 5);
});

test("a repo inside a backed-up folder is excluded from itself", () => {
  const inner = { ...cfg, repo: path.join(data, "restic") };
  assert.ok(backupArgs(inner).includes(path.join(data, "restic")));
  assert.ok(!backupArgs(cfg).includes(cfg.repo));
});

test("forget keeps N snapshots and prunes; password only via file", () => {
  assert.deepEqual(forgetArgs(cfg), ["forget", "--tag", "orbit", "--keep-daily", "10", "--keep-weekly", "8", "--keep-monthly", "12", "--prune"]);
  assert.deepEqual(resticEnv(cfg.repo, "/k/restic.pass"), { RESTIC_REPOSITORY: cfg.repo, RESTIC_PASSWORD_FILE: "/k/restic.pass" });
  for (const a of [backupArgs(cfg), forgetArgs(cfg)]) assert.ok(!a.some((x) => /password/i.test(x)));
});

test("restore only into a separate folder, valid snapshot ids only", () => {
  assert.deepEqual(restoreArgs(cfg, "latest", "/restore/test"), ["restore", "latest", "--target", "/restore/test"]);
  assert.deepEqual(restoreArgs(cfg, "0a1b2c3d", "/restore/t"), ["restore", "0a1b2c3d", "--target", "/restore/t"]);
  assert.ok("error" in (restoreArgs(cfg, "latest", path.join(data, "sub")) as object));
  assert.ok("error" in (restoreArgs(cfg, "latest", "/x") as object)); // a parent of the live folders
  assert.ok("error" in (restoreArgs(cfg, "latest; rm -rf /", "/r") as object));
});

test("no cloud upload unless the owner configured a remote", () => {
  assert.equal(cloudCopy(cfg, "/k/p"), null);
  const c = cloudCopy({ ...cfg, cloud: "onedrive:orbit" }, "/k/p")!;
  assert.equal(c.env.RESTIC_REPOSITORY, "rclone:onedrive:orbit");
  assert.deepEqual(c.args, ["copy", "--from-repo", cfg.repo, "--from-password-file", "/k/p", "--tag", "orbit"]);
});

test("config validation", () => {
  assert.deepEqual(configErrors(cfg), []);
  assert.equal(configErrors(null).length, 1);
  assert.ok(configErrors({ ...cfg, keep: { daily: 0, weekly: 0, monthly: 0 } }).length);
  assert.ok(configErrors({ ...cfg, cloud: "no-colon" }).length);
  assert.ok(configErrors({ ...cfg, paths: [] }).length);
});

test("snapshot id from restic --json output", () => {
  const out = ['{"message_type":"status","percent_done":0.5}', '{"message_type":"summary","snapshot_id":"abc123ef"}'].join("\n");
  assert.equal(snapshotFromJson(out), "abc123ef");
  assert.equal(snapshotFromJson("garbage"), null);
});

test("doctor: backup age and journal encryption", () => {
  const now = Date.parse("2026-11-21T12:00:00Z"), h = (n: number) => new Date(now - n * 3600_000).toISOString();
  assert.equal(backupCheck(false, null, now).status, "warn");
  assert.equal(backupCheck(true, null, now).status, "warn");
  const ok = backupCheck(true, { lastRun: h(9), ok: true, lastOk: h(9) }, now);
  assert.equal(ok.status, "ok"); assert.match(ok.detail, /9 h ago/);
  assert.equal(backupCheck(true, { lastRun: h(50), ok: true, lastOk: h(50) }, now).status, "warn");
  assert.equal(backupCheck(true, { lastRun: h(1), ok: false, lastOk: h(30), error: "disk full" }, now).status, "fail");
  assert.equal(journalCheck(null, 0, 0).status, "warn");
  assert.equal(journalCheck("ab12cd34", 2, 0).status, "warn");
  assert.equal(journalCheck("ab12cd34", 0, 0).status, "ok");
});
