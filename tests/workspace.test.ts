import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAX_FILES, MAX_FILE_BYTES, MAX_WS_BYTES, PREVIEW_HEADERS, PREVIEW_TTL_S, capError, checkPath, contentType, parsePreviewSeg, previewNeedsSession, previewPath, previewSeg, previewValid, sameFile, slugify } from "../src/lib/workspace-pure.ts";
import { isWsTool, wsTainted, wsWriteBlocked } from "../src/lib/core-workspace.ts";

const ok = (p: string) => assert.deepEqual(checkPath(p), { path: p }, p);
const no = (p: unknown) => assert.ok("error" in checkPath(p), String(p));

test("checkPath allows plain relative paths", () => {
  ["index.html", "css/style.css", "js/app.mjs", "data/a b.json", "src/main.luau", "README.md", "img/logo.svg", "a/b/c/d.py"].forEach(ok);
});

test("checkPath refuses traversal, absolute, Windows and odd paths", () => {
  ["../x.html", "a/../../x.html", "..", "./index.html", "a/./b.html", "/etc/passwd.txt", "//srv/x.html", "C:/x.html", "c:x.html",
    "C:\\x.html", "a\\b.html", "..\\x.html", "\\\\srv\\share\\x.html", "a\0.html", "a//b.html", "a/", "", ".trash/x.html", ".env.txt",
    "a/.git/x.txt", "x.html:stream", "CON.txt", "con .txt", "Aux  .md", "nul.html", "com1/x.js", "a./x.html", "x.html ", "~/x.html", "-x.html", "%2e%2e/x.html",
    "x.exe", "x.php", "x", "x.HTML.bat", "a/b/c/d/e/f/g/h/i.html", "a".repeat(201) + ".txt", 5, null].forEach(no);
});

test("slugify", () => {
  assert.equal(slugify("My Cool Site!"), "my-cool-site");
  assert.equal(slugify("Café ÖÄ"), "cafe-oa");
  assert.equal(slugify("../../etc"), "etc");
  assert.equal(slugify("!!!"), null);
  assert.equal(slugify("con"), null);
  assert.equal(slugify("x".repeat(80))!.length, 40);
});

test("caps", () => {
  assert.equal(capError(100, null, 0, 0), null);
  assert.ok(capError(MAX_FILE_BYTES + 1, null, 0, 0));
  assert.ok(capError(10, null, MAX_FILES, 0)); // new file over the count
  assert.equal(capError(10, 5, MAX_FILES, 0), null); // replacing one is fine
  assert.ok(capError(1000, null, 1, MAX_WS_BYTES - 999));
  assert.equal(capError(1000, 1000, 1, MAX_WS_BYTES), null); // same size replace at the limit
  // Index.html vs index.html: one file on Windows/macOS (replace, no new slot), two on Linux
  assert.equal(sameFile("Index.html", "index.html", true), true);
  assert.equal(sameFile("Index.html", "index.html", false), false);
});

