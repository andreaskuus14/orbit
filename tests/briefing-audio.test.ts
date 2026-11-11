import { test } from "node:test";
import assert from "node:assert/strict";
import { gapAfter, script, speech, stories } from "../src/lib/briefing-audio-pure.ts";

const MD = `## World & conflict
### Ceasefire talks resume in Geneva — Confirmed
Delegations met for six hours on Tuesday [a:12][a:14]. Both sides said a prisoner exchange is on the table [a:12]. A second round is set for Friday. More text. Why it matters: a deal would reopen the grain corridor.
## Economy & markets
### Estonian inflation slows to 3.1% — Single source
Statistics Estonia reported the figure this morning [a:20]. Why it matters: it supports a rate cut.
## Suggested next steps
1. Watch Friday's Geneva round.
2. Check **ECB** minutes on [Thursday](https://example.com).`;

test("speech: citations, links and Markdown are stripped", () => {
  assert.equal(speech("Met for **six** hours [a:12][a:14] — see [this](https://x.y) https://z.com ."), "Met for six hours — see this.");
});

test("stories: sections, headlines, labels, up to 3 facts and the why", () => {
  const s = stories(MD);
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].section, s[0].headline, s[0].single], ["World & conflict", "Ceasefire talks resume in Geneva", false]);
  assert.equal(s[1].single, true);
  assert.equal(s[0].why, "a deal would reopen the grain corridor.");
  assert.ok(!s[0].facts.join(" ").includes("[a:"));
});

test("script: two voices, section lead-ins, single-source flag, follow-ups, no invented facts", () => {
  const L = script("Morning briefing", MD, "Tuesday");
  assert.equal(L[0].who, "anchor"); assert.match(L[0].text, /2 stories/);
  assert.match(L[1].text, /^World & conflict\. Ceasefire talks resume in Geneva\. Delegations met for six hours on Tuesday\./);
  assert.ok(!L[1].text.includes("More text"), "at most three sentences per story");
  assert.equal(L[2].who, "analyst"); assert.match(L[2].text, /^Why it matters: a deal/);
  assert.match(L.find((l) => l.text.includes("inflation"))!.text, /^Economy & markets\./);
  assert.ok(L.some((l) => l.who === "analyst" && /one outlet so far/.test(l.text)));
  assert.match(L.at(-2)!.text, /^To follow up: Watch Friday's Geneva round\. Also: Check ECB minutes on Thursday\./);
  assert.equal(gapAfter(L[1], L[2]), 0.55); assert.equal(gapAfter(L[0], L[1]), 0.35); assert.equal(gapAfter(L.at(-1)!), 0);
});
