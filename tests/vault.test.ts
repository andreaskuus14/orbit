import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeName, uniqueName, withSuffix, renameTarget, kindOf, serveHeaders, contentDisposition, parseRange, extractType, memoryType, snippet, uploadError,
  MAX_FILE, MAX_TOTAL, MAX_FILES,
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
