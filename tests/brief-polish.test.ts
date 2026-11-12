import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// brief.ts loaded for real (child process, like tests/briefing-crash-policy.test.ts) with a fake model and a fake Supabase.
const root = path.resolve(import.meta.dirname, "..");
const run = (code: string, dir: string) => promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
  "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ORBIT_DATA_DIR: dir }, timeout: 60_000 }).then((r) => r.stdout.trim());
const PRE = `const { polishOnce } = await import("@/lib/brief"); const { setBriefLife } = await import("@/lib/brief");
const sb = { from: () => ({ insert: async () => ({ error: null }) }) };
const b = { day: "2026-11-12", greeting: "Hi", items: [{}], spoken: "Plain words." };`;

test("two concurrent first reads make one model call and get the same words", async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-brief-"));
  const out = await run(`${PRE}
let calls = 0;
const ask = async () => { calls++; await new Promise((r) => setTimeout(r, 100)); return { text: "Polished plain words " + (calls === 1 ? "one" : "many"), inputTokens: 1, outputTokens: 1 }; };
const [x, y] = await Promise.all([polishOnce(sb, "u1", b, ask), polishOnce(sb, "u1", b, ask)]);
console.log(JSON.stringify({ calls, same: JSON.stringify(x) === JSON.stringify(y), x }));`, d);
  const r = JSON.parse(out);
  assert.equal(r.calls, 1);
  assert.ok(r.same);
  assert.match(r.x.spoken, /^Polished plain words one/);
});

test("a corrupt brief.json is not overwritten: no model call, file kept; a missing one is just empty", async () => {
  const d = await mkdtemp(path.join(tmpdir(), "orbit-brief-"));
  await writeFile(path.join(d, "brief.json"), '{"users":{"u1":{"life":true}'); // cut off
  const out = await run(`${PRE}
let calls = 0; const ask = async () => { calls++; return { text: "x", inputTokens: 1, outputTokens: 1 }; };
const r = await polishOnce(sb, "u1", b, ask);
const life = await setBriefLife("u1", false).then(() => "wrote", () => "refused");
console.log(JSON.stringify({ r, calls, life }));`, d);
  assert.deepEqual(JSON.parse(out), { r: null, calls: 0, life: "refused" });
  assert.equal(await readFile(path.join(d, "brief.json"), "utf8"), '{"users":{"u1":{"life":true}');

  const d2 = await mkdtemp(path.join(tmpdir(), "orbit-brief-"));
  const ok = await run(`${PRE}
await setBriefLife("u1", true); console.log("ok");`, d2);
  assert.equal(ok, "ok");
  assert.equal(JSON.parse(await readFile(path.join(d2, "brief.json"), "utf8")).users.u1.life, true);
});
