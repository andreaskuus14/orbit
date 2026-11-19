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

import { transcriptLanguage } from "../src/lib/clips/lang-pure.ts";
test("transcriptLanguage: English text passes, Spanish is other, too few words is unknown", () => {
  const en = "yo chat what is going on, I can't believe this is the craziest thing I have ever seen in my life bro".split(" ");
  const es = "hola chicos bienvenidos otra vez hoy vamos jugar partida increíble con amigos nuevos mañana".split(" ");
  const many = (ws: string[]) => Array.from({ length: 5 }, () => ws).flat().map((text) => ({ text }));
  assert.equal(transcriptLanguage(many(en)), "english");
  assert.equal(transcriptLanguage(many(es)), "other");
  assert.equal(transcriptLanguage(en.slice(0, 10).map((text) => ({ text }))), "unknown");
});
