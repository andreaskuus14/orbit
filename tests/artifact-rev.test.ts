import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileRev, parseBasis } from "../src/lib/artifact-rev-pure.ts";
import { artifactsFromTrace, checkpointBasis, addLines, type Checkpoint } from "../src/lib/checkpoint-pure.ts";

test("write receipts carry the revision into the checkpoint basis", () => {
  const d = artifactsFromTrace([{ step: "ws_write", detail: "", ok: true, evidence: [{ kind: "file", id: "site", path: "a.md", rev: "sha256:x@1" }] }]);
  assert.deepEqual(d, [{ kind: "artifact", ref: "file:site/a.md", text: "file site/a.md", rev: "sha256:x@1" }]);
  const cp: Checkpoint = { lines: [] };
  addLines(cp, d, "orbit", "2026-10-28T00:00:00Z", () => "1");
  assert.deepEqual(checkpointBasis(cp), [{ ref: "file:site/a.md", rev: "sha256:x@1" }]);
  assert.deepEqual(parseBasis([{ ref: "a", rev: "b" }, { ref: 1 }, "x"]), [{ ref: "a", rev: "b" }]);
});

test("ws_write: a changed pinned file is refused with an explanation; same bytes go through", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-rev-"));
  process.env.ORBIT_DATA_DIR = dir;
  try {
    const ws = await import("../src/lib/workspace.ts");
    const { runWsTool } = await import("../src/lib/core-workspace.ts");
    const { sha256 } = await import("../src/lib/artifact-rev.ts");
    const uid = "user-1";
    await ws.createWorkspace(uid, "site");
    await ws.writeWsFile(uid, "site", "notes.md", "v1");
    const basis = [{ ref: "file:site/notes.md", rev: fileRev(sha256("v1"), 1) }];
    const write = () => runWsTool(uid, "ws_write", { workspace: "site", path: "notes.md", content: "v2 by CORE" }, "edit notes.md in my site", false, 0, undefined, basis);

    assert.match(await write(), /notes\.md updated/); // same bytes as planned → ok
    await ws.writeWsFile(uid, "site", "notes.md", "v1"); // reset, then he edits it outside ORBIT
    await ws.writeWsFile(uid, "site", "notes.md", "his own edit");
    const out = await write();
    assert.match(out, /Not applied: this was based on an older version\. file:site\/notes\.md changed after planning/);
    assert.equal((await ws.readWsFile(uid, "site", "notes.md"))!.text, "his own edit");
    const reread = await runWsTool(uid, "ws_write", { workspace: "site", path: "notes.md", content: "merged" }, "edit notes.md in my site", false, 0, undefined, basis, () => true);
    assert.match(reread, /updated/); // read this answer → refreshed
  } finally { await rm(dir, { recursive: true, force: true }); }
});
