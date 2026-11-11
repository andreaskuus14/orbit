import assert from "node:assert/strict";
import { test } from "node:test";
import { vaultTextDiff } from "../src/lib/vault-text-diff-pure.ts";

test("reports removed and added lines with their original line numbers", () => {
  assert.deepEqual(vaultTextDiff("title\nold\nkeep\nend", "title\nnew\nkeep\nextra\nend"), {
    total: 3,
    changes: [
      { kind: "removed", line: 2, text: "old" },
      { kind: "added", line: 2, text: "new" },
      { kind: "added", line: 4, text: "extra" },
    ],
  });
});

test("handles empty files, duplicate lines and Windows line endings", () => {
  assert.deepEqual(vaultTextDiff("a\r\na\r\nb", "a\na\nb"), { changes: [], total: 0 });
  assert.deepEqual(vaultTextDiff("a\na\nb", "a\nb"), {
    total: 1,
    changes: [{ kind: "removed", line: 2, text: "a" }],
  });
  assert.deepEqual(vaultTextDiff("", "a"), {
    total: 1,
    changes: [{ kind: "added", line: 1, text: "a" }],
  });
});

test("bounds both comparison work and rendered changes", () => {
  assert.equal(vaultTextDiff("a\n".repeat(1000), "b\n".repeat(1000)), null);
  const result = vaultTextDiff("", "line\n".repeat(500));
  assert.equal(result?.total, 501);
  assert.equal(result?.changes.length, 400);
});
