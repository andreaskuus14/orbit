import { pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Server modules keep process-wide state on globalThis.__orbit*. Two modules using one key for different things break each other
// depending on which loads first (live: Doctor 500 "catch is not a function", study grades failing, pushes during focus blocks).
const root = path.join(import.meta.dirname, "..");
const run = promisify(execFile);

/** Load real modules in a child process, in order, then run `body` (an async function body with the modules as m0, m1...). */
async function inChild(mods: string[], body: string): Promise<string> {
  const code = `${mods.map((m, i) => `const m${i} = await import(${JSON.stringify(pathToFileURL(path.join(root, m)).href)});`).join("\n")}
try { const out = await (async () => { ${body} })(); console.log(JSON.stringify(out)); } catch (e) { console.log(JSON.stringify("THREW " + String(e))); }
process.exit(0);`;
  const env = { ...process.env, ORBIT_DATA_DIR: await mkdtemp(path.join(tmpdir(), "orbit-glob-")) };
  const { stdout } = await run(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, env, timeout: 60_000 });
  return JSON.parse(stdout.trim().split("\n").pop()!);
}

test("no __orbit* global key is declared with two different types (scans src)", async () => {
  const seen = new Map<string, Map<string, string>>(); // key → type → file
  const walk = async (d: string): Promise<string[]> => (await Promise.all((await readdir(d, { withFileTypes: true }))
    .map((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []))).flat();
  for (const f of await walk(path.join(root, "src"))) {
    for (const decl of (await readFile(f, "utf8")).matchAll(/globalThis as unknown as \{([^\n]*)\}/g))
      for (const [, key, type] of decl[1].matchAll(/(__orbit\w+)\??:\s*([^;]+?)(?=;\s*__orbit|;?\s*$)/g)) {
        const types = seen.get(key) ?? new Map<string, string>();
        types.set(type.replace(/\s+/g, ""), path.relative(root, f)); seen.set(key, types);
      }
  }
  const clashes = [...seen].filter(([, t]) => t.size > 1).map(([k, t]) => `${k}: ${[...t.values()].join(" vs ")}`);
  assert.deepEqual(clashes, []);
});

for (const order of [["src/lib/agents.ts", "src/lib/doctor-boot.ts"], ["src/lib/doctor-boot.ts", "src/lib/agents.ts"]]) {
  test(`Doctor boot self-test stays a promise: ${order.map((m) => path.basename(m)).join(" then ")}`, { timeout: 90_000 }, async () => {
    const boot = order.indexOf("src/lib/doctor-boot.ts");
    assert.equal(await inChild(order, `const r = m${boot}.bootSelfTest(); return typeof r?.then === "function" ? "promise" : typeof r;`), "promise");
  });
}

for (const order of [["src/lib/study.ts", "src/lib/clips/study.ts"], ["src/lib/clips/study.ts", "src/lib/study.ts"]]) {
  test(`study cards and STUDIO lessons don't share state: ${order.join(" then ")}`, { timeout: 90_000 }, async () => {
    const s = order.indexOf("src/lib/study.ts"), c = 1 - s;
    // grading a missing card is a no-op; it must not throw, and the clips side must still answer
    assert.equal(await inChild(order, `await m${s}.gradeCard("u", "nope", 3); await m${s}.gradeCard("u", "nope", 3); return m${c}.studyBusy();`), null);
  });
}

for (const order of [["src/lib/life.ts", "src/lib/focus.ts"], ["src/lib/focus.ts", "src/lib/life.ts"]]) {
  test(`LIFE focus timer and focus mode don't share state: ${order.join(" then ")}`, { timeout: 90_000 }, async () => {
    const l = order.indexOf("src/lib/life.ts"), f = 1 - l;
    const got = await inChild(order, `const before = m${l}.liveFocus(); m${f}.focusState();
      await m${l}.setLiveFocus({ plan: 25, phase: "work", endAt: Date.now() + 60000, left: 1, at: Date.now() });
      const s = m${f}.focusState(); return { before, held: Array.isArray(s.held), timer: m${l}.liveFocus()?.phase ?? null };`);
    assert.deepEqual(got, { before: null, held: true, timer: "work" });
  });
}
