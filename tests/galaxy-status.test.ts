import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWorld, countBadge, galaxyStatus, needWorld, progressWorld, sentenceRest, statusLook, PULSE_PERIOD, type PlacedProgress } from "../src/lib/galaxy-status-pure.ts";
import { studioWork } from "../src/lib/planet-page-pure.ts";

const card = (o: Partial<PlacedProgress> & { id: string }): PlacedProgress => ({ title: "Task", phase: "working", steps: [], now: null, leftMin: null, result: null, action: null, at: "2026-11-21T10:00:00Z", ...o });
const NAMES = { studio: "STUDIO", business: "BUSINESS", life: "LIFE", agents: "AGENTS", core: "CORE", creation: "GAME DEV", operations: "OPERATIONS" } as const;

test("nothing known: every named world is idle and says so", () => {
  const s = galaxyStatus({}, NAMES, "en");
  assert.deepEqual(Object.keys(s).sort(), Object.keys(NAMES).sort());
  for (const w of Object.values(s)) assert.equal(w!.state, "idle");
  assert.equal(s.studio!.line, "STUDIO: all quiet");
  assert.equal(galaxyStatus({}, { studio: "STUUDIO" }, "et").studio!.line, "STUUDIO: kõik on vaikne");
});

test("the owner's example: STUDIO making Shorts with time left, from the real clip-job builder", () => {
  const now = Date.parse("2026-11-21T10:10:00Z");
  const work = studioWork([{ id: "j1", source: "C:\\v\\stream.mp4", createdAt: "2026-11-21T10:00:00Z", updatedAt: "2026-11-21T10:09:00Z", status: "rendering" }], [], "en", now);
  const s = galaxyStatus({ progress: work }, NAMES, "en").studio!;
  assert.equal(s.state, "working");
  assert.equal(s.working, 1);
  assert.equal(s.line, "STUDIO: making the Shorts, about 2 min left");
});

test("two things running: a count and the longest time left", () => {
  const s = galaxyStatus({ progress: [card({ id: "clip:a", leftMin: 6 }), card({ id: "dl:b", leftMin: 3 })] }, NAMES, "en").studio!;
  assert.deepEqual([s.state, s.working, s.leftMin], ["working", 2, 6]);
  assert.equal(s.line, "STUDIO: working on 2 things, about 6 min left");
  assert.equal(countBadge(s), "2");
});

test("priority: broke beats needs beats working; secondary work is still mentioned", () => {
  const s = galaxyStatus({
    progress: [card({ id: "clip:a" }), card({ id: "t1", title: "Make a thumbnail for the video", phase: "needs" })],
  }, NAMES, "en").studio!;
  assert.equal(s.state, "needs");
  assert.equal(s.line, "STUDIO: 1 thing needs you: Make a thumbnail for the video, still working on 1");
  const b = galaxyStatus({ progress: [card({ id: "clip:a", phase: "failed", result: { text: "It took too long." } }), card({ id: "clip:b", phase: "needs" })] }, NAMES, "en").studio!;
  assert.equal(b.state, "broke");
  assert.equal(b.line, "STUDIO: something broke: it took too long");
});

test("a task waiting for him is counted once, even though it is also in Needs you", () => {
  const s = galaxyStatus({ progress: [card({ id: "T9", title: "Email the roblox playtesters", phase: "needs" })],
    needs: [{ ref: "task:T9", kind: "decide", cause: "approval", title: "Email the roblox playtesters" }] }, NAMES, "en");
  assert.equal(s.creation!.needs, 1);
});

test("needs-you items land on their world; results to look at stay calm; system problems go to CORE", () => {
  const s = galaxyStatus({ needs: [
    { ref: "invoice:1", kind: "decide", cause: "overdue", title: "Acme · €120.00" },
    { ref: "prospect:2", kind: "decide", cause: "followup", title: "Bob" },
    { ref: "task:3", kind: "review", cause: "review", title: "Checked result" },
    { ref: "health:x", kind: "unblock", cause: "system", title: "Login expired" },
  ] }, NAMES, "en");
  assert.equal(s.business!.state, "needs");
  assert.equal(s.business!.line, "BUSINESS: 2 things need you");
  assert.equal(s.agents!.state, "idle");
  assert.equal(s.core!.state, "broke");
  assert.match(s.core!.line, /open the doctor/);
});

