import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256File } from "../src/lib/clips/sha-file.ts";

test("sha256File streams the same digest as hashing the bytes; unreadable gives empty", async () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "sha-")), "a.bin");
  const b = Buffer.alloc(300_000, 7);
  writeFileSync(f, b);
  assert.equal(await sha256File(f), createHash("sha256").update(b).digest("hex"));
  assert.equal(await sha256File(f + ".missing"), "");
});
