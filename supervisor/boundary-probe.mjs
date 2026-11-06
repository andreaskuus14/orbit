// Boundary probe: run AS THE BUILDER'S ACCOUNT, the way model-written code runs (e.g. `node --test` from a builder worktree).
// Tries everything the builder must not be able to do and a few things it must; exits 1 if any forbidden action works.
//   PROBE_SUP=<supervisor home> PROBE_LIVE=<live ORBIT folder> PROBE_STAGE=<stage folder> PROBE_DATA=<ORBIT data folder>
//   PROBE_SUP_PID=<supervisor pid, optional> PROBE_ORIGIN=<git remote main lives on, optional>   node --test supervisor/boundary-probe.mjs
// Windows: run from the builder account (runas /user:orbit-builder ...) with the real paths. Nothing here needs network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, readdirSync, unlinkSync, writeFileSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const E = process.env, SUP = E.PROBE_SUP, LIVE = E.PROBE_LIVE, STAGE = E.PROBE_STAGE, DATA = E.PROBE_DATA;
const tag = `probe-${process.pid}`;
const denied = (what, fn) => {
  let ok = false;
  try { fn(); ok = true; } catch (e) { if (!["EACCES", "EPERM", "ENOENT", "EROFS"].includes(e.code)) throw e; }
  assert.equal(ok, false, `builder could ${what}`);
};
const allowed = (what, fn) => { try { fn(); } catch (e) { assert.fail(`builder can't ${what}: ${e.code ?? e.message}`); } };

test("supervisor credentials and state can't be read or changed", () => {
  denied("read the GitHub token", () => readFileSync(path.join(SUP, "token.txt")));
  denied("read the supervisor config", () => readFileSync(path.join(SUP, "config.json")));
  for (const f of ["config.json", "state.json", "audit.jsonl", "STOP"]) denied(`write ${f}`, () => appendFileSync(path.join(SUP, f), "x"));
  denied("remove the emergency stop", () => unlinkSync(path.join(SUP, "STOP")));
  denied("queue owner commands (ctl/)", () => writeFileSync(path.join(SUP, "ctl", `control-${tag}.json`), '{"action":"clear"}'));
  denied("list ctl/", () => readdirSync(path.join(SUP, "ctl")));
});

test("the supervisor's code, install scripts, snapshots and mirror can't be changed", () => {
  for (const d of ["app", "app/windows"]) denied(`write into ${d}/`, () => writeFileSync(path.join(SUP, d, `${tag}.ts`), "x"));
  for (const f of readdirSync(path.join(SUP, "app")).filter((n) => /\.(ts|ps1|json)$/.test(n))) denied(`modify app/${f}`, () => appendFileSync(path.join(SUP, "app", f), "\n// x"));
  denied("write a release snapshot", () => writeFileSync(path.join(SUP, "releases", `${tag}`), "x"));
  denied("move main in the mirror", () => writeFileSync(path.join(SUP, "mirror.git", "refs", "heads", "main"), "0".repeat(40) + "\n"));
  denied("write the published status", () => appendFileSync(path.join(SUP, "public", "status.json"), "x"));
  allowed("read the published status", () => readFileSync(path.join(SUP, "public", "status.json")));
  allowed("read main from the mirror", () => readFileSync(path.join(SUP, "mirror.git", "HEAD")));
});

test("the inbox takes new submissions but nothing already there can be changed or removed", () => {
  const mine = path.join(SUP, "inbox", `${tag}.json.tmp`);
  allowed("create a submission", () => writeFileSync(mine, "{}"));
  allowed("finish it with a rename", () => renameSync(mine, mine.replace(/\.tmp$/, "")));
  denied("list the inbox", () => readdirSync(path.join(SUP, "inbox")));
  const theirs = path.join(SUP, "inbox", "existing-by-supervisor.json");
  denied("overwrite someone else's inbox file", () => writeFileSync(theirs, "{}"));
  denied("delete someone else's inbox file", () => unlinkSync(theirs));
});

test("the live install, the stage build and ORBIT's data can't be touched", () => {
  for (const f of ["src/app/api/health/route.ts", "scripts/stop.ps1", "scripts/launch.ps1", ".git/config", ".next/BUILD_ID", "package.json"])
    denied(`modify live ${f}`, () => appendFileSync(path.join(LIVE, f), "x"));
  denied("add a git hook in live", () => writeFileSync(path.join(LIVE, ".git", "hooks", "post-checkout"), "#!/bin/sh\n"));
  denied("read live .env.local", () => readFileSync(path.join(LIVE, ".env.local")));
  denied("write the stage build", () => writeFileSync(path.join(STAGE, ".next", "BUILD_ID"), "x"));
  denied("fake a build result", () => writeFileSync(path.join(STAGE, "BUILD_RESULT.txt"), `${"0".repeat(40)} 0`));
  denied("read ORBIT's data", () => readdirSync(DATA));
  denied("switch ORBIT's Stop-all off", () => writeFileSync(path.join(DATA, "stop-all.json"), '{"on":false}'));
});

test("no way around the release checks: no push to main, no signal to the supervisor", () => {
  if (E.PROBE_ORIGIN) {
    const r = spawnSync("git", ["push", E.PROBE_ORIGIN, "HEAD:refs/heads/main"], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    assert.notEqual(r.status, 0, "builder pushed to main");
  }
  if (E.PROBE_SUP_PID) {
    denied("signal the supervisor", () => process.kill(Number(E.PROBE_SUP_PID), 0));
    denied("read the supervisor's environment", () => readFileSync(`/proc/${E.PROBE_SUP_PID}/environ`));
  }
});
