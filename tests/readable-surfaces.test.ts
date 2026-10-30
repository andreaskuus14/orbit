// V01-V03: working panels hide the scene, panels never need a sideways scrollbar, the global nav keeps a scrim. Read from globals.css.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseColor } from "../src/lib/contrast-pure.ts";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const tok = (name: string) => { const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(root); assert.ok(m, `--${name} missing`); return m[1]; };

test("panel surfaces are opaque enough to read over the brightest scene", () => {
  for (const name of ["panel-surface", "work-surface"]) assert.ok(parseColor(tok(name))[3] >= 0.85, `--${name} alpha < 0.85`);
  assert.match(css, /\.drawer, \.world-panel \{ background-color: var\(--panel-surface\); \}/);
  assert.match(css, /\.studio \.glass \{[^}]*var\(--work-surface\)/);
});

test("world panels shrink and wrap instead of scrolling sideways", () => {
  assert.match(css, /\.world-panel \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.world-panel :where\(\.field, input, select, textarea\) \{ min-width: 0; \}/);
  assert.match(css, /\.world-panel \.flex:has\(> \.chip, > \.btn\) \{ flex-wrap: wrap; \}/);
});

test("global nav sits on a scrim and the studio scene dims under an editor", () => {
  assert.match(tok("nav-scrim"), /rgba\(2, 4, 11, 0\.8\d?\)/);
  assert.match(css, /main > header::before \{[^}]*var\(--nav-scrim\)/);
  assert.match(css, /\.studio:has\(\.studio-sheet\) \.studio-vignette/);
});