test("doctor: only failing checks count, each on its own world", () => {
  const s = galaxyStatus({ checks: [{ id: "ffmpeg", status: "fail", label: "Video tool (ffmpeg)" }, { id: "ytkey", status: "warn" }, { id: "claude", status: "fail", label: "Claude login" }] }, NAMES, "en");
  assert.equal(s.studio!.state, "broke");
  assert.equal(s.studio!.line, "STUDIO: something broke: video tool (ffmpeg), open the doctor to fix it");
  assert.equal(s.core!.state, "broke");
  assert.equal(checkWorld({ id: "life" }), "life");
  assert.equal(checkWorld({ id: "never-heard" }), "core");
});

test("LIFE: counts only, never its text", () => {
  const s = galaxyStatus({ progress: [card({ id: "x", title: "Journal: my private thought", planet: "life", now: "Reading my diary" })],
    needs: [{ ref: "habit:1", kind: "decide", cause: "decide", title: "secret journal title" }] }, NAMES, "en").life!;
  assert.equal(s.state, "needs");
  assert.doesNotMatch(s.line, /journal|diary|secret|private/i);
});

test("placing work: ids, then words, then AGENTS", () => {
  assert.equal(progressWorld(card({ id: "clip:1" })), "studio");
  assert.equal(progressWorld(card({ id: "plan:1" })), "operations");
  assert.equal(progressWorld(card({ id: "brief" })), "intelligence");
  assert.equal(progressWorld(card({ id: "t", title: "Fix the roblox game" })), "creation");
  assert.equal(progressWorld(card({ id: "t", title: "Something" })), "agents");
  assert.equal(needWorld({ ref: "group:prospect:1", kind: "decide", cause: "approval", title: "x" }), "business");
  assert.equal(needWorld({ ref: "trust:x", kind: "decide", cause: "trust", title: "Let ORBIT do youtube work?" }), "studio");
});

test("bad input never throws and stays idle", () => {
  const s = galaxyStatus({ progress: [null as unknown as PlacedProgress], needs: [undefined as never], checks: [null as never] }, NAMES, "en");
  assert.equal(s.studio!.state, "idle");
});

test("looks: idle dim, working breathes slowly (still with reduced motion), needs amber ring, broke red ring", () => {
  const w = { state: "working", working: 2, needs: 0, broke: 0, leftMin: null, line: "" } as const;
  assert.deepEqual(statusLook(undefined, 0, false), { dim: 0, glow: 0, ring: null, ringOpacity: 0, count: 0 });
  assert.ok(statusLook({ ...w, state: "idle", working: 0 }, 0, false).dim > 0);
  const a = statusLook(w, 0, false).glow, b = statusLook(w, PULSE_PERIOD / 2, false).glow;
  assert.ok(b > a && b <= 0.3 + 1e-9, "a gentle pulse");
  assert.equal(statusLook(w, 0, true).glow, statusLook(w, 1.3, true).glow, "reduced motion: steady");
  assert.equal(statusLook(w, 0, false).count, 2);
  assert.equal(statusLook({ ...w, state: "needs" }, 0, false).ring, "amber");
  assert.equal(statusLook({ ...w, state: "broke" }, 0, false).ring, "red");
  assert.ok(Number.isFinite(statusLook(w, NaN, false).glow));
});

test("badge and sentence helpers", () => {
  assert.equal(countBadge(undefined), "");
  assert.equal(countBadge({ state: "working", working: 12, needs: 0, broke: 0, leftMin: null, line: "" }), "9+");
  assert.equal(sentenceRest("STUDIO: making the Shorts"), "Making the Shorts");
});
