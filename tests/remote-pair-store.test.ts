import { pathToFileURL } from "node:url";
// Pairing when remote-devices.json can't be read (locked by antivirus, or damaged): the real POST /api/remote/pair route in a child
// process. Nothing is saved over the file, the phone gets a clear 503, and the code still works once the file is readable again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

test("a devices file that can't be read doesn't burn the pairing code", async () => {
  const root = path.resolve(import.meta.dirname, ".."), d = await mkdtemp(path.join(tmpdir(), "orbit-pair-"));
  await writeFile(path.join(d, "remote-devices.json"), `[{"id": "his phone",`); // damaged
  const code = `
const { S } = await import("@/lib/remote");
const { POST } = await import("@/app/api/remote/pair/route");
S.pair = { code: "123456", expiresAt: Date.now() + 120_000, fails: 0, used: false, userId: "u1" };
const ask = () => POST(new Request("http://127.0.0.1:3000/api/remote/pair", { method: "POST", body: JSON.stringify({ code: "123456" }) }))
  .then(async (r) => [r.status, (await r.json()).error ?? ""], (e) => [0, "threw " + e.message]);
const first = await ask(), used = S.pair.used;
const fs = await import("node:fs/promises");
const file = await fs.readFile(process.env.ORBIT_DATA_DIR + "/remote-devices.json", "utf8");
await fs.writeFile(process.env.ORBIT_DATA_DIR + "/remote-devices.json", "[]"); // readable again
const again = await ask(); // reaches the save; cookies() needs a request scope, so the route throws only after saving
const saved = JSON.parse(await fs.readFile(process.env.ORBIT_DATA_DIR + "/remote-devices.json", "utf8")).length;
console.log(JSON.stringify({ first, used, usedAfter: S.pair.used, file, again: again[1].startsWith("threw") ? "saved, then cookie" : again, saved }));
process.exit(0);`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ORBIT_DATA_DIR: d, REMOTE_SECRET: "x".repeat(48) }, timeout: 60_000 });
  const got = JSON.parse(stdout.trim().split("\n").pop()!);
  assert.equal(got.first[0], 503, `first try: ${JSON.stringify(got.first)}`);
  assert.match(got.first[1], /remote-devices\.json .*The code still works/);
  assert.equal(got.used, false, "the code isn't spent by a failed save");
  assert.equal(got.file, `[{"id": "his phone",`, "the damaged file is left untouched");
  assert.equal(got.saved, 1, "the same code pairs once the file is readable");
  assert.equal(got.usedAfter, true, "...and is spent then");
});
