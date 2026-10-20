import { test } from "node:test";
import assert from "node:assert/strict";
import { appendActivity } from "../src/lib/core-activity-pure.ts";

test("stream activity ignores empty/repeated labels, bounds history, and keeps genuine retries", () => {
  const original = ["Reading memory"];
  assert.equal(appendActivity(original, "  "), original);
  assert.equal(appendActivity(original, " Reading memory "), original);
  let labels = original;
  for (const label of ["Reading page", "Calling agent", "Checking files", "Writing", "Reading memory"]) labels = appendActivity(labels, label);
  assert.deepEqual(labels, ["Reading page", "Calling agent", "Checking files", "Writing", "Reading memory"]);
  assert.deepEqual(original, ["Reading memory"]);
});
