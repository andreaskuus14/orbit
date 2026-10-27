import { test } from "node:test";
import assert from "node:assert/strict";
import { RECAP_SEC, cardTiming, isRecap, pickHighlights, recapArgs, recapAss, recapSource } from "../src/lib/clips/recap-pure.ts";
import { originalityIssue } from "../src/lib/clips/publish-checks-pure.ts";
import type { LedgerEvent } from "../src/lib/ledger-pure.ts";

const at = "2026-10-25T10:00:00Z";
const e = (type: string, data: object, id = Math.random().toString(36)) => ({ id, at, type, planet: "core", data }) as unknown as LedgerEvent;

test("highlights: counts in priority order, zeros dropped, first title as the sub line", () => {
  const cards = pickHighlights({
    events: [e("clip.published", { clipId: "c1", title: "🔥 Pet sim secret egg" }), e("focus.session", { minutes: 45 }), e("focus.session", { minutes: 30 }),
      e("goal.step", { goalId: "g1", step: "Draft the pitch", status: "done" }), e("goal.step", { goalId: "g1", step: "Send it", status: "done" }),
      e("goal.step", { goalId: "g2", step: "x", status: "failed" }), e("deal.found", { wishId: "w", offerId: "o" })],
    tasksDone: ["🌙 Tonight: Research Roblox pet sim retention benchmarks for the next update", "B"], archVersions: 0,
  });
  assert.deepEqual(cards.map((c) => [c.big, c.label]), [["1", "Short published"], ["2", "tasks done"], ["1", "goal moved"], ["1", "deal found"], ["75", "focus minutes"]]);
  assert.equal(cards[0].sub, "Pet sim secret egg", "no emoji (Arial in libass can't draw them)");
  assert.ok(cards[1].sub!.startsWith("Research Roblox") && cards[1].sub!.endsWith("…") && cards[1].sub!.length <= 40);
  assert.equal(cards[2].sub, "Draft the pitch");
});

test("highlights: an empty day gives no cards; ARCH versions count", () => {
  assert.deepEqual(pickHighlights({ events: [], tasksDone: [], archVersions: 0 }), []);
  assert.deepEqual(pickHighlights({ events: [], tasksDone: [], archVersions: 3 }), [{ big: "3", label: "ARCH versions saved" }]);
});

test("timing: always RECAP_SEC, cards back to back between intro and outro", () => {
  for (const n of [1, 3, 6]) {
    const t = cardTiming(n);
    assert.equal(t.cards.length, n);
    assert.equal(t.cards[0].start, t.intro.end);
    assert.equal(t.cards.at(-1)!.end, t.outro.start);
    t.cards.slice(1).forEach((c, i) => assert.equal(c.start, t.cards[i].end));
    assert.equal(t.outro.end, RECAP_SEC);
  }
});

test("ASS: one Dialogue per line, override braces in titles can't inject tags", () => {
  const ass = recapAss([{ big: "2", label: "tasks done", sub: "evil {\\pos(0,0)} title" }], "2026-10-25");
  assert.match(ass, /Sun 25 Oct/);
  assert.match(ass, /TASKS DONE/);
  assert.ok(!ass.includes("{\\pos(0,0)}"));
  assert.equal(ass.split("\n").filter((l) => l.startsWith("Dialogue:")).length, 3 + 3 + 2);
});

test("ffmpeg args: gradient background, ass burn-in, silence without music, music bed with fades when there is one", () => {
  const silent = recapArgs({ ass: "recap.ass", out: "clip-1.mp4" });
  const fc = silent[silent.indexOf("-filter_complex") + 1];
  assert.ok(silent.some((a) => a.startsWith("gradients=s=1080x1920")));
  assert.ok(silent.includes("anullsrc=r=48000:cl=stereo"));
  assert.match(fc, /^\[0:v\]ass=recap\.ass,format=yuv420p\[v\];\[1:a\]atrim=0:25\[a\]$/);
  assert.equal(silent.at(-1), "clip-1.mp4");
  const m = recapArgs({ ass: "recap.ass", music: "/studio/music/bed.mp3", out: "o.mp4" });
  assert.deepEqual(m.slice(m.indexOf("/studio/music/bed.mp3") - 3, m.indexOf("/studio/music/bed.mp3")), ["-stream_loop", "-1", "-i"]);
  assert.match(m[m.indexOf("-filter_complex") + 1], /volume=0\.15.*afade=t=in.*afade=t=out:st=23/);
});

test("a recap job is never publishable, even with an owner note", () => {
  const job = { source: recapSource("2026-10-25"), options: { count: 1, maxSec: 25, captions: false } };
  assert.ok(isRecap(job));
  assert.match(originalityIssue(job, { original: "my own commentary layer here" }) ?? "", /never posted/);
  assert.equal(isRecap({ source: "inbox/stream.mp4" }), false);
});
