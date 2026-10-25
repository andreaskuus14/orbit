import { test } from "node:test";
import assert from "node:assert/strict";
import { areaOf, briefHealth, builderText, buildSamples, classify, isoWeek, isProblem, logSamples, mergeIssues, parseSummary, perfSamples, redact, rollPerf,
  signature, sortIssues, toSummarise, triage, type Issue } from "../src/lib/health-pure.ts";

const NOW = "2026-10-25T03:00:00.000Z";
const SERVER = [
  "▲ Next.js 15.5.0",
  "✓ Ready in 812ms",
  "[orbit] night shift failed: fetch failed (ECONNRESET) for job 3f2a9c1e-7b1d-4c2e-9a0b-1234567890ab",
  "[orbit] night shift failed: fetch failed (ECONNRESET) for job 9d8e7f6a-1b2c-4d3e-8f9a-abcdefabcdef",
  "⨯ unhandledRejection: TypeError: Cannot read properties of undefined (reading 'clips') at C:\\Users\\Andreas\\orbit\\.next\\server\\chunks\\812.js:14:2201",
  "    at async listJobs (C:\\Users\\Andreas\\orbit\\src\\lib\\clips\\factory.ts:206:20)",
  "[orbit] usage meter not saved: SyntaxError: Unexpected end of JSON input in C:\\Users\\Andreas\\AppData\\Local\\orbit\\usage-meter.json",
  "[orbit] deals hunt failed: 401 Unauthorized Authorization: Bearer sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA user andreas@example.com token=abc123secret",
  "GET /api/brief 200 in 41ms",
  "Compiled with 0 errors",
].join("\n");
const LAUNCHER = "2026-10-25 02:13:05  [orbit] ORBIT server exited unexpectedly (code 3221226505) after 812 s.\n2026-10-25 02:13:06  [orbit] Starting ORBIT server";

test("redact strips keys, tokens, cookies, Bearer, JWTs and emails", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const r = redact(`Bearer abc.def-ghi apikey=sk-ant-api03-XYZXYZXYZXYZXYZ mail andreas@example.com supabase ${jwt} ?token=zzz&q=1 "password": "hunter2" ghp_${"a".repeat(36)}\nCookie: sb-access=${jwt}; x=1`);
  for (const bad of ["abc.def-ghi", "sk-ant", "hunter2", "andreas@example.com", "eyJ", "zzz", "ghp_"]) assert.ok(!r.includes(bad), `${bad} leaked: ${r}`);
  assert.match(r, /Bearer <redacted>/);
  assert.match(r, /<email>/);
  assert.match(r, /q=1/); // harmless params stay
  assert.match(r, /\nCookie: <redacted>$/);
});

test("signature strips times, paths, ids and numbers so repeats group", () => {
  const a = signature("2026-10-25 01:00:01 [orbit] clip job 3f2a9c1e-7b1d-4c2e-9a0b-1234567890ab failed at C:\\Users\\A\\orbit\\x.ts:12:4 after 812 s");
  const b = signature("2026-10-26 04:22:59 [orbit] clip job 9d8e7f6a-1b2c-4d3e-8f9a-abcdefabcdef failed at /home/a/orbit/y.ts:1:1 after 3 s");
  assert.equal(a, b);
  assert.equal(a, "[orbit] clip job <id> failed at <path> after <n> s");
  assert.equal(signature("story abc123-9f8e7d failed"), signature("story zz9xy1-001122 failed"));
});

test("problem lines: errors yes, stack frames and 'no errors' no", () => {
  assert.ok(isProblem("Error: boom"));
  assert.ok(!isProblem("    at foo (x.ts:1:1)"));
  assert.ok(!isProblem("Compiled with 0 errors"));
  assert.ok(!isProblem("GET /api/brief 200 in 41ms"));
});

test("classify and area", () => {
  assert.equal(classify("FATAL ERROR: heap out of memory", "server"), "crash");
  assert.equal(classify("unhandledRejection: TypeError", "server"), "unhandled");
  assert.equal(classify("SyntaxError: Unexpected end of JSON input", "server"), "data");
  assert.equal(classify("fetch failed ECONNRESET", "server"), "external");
  assert.equal(classify("Type error: x", "build"), "build");
  assert.equal(classify("clip job failed: no audio", "job"), "job");
  assert.equal(areaOf("clip job failed"), "studio");
  assert.equal(areaOf("deals hunt failed"), "markets");
  assert.equal(areaOf("night shift failed"), "agents");
  assert.equal(areaOf("something odd"), "system");
});

test("triage on synthetic logs: grouped, classified, redacted", () => {
  const groups = triage([...logSamples(SERVER, "server", NOW), ...logSamples(LAUNCHER, "launcher")], NOW);
  const by = Object.fromEntries(groups.map((g) => [g.cls, g]));
  assert.equal(groups.length, 5);
  assert.equal(by.external.count, 1); // the two ECONNRESET lines differ only by id: one group…
  assert.equal(groups.find((g) => g.sig.startsWith("[orbit] night shift"))!.count, 2); // …counted twice
  assert.equal(by.unhandled.area, "studio");
  assert.equal(by.data.area, "system");
  assert.equal(by.crash.first, new Date("2026-10-25T02:13:05").toISOString()); // launcher stamp kept
  const all = JSON.stringify(groups);
  for (const bad of ["sk-ant", "andreas@example.com", "abc123secret"]) assert.ok(!all.includes(bad), `${bad} leaked`);
});

