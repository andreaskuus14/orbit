import { test } from "node:test";
import assert from "node:assert/strict";
import { bootNotice, consumed, effortCheck, parseState, readRange, scanLogs, READ_CAP } from "../src/lib/doctor-boot-pure.ts";
import { check } from "../src/lib/doctor-pure.ts";

const LAUNCH = "2026-10-17 18:13:05  [orbit] ORBIT server exited unexpectedly (code 3221226505) after 812 s.\n2026-10-17 18:13:06  [orbit] Starting ORBIT server (npm run start) on port 3000.";

test("onnxruntime V8 locking crash maps to the Whisper explanation, generic FATAL dropped", () => {
  const s = scanLogs("✓ Ready in 300ms\nFATAL ERROR: v8::HandleScope::CreateHandle()\nError: Entering the V8 API without proper locking in place\n  at onnxruntime", LAUNCH);
  assert.deepEqual(s.crashes.map((c) => c.id), ["whisper-lock"]);
  assert.match(s.crashes[0].what, /two models at once/);
  assert.deepEqual(s.exits, ["2026-10-17 18:13"]);
});

test("generic patterns and normal logs", () => {
  assert.deepEqual(scanLogs("FATAL ERROR: something\nnpm error code 1", "").crashes.map((c) => c.id), ["fatal", "exit"]);
  assert.deepEqual(scanLogs("UnhandledPromiseRejection: x", "").crashes.map((c) => c.id), ["unhandled"]);
  assert.deepEqual(scanLogs("Uncaught TypeError: x", "").crashes.map((c) => c.id), ["uncaught"]);
  assert.deepEqual(scanLogs("JavaScript heap out of memory", "").crashes.map((c) => c.id), ["oom"]);
  assert.deepEqual(scanLogs("Error: listen EADDRINUSE: address already in use 127.0.0.1:3000", "").crashes.map((c) => c.id), ["port"]);
  const ok = scanLogs("> orbit@0.1.0 start\n ▲ Next.js 15.1.0\n ✓ Starting...\n ✓ Ready in 412ms\n[orbit] clip job done", "2026-10-17 09:00:00  [orbit] Starting ORBIT server");
  assert.deepEqual(ok, { crashes: [], exits: [], starts: 1 });
});

test("three server starts since the last check = restart loop", () => {
  const s = scanLogs(" ✓ Starting...\n ✓ Starting...\n ✓ Starting...", "");
  assert.equal(s.starts, 3);
  assert.deepEqual(s.crashes.map((c) => c.id), ["loop"]);
});

test("read range: continue, first run, cap, truncation, rotation", () => {
  assert.deepEqual(readRange({ offset: 100, id: "a" }, 250, "a"), { rotated: false, start: 100, end: 250 });
  assert.deepEqual(readRange(null, 500, "a"), { rotated: false, start: 500, end: 500 }); // first run: start at the end
  assert.deepEqual(readRange({ offset: 0, id: "a" }, READ_CAP + 10, "a"), { rotated: false, start: 10, end: READ_CAP + 10 });
  assert.deepEqual(readRange({ offset: 900, id: "a" }, 300, "a"), { rotated: true, start: 0, end: 300 }); // truncated
  assert.deepEqual(readRange({ offset: 100, id: "a" }, 5000, "b"), { rotated: true, start: 0, end: 5000 }); // replaced, already bigger
  assert.deepEqual(readRange({ offset: 100, id: "a" }, 100, "a"), { rotated: false, start: 100, end: 100 }); // nothing new
});

test("bell: crash notice with time and cause, links to the doctor", () => {
  const n = bootNotice(scanLogs("Entering the V8 API without proper locking", LAUNCH), [], "2026-10-17");
  assert.equal(n?.title, "ORBIT restarted after a crash at 18:13 — Whisper (speech-to-text) crashed while loading two models at once.");
  assert.deepEqual(n?.nav, { panel: null, doctor: true });
  assert.equal(n?.kind, "system");
  // another day: keep the date; unknown cause still notifies
  const m = bootNotice(scanLogs("", LAUNCH), [check("x", "X", "fail", "broken")], "2026-10-18");
  assert.match(m!.title, /at 2026-10-17 18:13\.$/);
  assert.match(m!.body!, /Cause not recognised.*1 problem found \(X\)/);
});

test("bell: silent when all is fine or only warnings; fails alone notify", () => {
  const clean = scanLogs("", "");
  assert.equal(bootNotice(clean, [check("a", "A", "ok", "fine"), check("b", "B", "warn", "meh")], "2026-10-17"), null);
  const n = bootNotice(clean, [check("a", "Database (Supabase)", "fail", "Couldn't reach the database")], "2026-10-17");
  assert.equal(n?.title, "ORBIT self-test: 1 problem after restart");
  assert.equal(n?.body, "Database (Supabase): Couldn't reach the database");
});

test("effort support from claude --help", () => {
  assert.equal(effortCheck("  --effort <level>  reasoning effort", "2.1.0").status, "ok");
  assert.equal(effortCheck("  --model <m>", "1.0.0").status, "warn");
  assert.equal(effortCheck(null, null).status, "ok");
});

test("offset stops at the last newline; a full chunk with none still advances", () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  assert.equal(consumed(enc("a\nb\npartial")), 4);
  assert.equal(consumed(enc("done\n")), 5);
  assert.equal(consumed(enc("no newline yet")), 0);
  assert.equal(consumed(enc("xxxx"), 4), 4);
});

test("state file: corrupt or malformed parts are dropped", () => {
  assert.deepEqual(parseState("{not json"), {});
  assert.deepEqual(parseState(null), {});
  assert.deepEqual(parseState("[1]"), {});
  assert.deepEqual(parseState('{"server":{"offset":-1,"id":"a"},"launcher":{"offset":12,"id":"b"}}'), { launcher: { offset: 12, id: "b" } });
  assert.deepEqual(parseState('{"server":{"offset":"5","id":"a"},"launcher":{"offset":1.5,"id":"b"}}'), {});
});

test("huge lines are capped before matching", () => {
  assert.deepEqual(scanLogs("x".repeat(5000) + " FATAL ERROR", "").crashes, []);
  assert.deepEqual(scanLogs("FATAL ERROR " + "x".repeat(5000), "").crashes.map((c) => c.id), ["fatal"]);
});
