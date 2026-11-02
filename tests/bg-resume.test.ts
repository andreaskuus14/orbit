import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_RESUMES, doneSoFar, newBgTurn, parseBgTurn, resumeContext, resumeHistory, resumePlan } from "../src/lib/bg-resume-pure.ts";

const now = Date.parse("2026-11-02T10:00:00Z");
const rec = newBgTurn({ taskId: "t-1", userId: "u-1", chatId: "c-1", request: "build me a site", title: "CORE: build me a site", done: ["ws_write: index.html"], lang: "et" }, now);

test("record round-trips and rejects junk", () => {
  assert.deepEqual(parseBgTurn(JSON.parse(JSON.stringify(rec))), rec);
  assert.equal(parseBgTurn(null), null);
  assert.equal(parseBgTurn({ ...rec, taskId: "../x" }), null);
  assert.equal(parseBgTurn({ ...rec, request: "" }), null);
  assert.equal(parseBgTurn({ ...rec, attempts: -1 })?.attempts, 0);
});

test("resume until MAX_RESUMES tries, then fail with a readable reason", () => {
  assert.deepEqual(resumePlan(rec, now), { do: "resume" });
  assert.deepEqual(resumePlan({ ...rec, attempts: MAX_RESUMES - 1 }, now), { do: "resume" });
  const f = resumePlan({ ...rec, attempts: MAX_RESUMES, lastError: "CLI crashed" }, now);
  assert.equal(f.do, "fail");
  assert.match((f as { reason: string }).reason, /restarted.*2 tries.*CLI crashed/);
  assert.equal(resumePlan(rec, now + 25 * 3600_000).do, "fail"); // ORBIT off for over a day
});

test("done-so-far keeps tool steps only; context tells the model not to redo them", () => {
  const d = doneSoFar([{ step: "think", detail: "x" }, { step: "ws_write", detail: "index.html", ok: true }, { step: "web_search", detail: "q", ok: false }, { step: "fallback" }]);
  assert.deepEqual(d, ["ws_write: index.html"]);
  assert.match(resumeContext(rec), /RESUMED[\s\S]*do not redo[\s\S]*- ws_write: index\.html/);
  assert.match(resumeContext({ ...rec, done: [] }), /No step had finished/);
});

test("history ends at the request (the handoff reply after it is dropped)", () => {
  const rows = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "build me a site\n\n(attached: a.png)" }, { role: "assistant", content: "Continuing in the background" }];
  assert.deepEqual(resumeHistory(rows, "build me a site").map((r) => r.role), ["user", "assistant", "user"]);
  assert.deepEqual(resumeHistory(rows, "something else"), []);
});
