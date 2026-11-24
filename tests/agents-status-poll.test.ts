import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUS_COLS, clipLine, taskCols } from "../src/lib/station-pure.ts";

test("fields=status picks the slim columns, anything else keeps the full set", () => {
  assert.equal(taskCols("status", "FULL"), STATUS_COLS);
  assert.equal(taskCols(null, "FULL"), "FULL");
  assert.equal(taskCols("all", "FULL"), "FULL");
  for (const heavy of ["result", "trace", "request", "pending", "error"]) assert.ok(!STATUS_COLS.split(/,\s*/).includes(heavy), heavy);
  for (const need of ["id", "agent", "title", "status", "created_at", "started_at", "finished_at"]) assert.ok(STATUS_COLS.includes(need), need);
});

test("cut-off activity lines end in an ellipsis, no stray closing quote", () => {
  const long = `got “${"x".repeat(100)}”`;
  assert.equal(clipLine(long), `${long.slice(0, 70)}…`);
  assert.ok(!clipLine(long).endsWith("”"));
  assert.equal(clipLine("got “short”"), "got “short”");
});
