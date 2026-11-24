import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { accent, accentCss, accentInk, accentSet, closeAccents, contrast, menuMove, menuSeek, mix, NEUTRAL, pushToast, RADIUS, SHELL_IDS, TOAST_MAX, toastMs, TYPE } from "../src/lib/planet-ui-pure.ts";
import { PLANETS } from "../src/lib/planets.ts";
import { lint } from "./a11y-static.test.ts";

const css = readFileSync(new URL("../src/app/planet-ui.css", import.meta.url), "utf8");
const uiDir = new URL("../src/components/ui/", import.meta.url);

test("contrast: WCAG reference values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
});

test("text colours pass AA (4.5:1) on every surface", () => {
  for (const ink of [NEUTRAL.ink, NEUTRAL.ink2, NEUTRAL.ink3, NEUTRAL.good, NEUTRAL.warn, NEUTRAL.bad])
    for (const s of [NEUTRAL.bg, NEUTRAL.surface, NEUTRAL.raised, NEUTRAL.overlay]) assert.ok(contrast(ink, s) >= 4.5, `${ink} on ${s}: ${contrast(ink, s).toFixed(2)}`);
});

test("every planet has one accent from lib/planets.ts, an AA ink and a readable primary button", () => {
  for (const p of PLANETS) assert.equal(accent(p.id), p.color);
  for (const id of SHELL_IDS) {
    const s = accentSet(id);
    assert.ok(contrast(s.ink, NEUTRAL.raised) >= 4.5, `${id} ink`);
    assert.ok(contrast(s.on, s.fill) >= 4.5, `${id} button text`);
  }
  assert.equal(accentInk("#ffffff"), "#ffffff");
  assert.notEqual(accentInk("#3b0764"), "#3b0764"); // a dark accent gets lightened for text
});

test("planet-ui.css declares exactly the generated accent blocks", () => {
  for (const id of SHELL_IDS) assert.ok(css.includes(accentCss(id)), `missing or stale: ${accentCss(id)}`);
});

test("planet-ui.css declares the type scale and radii from the pure tokens", () => {
  for (const [k, v] of Object.entries(TYPE)) assert.ok(css.includes(`--pu-${k}: ${v.weight} ${v.size}px/${v.line}px`), `type ${k}`);
  for (const [k, v] of Object.entries(RADIUS)) assert.ok(css.includes(`--pu-r-${k}: ${v}px`), `radius ${k}`);
  for (const [k, v] of Object.entries(NEUTRAL)) assert.ok(css.toLowerCase().includes(v), `colour ${k}`);
});

test("planet-ui.css: scoped, animates only transform/opacity, has reduced-motion and motion-off blocks", () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const sel of body.split("}").map((r) => r.split("{")[0].trim()).filter(Boolean)) {
    if (sel.startsWith("@") || /^(from|to|\d+%)/.test(sel) || sel === "") continue;
    const parts = sel.split(",").map((s) => s.trim());
    for (const s of parts) assert.ok(/^(\.pu|\[data-planet|button\.pu|a\.pu|html\[data-motion="off"\] \.pu)/.test(s) || /^\.pu/.test(s), `unscoped selector: ${s}`);
  }
  for (const m of body.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\}\s*\}?/g))
    for (const prop of m[1].matchAll(/([a-z-]+)\s*:/g)) assert.ok(["opacity", "transform", "background-position"].includes(prop[1]), `keyframe animates ${prop[1]}`);
  for (const m of body.matchAll(/transition:\s*([^;]+);/g))
    for (const part of m[1].split(",")) assert.ok(/^(none|transform|opacity|background-color|color|box-shadow)\b/.test(part.trim()), `transition on ${part.trim()}`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /html\[data-motion="off"\] \.pu/);
});

test("BUSINESS has its own accent (#fb923c, owner decision); no other pair moved closer", () => {
  const close = closeAccents().map((p) => p.join("/"));
  assert.ok(!close.some((p) => p.includes("business")), close.join(", "));
  assert.equal(accent("business"), "#fb923c");
});

test("toasts: timing and stacking", () => {
  assert.equal(toastMs({ text: "Saved" }), 4000);
  assert.equal(toastMs({ text: "Saved", action: true }), 6000);
  assert.equal(toastMs({ text: "Didn't work", tone: "error" }), 7000);
  assert.ok(toastMs({ text: "x".repeat(400) }) <= 10000);
  let l: { id: string }[] = [];
  for (const id of ["a", "b", "c", "d"]) l = pushToast(l, { id });
  assert.deepEqual(l.map((x) => x.id), ["b", "c", "d"]);
  assert.equal(l.length, TOAST_MAX);
  assert.deepEqual(pushToast(l, { id: "c" }).map((x) => x.id), ["b", "d", "c"]); // same id replaces and moves to newest
});

test("menu keyboard: wraps, skips disabled, Home/End, typeahead", () => {
  const dis = [false, true, false, false];
  assert.equal(menuMove(dis, -1, "Home"), 0);
  assert.equal(menuMove(dis, 0, "ArrowDown"), 2);
  assert.equal(menuMove(dis, 3, "ArrowDown"), 0);
  assert.equal(menuMove(dis, 0, "ArrowUp"), 3);
  assert.equal(menuMove(dis, 0, "End"), 3);
  assert.equal(menuMove([true, true], 0, "ArrowDown"), -1);
  assert.equal(menuSeek(["All tools", "Settings", "Help", "Stop"], [false, false, false, false], 0, "s"), 1);
  assert.equal(menuSeek(["All tools", "Settings", "Help", "Stop"], [false, false, false, false], 1, "s"), 3);
  assert.equal(menuSeek(["All tools"], [false], 0, "z"), 0);
});

test("ui kit: every component passes the static a11y lint and has no hard-coded English UI text", () => {
  for (const f of readdirSync(uiDir).filter((n) => n.endsWith(".tsx"))) {
    const src = readFileSync(new URL(f, uiDir), "utf8");
    assert.deepEqual(lint(src), [], f);
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // literal text between tags (>Word<) would bypass the caller's EN/ET keys
    assert.equal(/>\s*[A-Za-z][A-Za-z ]{2,}\s*</.test(code), false, `${f} has literal UI text`);
  }
});

test("ARCH has its own clear accent (#a3e635 lime): ≥ 4.5:1 on raised, not close to any planet", () => {
  assert.equal(accent("arch"), "#a3e635");
  assert.ok(contrast(accent("arch"), NEUTRAL.raised) >= 4.5);
  assert.ok(!closeAccents().some((p) => p.includes("arch")), closeAccents().join(", "));
  assert.equal(new Set(PLANETS.map((p) => p.color)).size, PLANETS.length, "every planet colour is unique");
});

test("no browser alert/confirm/prompt in src/components (kit askConfirm/askText instead)", () => {
  const dir = new URL("../src/components/", import.meta.url), bad: string[] = [];
  const walk = (u: URL) => {
    for (const e of readdirSync(u, { withFileTypes: true })) {
      if (e.isDirectory()) { walk(new URL(`${e.name}/`, u)); continue; }
      if (!/\.tsx?$/.test(e.name) || e.name === "RefBoard.tsx") continue; // RefBoard has its own prompt() helper (an AI prompt builder)
      const code = readFileSync(new URL(e.name, u), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (/(?<![\w.])(window\.)?(alert|confirm|prompt)\(/.test(code)) bad.push(e.name);
    }
  };
  walk(dir);
  assert.deepEqual(bad, []);
});
