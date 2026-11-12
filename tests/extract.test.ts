// extract.ts + parse-worker.mjs: a hostile document can only cost its own worker. Each case runs in a child Node process, because a
// worker that was NOT terminated keeps that process alive: the child ending by itself is the proof the thread is really gone.
// The worker file is the real one for normal documents; for hostile ones a stand-in worker (spin / allocate forever) is put at
// <cwd>/src/lib/parse-worker.mjs, which is where extract.ts looks. The 30 s timeout is shortened by scaling setTimeout in the child.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const EXTRACT = pathToFileURL(path.join(root, "src/lib/extract.ts")).href;
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Runs `body` (has `extractText`, `PDF`, `DOCX`, `bytes`) in a child with cwd = `cwd`; resolves { code, out } where out is the last JSON line printed. */
async function child(cwd: string, body: string, env: Record<string, string> = {}) {
  const code = `
    const T = globalThis.setTimeout; globalThis.setTimeout = (f, ms, ...a) => T(f, ms === 30000 ? 400 : ms, ...a); // PARSE_MS 30 s -> 0.4 s
    const { extractText } = await import(${JSON.stringify(EXTRACT)});
    const PDF = ${JSON.stringify(PDF)}, DOCX = ${JSON.stringify(DOCX)};
    const t0 = Date.now(); const done = (o) => console.log(JSON.stringify({ ...o, ms: Date.now() - t0 }));
    ${body}`;
  // A script file, not -e: the worker inherits the parent's execArgv, and --input-type is rejected in a worker.
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-extract-run-")), file = path.join(dir, "run.mjs");
  await writeFile(file, code);
  const r = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href, file],
    { cwd, env: { ...process.env, ...env }, timeout: 60_000 }).then((x) => ({ code: 0, stdout: x.stdout }), (e) => ({ code: (e.code ?? 1) as number, stdout: String(e.stdout ?? "") + String(e.stderr ?? "") }));
  await rm(dir, { recursive: true, force: true });
  const line = r.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1);
  return { code: r.code, out: line ? JSON.parse(line) : null, raw: r.stdout };
}

/** A cwd whose src/lib/parse-worker.mjs is the given stand-in worker source. */
async function fakeCwd(workerSrc: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-extract-"));
  await mkdir(path.join(dir, "src/lib"), { recursive: true });
  await writeFile(path.join(dir, "src/lib/parse-worker.mjs"), workerSrc);
  return dir;
}

// A one-page PDF with a single text line, built by hand (xref offsets computed).
function pdf(text: string) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 18 Tf 20 50 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 20 50 Td (${text}) Tj ET\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let s = "%PDF-1.4\n"; const at: number[] = [];
  objs.forEach((o, i) => { at.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}

// A stored (uncompressed) zip; `declared` overrides the uncompressed size written in the central directory (a zip bomb's lie).
function zip(files: Record<string, string>, declared?: number) {
  const locals: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), d = Buffer.from(text), c = crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(declared ?? d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, d); central.push(ch, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const docx = (text: string, declared?: number) => zip({
  "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
}, declared);

const b64 = (b: Buffer) => JSON.stringify(b.toString("base64"));
const buf = (b: Buffer) => `const bytes = Buffer.from(${b64(b)}, "base64");`;

test("a normal small PDF and Word file parse to their text through the real worker", async () => {
  const a = await child(root, `${buf(pdf("Hello ORBIT pdf"))} done({ text: await extractText(bytes, PDF) });`);
  assert.equal(a.code, 0, a.raw);
  assert.match(a.out.text, /Hello ORBIT pdf/);
  const d = await child(root, `${buf(docx("Hello ORBIT word"))} done({ text: await extractText(bytes, DOCX) });`);
  assert.equal(d.code, 0, d.raw);
  assert.equal(d.out.text, "Hello ORBIT word");
});

test("plain text passes through without a worker; unknown types give empty text; NULs are stripped", async () => {
  const r = await child(root, `done({ t: await extractText(Buffer.from("  a\\u0000b  "), "text/plain"), x: await extractText(Buffer.from("zz"), "image/png") });`);
  assert.deepEqual([r.out.t, r.out.x], ["ab", ""]);
});

test("a file whose parse never ends is killed at the timeout and its worker thread is really gone", async () => {
  const cwd = await fakeCwd(`for (;;) {}`);
  try {
    const r = await child(cwd, `${buf(Buffer.from("x"))} done(await extractText(bytes, PDF).then(() => ({ ok: 1 }), (e) => ({ err: e.message })));`);
    assert.equal(r.code, 0, `the child must exit by itself (a surviving worker would keep it alive): ${r.raw}`);
    assert.match(r.out.err, /took too long/);
    assert.ok(r.out.ms < 10_000, `rejected at the (shortened) timeout, took ${r.out.ms} ms`);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("a file that eats memory is killed at the heap cap, not left to grow", async () => {
  const cwd = await fakeCwd(`const keep = []; for (;;) keep.push(new Array(1e6).fill(Math.random()));`);
  try {
    // timeout scaled up so the cap, not the clock, is what ends it
    const r = await child(cwd, `globalThis.setTimeout = T; ${buf(Buffer.from("x"))} done(await extractText(bytes, PDF).then(() => ({ ok: 1 }), (e) => ({ err: e.message })));`);
    assert.equal(r.code, 0, r.raw);
    assert.match(r.out.err, /too large to read/);
    assert.ok(r.out.ms < 40_000, `took ${r.out.ms} ms`);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("the worker really runs under the 512 MB heap cap (V8's own limit, read back inside the worker)", async () => {
  const cwd = await fakeCwd(`import { parentPort } from "node:worker_threads"; import v8 from "node:v8"; parentPort.postMessage({ text: String(v8.getHeapStatistics().heap_size_limit) });`);
  try {
    const r = await child(cwd, `${buf(Buffer.from("x"))} done({ limit: Number(await extractText(bytes, PDF)) });`);
    const mb = r.out.limit / 1024 / 1024;
    // old space 512 MB plus young generation/code space (Node 22 ≈ 520 MB, Node 24 ≈ 704 MB); the machine default is several GB, so this fails without resourceLimits
    assert.ok(mb >= 512 && mb < 1024, `worker heap_size_limit is ${mb.toFixed(0)} MB`);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("a worker that reports an error rejects with that reason", async () => {
  const cwd = await fakeCwd(`import { parentPort } from "node:worker_threads"; parentPort.postMessage({ error: "bad file" });`);
  try {
    const r = await child(cwd, `${buf(Buffer.from("x"))} done(await extractText(bytes, PDF).then(() => ({ ok: 1 }), (e) => ({ err: e.message })));`);
    assert.equal(r.out.err, "bad file");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("a Word file that declares more than 50 MB unpacked is refused before any worker starts", async () => {
  const r = await child(root, `${buf(docx("bomb", 60 * 1024 * 1024))} done(await extractText(bytes, DOCX).then(() => ({ ok: 1 }), (e) => ({ err: e.message })));`);
  assert.match(r.out.err, /more than 50 MB/);
  assert.ok(r.out.ms < 5_000);
});
