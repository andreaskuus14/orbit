import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Guard for audit finding P0 #3: `.order(ascending: true).limit(n)` returns the OLDEST n rows, so a long chat resumed without
// its latest messages. Take the newest n (ascending: false) and reverse. Oldest-first on purpose needs "oldest-first ok" on the line.
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []; });

test("no capped query silently keeps the oldest rows", () => {
  const src = path.join(import.meta.dirname, "..", "src");
  const bad = files(src).flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [l, `${path.relative(src, f)}:${i + 1}`] as const)
    .filter(([l]) => /ascending:\s*true\s*\}\)\s*\.limit\(/.test(l) && !/oldest-first ok/.test(l)).map(([, at]) => at));
  assert.deepEqual(bad, []);
});
