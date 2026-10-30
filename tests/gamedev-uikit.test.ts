import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_KIT, abbrev, cleanKit, contrast, kitIssues, kitLuau, type UiKit } from "../src/lib/gamedev-uikit-pure.ts";
import { SEED_WORLD, validateDevWorld } from "../src/lib/devworld-pure.ts";

test("contrast follows WCAG", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
});

test("default kit passes every preview mode", () => {
  for (const m of ["short", "long", "touch", "lowres"] as const) assert.deepEqual(kitIssues(DEFAULT_KIT, m), [], m);
});

test("preview modes catch contrast, touch, long text and low-res problems", () => {
  const k: UiKit = { ...DEFAULT_KIT, body: 12, spacing: 4, card: 220, colors: { ...DEFAULT_KIT.colors, text: "#334155" } };
  assert.ok(kitIssues(k, "short").includes("textContrast"));
  assert.ok(kitIssues(k, "touch").includes("touchTarget")); // 12 + 8 < 44
  assert.ok(kitIssues(k, "lowres").includes("lowresText"));
  assert.ok(kitIssues(k, "lowres").includes("lowresFit")); // 220px cards: only 2 fit in 640
  assert.ok(kitIssues({ ...DEFAULT_KIT, card: 70, body: 20 }, "long").includes("longTruncated"));
});

test("abbrev matches the Luau rule", () => {
  assert.equal(abbrev(999), "999"); assert.equal(abbrev(1234), "1.2K"); assert.equal(abbrev(2_500_000), "2.5M"); assert.equal(abbrev(-1500), "-1.5K");
});

test("Luau module: theme from the kit, injected text escaped, balanced blocks", () => {
  const src = kitLuau({ ...DEFAULT_KIT, currency: 'Gems"); os.exit() --' }, "Pet\nSim");
  assert.match(src, /Font = Enum\.Font\.GothamBold/);
  assert.match(src, /Primary = Color3\.fromHex\("#22c55e"\)/);
  assert.match(src, /Currency = "Gems\\"\); os\.exit\(\) --"/);
  assert.match(src, /^-- Pet Sim UI kit/);
  for (const fn of ["Button", "InventoryCard", "CurrencyLabel", "Toast", "Abbrev"]) assert.match(src, new RegExp(`function Kit\\.${fn}\\(`));
  const opens = (src.match(/\b(function|then|do)\b/g) ?? []).length - (src.match(/\belseif\b/g) ?? []).length - (src.match(/\bif\b[^\n]*\bthen\b[^\n]*\belse\b/g) ?? []).length;
  assert.ok(opens > 0 && src.trim().endsWith("return Kit"));
});

test("kit is validated and stored on the game", () => {
  assert.throws(() => cleanKit({ ...DEFAULT_KIT, body: 2 }, "G"), /body/);
  assert.throws(() => cleanKit({ ...DEFAULT_KIT, colors: { ...DEFAULT_KIT.colors, text: "red" } }, "G"), /colour/);
  assert.throws(() => cleanKit({ ...DEFAULT_KIT, icon: "http://x" }, "G"), /icon/);
  const w = structuredClone(SEED_WORLD); w.games[0].uikit = { ...DEFAULT_KIT, colors: { ...DEFAULT_KIT.colors, text: "#FFFFFF" } };
  const r = validateDevWorld(w); assert.ok(r.ok);
  if (r.ok) assert.equal(r.world.games[0].uikit?.colors.text, "#ffffff");
});
