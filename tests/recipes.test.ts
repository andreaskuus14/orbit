import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRecipe, parseRunRecipe, validateRecipe } from "../src/lib/recipes-pure.ts";

test("validateRecipe needs a name, a valid agent slug and a request", () => {
  assert.equal(validateRecipe({ agent: "nova", request: "x" }), "Give the recipe a name");
  assert.equal(validateRecipe({ name: "a", agent: "../x", request: "x" }), "Unknown agent");
  assert.equal(validateRecipe({ name: "a", agent: "nova", request: "  " }), "The recipe needs a task request");
  assert.deepEqual(validateRecipe({ name: "  Daily   ideas ", agent: "Forge", request: "Find 3 ideas\u0007" }), { name: "Daily ideas", agent: "forge", request: "Find 3 ideas" });
});

test("run recipe commands: whole utterance only, English and Estonian", () => {
  assert.equal(parseRunRecipe("run recipe daily ideas"), "daily ideas");
  assert.equal(parseRunRecipe("Orbit, run the recipe Daily Ideas!"), "daily ideas");
  assert.equal(parseRunRecipe("käivita retsept igapäevased ideed"), "igapäevased ideed");
  for (const t of ["how do I run recipe tests", "recipe daily ideas", "what does run recipe do", "please explain recipes", "I ran the recipe yesterday"])
    assert.equal(parseRunRecipe(t), null, t);
  assert.equal(parseRunRecipe("run recipe"), null);
});

test("matchRecipe: exact, unique partial, else closest names", () => {
  const list = [{ id: "1", name: "Daily YouTube ideas" }, { id: "2", name: "Weekly market scan" }, { id: "3", name: "Daily news brief" }];
  assert.deepEqual(matchRecipe("daily youtube ideas", list), { id: "1" });
  assert.deepEqual(matchRecipe("market", list), { id: "2" });
  const r = matchRecipe("daily", list);
  assert.ok("closest" in r && r.closest.length === 3 && r.closest.slice(0, 2).every((n) => n.startsWith("Daily")));
});
