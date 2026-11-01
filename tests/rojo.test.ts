import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ISSUES, SOURCE_DIRS, cleanFile, lintSummary, parseSelene, placePath, projectJson, projectName } from "../src/lib/rojo-pure.ts";
import { decide, TIERS, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { EFFECTS, isConsequential } from "../src/lib/approval-pure.ts";
import { STARTS_WORK } from "../src/lib/stop-all-pure.ts";
import { MODULE_ABOUT, MODULE_HINTS } from "../src/lib/core-modules-pure.ts";

test("project folder names are legal on Windows", () => {
  assert.equal(projectName("C:\\Users\\A\\Documents\\Pet Sim.rbxl"), "Pet Sim");
  assert.equal(projectName("/home/a/My:Game?.RBXLX"), "MyGame");
  assert.equal(projectName("C:\\x\\Pet Sim v2. .rbxl"), "Pet Sim v2");
  assert.equal(projectName("C:\\x\\CON.rbxl"), "place-CON");
  assert.equal(projectName("C:\\x\\<>.rbxl"), "place-untitled");
  assert.equal(projectName(`C:\\x\\${"a".repeat(100)}.rbxl`).length, 60);
});

test("place path: quotes from Copy as path are stripped; only .rbxl/.rbxlx", () => {
  assert.equal(placePath('  "C:\\Users\\A\\Pet Sim.rbxl" '), "C:\\Users\\A\\Pet Sim.rbxl");
  assert.equal(placePath("C:\\a.rbxlx"), "C:\\a.rbxlx");
  assert.equal(placePath("C:\\a.rbxm"), null);
  assert.equal(placePath("C:\\a.rbxl\n"), "C:\\a.rbxl"); // trimmed
  assert.equal(placePath("C:\\a\nb.rbxl"), null);
  assert.equal(placePath(42), null);
});

test("project file: script services only, every path in SOURCE_DIRS, Studio objects never deleted", () => {
  const p = JSON.parse(projectJson("Pet Sim"));
  assert.equal(p.name, "Pet Sim");
  assert.equal(p.tree.$className, "DataModel");
  assert.equal(p.tree.Workspace, undefined);
  assert.equal(p.tree.ServerScriptService.$path, "src/ServerScriptService");
  assert.equal(p.tree.StarterPlayer.StarterPlayerScripts.$className, "StarterPlayerScripts");
  const paths: string[] = [];
  const walk = (n: Record<string, unknown>) => { for (const [k, v] of Object.entries(n)) if (k === "$path") paths.push(v as string); else if (v && typeof v === "object") { assert.equal((v as Record<string, unknown>).$path ? (v as Record<string, unknown>).$ignoreUnknownInstances : true, true); walk(v as Record<string, unknown>); } };
  walk(p.tree);
  assert.deepEqual(paths.sort(), [...SOURCE_DIRS].sort());
});

// Shape from selene's json_output.rs (JsonOutput tagged by "type"; codespan 0-based line/column).
const diag = (file: string, line: number, sev: string, code: string, message: string) =>
  JSON.stringify({ type: "Diagnostic", severity: sev, code, message, primary_label: { filename: file, span: { start: 10, start_line: line, start_column: 4, end: 14, end_line: line, end_column: 8 }, message: "" }, notes: [], secondary_labels: [] });
const SAMPLE = [
  diag("src\\ServerScriptService\\ClickerServer.server.luau", 11, "Warning", "unused_variable", "player is defined, but never used"),
  diag("src\\ServerScriptService\\ClickerServer.server.luau", 2, "Error", "undefined_variable", "`coinz` is not defined"),
  diag("./src/StarterPlayer/StarterPlayerScripts/MouthBubbleClient.client.luau", 0, "Warning", "shadowing", "shadowing variable `mouse`"),
  "Results:", // human lines selene may print are skipped
  JSON.stringify({ type: "Summary", errors: 1, warnings: 2, parse_errors: 0 }),
].join("\r\n");

test("selene json2 → issues by file, 1-based lines, sorted; summary counts", () => {
  const r = parseSelene(SAMPLE)!;
  assert.equal(r.total, 3);
  assert.deepEqual([r.errors, r.warnings, r.parseErrors, r.clipped], [1, 2, 0, false]);
  assert.deepEqual(r.files.map((f) => f.file), ["src/ServerScriptService/ClickerServer.server.luau", "src/StarterPlayer/StarterPlayerScripts/MouthBubbleClient.client.luau"]);
  assert.deepEqual(r.files[0].issues.map((i) => [i.line, i.col, i.severity, i.code]), [[3, 5, "error", "undefined_variable"], [12, 5, "warning", "unused_variable"]]);
  assert.equal(r.files[1].issues[0].line, 1);
});

test("selene: plain json (no type), no summary, garbage and crashes", () => {
  const plain = parseSelene(diag("a.luau", 4, "Error", "parse_error", "unexpected token").replace('"type":"Diagnostic",', ""))!;
  assert.deepEqual([plain.total, plain.errors, plain.parseErrors, plain.files[0].issues[0].line], [1, 1, 1, 5]);
  assert.equal(parseSelene("thread 'main' panicked at ..."), null);
  assert.equal(parseSelene(""), null);
  assert.equal(parseSelene('{"type":"Summary","errors":0,"warnings":0,"parse_errors":0}')!.total, 0); // clean project
  const many = Array.from({ length: MAX_ISSUES + 5 }, (_, i) => diag("b.luau", i, "Warning", "x", "m")).join("\n");
  const r = parseSelene(many)!;
  assert.deepEqual([r.total, r.files[0].issues.length, r.clipped], [MAX_ISSUES + 5, MAX_ISSUES, true]);
});

test("cleanFile and the CORE summary: errors first, file:line, capped", () => {
  assert.equal(cleanFile(".\\src\\a.luau"), "src/a.luau");
  const r = parseSelene(SAMPLE)!;
  r.files[0].issues[0].text = "  coinz += 1";
  const s = lintSummary("Pet Sim", r, 2);
  assert.match(s, /^Selene found 3 issues in "Pet Sim" \(1 error, 2 warnings\) across 2 files:/);
  assert.match(s.split("\n")[1], /^- src\/ServerScriptService\/ClickerServer\.server\.luau:3 error \[undefined_variable\]: `coinz` is not defined \| coinz \+= 1$/);
  assert.match(s, /\(1 more in GAME DEV/);
  assert.equal(lintSummary("X", parseSelene('{"type":"Summary","errors":0,"warnings":0,"parse_errors":0}')!), 'Selene found no issues in "X".');
});

const ctx = (o: Partial<PolicyCtx> = {}): PolicyCtx => ({ stopAll: false, attach: false, pins: false, steps: [], question: "export my pet sim scripts", ...o });
test("CORE tools: export is a local T2 write halted by Stop-all; lint is a T0 read; routed by hints", () => {
  assert.deepEqual([TIERS.roblox_export, TIERS.roblox_lint], ["T2", "T0"]);
  assert.deepEqual([EFFECTS.roblox_export, EFFECTS.roblox_lint], ["reversible", "read"]);
  assert.ok(!isConsequential("roblox_export") && STARTS_WORK.includes("roblox_export") && !STARTS_WORK.includes("roblox_lint"));
  assert.equal(decide("roblox_export", { place: "C:\\a.rbxl" }, ctx()).allow, true);
  assert.equal(decide("roblox_export", { place: "C:\\a.rbxl" }, ctx({ stopAll: true })).allow, false);
  assert.equal(decide("roblox_lint", {}, ctx({ stopAll: true })).allow, true);
  for (const q of ["check my roblox code with selene", "lint the pet sim", "export the scripts from PetSim.rbxl", "kontrolli koodi"]) assert.ok(MODULE_HINTS.ROBLOXFILES.test(q), q);
  assert.ok(!MODULE_HINTS.ROBLOXFILES.test("what's on my calendar today") && MODULE_ABOUT.ROBLOXFILES);
});
