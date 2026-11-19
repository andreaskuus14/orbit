import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTALL_HINT, MAX_FILED_PER_RUN, countFindings, draftFor, fingerprint, newErrors, normalizeMessage, parseFindings, refOf, seleneCandidates, summaryText } from "../src/lib/selene-pure.ts";
import { importDrafts } from "../src/lib/backlog-pure.ts";
import { eventFromSelene, sessionStats, type DevSession } from "../src/lib/dev-session-pure.ts";
import { validateDevWorld, type DevWorld } from "../src/lib/devworld-pure.ts";

const diag = (file: string, line: number, severity: string, code: string, message: string) => JSON.stringify({
  type: "Diagnostic", severity, code, message, primary_label: { filename: file, span: { start: 0, start_line: line, start_column: 4, end: 5, end_line: line, end_column: 9 }, message: "" }, notes: [], secondary_labels: [],
});
const FIXTURE = [
  diag("./src\\ServerScriptService\\Main.server.luau", 11, "Error", "undefined_variable", "`Players` is not defined"),
  diag("./src/ServerScriptService/Main.server.luau", 29, "Warning", "unused_variable", "`x` is defined, but never used"),
  diag("./src/ReplicatedStorage/Pets.luau", 4, "Error", "incorrect_standard_library_use", "`game:GetService` takes 1 argument, 2 given"),
  "selene crashed halfway: not json",
  JSON.stringify({ type: "Summary", errors: 2, warnings: 1, parse_errors: 0 }),
].join("\n");

const world = (): DevWorld => {
  const v = validateDevWorld({ v: 1, games: [{ id: "g1", name: "Pet Sim", platform: "roblox", stage: "alpha", pitch: "", notes: "" }], bugs: [] });
  if (!v.ok) throw new Error(v.error);
  return v.world;
};

test("parseFindings: flat, 1-based, errors first, paths cleaned, junk lines skipped", () => {
  const f = parseFindings(FIXTURE)!;
  assert.equal(f.length, 3);
  assert.deepEqual(f.map((x) => x.severity), ["error", "error", "warning"]);
  assert.equal(f[1].file, "src/ServerScriptService/Main.server.luau");
  assert.equal(f[1].line, 12);
  assert.equal(f[1].col, 5);
  assert.equal(f[1].code, "undefined_variable");
  assert.deepEqual(countFindings(f), { errors: 2, warnings: 1, files: 2 });
});

test("parseFindings: no output or a crash message is null; a clean run is an empty list", () => {
  assert.equal(parseFindings(""), null);
  assert.equal(parseFindings("thread 'main' panicked"), null);
  assert.deepEqual(parseFindings(JSON.stringify({ type: "Summary", errors: 0, warnings: 0, parse_errors: 0 })), []);
});

test("fingerprint ignores line numbers and digits, not file, rule or identifier", () => {
  const a = { file: "src/A.luau", code: "undefined_variable", message: "`Players` is not defined" };
  assert.equal(fingerprint(a), fingerprint({ ...a }));
  assert.equal(fingerprint({ ...a, message: "  `Players`   IS not defined " }), fingerprint(a));
  assert.equal(fingerprint({ ...a, message: "`foo` is not defined" }) === fingerprint(a), false);
  assert.equal(fingerprint({ ...a, file: "src/B.luau" }) === fingerprint(a), false);
  assert.equal(fingerprint({ ...a, code: "other" }) === fingerprint(a), false);
  assert.equal(normalizeMessage("used 3 times on line 12"), "used # times on line");
  assert.match(refOf(a), /^selene:[0-9a-f]{12}$/);
  assert.ok(refOf(a).length <= 40);
  const f1 = parseFindings(diag("./src/A.luau", 3, "Error", "x", "m"))![0], f2 = parseFindings(diag("./src/A.luau", 90, "Error", "x", "m"))![0];
  assert.equal(fingerprint(f1), fingerprint(f2));
});

test("newErrors: errors only; known, wontfix suppress; fixed ones come back; duplicates collapse; capped", () => {
  const fs = parseFindings(FIXTURE)!;
  const [e1, e2] = fs;
  let d = newErrors(fs, [], "g1");
  assert.equal(d.fresh.length, 2); // the warning is never filed
  assert.equal(d.known, 0);
  const bug = (f: typeof e1, status: "open" | "fixed" | "wontfix", game = "g1") => ({ game, ref: refOf(f), status });
  d = newErrors(fs, [bug(e1, "open")], "g1");
  assert.deepEqual([d.fresh.length, d.known], [1, 1]);
  d = newErrors(fs, [bug(e1, "wontfix"), bug(e2, "fixed")], "g1");
  assert.deepEqual([d.fresh.map((f) => f.file), d.known], [[e2.file], 1]);
  d = newErrors(fs, [bug(e1, "open", "other-game")], "g1");
  assert.equal(d.fresh.length, 2); // another game's bug doesn't count
  d = newErrors([e1, { ...e1, line: 99 }], [], "g1");
  assert.equal(d.fresh.length, 1);
  const many = Array.from({ length: 25 }, (_, i) => ({ ...e1, message: `\`v${i}x\` is not defined`.replace(/\d/g, (c) => "abcdefghij"[+c]) }));
  d = newErrors(many, [], "g1");
  assert.equal(d.fresh.length, MAX_FILED_PER_RUN);
  assert.equal(d.overflow, 25 - MAX_FILED_PER_RUN);
});

