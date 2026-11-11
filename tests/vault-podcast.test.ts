import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, parseDialogue, sourceText } from "../src/lib/vault-podcast-pure.ts";

test("parseDialogue maps speakers, joins follow-on lines, strips markdown", () => {
  const l = parseDialogue("Intro junk\nHOST: Welcome to **the** show.\nGUEST: Thanks.\nIt covers [two](http://x) things.\n**HOST:** Bye.");
  assert.deepEqual(l, [
    { who: "anchor", text: "Welcome to the show." },
    { who: "analyst", text: "Thanks. It covers two things." },
    { who: "anchor", text: "Bye." },
  ]);
});

test("sourceText shares the budget and skips empty files", () => {
  const s = sourceText([{ name: "a.pdf", text: "x".repeat(100) }, { name: "b.txt", text: "  " }, { name: "c.md", text: "y".repeat(100) }], 60);
  assert.match(s, /=== a\.pdf ===\nx{30}\n/);
  assert.ok(!s.includes("b.txt"));
  assert.match(s, /=== c\.md ===\ny{30}$/);
});

test("cacheKey is order-free and changes with a new version", () => {
  const a = cacheKey([{ name: "a", mtime: 1 }, { name: "b", mtime: 2 }]);
  assert.equal(a, cacheKey([{ name: "b", mtime: 2 }, { name: "a", mtime: 1 }]));
  assert.notEqual(a, cacheKey([{ name: "a", mtime: 3 }, { name: "b", mtime: 2 }]));
});
