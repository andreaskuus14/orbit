import { test } from "node:test";
import assert from "node:assert/strict";
import { askLine, CONFIRM_MS, confirmAllowed, confirmReply, insideFolders, normPath, parseApps, parseFolders, PC_ACTIONS, PC_LEVEL, pcDecide, renameTarget, type Pending } from "../src/lib/pc-policy-pure.ts";

const folders = ["C:\\Users\\me\\Games", "D:\\Renders"];
const ctx = { stopAll: false, folders };

test("paths: normalized, inside connected folders only, no climbing out", () => {
  assert.equal(normPath("C:\\Users\\Me\\Games\\"), "c:/users/me/games");
  assert.equal(normPath("relative\\x"), null);
  assert.equal(normPath("C:\\Users\\me\\Games\\..\\..\\Windows"), null);
  assert.ok(insideFolders("c:/users/me/games/pet sim/src/a.lua", folders));
  assert.ok(insideFolders("D:\\Renders", folders));
  assert.ok(!insideFolders("C:\\Users\\me\\GamesX\\a.txt", folders)); // prefix of a name is not inside
  assert.ok(!insideFolders("C:\\Users\\me\\Documents\\a.txt", folders));
});

test("ORBIT_PC_FOLDERS never connects system folders, drive roots or AppData", () => {
  assert.deepEqual(parseFolders("C:\\Users\\me\\Games; C:\\Windows ;C:\;C:\\Program Files\\X;C:\\Users\\me\\AppData\\Roaming;relative"), ["C:\\Users\\me\\Games"]);
  assert.deepEqual(parseFolders(undefined), []);
  assert.deepEqual(parseApps('{"Godot":"C:\\\\Godot\\\\godot.exe","bad":3}'), { godot: "C:\\Godot\\godot.exe" });
  assert.deepEqual(parseApps("not json"), {});
});

test("level 1 runs now: known apps, reads, tasks, media keys", () => {
  assert.deepEqual(pcDecide({ action: "open_app", args: { app: "VS Code" } }, ctx), { run: "now", level: 1, args: { app: "vs code", target: "code" }, summary: "open vs code" });
  assert.equal(pcDecide({ action: "open_app", args: { app: "C:\\evil.exe" } }, ctx).run, "refuse"); // no arbitrary programs
  assert.equal(pcDecide({ action: "open_app", args: { app: "godot" } }, { ...ctx, apps: { godot: "C:\\godot.exe" } }).run, "now");
  assert.equal(pcDecide({ action: "read_file", args: { path: "C:\\Users\\me\\Games\\notes.txt" } }, ctx).run, "now");
  assert.equal(pcDecide({ action: "read_file", args: { path: "C:\\Users\\me\\.ssh\\id_rsa" } }, ctx).run, "refuse");
  assert.equal(pcDecide({ action: "run_task", args: { folder: "C:\\Users\\me\\Games\\site", task: "test" } }, ctx).run, "now");
  assert.equal(pcDecide({ action: "run_task", args: { folder: "C:\\Users\\me\\Games\\site", task: "rm -rf /" } }, ctx).run, "refuse");
  assert.equal(pcDecide({ action: "media_key", args: { key: "play_pause" } }, ctx).run, "now");
  assert.equal(pcDecide({ action: "media_key", args: { key: "shutdown" } }, ctx).run, "refuse");
});

