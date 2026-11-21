import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSelene, projectJson } from "../src/lib/rojo-pure.ts";
import {
  EDIT_PREFIX, backupFile, buildArgs, checkVerdict, connectRefusal, explainRojoLog, jsonValues, lintTargets, mergeProjects, parseConnected, parseLog,
  parseRojoInfo, parseStylua, pickUndo, readProjectFile, robloxWriteBlocked, scriptKind, scriptPath, seleneArgs, serveArgs, serveWords,
  styluaCheckArgs, styluaFormatArgs, undoSubject,
} from "../src/lib/rojo-sync-pure.ts";
import { decide, TIERS, UNTRUSTED, EGRESS_CLASS, TOOL_AREA, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { EFFECTS, isConsequential } from "../src/lib/approval-pure.ts";
import { STARTS_WORK } from "../src/lib/stop-all-pure.ts";
import { MODULE_HINTS } from "../src/lib/core-modules-pure.ts";

test("command lines: serve is always loopback + fixed port; build/stylua/selene fixed", () => {
  assert.deepEqual(serveArgs(), ["serve", "default.project.json", "--address", "127.0.0.1", "--port", "34872"]);
  assert.deepEqual(buildArgs("backups/a.rbxl"), ["build", "default.project.json", "--output", "backups/a.rbxl"]);
  assert.deepEqual(seleneArgs(["src", "lib"]), ["--display-style", "json2", "src", "lib"]);
  assert.deepEqual(styluaCheckArgs(["src"]), ["--check", "--output-format=json", "src"]);
  assert.deepEqual(styluaFormatArgs(["-rf.luau"]), ["--", "-rf.luau"]); // a file name can't become an option
  assert.equal(backupFile("Pet Sim: v2", { y: 2026, mo: 3, d: 7, h: 9, mi: 5 }), "backups/Pet-Sim-v2-2026-03-07-0905.rbxl");
  assert.equal(backupFile("???", { y: 2026, mo: 11, d: 21, h: 14, mi: 30 }), "backups/place-2026-11-21-1430.rbxl");
});

test("project file: ORBIT's own one reads back with every source folder", () => {
  const pf = readProjectFile(projectJson("Pet Sim"))!;
  assert.equal(pf.name, "Pet Sim");
  assert.ok(pf.paths.includes("src/ServerScriptService") && pf.paths.includes("src/StarterPlayer/StarterPlayerScripts"));
  assert.deepEqual(pf.problems, []);
  assert.deepEqual(lintTargets(pf.paths), ["src"]);
});

test("project file: his own layout, optional paths, escapes, LAN address, junk", () => {
  const pf = readProjectFile("\uFEFF" + JSON.stringify({
    name: "Game", serveAddress: "0.0.0.0",
    tree: { $className: "DataModel", ReplicatedStorage: { Shared: { $path: "./lib/shared/" }, Pkgs: { $path: { optional: "Packages" } } },
      ServerScriptService: { $path: "server" }, Evil: { $path: "../outside" }, Abs: { $path: "C:\\Windows" } },
  }))!;
  assert.deepEqual(pf.paths, ["lib/shared", "Packages", "server"]);
  assert.equal(pf.problems.length, 3);
  assert.match(pf.problems.join(" "), /0\.0\.0\.0.*127\.0\.0\.1/);
  assert.deepEqual(lintTargets(pf.paths), ["Packages", "lib", "server"]);
  assert.equal(readProjectFile("not json"), null);
  assert.equal(readProjectFile('{"name":"x"}'), null);
  assert.match(readProjectFile('{"tree":{"$className":"DataModel"}}')!.problems[0], /nothing to sync/);
});

test("connect: only real project folders", () => {
  const w = { home: "C:\\Users\\A", orbit: "C:\\Users\\A\\orbit", win: true };
  assert.equal(connectRefusal("C:\\Users\\A\\Documents\\PetSim", w), "");
  assert.equal(connectRefusal("D:/Games/Pet Sim/", w), "");
  assert.match(connectRefusal("PetSim", w), /full path/);
  assert.match(connectRefusal("C:\\", w), /whole drive/);
  assert.match(connectRefusal("c:\\users\\a\\", w), /user folder/);
  assert.match(connectRefusal("C:\\Users\\A\\ORBIT\\src", w), /ORBIT's own/);
  assert.match(connectRefusal("C:\\Program Files\\Roblox", w), /system folder/);
  assert.match(connectRefusal("C:\\a\nb", w), /full path/);
  const l = { home: "/home/a", orbit: "/home/a/orbit", win: false };
  assert.equal(connectRefusal("/home/a/games/pet", l), "");
  assert.match(connectRefusal("/etc/x", l), /system/);
  assert.match(connectRefusal("/", l), /drive/);
  assert.deepEqual(parseConnected('{"dirs":["C:\\\\a"," C:\\\\a ",3,""]}'), ["C:\\a"]);
  assert.deepEqual(parseConnected("garbage"), []);
});

test("projects: connected folders join exported ones without clashing names", () => {
  const out = mergeProjects([{ name: "Pet", dir: "C:\\R\\Pet", at: "2026-11-01" }], [
    { name: "Pet", dir: "D:\\Pet", at: "2026-11-20" }, { name: "pet", dir: "E:\\pet", at: "2026-11-02" }, { name: "Pet", dir: "c:\\r\\pet", at: "2026-11-21" },
  ]);
  assert.deepEqual(out.map((p) => [p.name, !!p.connected]), [["Pet (2)", true], ["pet (3)", true], ["Pet", false]]);
});

test("script paths CORE may write: inside a $path, .luau/.lua, nothing Windows can't store", () => {
  const roots = ["src/ServerScriptService", "src/ReplicatedStorage", "lib/Main.luau"];
  assert.equal(scriptPath("src\\ServerScriptService\\Coins.server.luau", roots), "src/ServerScriptService/Coins.server.luau");
  assert.equal(scriptPath("./src/ReplicatedStorage/Pets/Data.lua", roots), "src/ReplicatedStorage/Pets/Data.lua");
  assert.equal(scriptPath("lib/Main.luau", roots), "lib/Main.luau");
  for (const bad of ["src/ServerScriptService/../../x.luau", "/src/ServerScriptService/a.luau", "C:/src/ServerScriptService/a.luau",
    "src/ServerScriptService/a.txt", "src/Workspace/a.luau", "src/ServerScriptService/a.luau:evil", "src/ServerScriptService/CON.luau",
    "src/ServerScriptService/x?.luau", "src/ServerScriptService /a.luau", "src/ServerScriptServiceX/a.luau", 7])
    assert.equal(scriptPath(bad, roots), null, String(bad));
  assert.deepEqual(["a.server.luau", "a.client.lua", "a.luau"].map(scriptKind), ["Script", "LocalScript", "ModuleScript"]);
});

test("StyLua json output: unformatted files and parse errors; crashes", () => {
  assert.equal(jsonValues('x [{"a":"]"}][{"b":1}] {"c":"\\"}"}').length, 3);
  const out = [JSON.stringify({ file: "src\\A.luau", mismatches: [] }), JSON.stringify({ file: "./src/B.luau", mismatches: [] })].join("\n");
  const err = JSON.stringify([{ type: "parse_error", message: "unexpected token `end`", filename: "src/C.luau", location: { start_line: 4, start_column: 2 } }])
    + JSON.stringify([{ type: "parse_error", message: "unclosed string", filename: "src/D.luau", location: {} }]);
  const s = parseStylua(out, err, 2)!;
  assert.deepEqual(s.unformatted, ["src/A.luau", "src/B.luau"]);
  assert.deepEqual(s.parseErrors.map((e) => [e.file, e.line, e.col]), [["src/C.luau", 4, 2], ["src/D.luau", 1, 1]]);
  assert.deepEqual(parseStylua("", "", 0), { unformatted: [], parseErrors: [], other: "" });
  assert.equal(parseStylua("", "", 2), null);
  assert.match(parseStylua("", "error: unknown option --foo", 2)!.other, /unknown option/);
});

const diag = (file: string, sev: string, code: string, message: string) => JSON.stringify({ type: "Diagnostic", severity: sev, code, message, primary_label: { filename: file, span: { start_line: 2, start_column: 0 } } });
test("check before sync: Selene errors and broken code block; hints and tidiness don't", () => {
  const warnOnly = parseSelene(diag("src/a.luau", "Warning", "unused_variable", "x is never used"))!;
  const clean = { unformatted: ["src/a.luau"], parseErrors: [], other: "" };
  const v1 = checkVerdict(warnOnly, clean);
  assert.equal(v1.blocking, false);
  assert.equal(v1.text, "Code check: 1 hint (they don't stop sync), 1 file not tidy (press Format code).");
  const v2 = checkVerdict(parseSelene(diag("src/a.luau", "Error", "undefined_variable", "`coinz` is not defined"))!, { unformatted: [], parseErrors: [{ file: "src/b.luau", line: 3, col: 1, message: "unexpected token" }], other: "" });
  assert.equal(v2.blocking, true);
  assert.deepEqual(v2.rows, ["src/a.luau line 3: `coinz` is not defined", "src/b.luau line 3: the code doesn't read as Luau (unexpected token)"]);
  assert.match(v2.text, /^Code check: 2 mistakes to fix before syncing/);
  const empty = parseSelene('{"type":"Summary","errors":0,"warnings":0,"parse_errors":0}')!;
  assert.equal(checkVerdict(empty, { unformatted: [], parseErrors: [], other: "" }).text, "Code check: no mistakes found and the code is tidy.");
  assert.match(checkVerdict(empty, null).text, /StyLua didn't run/);
});

test("Rojo status in plain words", () => {
  const info = parseRojoInfo(JSON.stringify({ serverVersion: "7.7.1", protocolVersion: 4, projectName: "Pet Sim", sessionId: "abc", rootInstanceId: "x" }));
  assert.deepEqual(info, { project: "Pet Sim", version: "7.7.1" });
  assert.equal(parseRojoInfo("<html>"), null);
  // Rojo 7.7's real answer is MessagePack (captured from rojo 7.7.1 serve, trimmed): fixmap with fixstr keys
  const enc = (s: string) => [0xa0 | s.length, ...new TextEncoder().encode(s)];
  const mp = new Uint8Array([0x84, ...enc("sessionId"), ...enc("1b41ce89"), ...enc("serverVersion"), ...enc("7.7.1"), ...enc("protocolVersion"), 0x04, ...enc("projectName"), 0xd9, 7, ...new TextEncoder().encode("Pet Sim")]);
  assert.deepEqual(parseRojoInfo(mp), { project: "Pet Sim", version: "7.7.1" });
  assert.equal(parseRojoInfo(new Uint8Array([0x81, ...enc("serverVersion"), ...enc("7")])), null); // no session: not Rojo
  assert.equal(parseRojoInfo('{"serverVersion":"1"}'), null);
  assert.equal(serveWords({ running: true, ours: "Pet Sim", info }).state, "on");
  assert.match(serveWords({ running: true, ours: "Pet Sim", info }).text, /Live sync is on for "Pet Sim" \(Rojo 7\.7\.1\).*Plugins → Rojo → Connect/);
  assert.equal(serveWords({ running: false, ours: "Pet Sim", info: null }).state, "starting");
  assert.match(serveWords({ running: true, ours: null, info }).text, /outside ORBIT for "Pet Sim".*can't stop it/);
  assert.deepEqual(serveWords({ running: false, ours: null, info: null }), { state: "off", text: "Live sync is off." });
  const crashed = serveWords({ running: false, ours: null, info: null, lastExit: "Error: Only one usage of each socket address (protocol/network address/port) is normally permitted. (os error 10048)" });
  assert.equal(crashed.state, "stopped");
  assert.match(crashed.text, /Port 34872 is already taken/);
  assert.match(explainRojoLog("[ERROR rojo] Rojo project could not be loaded: unknown field `$pth` at line 4"), /default\.project\.json has a mistake/);
  assert.match(explainRojoLog("error: Access is denied. (os error 5)"), /access denied/);
  assert.match(explainRojoLog("thread 'main' panicked at foo"), /^Rojo stopped: thread 'main' panicked/);
  assert.equal(explainRojoLog("Rojo server listening:\n  Address: 127.0.0.1"), "");
});

test("undo picks ORBIT's newest edit that isn't undone; never his own commits", () => {
  const log = parseLog([
    "aaaaaaaaaaaa\x1fUndo ORBIT edit cccccccccc: change src/x.luau",
    "bbbbbbbbbbbb\x1fSnapshot of your own changes (before an ORBIT edit)",
    "cccccccccccc\x1fORBIT edit: change src/x.luau",
    "dddddddddddd\x1fmy own fix",
    "eeeeeeeeeeee\x1fORBIT edit: add src/y.luau",
    "not a line",
  ].join("\n"));
  assert.equal(log.length, 5);
  assert.equal(pickUndo(log)?.hash, "eeeeeeeeeeee");
  assert.equal(pickUndo(log.slice(0, 4)), null);
  assert.equal(pickUndo(parseLog("ffffffffffff\x1fmy own work")), null);
  const c = { hash: "0123456789abcdef", subject: `${EDIT_PREFIX}add src/a.luau` };
  assert.equal(undoSubject(c), "Undo ORBIT edit 0123456789: add src/a.luau");
  assert.equal(pickUndo([{ hash: "9999999999", subject: undoSubject(c) }, c]), null);
});

const ctx = (q: string, o: Partial<PolicyCtx> = {}): PolicyCtx => ({ stopAll: false, attach: false, pins: false, steps: [], question: q, ...o });
test("CORE tools: reads are T0, writes T2 + git-reversible, halted by Stop-all, only on his ask", () => {
  assert.deepEqual(["roblox_files", "roblox_read", "roblox_write", "roblox_undo"].map((t) => TIERS[t]), ["T0", "T0", "T2", "T2"]);
  assert.deepEqual(["roblox_files", "roblox_read", "roblox_write", "roblox_undo"].map((t) => EFFECTS[t]), ["read", "read", "reversible", "reversible"]);
  for (const t of ["roblox_write", "roblox_undo"]) {
    assert.ok(!isConsequential(t) && STARTS_WORK.includes(t) && TOOL_AREA[t] === "operator-build" && EGRESS_CLASS[t] === "none", t);
    assert.equal(decide(t, { file: "src/ServerScriptService/a.server.luau", content: "print(1)" }, ctx("fix the coin script")).allow, true);
    assert.equal(decide(t, {}, ctx("fix the coin script", { stopAll: true })).allow, false);
    assert.equal(decide(t, {}, ctx("what's in my coin script?")).allow, false);
  }
  assert.equal(decide("roblox_undo", {}, ctx("võta see muudatus tagasi")).allow, true);
  assert.equal(decide("roblox_read", {}, ctx("x", { stopAll: true })).allow, true);
  assert.ok(UNTRUSTED.includes("roblox_read")); // free-model code can hold injected text
  assert.equal(robloxWriteBlocked("paranda mündi skript"), "");
  for (const q of ["fix my coin script", "write a server script that gives coins", "undo that edit", "kontrolli koodi"]) assert.ok(MODULE_HINTS.ROBLOXFILES.test(q), q);
});

test("setup pins StyLua and installs the Studio plugin; rokit.toml has all three tools", () => {
  const toml = readFileSync(new URL("../tools/roblox/rokit.toml", import.meta.url), "utf8");
  for (const t of ["rojo-rbx/rojo@", "Kampfkarren/selene@", "JohnnyMorganz/StyLua@"]) assert.ok(toml.includes(t), t);
  const ps = readFileSync(new URL("../tools/roblox/setup.ps1", import.meta.url), "utf8");
  assert.match(ps, /rojo @\("plugin", "install"\)/);
  assert.match(ps, /stylua @\("--version"\)/);
});
