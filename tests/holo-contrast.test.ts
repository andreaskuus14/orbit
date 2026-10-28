// Holo HUD theme: text tokens must stay WCAG AA (4.5:1) on the holo glass, read straight from globals.css.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrast, over, parseColor, type RGBA } from "../src/lib/contrast-pure.ts";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(root);
  assert.ok(m, `token --${name} missing`);
  return parseColor(m[1]);
};

test("contrast helpers match known WCAG values", () => {
  assert.equal(contrast(parseColor("#000"), parseColor("#ffffff")).toFixed(1), "21.0");
  assert.equal(contrast(parseColor("#777777"), parseColor("#fff")).toFixed(2), "4.48");
  assert.deepEqual(over(parseColor("rgba(255, 255, 255, 0.5)"), parseColor("#000")), [127.5, 127.5, 127.5, 1]);
  assert.throws(() => parseColor("hsl(0 0% 0%)"));
});

test("holo glass keeps text tokens AA, even over a bright patch of the galaxy", () => {
  // Backdrops: the page's own --bg, and a bright blurred nebula/planet region behind the glass (worst case).
  for (const backdrop of [token("bg"), parseColor("#2a3a55")]) {
    // Worst spot of the panel: tint, then the full top-left sheen, the cyan rim wash and the scan line's peak.
    let bg: RGBA = over(token("holo-tint"), backdrop);
    bg = over(token("holo-sheen"), bg);
    bg = over(parseColor("rgba(34, 211, 238, 0.09)"), bg);
    bg = over(parseColor("rgba(125, 233, 255, 0.09)"), bg);
    for (const fg of ["ink", "holo-muted", "cyan", "mint", "amber", "holo-rose"]) {
      const r = contrast(token(fg), bg);
      assert.ok(r >= 4.5, `--${fg} on holo glass over ${backdrop.slice(0, 3)}: ${r.toFixed(2)} < 4.5`);
    }
    const h3 = contrast(parseColor("#7dd3fc"), bg); // .h3 labels
    assert.ok(h3 >= 4.5, `.h3 on holo glass: ${h3.toFixed(2)}`);
  }
});
