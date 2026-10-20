import { test } from "node:test";
import assert from "node:assert/strict";
import { languageVerdict } from "../src/lib/clips/lang-pure.ts";

test("clip language verdict: English majority passes, non-English majority is skipped, nothing known never blocks", () => {
  assert.equal(languageVerdict(["en"]), "english");
  assert.equal(languageVerdict(["zh", "zh", "en"]), "other");
  assert.equal(languageVerdict(["en", "ja"]), "english"); // a tie keeps the clip: never drop English by accident
  assert.equal(languageVerdict(["ja"]), "other");
  assert.equal(languageVerdict([null, null]), "unknown");
  assert.equal(languageVerdict([]), "unknown");
});
