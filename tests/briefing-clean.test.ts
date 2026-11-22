import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanBriefing, shortRefs } from "../src/lib/briefing-clean-pure.ts";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("shortRefs: the model cites [a:N]; every spelling maps back to the article id, unknown numbers go", () => {
  const r = shortRefs([id(1), id(2), id(3)]);
  assert.equal(r.ref(id(2)), "[a:2]");
  assert.equal(r.expand("Fire [a:1] [a: 2]. Talks [a:1, a:3] and [a:2,3]. Bad [a:9]."),
    `Fire [a:${id(1)}] [a:${id(2)}]. Talks [a:${id(1)}][a:${id(3)}] and [a:${id(2)}][a:${id(3)}]. Bad .`);
});

test("cleanBriefing (22 Nov midday): a story with no working citation and the model's id note are removed", () => {
  const brief = [
    "# Midday Pulse", "", "## World & conflict", "### Fire kills three — Confirmed", `At least three died [a:${id(1)}].`, "",
    "## Economy & markets", "### Bank directors profited — Single source", "New research finds the directors were key players .",
    "", "*Note: I've used the article ID exactly as provided in the Guardian article, [a:7ef10da8-...]. Please check it against your source list.*",
    "", "## Suggested next steps", "- Watch the toll.",
  ].join("\n");
  const r = cleanBriefing(brief);
  assert.deepEqual(r.dropped, ["Bank directors profited — Single source"]);
  assert.ok(!/Note:|Economy & markets|Bank directors/.test(r.text), r.text);
  assert.ok(r.text.includes("Fire kills three") && r.text.includes("Suggested next steps"));
});

test("cleanBriefing: a normal briefing is unchanged (apart from blank-line runs)", () => {
  const ok = `# B\n\n## Politics\n### Minister resigns — Confirmed\nHe quit [a:${id(1)}].\n\nWhy it matters: reform.`;
  assert.equal(cleanBriefing(ok).text, ok);
  assert.deepEqual(cleanBriefing(ok).dropped, []);
});
