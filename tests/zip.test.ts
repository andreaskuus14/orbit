import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { attachment, zipStore } from "../src/lib/zip-pure.ts";
import { checkPath } from "../src/lib/workspace-pure.ts";
import { WS_PROMPT, verifiedLine } from "../src/lib/core-workspace.ts";
import { deliverables } from "../src/lib/core-workspace-pure.ts";

// Reads a store-only zip back through its central directory.
function unzip(z: Buffer) {
  const end = z.length - 22;
  assert.equal(z.readUInt32LE(end), 0x06054b50);
  const n = z.readUInt16LE(end + 10);
  let p = z.readUInt32LE(end + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    assert.equal(z.readUInt32LE(p), 0x02014b50);
    const crc = z.readUInt32LE(p + 16), len = z.readUInt32LE(p + 20), nl = z.readUInt16LE(p + 28), off = z.readUInt32LE(p + 42);
    const name = z.subarray(p + 46, p + 46 + nl).toString("utf8");
    assert.equal(z.readUInt32LE(off), 0x04034b50);
    const start = off + 30 + z.readUInt16LE(off + 26);
    const data = z.subarray(start, start + len);
    assert.equal(crc32(data) >>> 0, crc, name);
    out[name] = data.toString("utf8");
    p += 46 + nl;
  }
  return out;
}

test("zipStore round-trips entries", () => {
  const files = { "index.html": "<h1>hi</h1>", "css/style.css": "body{}", "ä.txt": "õun", "empty.txt": "" };
  const z = zipStore(Object.entries(files).map(([p, t]) => ({ path: p, bytes: Buffer.from(t) })));
  assert.deepEqual(unzip(z), files);
  assert.deepEqual(unzip(zipStore([])), {});
});

test("download: traversal paths refused, attachment name is the last segment and header-safe", () => {
  for (const p of ["../x.html", "a/../../x.html", "/etc/passwd.txt", "C:/x.html", "..\\x.html", ".trash/x.html", "%2e%2e/x.html"]) assert.ok("error" in checkPath(p), p);
  assert.equal(attachment("css/style.css"), `attachment; filename="style.css"; filename*=UTF-8''style.css`);
  assert.ok(!/[\r\n]/.test(attachment('a"\r\nX: y.txt')));
  assert.match(attachment("õun.txt"), /filename="_un.txt"; filename\*=UTF-8''%C3%B5un.txt/);
});

test("zipWorkspace and readWsFile never leave the workspace", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-zip-"));
  process.env.ORBIT_DATA_DIR = dir;
  const ws = await import("../src/lib/workspace.ts");
  const uid = "user-zip";
  await ws.createWorkspace(uid, "site");
  await ws.writeWsFile(uid, "site", "index.html", "<p>x</p>");
  await writeFile(path.join(dir, "workspaces", uid, "secret.txt"), "nope").catch(() => {});
  assert.equal(await ws.readWsFile(uid, "site", "../secret.txt"), null);
  assert.deepEqual(unzip((await ws.zipWorkspace(uid, "site"))!), { "index.html": "<p>x</p>" });
  assert.equal(await ws.zipWorkspace(uid, "nope"), null);
});

test("CORE delivers files as cards, not pasted code", () => {
  assert.match(WS_PROMPT, /never paste a whole file \(over 40 lines\)/);
  assert.match(WS_PROMPT, /Notepad/);
  assert.match(WS_PROMPT, /Previews run sandboxed and offline/);
});

test("verification line is honest", () => {
  assert.equal(verifiedLine(""), "Not checked: saved and read back only");
  assert.match(verifiedLine("\nCheck: skipped (no browser)."), /^Not checked/);
  assert.equal(verifiedLine("\nCheck: checked: ✓ loads, ✓ phone. Give the user the preview link with this check line."), "Checked: ✓ loads, ✓ phone");
  assert.match(verifiedLine("\nCheck: checked: ✗ 1 load problem\nProblems the headless check found"), /problems still listed/);
});

test("deliverables: one card per file, last write wins", () => {
  const d = deliverables([{ kind: "file", id: "s", path: "a.html", bytes: 1 }, { kind: "memory", id: "m" }, { kind: "file", id: "s", path: "a.html", bytes: 2 }, { kind: "file", id: "s", path: "b.css" }]);
  assert.deepEqual(d.map((x) => [x.path, x.bytes]), [["a.html", 2], ["b.css", undefined]]);
});
