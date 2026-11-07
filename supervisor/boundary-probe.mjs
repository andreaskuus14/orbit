// Boundary probe. Run it from the account under test, the way untrusted code runs there:
//   builder: as a model-written test   node --test supervisor/boundary-probe.mjs                (PROBE_ROLE=builder)
//   build:   during `next build` or an npm install script   node supervisor/boundary-probe.mjs --report <file>  (PROBE_ROLE=build)
//   test:    as a test the orbit-test runner executes (supervisor/test-run.ts): node --test from its disposable checkout (PROBE_ROLE=test).
//            The runner gives tests an empty environment, so the paths come from probe-env.json next to the checkout's package.json.
// It tries everything that account must not do, and the little it must; exits 1 if any forbidden action works.
// Paths: PROBE_SUP (supervisor home), PROBE_LIVE (live ORBIT folder), PROBE_STAGE (release build folder), PROBE_DATA (ORBIT data),
// PROBE_OWN (a folder this account may write, for the hard-link check), optional PROBE_SUP_PID, PROBE_ORIGIN (where main lives).
// Role test also: PROBE_BUILDER (the builder's home: config, state, secrets\model.key, worktrees), PROBE_BUILDER_PROFILE (its
// profile, .claude\.credentials.json), PROBE_BUILDER_PID (a builder process holding a canary credential), PROBE_PROXY (host:port).
// Network checks run in this process, in a child and in a grandchild (through the shell): a rule that only caught the first is no rule.
import { appendFileSync, existsSync, linkSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import dns from "node:dns/promises";
import path from "node:path";

const fileEnv = existsSync("probe-env.json") ? JSON.parse(readFileSync("probe-env.json", "utf8")) : {};
const E = { ...fileEnv, ...process.env }, ROLE = E.PROBE_ROLE || "builder", SUP = E.PROBE_SUP, LIVE = E.PROBE_LIVE, STAGE = E.PROBE_STAGE, DATA = E.PROBE_DATA;
const tag = `probe-${ROLE}-${process.pid}`;
const DENY_CODES = ["EACCES", "EPERM", "ENOENT", "EROFS", "ENOTDIR", "EXDEV", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ESRCH", "EBLOCKED", "ETIMEOUT", "ECONNRESET", "ESERVFAIL", "EREFUSED", "ECONNREFUSED", "EADDRNOTAVAIL", "ENOTCONN", "EAI_FAIL", "EAI_NONAME", "EAFNOSUPPORT", "ENETDOWN"];
const fail = (code, msg = code) => { const e = new Error(msg); e.code = code; throw e; };

/** Connect from this process (depth 0), a child (1) or a grandchild through the shell (2). Resolves if connected. */
async function connect(host, port, depth = 0) {
  if (depth === 0) return new Promise((ok, no) => {
    const s = net.connect({ host, port, timeout: 4000 });
    s.on("connect", () => { s.destroy(); ok(); }).on("timeout", () => { s.destroy(); no(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })); }).on("error", no);
  });
  // The child reports through a file, not stdout: inside a Windows AppContainer, stdio pipes to a child process can hang.
  const f = path.join(E.TEMP || E.TMPDIR || "/tmp", `probe-net-${process.pid}-${Date.now()}`), outFile = `${f}.out`;
  const js = `const fs=require("fs");const done=(c,m)=>{fs.writeFileSync(${JSON.stringify(outFile)},m);process.exit(c)};require("net").connect({host:${JSON.stringify(host)},port:${port},timeout:4000}).on("connect",()=>done(0,"connected")).on("timeout",()=>done(3,"ETIMEDOUT")).on("error",e=>done(3,e.code||"error"))`;
  writeFileSync(`${f}.cjs`, js);
  const opts = { stdio: "ignore", timeout: 15000, windowsHide: true };
  const r = depth === 1 ? spawnSync(process.execPath, [`${f}.cjs`], opts)
    : process.platform === "win32" ? spawnSync("cmd.exe", ["/d", "/c", `"${process.execPath}" "${f}.cjs"`], { ...opts, windowsVerbatimArguments: true })
    : spawnSync("sh", ["-c", `"$0" "$1"`, process.execPath, `${f}.cjs`], opts);
  let got = ""; try { got = readFileSync(outFile, "utf8"); } catch { /* the child never wrote */ }
  for (const x of [`${f}.cjs`, outFile]) { try { unlinkSync(x); } catch { /* best effort */ } }
  if (got === "connected") return; // reached it, whatever happened after
  fail(got || (r.error?.code === "ETIMEDOUT" ? "ETIMEDOUT" : r.error?.code) || "EBLOCKED");
}