test("a second run on the same output files nothing new (fixture → one bug each, then no duplicates)", () => {
  const fs = parseFindings(FIXTURE)!;
  const w1 = importDrafts(world(), "g1", newErrors(fs, [], "g1").fresh.map(draftFor), "2026-11-20T10:00:00.000Z", (() => { let i = 0; return () => `b${++i}`; })());
  assert.equal(w1.added, 2);
  assert.ok(validateDevWorld(w1.world).ok); // what we save is valid
  const bug = w1.world.bugs[0];
  assert.equal(bug.kind, "bug");
  assert.equal(bug.status, "open");
  assert.match(bug.ref ?? "", /^selene:/);
  const again = newErrors(fs, w1.world.bugs, "g1");
  assert.deepEqual([again.fresh.length, again.known], [0, 2]);
  // the code moved down the file: still the same bug
  const moved = parseFindings(diag("./src/ReplicatedStorage/Pets.luau", 80, "Error", "incorrect_standard_library_use", "`game:GetService` takes 1 argument, 2 given"))!;
  assert.equal(newErrors(moved, w1.world.bugs, "g1").fresh.length, 0);
});

test("draftFor: parse errors are crashes, titles fit, detail names the place", () => {
  const f = parseFindings(diag("./src/A.luau", 0, "Error", "parse_error", "unexpected token ".repeat(30)))![0];
  const d = draftFor(f);
  assert.equal(d.severity, "crash");
  assert.ok(d.title.length <= 140);
  assert.match(d.detail, /^src\/A\.luau:1:5 /);
});

test("summaryText: counts, filed/known, warnings shown not filed, row cap", () => {
  const fs = parseFindings(FIXTURE)!;
  const t = summaryText("Pet Sim", fs, { filed: 1, known: 1, overflow: 0 });
  assert.match(t.split("\n")[0], /^Selene: 2 errors, 1 warning in 2 files · 1 new bug filed · 1 already in the backlog$/);
  assert.match(t, /warning \[unused_variable\]/);
  assert.equal(summaryText("P", [], { filed: 0, known: 0, overflow: 0 }), 'Selene: no issues in "P".');
  assert.match(summaryText("P", fs, { filed: 0, known: 0, overflow: 4, unfiled: "no game called \"P\" in GAME DEV, nothing filed" }), /4 more errors not filed.*no game called/);
  assert.match(summaryText("P", fs, { filed: 0, known: 0, overflow: 0 }, 1), /2 more in GAME DEV/);
});

test("dev session event: counts land in the session stats", () => {
  const e = eventFromSelene("Pet Sim", ["a.luau:1 [x] bad"], ["b.luau:2 [y] meh", "c.luau:3 [y] meh"], "1 errors, 2 warnings");
  assert.equal(e.source, "build");
  assert.equal(e.ok, false);
  const s: DevSession = { id: "00000000-0000-4000-8000-000000000000", userId: "u", n: 1, start: e.at, last: e.at, events: [e] };
  const st = sessionStats(s, Date.parse(e.at));
  assert.deepEqual([st.errors, st.warnings], [1, 2]);
  assert.equal(eventFromSelene("P", [], []).ok, true);
});

test("seleneCandidates: ORBIT_SELENE first, then rokit/aftman/foreman, the project's own, PATH; no duplicates", () => {
  const c = seleneCandidates({ env: " /opt/selene ", home: "/home/a", win: false, projectDir: "/p/Pet", path: "/usr/bin:/home/a/.rokit/bin", sep: ":" });
  assert.equal(c[0], "/opt/selene");
  assert.deepEqual(c.slice(1, 4), ["/home/a/.rokit/bin/selene", "/home/a/.aftman/bin/selene", "/home/a/.foreman/bin/selene"]);
  assert.ok(c.includes("/p/Pet/.rokit/bin/selene") && c.includes("/usr/bin/selene"));
  assert.equal(new Set(c).size, c.length);
  const w = seleneCandidates({ home: "C:\\Users\\a", win: true, projectDir: "C:\\p", path: "C:\\bin", sep: ";" });
  assert.equal(w[0], "C:\\Users\\a\\.rokit\\bin\\selene.exe");
  assert.match(INSTALL_HINT, /rokit add Kampfkarren\/selene/);
  assert.match(INSTALL_HINT, /aftman add Kampfkarren\/selene/);
});
