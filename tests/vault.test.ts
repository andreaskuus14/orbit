import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeName, uniqueName, withSuffix, renameTarget, kindOf, serveHeaders, contentDisposition, parseRange, extractType, memoryType, snippet, uploadError,
  MAX_FILE, MAX_TOTAL, MAX_FILES, cloudKey, nameFromKey, cloudPath, mergeCloud, cloudFailure, mimeOf,
} from "../src/lib/vault-pure.ts";

test("sanitizeName strips paths, bad chars, dots and reserved names", () => {
  const cases: [unknown, string][] = [
    ["report.pdf", "report.pdf"],
    ["../../etc/passwd", "passwd"],
    ["..\\..\\Windows\\win.ini", "win.ini"],
    ["C:\\Users\\a\\notes.txt", "notes.txt"],
    ["a<b>c:d\"e|f?g*h.txt", "abcdefgh.txt"],
    ["tab\there\u0000.txt", "tabhere.txt"],
    ["...hidden", "hidden"],
    [".index.json", "_index.json"],
    ["index.json", "_index.json"],
    ["name. . ", "name"],
    ["CON", "_CON"],
    ["nul.txt", "_nul.txt"],
    ["com1.tar.gz", "_com1.tar.gz"],
    ["LPT9", "_LPT9"],
    ["console.txt", "console.txt"],
    ["evil\u202Etxt.exe", "eviltxt.exe"],
    ["", "file"],
    ["..", "file"],
    ["/", "file"],
    [null, "file"],
    ["   ", "file"],
  ];
  for (const [input, want] of cases) assert.equal(sanitizeName(input), want, String(input));
  const long = sanitizeName("x".repeat(300) + ".pdf");
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".pdf"));
  for (const s of ["a/b", "a\\b", "..", "x".repeat(500), "COM3.log", " .x. "]) {
    const out = sanitizeName(s);
    assert.ok(out && out.length <= 120 && !/[\\/<>:"|?*\u0000-\u001f]/.test(out) && !out.startsWith(".") && !/[ .]$/.test(out), s);
    assert.equal(sanitizeName(out), out, `idempotent: ${s}`);
  }
});

test("8.3 short-name aliases and console devices are never valid names", () => {
  for (const [input, want] of [["REPORT~1.PDF", "REPORT-1.PDF"], ["INDEX~1.JSO", "INDEX-1.JSO"], ["a~12b.txt", "a-12b.txt"], ["~1", "-1"]]) {
    assert.equal(sanitizeName(input), want, input);
    assert.notEqual(sanitizeName(input), input); // so filePath() rejects the raw alias for raw/delete/rename
  }
  assert.equal(sanitizeName("my~file.txt"), "my~file.txt");
  for (const [input, want] of [["CONIN$", "_CONIN$"], ["conout$.txt", "_conout$.txt"], ["CONIN$ .log", "_CONIN$ .log"]]) assert.equal(sanitizeName(input), want, input);
  assert.equal(sanitizeName("conin.txt"), "conin.txt");
});

test("collisions get (n) suffixes, case-insensitively", () => {
  assert.equal(withSuffix("a.txt", 2), "a (2).txt");
  assert.equal(withSuffix("noext", 3), "noext (3)");
  assert.equal(uniqueName("a.txt", ["b.txt"]), "a.txt");
  assert.equal(uniqueName("a.txt", ["A.TXT"]), "a (2).txt");
  assert.equal(uniqueName("a.txt", ["a.txt", "a (2).txt"]), "a (3).txt");
  assert.ok(withSuffix("x".repeat(116) + ".pdf", 12).length <= 120);
});

test("rename keeps the extension unless one is typed", () => {
  assert.equal(renameTarget("photo.jpg", "holiday"), "holiday.jpg");
  assert.equal(renameTarget("photo.jpg", "holiday.png"), "holiday.png");
  assert.equal(renameTarget("README", "notes"), "notes");
  assert.equal(renameTarget("a.txt", "../../x"), "x.txt");
  assert.equal(renameTarget("a.txt", "con"), "_con.txt");
});

test("serving headers never inline active content", () => {
  for (const n of ["a.html", "a.htm", "a.svg", "a.xml", "a.js", "a.exe", "a", "a.docx"]) {
    const h = serveHeaders(n);
    assert.equal(h["Content-Type"], "application/octet-stream", n);
    assert.ok(h["Content-Disposition"].startsWith("attachment;"), n);
    assert.equal(h["X-Content-Type-Options"], "nosniff");
    assert.ok(h["Content-Security-Policy"].startsWith("sandbox; default-src 'none'"), n);
  }
  for (const [n, t] of [["a.png", "image/png"], ["a.JPG", "image/jpeg"], ["a.mp4", "video/mp4"], ["a.mp3", "audio/mpeg"], ["a.pdf", "application/pdf"], ["a.md", "text/plain; charset=utf-8"]]) {
    const h = serveHeaders(n);
    assert.equal(h["Content-Type"], t, n);
    assert.ok(h["Content-Disposition"].startsWith("inline;"), n);
    assert.ok(h["Content-Security-Policy"].includes("default-src 'none'"), n);
  }
  assert.match(serveHeaders("a.png")["Content-Security-Policy"], /^sandbox;/);
});

test("content-disposition encodes names safely", () => {
  assert.equal(contentDisposition('ä "x";.txt', false), `attachment; filename="_ _x__.txt"; filename*=UTF-8''%C3%A4%20%22x%22%3B.txt`);
  assert.ok(!contentDisposition("a\r\nb.txt", true).includes("\n"));
});

