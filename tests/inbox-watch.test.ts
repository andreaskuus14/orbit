import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STARTED, STABLE_POLLS, rememberStarted, defaultInboxAuto, inboxAutoProblem, isTempName, readyFiles, sourceNote, trackStable, type Polled, type Seen } from "../src/lib/clips/inbox-watch.ts";

const file = (name: string, size = 100, mtimeMs = 1, extra: Partial<Polled> = {}): Polled => ({ name, size, mtimeMs, ctimeMs: 1, arrivedMs: 1000, fromOrbit: false, ...extra });
const pollN = (files: Polled[], n: number, seen = new Map<string, Seen>()) => { for (let i = 0; i < n; i++) seen = trackStable(seen, files); return seen; };

test("a file is ready only after size+mtime held still for STABLE_POLLS polls", () => {
  const f = [file("stream.mp4")];
  assert.equal(STABLE_POLLS, 2);
  assert.deepEqual(readyFiles(f, pollN(f, 1), new Set(), 0), []); // first sight
  assert.deepEqual(readyFiles(f, pollN(f, 2), new Set(), 0), []); // unchanged once
  assert.deepEqual(readyFiles(f, pollN(f, 3), new Set(), 0).map((x) => x.name), ["stream.mp4"]);
});

test("a growing file resets its counter; a vanished one is forgotten", () => {
  let seen = pollN([file("a.mkv", 100)], 3);
  seen = trackStable(seen, [file("a.mkv", 200)]);
  assert.equal(seen.get("a.mkv")?.stable, 0);
  seen = trackStable(seen, [file("a.mkv", 200, 5)]); // mtime moved, same size
  assert.equal(seen.get("a.mkv")?.stable, 0);
  seen = pollN([file("a.mkv", 200, 5)], 2, seen);
  assert.equal(seen.get("a.mkv")?.stable, 2);
  seen = trackStable(seen, [file("a.mkv", 200, 5, { ctimeMs: 9 })]); // preallocated size, only ctime moved
  assert.equal(seen.get("a.mkv")?.stable, 0);
  assert.equal(trackStable(seen, []).size, 0);
});

test("skips files with a job (any status), ORBIT downloads, temp names, empty files and the pre-enable backlog", () => {
  const files = [file("done.mp4"), file("mine.mp4", 100, 1, { fromOrbit: true }), file("x.temp.mp4"), file("x.f137.mp4.part"), file("empty.mp4", 0),
    file("old.mp4", 100, 1, { arrivedMs: 10 }), file("notes.txt"), file("new.MOV")];
  assert.deepEqual(readyFiles(files, pollN(files, 3), new Set(["done.mp4"]), 500).map((x) => x.name), ["new.MOV"]);
});

test("temp-name detection", () => {
  for (const n of ["a.mp4.part", "a.part", "a.mp4.ytdl", "a.temp.mp4", "a.TEMP.mkv"]) assert.ok(isTempName(n), n);
  for (const n of ["a.mp4", "partial stream.mp4", "temperature.mp4"]) assert.ok(!isTempName(n), n);
});

test("source note: .source.txt first non-empty line wins, else .source.json permission", () => {
  assert.equal(sourceNote("﻿\n  Clipping program: StreamerX allows clips \r\nmore", '{"permission":"json"}'), "Clipping program: StreamerX allows clips");
  assert.equal(sourceNote(null, '{"permission":"Discord ok from @x"}'), "Discord ok from @x");
  assert.equal(sourceNote(null, "not json"), "");
  assert.equal(sourceNote(null, null), "");
  assert.equal(sourceNote("y".repeat(500)).length, 300);
});

test("inbox-auto.json validation", () => {
  const d = defaultInboxAuto(new Date("2026-10-16T00:00:00Z"));
  assert.equal(inboxAutoProblem(d), "");
  assert.equal(d.enabled, true);
  assert.equal(defaultInboxAuto(new Date(), false).enabled, false); // recreated after a damaged file
  assert.match(inboxAutoProblem({ ...d, enabled: "yes" }), /enabled/);
  assert.match(inboxAutoProblem({ ...d, options: { count: 99 } }), /count/);
  assert.match(inboxAutoProblem({ ...d, since: "soon" }), /since/);
  assert.match(inboxAutoProblem(null), /object/);
});

test("a file auto-started before is never started again (job deleted), unless it's a different file under the same name", () => {
  const f = [file("s.mp4", 100, 7)], seen = pollN(f, 3);
  const started = rememberStarted([], f[0]);
  assert.deepEqual(readyFiles(f, seen, new Set(), 0, started), []);
  const replaced = [file("s.mp4", 999, 8)];
  assert.equal(readyFiles(replaced, pollN(replaced, 3), new Set(), 0, started).length, 1);
});

test("started list keeps the newest MAX_STARTED, no duplicates", () => {
  let list = rememberStarted([], file("a.mp4"));
  list = rememberStarted(list, file("a.mp4"));
  assert.equal(list.length, 1);
  for (let i = 0; i < MAX_STARTED + 20; i++) list = rememberStarted(list, file(`f${i}.mp4`));
  assert.equal(list.length, MAX_STARTED);
  assert.equal(list.at(-1)?.name, `f${MAX_STARTED + 19}.mp4`);
  assert.ok(!list.some((x) => x.name === "a.mp4"));
  assert.equal(inboxAutoProblem({ ...defaultInboxAuto(new Date()), started: list }), "");
  assert.match(inboxAutoProblem({ ...defaultInboxAuto(new Date()), started: [{ name: 1 }] }), /started/);
});