test("level 2 runs with a snapshot; both ends inside connected folders", () => {
  const mv = pcDecide({ action: "move_file", args: { from: "C:\\Users\\me\\Games\\a.png", to: "D:\\Renders\\a.png" } }, ctx);
  assert.equal(mv.run, "snapshot"); assert.equal(mv.level, 2);
  assert.equal(pcDecide({ action: "move_file", args: { from: "C:\\Users\\me\\Games\\a.png", to: "C:\\Temp\\a.png" } }, ctx).run, "refuse");
  const rn = pcDecide({ action: "rename_file", args: { from: "C:\\Users\\me\\Games\\a.png", name: "b.png" } }, ctx);
  assert.equal(rn.run, "snapshot"); assert.equal(rn.run === "snapshot" && rn.args.to, "C:\\Users\\me\\Games\\b.png");
  assert.equal(pcDecide({ action: "rename_file", args: { from: "C:\\Users\\me\\Games\\a.png", name: "..\\..\\x" } }, ctx).run, "refuse");
  assert.equal(renameTarget("C:\\a\\b.txt", "c.txt"), "C:\\a\\c.txt");
  assert.equal(renameTarget("C:\\a\\b.txt", "x/y"), "");
  assert.equal(pcDecide({ action: "code_edit", args: { repo: "C:\\Users\\me\\Games\\pet", file: "src/a.lua", find: "x = 1", replace: "x = 2" } }, ctx).run, "snapshot");
  assert.equal(pcDecide({ action: "code_edit", args: { repo: "C:\\Users\\me\\Games\\pet", file: "..\\..\\a.lua", find: "x" } }, ctx).run, "refuse");
});

test("level 3 waits for his OK; never deletes a connected folder itself", () => {
  const del = pcDecide({ action: "delete_file", args: { path: "D:\\Renders\\old.mp4" } }, ctx);
  assert.equal(del.run, "confirm"); assert.equal(del.run === "confirm" && del.click, false);
  assert.equal(pcDecide({ action: "delete_file", args: { path: "D:\\Renders" } }, ctx).run, "refuse");
  assert.equal(pcDecide({ action: "install_app", args: { id: "Mozilla.Firefox" } }, ctx).run, "confirm");
  assert.equal(pcDecide({ action: "install_app", args: { id: "x; del C:\\" } }, ctx).run, "refuse");
  assert.equal(pcDecide({ action: "system_setting", args: { setting: "dark_mode", value: "on" } }, ctx).run, "confirm");
});

test("sends, posts, spends and logins are never PC actions; Stop-all refuses everything", () => {
  for (const a of ["send", "publish", "spend", "login"]) {
    const v = pcDecide({ action: a, args: {} }, ctx);
    assert.equal(v.run, "refuse", a);
    assert.equal(PC_LEVEL[a as keyof typeof PC_LEVEL].click, true, a);
  }
  for (const a of PC_ACTIONS) assert.equal(pcDecide({ action: a, args: { app: "notepad", path: "D:\\Renders\\a", key: "mute" } }, { ...ctx, stopAll: true }).run, "refuse", a);
  assert.equal(pcDecide({ action: "format_disk", args: {} }, ctx).run, "refuse");
  assert.equal(pcDecide({ action: "read_file", args: { path: "D:\\Renders\\a" } }, { stopAll: false, folders: [] }).run, "refuse");
});

test("voice OK: a whole plain yes only; click-only items refuse voice; expiry", () => {
  assert.equal(confirmReply("Yes, do it."), "yes");
  assert.equal(confirmReply("Orbit, go ahead"), "yes");
  assert.equal(confirmReply("yes but first tell me what it is"), null);
  assert.equal(confirmReply("no wait"), "no");
  assert.equal(confirmReply("what's the weather"), null);
  const p: Pending = { id: "a", action: "delete_file", args: {}, summary: "x", click: false, at: 1000 };
  assert.deepEqual(confirmAllowed(p, "voice", 2000, false), { ok: true });
  assert.equal(confirmAllowed({ ...p, click: true }, "voice", 2000, false).ok, false);
  assert.equal(confirmAllowed({ ...p, click: true }, "click", 2000, false).ok, true);
  assert.equal(confirmAllowed(p, "click", 1000 + CONFIRM_MS + 1, false).ok, false);
  assert.equal(confirmAllowed(p, "click", 2000, true).ok, false);
  assert.equal(confirmAllowed(undefined, "click", 2000, false).ok, false);
  assert.match(askLine({ summary: "delete x", click: false }), /yes, do it/);
});