test("range parsing", () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-9", 100), [0, 9]);
  assert.deepEqual(parseRange("bytes=90-", 100), [90, 99]);
  assert.deepEqual(parseRange("bytes=-10", 100), [90, 99]);
  assert.deepEqual(parseRange("bytes=50-500", 100), [50, 99]);
  assert.equal(parseRange("bytes=100-", 100), "bad");
  assert.equal(parseRange("bytes=9-1", 100), "bad");
  assert.equal(parseRange("bytes=0-1,5-6", 100), null);
});

test("kinds, extraction and memory types", () => {
  assert.equal(kindOf("a.webp"), "image");
  assert.equal(kindOf("a.svg"), "text"); // previewed as source text, never rendered
  assert.equal(kindOf("a.wav"), "audio");
  assert.equal(kindOf("a.zip"), "other");
  assert.equal(extractType("a.docx", "DOCX"), "DOCX");
  assert.equal(extractType("a.json", "D"), "text/plain");
  assert.equal(extractType("a.png", "D"), null);
  assert.equal(memoryType("a.md"), "text/markdown");
  assert.equal(memoryType("a.mp4"), null);
});

test("snippets and upload limits", () => {
  assert.equal(snippet("hello world", "WORLD"), "hello world");
  assert.equal(snippet("abc", "z"), null);
  assert.ok(snippet("x".repeat(500) + "needle" + "y".repeat(500), "needle")!.startsWith("…"));
  assert.equal(uploadError(10, { bytes: 0, count: 0 }), null);
  assert.match(uploadError(MAX_FILE + 1, { bytes: 0, count: 0 })!, /40 MB/);
  assert.match(uploadError(10, { bytes: 0, count: MAX_FILES })!, /full/);
  assert.match(uploadError(10, { bytes: MAX_TOTAL - 5, count: 1 })!, /space/);
});

const UID = "0b7d3c1e-2f4a-4c5b-9d6e-7f8a9b0c1d2e";

test("cloud keys are reversible and only ever valid vault names", () => {
  for (const n of ["report.pdf", "a (2).txt", "ä ö.md", "x#y[1].png", "b64.trick.txt", "日本語.txt", "x".repeat(116) + ".pdf"]) {
    const k = cloudKey(n);
    assert.match(k, /^[A-Za-z0-9 _.()!'@=+,&$;-]+$/, n);
    assert.equal(nameFromKey(k), n, n);
  }
  assert.equal(cloudKey("report.pdf"), "report.pdf");
  assert.ok(cloudKey("b64.trick.txt").startsWith("b64.") && cloudKey("b64.trick.txt") !== "b64.trick.txt");
  for (const bad of [".emptyFolderPlaceholder", "b64.!!!", "b64.Li4vZXRjL3Bhc3N3ZA", "CON", "a~1.txt", "../x", "a/b"]) assert.equal(nameFromKey(bad), null, bad);
});

test("cloudPath takes the uid from the session and re-validates the name", () => {
  assert.equal(cloudPath(UID, "a.txt"), `${UID}/vault-files/a.txt`);
  assert.equal(cloudPath(UID, "ä.txt"), `${UID}/vault-files/${cloudKey("ä.txt")}`);
  for (const bad of ["../a.txt", "a/b.txt", "", ".index.json", "REPORT~1.PDF", "nul"]) assert.throws(() => cloudPath(UID, bad), /Invalid file name/, bad);
  for (const bad of ["", "../x", "not-a-uuid", `${UID}/x`]) assert.throws(() => cloudPath(bad, "a.txt"), /Invalid user id/, bad);
});

test("mergeCloud marks copies and lists cloud-only files", () => {
  const f = (name: string) => ({ name, size: 1, mtime: 1, type: "text" as const });
  const { files, cloudOnly } = mergeCloud([f("a.txt"), f("B.txt")], new Map([["a.txt", 1], ["b.txt", 5], ["z.txt", 9]]));
  assert.deepEqual(files.map((x) => [x.name, x.cloud]), [["a.txt", true], ["B.txt", false]]);
  assert.deepEqual(cloudOnly, [{ name: "z.txt", size: 9 }]); // b.txt matches B.txt locally (Windows is case-insensitive)
  assert.deepEqual(mergeCloud([f("a.txt")], null), { files: [f("a.txt")], cloudOnly: [] });
});

test("cloud failure hints and content types", () => {
  assert.match(cloudFailure("The object exceeded the maximum allowed size"), /0009_vault_cloud\.sql/);
  assert.match(cloudFailure("new row violates row-level security policy"), /0009_vault_cloud\.sql/);
  assert.equal(cloudFailure("fetch failed"), "fetch failed");
  assert.equal(cloudFailure("403 Unauthorized: jwt expired"), "403 Unauthorized: jwt expired"); // expired session ≠ missing migration
  assert.equal(mimeOf("a.html"), "application/octet-stream");
  assert.equal(mimeOf("a.png"), "image/png");
});

test("latestGate: A→B→C selections resolving in reverse order show only C", async () => {
  const { latestGate } = await import("../src/lib/vault-pure.ts");
  const begin = latestGate();
  let shown: string | null = null;
  const pending: (() => void)[] = [];
  for (const f of ["A", "B", "C"]) { const ok = begin(); pending.push(() => { if (ok()) shown = f; }); }
  for (const resolve of pending.reverse()) resolve(); // C, then B, then A
  assert.equal(shown, "C");
});
