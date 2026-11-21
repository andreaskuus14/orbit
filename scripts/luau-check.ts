// Luau harness for ORBIT's generated Roblox code (GAME DEV UI kit). Runs with the free Luau CLI (luau-lang/luau, MIT):
//   npm run check:luau                 uses `luau` / `luau-compile` on PATH, or LUAU_BIN_DIR=<folder with them>
//   npm run check:luau -- --require    fails instead of skipping when the CLI is missing (CI)
// 1. Every generated UI kit module parses (luau-compile; Roblox globals like Instance are not run, only compiled).
// 2. Kit.Abbrev, the coin label players see, is extracted from the generated module and run in real Luau on thousands of
//    fast-check numbers (MIT): it must print exactly what the TypeScript abbrev() prints (the preview ORBIT shows him).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { DEFAULT_KIT, KIT_FONTS, abbrev, kitLuau, type UiKit } from "../src/lib/gamedev-uikit-pure.ts";

const required = process.argv.includes("--require");
const bin = (name: string) => (process.env.LUAU_BIN_DIR ? join(process.env.LUAU_BIN_DIR, name) : name);
const run = (name: string, args: string[]) => spawnSync(bin(name), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const probe = run("luau", ["-h"]);
if (probe.error) {
  const msg = "luau CLI not found: install it from https://github.com/luau-lang/luau/releases (MIT) or set LUAU_BIN_DIR";
  if (required) { console.error(msg); process.exit(1); }
  console.log(`skip: ${msg}`); process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "orbit-luau-"));
let failed = 0;
try {
  // 1. generated modules parse: the default kit, every font, and odd names/currencies (quotes, backslashes, control chars)
  const kits: [UiKit, string][] = [[DEFAULT_KIT, "Pet Sim"], ...KIT_FONTS.map((font): [UiKit, string] => [{ ...DEFAULT_KIT, font }, "x"]),
    [{ ...DEFAULT_KIT, currency: 'Gems "\\ \n', icon: "rbxassetid://123" }, 'My "game"\n-- ]]']];
  kits.forEach(([k, g], i) => {
    const f = join(dir, `kit${i}.luau`);
    writeFileSync(f, kitLuau(k, g));
    const r = run("luau-compile", ["--binary", f]);
    if (r.status !== 0) { failed++; console.error(`kit ${i} (${k.font}) does not compile:\n${r.stderr || r.stdout}`); }
  });

  // 2. Kit.Abbrev in Luau == abbrev() in TypeScript
  const src = kitLuau(DEFAULT_KIT, "x"), m = /function Kit\.Abbrev[\s\S]*?\nend\n/.exec(src);
  if (!m) throw new Error("Kit.Abbrev not found in the generated module");
  const nums = [0, 1, -1, 999, 1000, 1049, 1099, 1100, 999_999, 1_000_000, 1_234_567, 999_999_999, 1e12, 999.9e12, 1e15, -1234,
    ...fc.sample(fc.oneof(fc.integer({ min: -2_000_000, max: 2_000_000 }), fc.integer({ min: 0, max: 2 ** 52 }),
      fc.integer({ min: 1, max: 999 }).chain((h) => fc.constantFrom(h * 1e3, h * 1e6, h * 1e9, h * 1e12, h * 1e3 + 999, h * 1e6 - 1))), { numRuns: 5000, seed: 42 })];
  const file = join(dir, "abbrev.luau");
  writeFileSync(file, `local Kit = {}\n${m[0]}\nlocal xs = { ${nums.map((n) => n.toString()).join(", ")} }\nfor _, n in ipairs(xs) do print(Kit.Abbrev(n)) end\n`);
  const r = run("luau", [file]);
  if (r.status !== 0) throw new Error(`luau failed: ${r.stderr}`);
  const got = r.stdout.trimEnd().split("\n");
  let bad = 0;
  nums.forEach((n, i) => { if (got[i] !== abbrev(n)) { if (bad++ < 10) console.error(`Kit.Abbrev(${n}): Luau "${got[i]}" vs TypeScript "${abbrev(n)}"`); } });
  if (bad) failed++;
  console.log(`${kits.length} generated kits compiled; Kit.Abbrev matched TypeScript on ${nums.length - bad}/${nums.length} numbers`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
