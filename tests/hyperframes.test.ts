import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComposition, burnAssArgs, captionEvents, esc, fxPlan, hfRenderArgs, overlayArgs, payoffs } from "../src/lib/clips/hyperframes-pure.ts";
import type { Word } from "../src/lib/clips/pure.ts";

const words: Word[] = [
  { start: 0.2, end: 0.5, text: "this" }, { start: 0.5, end: 0.9, text: "is" }, { start: 0.9, end: 1.3, text: "insane." },
  { start: 2, end: 2.4, text: "NO", loud: true }, { start: 2.4, end: 2.8, text: "way" }, { start: 3, end: 3.3, text: "WHAT", loud: true },
  { start: 6, end: 6.5, text: "<script>alert(1)</script>", loud: true },
];
const pb = (effects: string[], n = 5) => ({ n, payoffAt: 0.5, effects: effects.map((label) => ({ label, n })) });

test("escaping: no markup or script survives from hook or transcript", () => {
  assert.equal(esc(`a<b>&"c'\n`), "a&lt;b&gt;&amp;&quot;c&#39;");
  assert.ok(buildComposition({ hook: "a & b", words: [], duration: 3 })!.includes("A &amp; B")); // upper-cased before escaping
  const html = buildComposition({ hook: `</style><script>x()</script>`, words, duration: 10, playbook: pb(["text pop-up"]) })!;
  assert.equal((html.match(/<script/gi) ?? []).length, 0);
  assert.equal((html.match(/<\/style>/g) ?? []).length, 1);
  assert.ok(html.includes("&lt;SCRIPT&gt;ALERT(1)&lt;/SCRIPT&gt;!")); // the shouted word as a pop-up, escaped
  assert.ok(!/https?:\/\//.test(html) && !/Date\.now|Math\.random/.test(html)); // nothing from the network, nothing non-deterministic
});

test("timing matches buildAss: per-word karaoke events never overlap, classic one per group", () => {
  const k = captionEvents(words, 10, "karaoke");
  assert.deepEqual(k.slice(0, 3).map((e) => [e.start, e.end, e.on]), [[0.2, 0.5, 0], [0.5, 0.9, 1], [0.9, 1.3, 0]]);
  assert.ok(k.every((e, i) => e.end > e.start && (i === 0 || e.start >= k[i - 1].end)));
  assert.equal(k.find((e) => e.words.includes("NO"))!.loud, true);
  const c = captionEvents(words, 10, "classic");
  assert.ok(c.every((e) => e.on === -1) && c.length < k.length);
  const html = buildComposition({ hook: "Watch this", words, duration: 7.25 })!;
  assert.ok(html.includes('data-duration="7.25"') && html.includes('id="hook" class="clip hook" data-start="0" data-duration="1.5"'));
  assert.ok(html.includes('id="c0" class="clip cap karaoke" data-start="0.2" data-duration="0.3"'));
  assert.equal(html, buildComposition({ hook: "Watch this", words, duration: 7.25 })); // deterministic
});

test("effect selection: playbook gates pop-ups, words gate captions, style passes through", () => {
  assert.deepEqual(fxPlan({ hook: "", words, duration: 10 }), { captions: "karaoke", hook: false, emoji: false, popups: false });
  assert.deepEqual(fxPlan({ hook: "h", words, duration: 10, style: "classic", playbook: pb(["emoji", "text pop-up"], 4) }), { captions: "classic", hook: true, emoji: false, popups: false });
  assert.deepEqual(fxPlan({ hook: "h", words, duration: 10, playbook: pb(["emoji"]) }), { captions: "karaoke", hook: true, emoji: true, popups: false });
  assert.deepEqual(payoffs(words, 10).map((p) => p.t), [2, 6]); // shouted, after the hook card, ≥ 3 s apart
  assert.deepEqual(payoffs(words.map((w) => ({ ...w, loud: false })), 10, 0.3).map((p) => p.text), ["WHAT"]); // nearest the playbook payoff
  const html = buildComposition({ hook: "", words, duration: 10, playbook: pb(["emoji"]) })!;
  assert.ok(html.includes('id="e0" class="clip emoji" data-start="2"') && !html.includes('class="clip popup"'));
});

test("empty words: hook only, or nothing at all", () => {
  const html = buildComposition({ hook: "Big hook", words: [], duration: 5, playbook: pb(["emoji", "text pop-up"]) })!;
  assert.ok(html.includes("BIG HOOK") && !html.includes("clip cap") && !html.includes("clip emoji"));
  assert.equal(buildComposition({ hook: "  ", words: [], duration: 5 }), null);
});

test("argv: alpha MOV render, overlay keeps audio, ASS fallback name checked", () => {
  assert.deepEqual(hfRenderArgs("/p", "/o.mov"), ["render", "/p", "--format", "mov", "--fps", "30", "--output", "/o.mov", "--quiet"]);
  const o = overlayArgs("c.mp4", "c.fx.mov", "c.mp4.fx.mp4");
  assert.ok(o.includes("0:a?") && o.join(" ").includes("overlay=0:0") && o.at(-1) === "c.mp4.fx.mp4");
  assert.ok(burnAssArgs("c.mp4", "c.ass", "t.mp4").includes("ass=c.ass"));
  assert.throws(() => burnAssArgs("c.mp4", "x;y.ass", "t.mp4"));
});
