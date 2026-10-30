// CORE chat reads over the scene: solid surface token, dimmed scene, no decorative label on the text, readable bubbles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseColor } from "../src/lib/contrast-pure.ts";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const tok = /--core-surface:\s*([^;]+);/.exec(css);

test("CORE chat sits on a near-opaque surface and the scene dims behind it", () => {
  assert.ok(tok && parseColor(tok[1])[3] >= 0.9, "--core-surface alpha < 0.9");
  assert.match(css, /\.orbit-shell \.drawer\.glass:has\(\.core-ws\) \{ background-color: var\(--core-surface\); \}/);
  assert.match(css, /\.orbit-shell:has\(\.core-ws \.bubble\) div:has\(> canvas\) \{ filter: brightness\(0\.[0-5]/);
});

test("HUD serial label is hidden while a conversation is open", () => {
  assert.match(css, /\.orbit-shell \.drawer:has\(\.core-ws \.bubble\)::after \{ display: none; \}/);
});

test("bubbles are 15px+, ~1.5 line-height, and the composer is set apart", () => {
  assert.match(css, /\.core-ws \.bubble \{ font-size: 15px; line-height: 1\.5;/);
  assert.match(css, /\.core-ws \.bubble\.user \{[^}]*border-color/);
  assert.match(css, /\.core-ws form \{ border-top/);
});