test("content types: only html/css/js/svg render, code is plain text", () => {
  assert.equal(contentType("index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("a/STYLE.CSS"), "text/css; charset=utf-8");
  assert.equal(contentType("app.mjs"), "text/javascript; charset=utf-8");
  assert.equal(contentType("logo.svg"), "image/svg+xml");
  for (const f of ["x.md", "x.py", "x.lua", "x.luau", "x.csv", "x.txt"]) assert.equal(contentType(f), "text/plain; charset=utf-8");
  assert.equal(contentType("x.exe"), "application/octet-stream");
  const csp = PREVIEW_HEADERS["Content-Security-Policy"];
  assert.match(csp, /^sandbox allow-scripts;/);
  assert.match(csp, /form-action 'none'/);
  assert.doesNotMatch(csp, /allow-same-origin|https:|\*/); // no other origin can be reached
});

test("preview links: signed, expiring, tied to the workspace nonce", () => {
  const key = Buffer.alloc(32, 7), uid = "0b5e-uuid-1", now = 1_800_000_000;
  const seg = previewSeg(key, "nonceA", uid, "my-site", now);
  const p = parsePreviewSeg(seg)!;
  assert.deepEqual({ uid: p.uid, slug: p.slug, exp: p.exp }, { uid, slug: "my-site", exp: String(now + PREVIEW_TTL_S) });
  assert.equal(previewValid(key, "nonceA", p, now), true);
  assert.equal(previewValid(key, "nonceA", p, now + PREVIEW_TTL_S), true);
  assert.equal(previewValid(key, "nonceA", p, now + PREVIEW_TTL_S + 1), false); // expired
  assert.equal(previewValid(key, "nonceB", p, now), false); // workspace recreated → new nonce
  assert.equal(previewValid(Buffer.alloc(32, 8), "nonceA", p, now), false); // other PC's key
  assert.equal(previewValid(key, "nonceA", { ...p, slug: "other" }, now), false);
  assert.equal(previewValid(key, "nonceA", { ...p, exp: String(now + 10 * PREVIEW_TTL_S) }, now), false); // extended expiry
  assert.equal(parsePreviewSeg(`${seg}.x`), null);
  assert.equal(parsePreviewSeg(`${uid}.my-site.${p.exp}.`), null);
  assert.equal(parsePreviewSeg(`${uid}.my-site.soon.${p.sig}`), null);
  assert.equal(parsePreviewSeg(`${uid}.My-Site.${p.exp}.${p.sig}`), null);
  assert.equal(previewPath([]), "index.html");
  assert.equal(previewPath(["docs", ""]), "docs/index.html");
  assert.equal(previewPath(["css", "a%20b.css"]), "css/a b.css");
  assert.ok("error" in checkPath(previewPath(["%2e%2e", "x.html"])));
  assert.ok("error" in checkPath(previewPath(["%252e%252e", "x.html"]))); // double-encoded stays refused
  assert.ok("error" in checkPath(previewPath(["..%2fx.html"])));
  assert.ok("error" in checkPath(previewPath(["%E0%A4%A"]))); // malformed escape doesn't throw
});

test("preview needs the session for page loads, not for the page's own assets", () => {
  for (const d of [null, undefined, "", "document", "iframe", "frame", "embed", "object", "fencedframe", "Document"]) assert.equal(previewNeedsSession(d), true, String(d));
  for (const d of ["script", "style", "image", "font", "empty", "manifest"]) assert.equal(previewNeedsSession(d), false, d);
});

test("workspace writes only when the latest message asks", () => {
  for (const q of ["build me a website about cats", "Make a landing page for my game", "create a python script that renames files", "edit the css so it's dark", "save that as a file", "can you build a snake game?", "fix this page"])
    assert.equal(wsWriteBlocked(q, false), null, q);
  for (const q of ["what's the weather?", "how do I make a website?", "explain this html", "don't create any files, just show me", "tell me about cats", "make it so", "fix that", "update this"])
    assert.ok(wsWriteBlocked(q, false), q);
  assert.ok(wsWriteBlocked("build me a website", true)); // page/file text in context
  assert.ok(isWsTool("ws_write") && !isWsTool("life_check"));
  assert.equal(wsTainted([]), false);
  assert.equal(wsTainted(['You called ws_write {"workspace":"x"}\nRESULT:\n...', "You called navigate {}"]), false);
  assert.equal(wsTainted(['You called ws_read {"workspace":"x"}']), true);
  assert.equal(wsTainted(['You called fetch_url {"url":"https://x"}']), true);
});

test("disk: a damaged (short) preview key is refused, not used", async () => {
  const bad = await mkdtemp(path.join(os.tmpdir(), "orbit-ws-key-"));
  await mkdir(path.join(bad, "workspaces"), { recursive: true });
  await writeFile(path.join(bad, "workspaces", ".preview-key"), Buffer.alloc(8, 1).toString("base64url"));
  process.env.ORBIT_DATA_DIR = bad;
  const ws = await import("../src/lib/workspace.ts");
  await assert.rejects(ws.getPreviewKey(), /32-byte/);
});

test("disk: create, write, caps, symlink escape, trash", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "orbit-ws-"));
  process.env.ORBIT_DATA_DIR = dir;
  const ws = await import("../src/lib/workspace.ts");
  assert.equal((await ws.getPreviewKey()).length, 32); // fresh key made after the failed one
  const uid = "user-1";
  assert.deepEqual(await ws.createWorkspace(uid, "My Site"), { slug: "my-site", created: true });
  assert.deepEqual(await ws.createWorkspace(uid, "my site"), { slug: "my-site", created: false });
  assert.deepEqual(await ws.writeWsFile(uid, "my-site", "index.html", "<h1>hi</h1>"), { path: "index.html", bytes: 11, created: true });
  assert.deepEqual(await ws.writeWsFile(uid, "my-site", "css/s.css", "a{}"), { path: "css/s.css", bytes: 3, created: true });
  assert.ok("error" in (await ws.writeWsFile(uid, "my-site", "../x.html", "x")));
  assert.ok("error" in (await ws.writeWsFile(uid, "nope", "a.html", "x")));
  assert.ok("error" in (await ws.writeWsFile(uid, "my-site", "big.txt", "x".repeat(MAX_FILE_BYTES + 1))));
  assert.equal((await ws.readWsFile(uid, "my-site", "index.html"))?.text, "<h1>hi</h1>");
  assert.deepEqual((await ws.listFiles(uid, "my-site"))!.map((f) => f.path), ["css/s.css", "index.html"]);
  // a symlink planted inside the workspace can't be followed out
  // Windows directory junctions exercise the same escape guard without requiring symlink privileges.
  await symlink(os.tmpdir(), path.join(dir, "workspaces", uid, "my-site", "out"), process.platform === "win32" ? "junction" : "dir");
  assert.ok("error" in (await ws.writeWsFile(uid, "my-site", "out/evil.html", "x")));
  assert.equal(await ws.readWsFile(uid, "my-site", "out/evil.html"), null);
  assert.ok("trashed" in (await ws.trashWsFile(uid, "my-site", "css/s.css")));
  assert.deepEqual((await ws.listFiles(uid, "my-site"))!.map((f) => f.path), ["index.html"]);
  assert.equal((await readdir(path.join(dir, "workspaces", uid, "my-site", ".trash"))).length, 1);
  const [info] = await ws.listWorkspaces(uid);
  assert.equal(info.slug, "my-site");
  assert.match(info.preview, /^\/w\/user-1\.my-site\.\d+\.[A-Za-z0-9_-]{22}\/index\.html$/);
  assert.deepEqual(await ws.listWorkspaces("someone-else"), []);
  // the link resolves; after deleting and recreating the workspace the old link is dead
  const seg = info.preview.split("/")[2];
  assert.deepEqual(await ws.resolvePreview(seg), { uid, slug: "my-site" });
  assert.equal(await ws.resolvePreview(seg.replace("user-1", "user-2")), null);
  await rm(path.join(dir, "workspaces", uid, "my-site"), { recursive: true });
  await ws.createWorkspace(uid, "my-site");
  assert.equal(await ws.resolvePreview(seg), null);
  assert.notEqual(await ws.previewUrl(uid, "my-site"), info.preview);
  // a workspace folder that is a symlink is not a workspace
  await symlink(os.tmpdir(), path.join(dir, "workspaces", uid, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(await ws.listFiles(uid, "linked"), null);
  assert.ok("error" in (await ws.writeWsFile(uid, "linked", "a.html", "x")));
  // trash keeps the newest 50, unique names
  await ws.createWorkspace(uid, "t");
  for (let i = 0; i < 52; i++) { await ws.writeWsFile(uid, "t", "a.txt", String(i)); assert.ok("trashed" in (await ws.trashWsFile(uid, "t", "a.txt"))); }
  assert.equal((await readdir(path.join(dir, "workspaces", uid, "t", ".trash"))).length, 50);
});
