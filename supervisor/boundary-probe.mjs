// Boundary probe. Run it from the account under test, the way untrusted code runs there:
//   builder: as a model-written test   node --test supervisor/boundary-probe.mjs                (PROBE_ROLE=builder)
//   build:   during `next build` or an npm install script   node supervisor/boundary-probe.mjs --report <file>  (PROBE_ROLE=build)
// It tries everything that account must not do, and the little it must; exits 1 if any forbidden action works.
// Paths: PROBE_SUP (supervisor home), PROBE_LIVE (live ORBIT folder), PROBE_STAGE (release build folder), PROBE_DATA (ORBIT data),
// PROBE_OWN (a folder this account may write, for the hard-link check), optional PROBE_SUP_PID, PROBE_ORIGIN (where main lives). Nothing here needs the network.
import { appendFileSync, linkSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const E = process.env, ROLE = E.PROBE_ROLE || "builder", SUP = E.PROBE_SUP, LIVE = E.PROBE_LIVE, STAGE = E.PROBE_STAGE, DATA = E.PROBE_DATA;
const tag = `probe-${ROLE}-${process.pid}`;
const DENY_CODES = ["EACCES", "EPERM", "ENOENT", "EROFS", "ENOTDIR", "EXDEV"];

/** [group, what, fn, expect]: expect "denied" or "allowed". */
function checks() {
  const c = [];
  const d = (g, what, fn) => c.push([g, what, fn, "denied"]);
  const a = (g, what, fn) => c.push([g, what, fn, "allowed"]);
  const G1 = "supervisor credentials and state";
  d(G1, "read the GitHub token", () => readFileSync(path.join(SUP, "token.txt")));
  d(G1, "read the supervisor config", () => readFileSync(path.join(SUP, "config.json")));
  for (const f of ["config.json", "state.json", "audit.jsonl", "STOP"]) d(G1, `write ${f}`, () => appendFileSync(path.join(SUP, f), "x"));
  d(G1, "remove the emergency stop", () => unlinkSync(path.join(SUP, "STOP")));
  d(G1, "queue owner commands (ctl)", () => writeFileSync(path.join(SUP, "ctl", `control-${tag}.json`), '{"action":"clear"}'));
  d(G1, "hard-link the token somewhere readable", () => linkSync(path.join(SUP, "token.txt"), path.join(E.PROBE_OWN || SUP, `${tag}.lnk`)));
  const G2 = "supervisor code, install scripts, snapshots, mirror";
  for (const dir of ["app", path.join("app", "windows")]) d(G2, `write into ${dir}`, () => writeFileSync(path.join(SUP, dir, `${tag}.ts`), "x"));
  let appFiles = [];
  try { appFiles = readdirSync(path.join(SUP, "app")).filter((n) => /\.(ts|ps1|json)$/.test(n)); } catch { /* unreadable is fine */ }
  for (const f of appFiles) d(G2, `modify app/${f}`, () => appendFileSync(path.join(SUP, "app", f), "\n// x"));
  d(G2, "write a release snapshot", () => writeFileSync(path.join(SUP, "releases", tag), "x"));
  d(G2, "move main in the mirror", () => writeFileSync(path.join(SUP, "mirror.git", "refs", "heads", "main"), "0".repeat(40) + "\n"));
  d(G2, "write the published status", () => appendFileSync(path.join(SUP, "public", "status.json"), "x"));
  a(G2, "read main from the mirror", () => readFileSync(path.join(SUP, "mirror.git", "HEAD")));
  const G3 = "inbox";
  const theirs = path.join(SUP, "inbox", "existing-by-supervisor.keep");
  d(G3, "list the inbox", () => readdirSync(path.join(SUP, "inbox")));
  d(G3, "overwrite another inbox file", () => writeFileSync(theirs, "{}"));
  d(G3, "delete another inbox file", () => unlinkSync(theirs));
  if (ROLE === "builder") {
    const mine = path.join(SUP, "inbox", `${tag}.json.tmp`);
    a(G3, "create a submission", () => writeFileSync(mine, "{}"));
    a(G3, "finish it with a rename", () => renameSync(mine, mine.replace(/\.tmp$/, "")));
    a(G3, "read the published status", () => readFileSync(path.join(SUP, "public", "status.json")));
  } else d(G3, "drop a submission (build account)", () => writeFileSync(path.join(SUP, "inbox", `${tag}.json`), "{}"));
  const G4 = "live install and ORBIT data";
  for (const f of ["src/app/api/health/route.ts", "scripts/stop.ps1", "scripts/launch.ps1", ".git/config", ".next/BUILD_ID", "package.json"])
    d(G4, `modify live ${f}`, () => appendFileSync(path.join(LIVE, f), "x"));
  d(G4, "add a git hook in live", () => writeFileSync(path.join(LIVE, ".git", "hooks", "post-checkout"), "#!/bin/sh\n"));
  d(G4, "read live .env.local (production secrets)", () => readFileSync(path.join(LIVE, ".env.local")));
  d(G4, "read ORBIT's data", () => readdirSync(DATA));
  d(G4, "switch ORBIT's Stop-all off", () => writeFileSync(path.join(DATA, "stop-all.json"), '{"on":false}'));
  if (ROLE === "builder") {
    d(G4, "write the stage build", () => writeFileSync(path.join(STAGE, ".next", "BUILD_ID"), "x"));
    d(G4, "fake a build result", () => writeFileSync(path.join(STAGE, "BUILD_RESULT.txt"), `${"0".repeat(40)} 0`));
  }
  const G5 = "release checks";
  if (E.PROBE_ORIGIN) d(G5, "push to main", () => {
    const r = spawnSync("git", ["push", E.PROBE_ORIGIN, "HEAD:refs/heads/main"], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (r.status !== 0) { const e = new Error("push refused"); e.code = "EACCES"; throw e; }
  });
  if (E.PROBE_SUP_PID) {
    d(G5, "signal the supervisor", () => process.kill(Number(E.PROBE_SUP_PID), 0));
    if (process.platform !== "win32") d(G5, "read the supervisor's environment", () => readFileSync(`/proc/${E.PROBE_SUP_PID}/environ`));
  }
  d(G5, "see supervisor secrets in its own environment", () => {
    const leak = Object.entries(process.env).find(([k, v]) => /SUPABASE_SECRET|GITHUB_TOKEN|GH_TOKEN|token\.txt/i.test(k) || /ghp_|github_pat_/.test(v ?? ""));
    if (!leak) { const e = new Error("none"); e.code = "ENOENT"; throw e; }
  });
  return c;
}

function run([group, what, fn, expect]) {
  try { fn(); return { group, what, expect, got: "allowed", ok: expect === "allowed" }; }
  catch (e) {
    if (expect === "denied" && !DENY_CODES.includes(e.code)) return { group, what, expect, got: `error ${e.code ?? e.message}`, ok: false };
    return { group, what, expect, got: `denied (${e.code})`, ok: expect === "denied" };
  }
}

const at = process.argv.indexOf("--report");
if (at > 0) {
  const results = checks().map(run);
  const out = { role: ROLE, user: E.USERNAME || E.USER || String(process.getuid?.()), pass: results.every((r) => r.ok), results };
  writeFileSync(process.argv[at + 1], JSON.stringify(out, null, 1));
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} [${ROLE}] ${r.what}: ${r.got}`);
  process.exit(out.pass ? 0 : 1);
} else {
  const { test } = await import("node:test");
  const assert = (await import("node:assert/strict")).default;
  const groups = new Map();
  for (const c of checks()) groups.set(c[0], [...(groups.get(c[0]) ?? []), c]);
  for (const [g, cs] of groups) test(`${ROLE}: ${g}`, () => { for (const r of cs.map(run)) assert.ok(r.ok, `${ROLE} ${r.expect === "denied" ? "could" : "can't"} ${r.what} (${r.got})`); });
}
