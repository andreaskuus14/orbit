import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error plain .mjs script without types
import { scanText, scanDir, entropy } from "../scripts/secret-scan.mjs";

const J = (...p: string[]) => p.join(""); // fake credentials built at runtime, so this file itself stays clean

test("S08: each seeded fake credential is caught; ordinary code is not", () => {
  for (const fake of [J("sk-ant-", "api03-", "A".repeat(30)), J("sb_secret_", "B".repeat(20)), J("ghp_", "C".repeat(36)), J("AKIA", "D".repeat(16)), J("-----BEGIN PRIVATE", " KEY-----")])
    assert.equal(scanText(`const k = "${fake}";`).length, 1, fake.slice(0, 10));
  assert.equal(scanText(`const API_KEY = "${J("q8Zr2", "Lm4Vx9Tn6Wp3Ks7Yd1Hc5Fb0Ga")}";`).length, 1, "a random value in a secret-named field");
  for (const ok of ['const token = "placeholder-token-goes-here-x";', 'apiKey: process.env.ANTHROPIC_API_KEY', 'const SECRET_NAME = /KEY|SECRET/;', `const k = "${J("sk-ant-", "A".repeat(30))}"; // secret-scan: allow`])
    assert.equal(scanText(ok).length, 0, ok);
  assert.ok(entropy("aaaaaaaaaaaaaaaaaaaaaaaa") < 1 && entropy(J("q8Zr2", "Lm4Vx9Tn6Wp3Ks7Yd1Hc5Fb0Ga")) > 4);
});

test("S08: the CLI fails a folder with a committed fake key and passes a clean one; fixtures are allowed, .env.example is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  writeFileSync(join(dir, "ok.ts"), "export const x = 1;\n");
  mkdirSync(join(dir, "tests", "fixtures"), { recursive: true });
  writeFileSync(join(dir, "tests", "fixtures", "fake.json"), `{"key":"${J("ghp_", "F".repeat(36))}"}`);
  assert.deepEqual(scanDir(dir), []);
  const run = () => execFileSync(process.execPath, ["scripts/secret-scan.mjs", dir], { encoding: "utf8", stdio: "pipe" });
  assert.match(run(), /clean/);
  writeFileSync(join(dir, "leak.ts"), `const k = "${J("sk-proj-", "G".repeat(30))}";\n`);
  assert.throws(run, (e: { status: number; stderr: string }) => e.status === 1 && /leak\.ts:1/.test(e.stderr) && !e.stderr.includes("GGGG"), "fails, names the place, never prints the value");
  const d2 = mkdtempSync(join(tmpdir(), "scan-"));
  writeFileSync(join(d2, ".env.example"), `ANTHROPIC_API_KEY=${J("sk-ant-", "E".repeat(30))}\n`);
  assert.equal(scanDir(d2).length, 1, "a real-looking key pasted into .env.example is caught");
});
