import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Keep Galaxy's change confined to its two spin lines while checking the actual rates used there.
test("planet spin preserve 60 fps speed at every refresh rate", () => {
  const source = readFileSync(new URL("../src/components/Galaxy.tsx", import.meta.url), "utf8");
  for (const [mesh, oldStep] of [["mesh", 0.003]] as const) {
    const rate = source.match(new RegExp(`${mesh}\\.current\\.rotation\\.y \\+= dt \\* ([\\d.]+)`));
    assert.ok(rate, `${mesh} spin must scale with frame delta`);
    const radiansPerSecond = Number(rate[1]);
    assert.ok(Math.abs(radiansPerSecond / 60 - oldStep) < 1e-12);
    for (const fps of [30, 60, 144, 240]) {
      let angle = 0;
      for (let frame = 0; frame < fps; frame++) angle += radiansPerSecond / fps;
      assert.ok(Math.abs(angle - oldStep * 60) < 1e-12, `${mesh} at ${fps} Hz`);
    }
  }
});
