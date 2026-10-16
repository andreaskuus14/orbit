import { test } from "node:test";
import assert from "node:assert/strict";
import { beamPairs, chainActive, checkTeam, excerpt, move, timeAgo, traceLines } from "../src/lib/mission-pure.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const at = (sec: number) => new Date(NOW - sec * 1000).toISOString();

test("timeAgo: buckets and bad input", () => {
  assert.equal(timeAgo(at(10), NOW), "just now");
  assert.equal(timeAgo(at(300), NOW), "5m ago");
  assert.equal(timeAgo(at(7200), NOW), "2h ago");
  assert.equal(timeAgo(at(3 * 86400), NOW), "3d ago");
  assert.equal(timeAgo(at(-60), NOW), "just now");
  assert.equal(timeAgo(null, NOW), "");
  assert.equal(timeAgo("nope", NOW), "");
});

test("traceLines: readable, tolerant of junk, keeps the tail", () => {
  const lines = traceLines([{ step: "web_search", detail: "  query\n x ", ms: 1500, ok: true }, { step: "save", detail: "", ms: 20, ok: false }, null, 5]);
  assert.deepEqual(lines.map((l) => l.text), ["web search — query x (1.5 s)", "save (20 ms)", "step", "step"]);
  assert.equal(lines[1].ok, false);
  assert.deepEqual(traceLines("<b>x</b>"), []);
  assert.equal(traceLines(Array.from({ length: 10 }, (_, i) => ({ step: `s${i}` })), 3)[0].text, "s7");
  assert.ok(traceLines([{ step: "x", detail: "y".repeat(500) }])[0].text.length < 180);
});

test("excerpt collapses whitespace and truncates", () => {
  assert.equal(excerpt(" a\n\nb "), "a b");
  assert.equal(excerpt("x".repeat(10), 4), "xxxx…");
  assert.equal(excerpt(null), "");
});

test("beamPairs: current step's previous agent → agent, only for live chains, deduped", () => {
  const st = (agent: string, status: string) => ({ index: 0, agent, request: "", taskId: null, status }) as never;
  const live = { status: "running" as const, steps: [st("atlas", "done"), st("forge", "running"), st("nova", "queued")] };
  assert.deepEqual(beamPairs([live, live]), [["atlas", "forge"]]);
  assert.deepEqual(beamPairs([{ status: "waiting", steps: [st("atlas", "done"), st("forge", "done"), st("nova", "awaiting_approval")] }]), [["forge", "nova"]]);
  assert.deepEqual(beamPairs([{ status: "running", steps: [st("atlas", "running"), st("forge", "queued")] }]), []); // first step: no hand-off yet
  assert.deepEqual(beamPairs([{ ...live, status: "done" }, { ...live, status: "cancelled" }]), []);
  assert.deepEqual(beamPairs([{ status: "running", steps: [st("atlas", "done"), st("atlas", "running")] }]), []);
  assert.equal(chainActive([{ status: "done" }, { status: "waiting" }]), true);
  assert.equal(chainActive([{ status: "failed" }]), false);
});

test("checkTeam mirrors the server and checks the roster", () => {
  const roster = ["atlas", "forge"];
  const ok = checkTeam("Goal", [{ agent: "Atlas", request: "a" }, { agent: "forge", request: "b" }], roster);
  assert.ok(typeof ok !== "string" && ok.steps[0].agent === "atlas");
  assert.match(checkTeam("", [{ agent: "atlas", request: "a" }, { agent: "forge", request: "b" }], roster) as string, /goal/);
  assert.match(checkTeam("g", [{ agent: "atlas", request: "a" }], roster) as string, /2-5/);
  assert.match(checkTeam("g", [{ agent: "atlas", request: "a" }, { agent: "forge", request: " " }], roster) as string, /step 2: request/);
  assert.match(checkTeam("g", [{ agent: "atlas", request: "a" }, { agent: "zed", request: "b" }], roster) as string, /unknown agent "zed"/);
});

test("move reorders within bounds only", () => {
  assert.deepEqual(move([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(move([1, 2, 3], 2, -1), [1, 3, 2]);
  const a = [1, 2];
  assert.equal(move(a, 0, -1), a);
  assert.equal(move(a, 1, 1), a);
});