test("build log: compile errors become build issues; a clean build none", () => {
  assert.deepEqual(buildSamples("✓ Compiled successfully\n✓ Generating static pages", NOW), []);
  const s = buildSamples("Failed to compile.\n./src/lib/night.ts:12:3\nType error: Property 'health' does not exist on type 'X'.", NOW);
  assert.equal(s.length, 1);
  assert.equal(triage(s, NOW)[0].cls, "build");
});

test("mergeIssues: new, ongoing (counts add), resolved, regressed, old resolved dropped", () => {
  const g1 = triage(logSamples("Error: alpha broke\nError: beta broke", "server", NOW), NOW);
  const r1 = mergeIssues({}, g1, NOW);
  assert.deepEqual(Object.values(r1.issues).map((i) => i.status), ["new", "new"]);
  assert.equal(r1.changed.length, 2);
  const T2 = "2026-10-26T03:00:00.000Z";
  const r2 = mergeIssues(r1.issues, triage(logSamples("Error: alpha broke\nError: alpha broke", "server", T2), T2), T2);
  const alpha = Object.values(r2.issues).find((i) => i.sig.includes("alpha"))!, beta = Object.values(r2.issues).find((i) => i.sig.includes("beta"))!;
  assert.equal(alpha.status, "ongoing");
  assert.equal(alpha.count, 3);
  assert.equal(alpha.first, NOW);
  assert.equal(beta.status, "resolved");
  assert.deepEqual(r2.changed, [{ id: beta.id, status: "resolved" }]);
  const T3 = "2026-10-27T03:00:00.000Z";
  const r3 = mergeIssues(r2.issues, triage(logSamples("Error: beta broke", "server", T3), T3), T3);
  assert.equal(r3.issues[beta.id].status, "regressed");
  const r4 = mergeIssues({ [beta.id]: { ...beta, last: NOW } }, [], "2026-11-20T00:00:00.000Z");
  assert.deepEqual(r4.issues, {});
});

test("toSummarise picks the top 3 new/regressed without a note; sortIssues puts resolved last", () => {
  const mk = (id: string, severity: number, status: Issue["status"], summary?: Issue["summary"]): Issue =>
    ({ id, cls: "error", area: "system", sig: id, title: id, excerpt: "", sources: ["server"], count: 1, first: NOW, last: NOW, severity, status, summary });
  const list = [mk("a", 20, "new"), mk("b", 80, "resolved"), mk("c", 60, "regressed"), mk("d", 70, "new", { summary: "s", cause: "", fix: "f" }), mk("e", 30, "new"), mk("f", 10, "new"), mk("g", 90, "ongoing")];
  assert.deepEqual(toSummarise(list).map((i) => i.id), ["c", "e", "a"]);
  assert.deepEqual(sortIssues(list).map((i) => i.id), ["g", "d", "c", "e", "a", "f", "b"]);
});

test("perf regression vs previous week", () => {
  assert.equal(isoWeek(Date.parse("2026-10-25T12:00:00Z")), "2026-W43");
  assert.equal(isoWeek(Date.parse("2027-01-01T12:00:00Z")), "2026-W53");
  let snaps = rollPerf([], { week: "2026-W42", core: { tool: 4000, memory: 2000 }, fps: { galaxy: 60, studio: 55 } });
  snaps = rollPerf(snaps, { week: "2026-W43", core: { tool: 7000 }, fps: { galaxy: 40 } });
  snaps = rollPerf(snaps, { week: "2026-W43", core: { memory: 2100 }, fps: {} });
  assert.deepEqual(snaps.map((s) => s.week), ["2026-W42", "2026-W43"]);
  assert.deepEqual(snaps[1].core, { tool: 7000, memory: 2100 });
  const s = perfSamples(snaps, NOW);
  assert.equal(s.length, 2);
  assert.match(s[0].line, /CORE tool answers slower: p95 4000 ms last week, 7000 ms now/);
  assert.match(s[1].line, /galaxy frame rate dropped: 60 fps last week, 40 fps now/);
  assert.equal(triage(s, NOW)[0].cls, "perf");
  assert.deepEqual(perfSamples(snaps.slice(1), NOW), []);
});

test("parseSummary: JSON only, redacted, needs summary + fix", () => {
  assert.deepEqual(parseSummary('Sure: {"summary": "Clips broke.", "cause": "token=abc leaked", "fix": "Guard undefined jobs."}'),
    { summary: "Clips broke.", cause: "token=<redacted> leaked", fix: "Guard undefined jobs." });
  assert.equal(parseSummary("no json"), null);
  assert.equal(parseSummary('{"summary": "x"}'), null);
});

test("builderText and the morning brief line", () => {
  const [g] = triage(logSamples("FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory", "server", NOW), NOW);
  const { issues } = mergeIssues({}, [g], NOW);
  const i = { ...issues[g.id], summary: { summary: "ORBIT ran out of memory. It restarted.", cause: "A big clip render.", fix: "Cap concurrent renders." } };
  const md = builderText(i);
  assert.match(md, /^## ORBIT health: Crash \(system\)/);
  assert.match(md, /```\nFATAL ERROR/);
  assert.match(md, /Suggested fix:\*\* Cap concurrent renders/);
  assert.match(md, /AGENTS\.md/);
  const line = briefHealth([i], Date.parse(NOW) + 3_600_000)!;
  assert.equal(line.id, g.id);
  assert.equal(line.say, "One health note: ORBIT ran out of memory. The details are in the Doctor panel, ready to hand to a builder.");
  assert.equal(briefHealth([{ ...i, status: "ongoing" }], Date.parse(NOW)), null);
  assert.equal(briefHealth([{ ...i, severity: 20 }], Date.parse(NOW)), null);
  assert.equal(briefHealth([i], Date.parse(NOW) + 2 * 86_400_000), null);
});
