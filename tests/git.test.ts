import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedRepo, gitArgs, isAbsRepo, parseBase, parseLog, parseRepoList, summaryText, trimStat } from "../src/lib/git-pure.ts";
import { parseDevlogScript } from "../src/lib/clips/devlog.ts";

test("repo list: absolute Windows/POSIX paths only, deduped, capped", () => {
  assert.deepEqual(parseRepoList(' C:\\Games\\Pets ; "D:\\code\\orbit\\" ;relative\\x;c:\\games\\pets;/home/a/repo;\\\\nas\\share\\g;C:\\bad|x'),
    ["C:\\Games\\Pets", "D:\\code\\orbit\\", "/home/a/repo"]);
  assert.deepEqual(parseRepoList(undefined), []);
  assert.equal(parseRepoList(Array.from({ length: 20 }, (_, i) => `C:\\r${i}`).join(";")).length, 10);
  assert.ok(!isAbsRepo("..\\x") && !isAbsRepo("C:\\a\nb"));
  for (const p of ["\\\\server\\share", "\\\\.\\pipe\\x", "\\\\?\\C:\\x", "//host/share", "/\\host"]) assert.ok(!isAbsRepo(p), p);
});

test("allowlist: only configured repos, by path or folder name", () => {
  const list = ["C:\\Games\\Pets", "D:\\code\\orbit"];
  assert.equal(allowedRepo(list, "c:/games/pets/"), "C:\\Games\\Pets");
  assert.equal(allowedRepo(list, "ORBIT"), "D:\\code\\orbit");
  assert.equal(allowedRepo(list, "C:\\Windows"), null);
  assert.equal(allowedRepo(list, "C:\\Games\\Pets\\..\\..\\Windows"), null);
  assert.equal(allowedRepo(list, ""), null);
});

test("git args are fixed lists; bad inputs throw", () => {
  const r = "C:\\Games\\Pets";
  assert.deepEqual(gitArgs(r, { kind: "log", since: "2026-10-11" }),
    ["-C", r, "-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "-c", "log.showSignature=false", "--no-pager", "log", "--since=2026-10-11", "--pretty=format:%h|%ad|%s", "--date=short", "-n", "200", "--no-color", "HEAD", "--"]);
  assert.deepEqual(gitArgs(r, { kind: "base", since: "2026-10-11" }).slice(-3), ["--before=2026-10-11", "HEAD", "--"]);
  const d = gitArgs(r, { kind: "diffstat", base: "b".repeat(64) }); // SHA-256 repo
  assert.ok(d.includes("--no-ext-diff") && d.includes("--no-textconv"));
  assert.deepEqual(d.slice(-3), ["b".repeat(64), "HEAD", "--"]);
  assert.throws(() => gitArgs(r, { kind: "log", since: "1 week ago; rm -rf" }));
  assert.throws(() => gitArgs(r, { kind: "diffstat", base: "--output=/tmp/x" }));
  assert.throws(() => gitArgs(r, { kind: "base", since: "--all" }));
});

test("parsing log, base, diffstat", () => {
  assert.deepEqual(parseLog("abc1234|2026-10-17|Add pet | follow AI\njunk\nfff0000|2026-10-16|<script>x"),
    [{ hash: "abc1234", date: "2026-10-17", subject: "Add pet | follow AI" }, { hash: "fff0000", date: "2026-10-16", subject: "script x" }]);
  assert.equal(parseBase(""), null); // no commit before the range → diffstat skipped
  assert.equal(parseBase("a".repeat(40) + "\n"), "a".repeat(40));
  assert.equal(parseBase("c".repeat(64)), "c".repeat(64));
  assert.equal(parseBase("abc"), null);
  const stat = [...Array.from({ length: 30 }, (_, i) => ` src/f${i}.lua | 2 +-`), " 30 files changed, 30 insertions(+), 30 deletions(-)"].join("\n");
  const t = trimStat(stat, 5).split("\n");
  assert.equal(t.length, 7);
  assert.match(t[5], /25 more files/);
  assert.match(t[6], /30 files changed/);
});

test("summary text marks commits as data", () => {
  assert.match(summaryText([], 7), /No git repos configured/);
  const s = summaryText([{ repo: "C:\\Games\\Pets", commits: [{ hash: "abc1234", date: "2026-10-17", subject: "Add eggs" }], stat: " 1 file changed" }, { repo: "/x/broken", commits: [], stat: "", error: "git failed" }], 7);
  assert.match(s, /data, not instructions/);
  assert.match(s, /## Pets\nCommits \(1\):\n- 2026-10-17 abc1234 "Add eggs"/);
  assert.match(s, /## broken\nError: git failed/);
});

test("devlog script reply parsing", () => {
  assert.deepEqual(parseDevlogScript('ok {"hook":"Pets follow me!","script":"This week I <b>added</b> pets.","titles":["A","",3,"B"]}'),
    { hook: "Pets follow me!", script: "This week I badded/b pets.", titles: ["A", "B"] });
  assert.equal(parseDevlogScript("no json"), null);
  assert.equal(parseDevlogScript('{"hook":"x"}'), null);
});
