import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { readStore, readStoreSync, StoreUnreadable, writeStore } from "../src/lib/safe-file.ts";

const root = path.join(import.meta.dirname, "..");
const tmp = () => mkdtemp(path.join(tmpdir(), "orbit-safe-"));

test("only a missing file reads as empty; damaged or unreadable throws", async () => {
  const d = await tmp();
  assert.equal(await readStore(path.join(d, "none.json")), "");
  assert.equal(readStoreSync(path.join(d, "none.json")), "");
  await writeFile(path.join(d, "bad.json"), '{"devices": [');
  await assert.rejects(readStore(path.join(d, "bad.json")), StoreUnreadable);
  assert.throws(() => readStoreSync(path.join(d, "bad.json")), StoreUnreadable);
  await mkdir(path.join(d, "locked.json")); // EISDIR: stands in for a locked/unreadable file (root ignores chmod)
  await assert.rejects(readStore(path.join(d, "locked.json")), /couldn't be read \(EISDIR\)/);
  await writeFile(path.join(d, "ok.json"), '{"a":1}');
  assert.equal(await readStore(path.join(d, "ok.json")), '{"a":1}');
});

test("an interrupted write never leaves a half file: killed mid-writes, the store is always one whole version", { timeout: 60_000 }, async () => {
  const d = await tmp(), f = path.join(d, "store.json");
  await writeStore(f, JSON.stringify({ v: "A", pad: "a".repeat(400_000) }));
  for (let round = 0; round < 5; round++) {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e",
      `const { writeStore } = await import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib/safe-file.ts")).href)});
       for (let i = 0; ; i++) await writeStore(${JSON.stringify(f)}, JSON.stringify({ v: i % 2 ? "A" : "B", pad: (i % 2 ? "a" : "b").repeat(400_000) }));`]);
    const exited = new Promise((r) => child.once("exit", r));
    await new Promise((r) => setTimeout(r, 150 + round * 70));
    child.kill("SIGKILL");
    await exited;
    const v = JSON.parse(await readFile(f, "utf8")); // never empty or truncated
    assert.ok(v.v === "A" || v.v === "B");
    assert.equal(v.pad.length, 400_000);
  }
  // a leftover tmp from the killed writer doesn't count as the store
  assert.ok((await readdir(d)).includes("store.json"));
});

// Real stores in a child process: each read-modify-write must refuse to save over a damaged or locked file.
test("stores never save an empty store over a damaged or locked file", { timeout: 90_000 }, async () => {
  for (const kind of ["damaged", "locked"] as const) {
    const d = await tmp();
    const files = ["remote-devices.json", "plugins.json", "studio-fail-ack.json", "night.json", "economy.json", "focus.json", "autonomy.json", "plugin-pending.json", "dayplan.json", "authority.json"];
    for (const n of files) {
      if (kind === "locked") await mkdir(path.join(d, n));
      else await writeFile(path.join(d, n), `{"his data": [1, 2,`);
    }
    const code = `const L = (m) => import(${JSON.stringify(pathToFileURL(path.join(root, "src/lib")).href)} + "/" + m);
const tries = {
  devices: async () => (await L("remote.ts")).updateDevices(() => []),
  plugins: async () => (await L("plugins.ts")).updatePlugins(() => []),
  failAck: async () => (await L("clips/fail-ack.ts")).addFailAck(["k"]),
  night: async () => (await L("night.ts")).setNightSettings({ enabled: false }),
  economy: async () => (await L("economy.ts")).saveEconomy("u", "t", "v"),
  focus: async () => (await L("focus.ts")).dismissSummary(),
  autonomy: async () => (await L("autonomy.ts")).snoozeArea("studio-publish"),
  pending: async () => (await L("plugins.ts")).discardPending("x"),
  dayplan: async () => (await L("dayplan.ts")).setDone("x", true),
  authority: async () => (await L("authority.ts")).updateAuthority(() => ({ out: null, state: { grants: [], modes: {} } })),
};
const out = {};
for (const [k, f] of Object.entries(tries)) out[k] = await f().then(() => "saved", (e) => e?.code === "ORBIT_STORE_UNREADABLE" ? "refused" : "error " + e?.message);
const a = await L("autonomy.ts");
out.levels = Object.entries(a.autonomyLevels()).filter(([, l]) => l === "do" || l === "auto").map(([k]) => k).join(",") || "none on its own";
out.shown = { pending: (await (await L("plugins.ts")).listPending()).length, plan: await (await L("dayplan.ts")).currentPlan(), problem: !!a.autonomyState().unreadable };
console.log(JSON.stringify(out)); process.exit(0);`;
    const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
      "--input-type=module", "-e", code], { cwd: root, env: { ...process.env, ORBIT_DATA_DIR: d }, timeout: 80_000 });
    const got = JSON.parse(stdout.trim().split("\n").pop()!);
    assert.deepEqual(got, { devices: "refused", plugins: "refused", failAck: "refused", night: "refused", economy: "refused", focus: "refused", autonomy: "refused",
      pending: "refused", dayplan: "refused", authority: "refused", levels: "none on its own", shown: { pending: 0, plan: null, problem: true } }, kind); // display reads show empty, never 500
    if (kind === "damaged") for (const n of files) assert.equal(await readFile(path.join(d, n), "utf8"), `{"his data": [1, 2,`, `${n} untouched`);
  }
});

test("simultaneous writes of one file never tear it, and leave no tmp files", async () => {
  const { writeStore: w } = await import("../src/lib/safe-file.ts");
  const d = await tmp(), f = path.join(d, "s.json");
  await Promise.all(Array.from({ length: 40 }, (_, i) => w(f, JSON.stringify({ i, pad: String(i).repeat(50_000) }))));
  const v = JSON.parse(await readFile(f, "utf8"));
  assert.equal(v.i, 39); // queued in call order: the last write wins
  assert.deepEqual((await readdir(d)).sort(), ["s.json"]);
});

test("updateStore: simultaneous read-modify-writes keep every change; an unreadable file is never saved over", async () => {
  const { updateStore } = await import("../src/lib/safe-file.ts");
  const d = await tmp(), f = path.join(d, "n.json");
  await Promise.all(Array.from({ length: 25 }, () => updateStore(f, (t) => ({ text: JSON.stringify({ n: (t ? JSON.parse(t).n : 0) + 1 }), out: null }))));
  assert.equal(JSON.parse(await readFile(f, "utf8")).n, 25);
  await writeFile(f, "{broken");
  await assert.rejects(updateStore(f, () => ({ text: "{}", out: null })), StoreUnreadable);
  assert.equal(await readFile(f, "utf8"), "{broken");
});