/** [group, what, fn, expect]: expect "denied" or "allowed". */
function checks() {
  const c = [];
  const d = (g, what, fn) => c.push([g, what, fn, "denied"]);
  const a = (g, what, fn) => c.push([g, what, fn, "allowed"]);
  const rp = (g, what, fn) => c.push([g, what, fn, "report"]); // recorded, not judged: a known limit of the platform, reported as found
  if (ROLE === "test") {
    const T1 = "builder credentials and spending settings";
    const B = E.PROBE_BUILDER, P = E.PROBE_BUILDER_PROFILE;
    d(T1, "read the builder's model key", () => readFileSync(path.join(B, "secrets", "model.key")));
    d(T1, "read the builder's login (.claude/.credentials.json)", () => readFileSync(path.join(P, ".claude", ".credentials.json")));
    d(T1, "read the builder's config (spending limits)", () => readFileSync(path.join(B, "config.json")));
    d(T1, "raise the daily spending limit", () => writeFileSync(path.join(B, "config.json"), '{"maxUsdPerDay":1000,"maxUsdPerTask":1000}'));
    d(T1, "reset today's spend (state.json)", () => writeFileSync(path.join(B, "state.json"), '{"day":{"costUsd":0}}'));
    d(T1, "list the builder's worktrees", () => readdirSync(path.join(B, "worktrees")));
    d(T1, "read the builder's log", () => readFileSync(path.join(B, "builder.log")));
    if (E.PROBE_BUILDER_PID) {
      d(T1, "signal the builder process", () => process.kill(Number(E.PROBE_BUILDER_PID), 0));
      if (process.platform !== "win32") d(T1, "read the builder process's environment (its key)", () => readFileSync(`/proc/${E.PROBE_BUILDER_PID}/environ`));
    }
    d(T1, "find a model, GitHub or proxy variable in its own environment", () => {
      const leak = Object.entries(process.env).find(([k, v]) => /^(ANTHROPIC_|CLAUDE_|GH_|GITHUB_|HTTPS?_PROXY$|https?_proxy$|SUPABASE_SECRET)/.test(k) || /sk-ant-|canary|ghp_|github_pat_/i.test(v ?? ""));
      if (leak) return; fail("ENOENT");
    });
    const T2 = "network: nothing but its own loopback";
    for (const depth of [0, 1, 2]) {
      const who = ["itself", "a child process", "a grandchild via the shell"][depth];
      d(T2, `${who}: connect to 1.1.1.1:443`, () => connect("1.1.1.1", 443, depth));
      d(T2, `${who}: connect to api.anthropic.com:443`, () => connect("api.anthropic.com", 443, depth));
      if (E.PROBE_PROXY) { const [h, p] = E.PROBE_PROXY.split(":"); d(T2, `${who}: connect to the host's proxy ${E.PROBE_PROXY}`, () => connect(h, Number(p), depth)); }
    }
    // Name resolution through the system resolver (Windows: the DNS Client service), and straight to public resolvers. A unique
    // name (PROBE_DNS_NAME) lets the harness check the DNS Client log for a query that left.
    // Judged on a name that exists (a working resolver answers it); the unique name is looked up only so the log check has a mark.
    d(T2, "resolve example.com through the system resolver", () => dns.lookup("example.com"));
    d(T2, "resolve example.com directly at 1.1.1.1 and 8.8.8.8", async () => { const r = new dns.Resolver({ timeout: 3000, tries: 1 }); r.setServers(["1.1.1.1", "8.8.8.8"]); await r.resolve4("example.com"); });
    if (E.PROBE_DNS_NAME) rp(T2, `look up the marker name ${E.PROBE_DNS_NAME}`, () => dns.lookup(E.PROBE_DNS_NAME));
    // The host's loopback services (live ORBIT listens on 127.0.0.1:3000): over IPv4, IPv6 and "localhost", from a child too.
    if (E.PROBE_HOST_PORT) for (const [host, depth] of [["127.0.0.1", 0], ["::1", 0], ["localhost", 0], ["127.0.0.1", 1]]) {
      d(T2, `reach the host's service on ${host}:${E.PROBE_HOST_PORT}${depth ? " from a child" : ""}`, () => connect(host, Number(E.PROBE_HOST_PORT), depth));
    }
    // Usability, not security: Windows AppContainers may refuse even their own loopback (reported, not judged there).
    (process.platform === "win32" ? rp : a)(T2, "loopback to its own server (the isolated app's path)", async () => {
      const srv = net.createServer((c) => c.end()).listen(0, "127.0.0.1");
      await new Promise((ok) => srv.on("listening", ok));
      try { await connect("127.0.0.1", srv.address().port, 1); } finally { srv.close(); }
    });
  }
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
  // the runner reads the mirror for the checkout; the tests themselves don't need it (Windows: refused inside the AppContainer)
  (ROLE === "test" ? rp : a)(G2, "read main from the mirror", () => readFileSync(path.join(SUP, "mirror.git", "HEAD")));
  const G3 = "inbox";
  const theirs = path.join(SUP, "inbox", "existing-by-supervisor.keep");
  d(G3, "list the inbox", () => readdirSync(path.join(SUP, "inbox")));
  d(G3, "overwrite another inbox file", () => writeFileSync(theirs, "{}"));
  d(G3, "delete another inbox file", () => unlinkSync(theirs));
  if (ROLE === "builder") {
    a(G3, "create a submission (one write, no rename)", () => writeFileSync(path.join(SUP, "inbox", `${tag}.json`), "{}", { flag: "wx" }));
    a(G3, "read the published status", () => readFileSync(path.join(SUP, "public", "status.json")));
  } else d(G3, `drop a submission (${ROLE} account)`, () => writeFileSync(path.join(SUP, "inbox", `${tag}.json`), "{}"));
  const G4 = "live install and ORBIT data";
  for (const f of ["src/app/api/health/route.ts", "scripts/stop.ps1", "scripts/launch.ps1", ".git/config", ".next/BUILD_ID", "package.json"])
    d(G4, `modify live ${f}`, () => appendFileSync(path.join(LIVE, f), "x"));
  d(G4, "add a git hook in live", () => writeFileSync(path.join(LIVE, ".git", "hooks", "post-checkout"), "#!/bin/sh\n"));
  d(G4, "read live .env.local (production secrets)", () => readFileSync(path.join(LIVE, ".env.local")));
  d(G4, "read ORBIT's data", () => readdirSync(DATA));
  d(G4, "switch ORBIT's Stop-all off", () => writeFileSync(path.join(DATA, "stop-all.json"), '{"on":false}'));
  if (ROLE !== "build") {
    d(G4, "write the stage build", () => writeFileSync(path.join(STAGE, ".next", "BUILD_ID"), "x"));
    d(G4, "fake a build result", () => writeFileSync(path.join(STAGE, "BUILD_RESULT.txt"), `${"0".repeat(40)} 0`));
  }
  const G5 = "release checks";
  if (E.PROBE_ORIGIN) d(G5, "push to main", () => {
    const r = spawnSync("git", ["push", E.PROBE_ORIGIN, "HEAD:refs/heads/main"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"].map((x, i) => (process.platform === "win32" && i ? "ignore" : x)), timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "", SSH_ASKPASS: "" } });
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

async function run([group, what, fn, expect]) {
  try { await fn(); return { group, what, expect, got: "allowed", ok: expect !== "denied" }; }
  catch (e) {
    if (expect === "report") return { group, what, expect, got: `denied (${e.code ?? e.message})`, ok: true };
    if (expect === "denied" && !DENY_CODES.includes(e.code)) return { group, what, expect, got: `error ${e.code ?? e.message}`, ok: false };
    return { group, what, expect, got: `denied (${e.code})`, ok: expect === "denied" };
  }
}

const at = process.argv.indexOf("--report");
if (at > 0) {
  const results = []; for (const c of checks()) results.push(await run(c));
  const out = { role: ROLE, user: E.USERNAME || E.USER || String(process.getuid?.()), pass: results.every((r) => r.ok), results };
  writeFileSync(process.argv[at + 1], JSON.stringify(out, null, 1));
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} [${ROLE}] ${r.what}: ${r.got}`);
  process.exit(out.pass ? 0 : 1);
} else {
  const { test } = await import("node:test");
  const assert = (await import("node:assert/strict")).default;
  const groups = new Map();
  for (const c of checks()) groups.set(c[0], [...(groups.get(c[0]) ?? []), c]);
  for (const [g, cs] of groups) test(`${ROLE}: ${g}`, async () => { for (const c of cs) { const r = await run(c); console.log(r.expect === "report" ? `# report: ${r.what}: ${r.got}` : `# check: ${r.ok ? "ok" : "FAIL"} ${r.what}: ${r.got}`); assert.ok(r.ok, `${ROLE} ${r.expect === "denied" ? "could" : "can't"} ${r.what} (${r.got})`); } });
}
