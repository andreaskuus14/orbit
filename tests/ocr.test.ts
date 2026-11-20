// Document OCR: GLM-OCR through the local Ollama for scanned PDF pages and photos (ocr-pure.ts, ocr.ts, vault-ocr.ts, intake + vault_read wiring).
// End-to-end cases run the real modules in a child Node process against a stand-in Ollama and Local AI on 127.0.0.1; every fetch the child makes
// is recorded to prove nothing left this machine. The model itself isn't run here (mock Ollama answers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { DEFAULT_OCR_MODEL, HEIC_NOTE, OCR_NUM_CTX, OCR_PROMPT, hasModel, isOcrImage, joinPages, ocrCheck, ocrConfig, ocrRequest, ocrText, parseRender, planPages, skippedNote } from "../src/lib/ocr-pure.ts";
import { kindLabel } from "../src/lib/gpu-lock-pure.ts";

const root = path.resolve(import.meta.dirname, "..");
const lib = (f: string) => JSON.stringify(pathToFileURL(path.join(root, "src/lib", f)).href);

// A PDF built by hand: a page is text lines, or null = image-only (no text layer, like a scan).
function pdf(pages: (string[] | null)[]) {
  const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream"];
  const kids: number[] = [];
  for (const lines of pages) {
    const c = lines ? `BT /F1 12 Tf 20 280 Td ${lines.map((l) => `(${l}) Tj 0 -16 Td`).join(" ")} ET` : "q 200 0 0 200 50 50 cm /Im1 Do Q";
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents ${objs.length} 0 R /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> >>`);
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let s = "%PDF-1.4\n"; const at: number[] = [];
  objs.forEach((o, i) => { at.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}
const INVOICE = ["Arve nr 2026-117", "Tarnija: Puit OU", "Kokku 124.00 EUR"];
const OCR_ANSWER = "Kuitu 12.50 EUR\nRimi Eesti";

async function child(body: string, env: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-ocr-run-")), file = path.join(dir, "run.mjs");
  await writeFile(file, `
    const seen = []; const F = globalThis.fetch; globalThis.fetch = (u, i) => { seen.push(String(u instanceof Request ? u.url : u)); return F(u, i); };
    const done = (o) => console.log(JSON.stringify({ ...o, seen }));
    try { ${body} } catch (e) { done({ err: e.message }); }`);
  const r = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href, file],
    { cwd: root, env: { ...process.env, ORBIT_LOCAL_AI_AUTOSTART: "0", ...env }, timeout: 90_000 }).then((x) => x.stdout, (e) => String(e.stdout ?? "") + String(e.stderr ?? ""));
  await rm(dir, { recursive: true, force: true });
  const line = r.trim().split("\n").filter((l) => l.startsWith("{")).at(-1);
  return line ? JSON.parse(line) : { raw: r };
}

type Got = { ocr: { model: string; numCtx: number; prompt: string; images: number }[]; llm: number; render: string[]; docling: number };
/** Stand-in Ollama (tags, GLM-OCR page reads, the intake chat) + Local AI (/render-pdf, /doc-to-md). */
async function fakes(o: { pulled: boolean }) {
  const got: Got = { ocr: [], llm: 0, render: [], docling: 0 };
  const read = (q: IncomingMessage) => new Promise<string>((ok) => { let b = ""; q.setEncoding("latin1"); q.on("data", (c) => (b += c)).on("end", () => ok(b)); });
  const tiny = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).jpeg().toBuffer()).toString("base64");
  const ollama = createServer(async (q, s) => {
    if (q.url === "/api/tags") return s.end(JSON.stringify({ models: o.pulled ? [{ name: "glm-ocr:latest" }, { name: "qwen3:8b" }] : [{ name: "qwen3:8b" }] }));
    const j = JSON.parse(await read(q));
    if (j.model === "glm-ocr") {
      got.ocr.push({ model: j.model, numCtx: j.options.num_ctx, prompt: j.messages[0].content, images: j.messages[0].images.length });
      return s.end(JSON.stringify({ message: { content: "```\n" + OCR_ANSWER + "\n```" } }));
    }
    got.llm++;
    s.end(JSON.stringify({ message: { content: JSON.stringify([{ field: "supplier", value: "Rimi", page: 2, quote: "Rimi Eesti" }]) } }));
  });
  const ai = createServer(async (q, s) => {
    if (q.url === "/health") return s.end("{}");
    const b = await read(q);
    if (q.url === "/render-pdf") {
      const pages = /name="pages"\r\n\r\n([\d,]*)/.exec(b)?.[1] ?? ""; got.render.push(pages);
      return s.end(JSON.stringify({ total: 2, pages: pages.split(",").filter(Boolean).map((p) => ({ page: Number(p), image: tiny })) }));
    }
    got.docling++; s.end(JSON.stringify({ markdown: "docling", pages: 2, byPage: ["", "docling page"] }));
  });
  await Promise.all([ollama, ai].map((x) => new Promise<void>((ok) => x.listen(0, "127.0.0.1", ok))));
  const url = (x: typeof ai) => `http://127.0.0.1:${(x.address() as AddressInfo).port}`;
  return { got, env: { ORBIT_LOCAL_LLM_URL: url(ollama), ORBIT_LOCAL_LLM_MODEL: "qwen3:8b", ORBIT_LOCAL_AI_URL: url(ai) }, close: () => { ollama.close(); ai.close(); } };
}

test("config: GLM-OCR by default, off with ORBIT_OCR=0, never a cloud model, page cap clamped", () => {
  assert.deepEqual(ocrConfig({}), { on: true, model: DEFAULT_OCR_MODEL, maxPages: 20 });
  assert.equal(DEFAULT_OCR_MODEL, "glm-ocr");
  assert.equal(ocrConfig({ ORBIT_OCR: "0" }).on, false);
  assert.equal(ocrConfig({ ORBIT_OCR_MODEL: "glm-ocr:cloud" }).on, false);
  assert.equal(ocrConfig({ ORBIT_OCR_MODEL: "x:latest" }).model, "x:latest");
  assert.deepEqual([ocrConfig({ ORBIT_OCR_MAX_PAGES: "5" }).maxPages, ocrConfig({ ORBIT_OCR_MAX_PAGES: "500" }).maxPages, ocrConfig({ ORBIT_OCR_MAX_PAGES: "x" }).maxPages], [5, 50, 20]);
  assert.equal(kindLabel("ocr"), "document OCR");
});

test("request carries the picture, the task prompt, 16k context; the answer is cleaned", () => {
  const r = ocrRequest("glm-ocr", "QUJD");
  assert.deepEqual([r.model, r.stream, r.options.num_ctx, r.messages[0].content, r.messages[0].images], ["glm-ocr", false, OCR_NUM_CTX, OCR_PROMPT, ["QUJD"]]);
  assert.equal(OCR_PROMPT, "Text Recognition:");
  assert.equal(ocrText({ message: { content: "```markdown\nRimi\n12.50\n```\n" } }), "Rimi\n12.50");
  assert.equal(ocrText({ message: { content: "plain \u0000text " } }), "plain text");
  assert.equal(ocrText({ message: {} }), null);
  assert.equal(ocrText(null), null);
});

test("hasModel: latest tag matches the bare name, explicit tags must match", () => {
  const t = { models: [{ name: "glm-ocr:latest" }, { name: "qwen3:8b" }] };
  assert.deepEqual([hasModel(t, "glm-ocr"), hasModel(t, "glm-ocr:latest"), hasModel(t, "qwen3:8b"), hasModel(t, "qwen3"), hasModel(t, "glm-ocr:q8_0"), hasModel(null, "glm-ocr"), hasModel({}, "glm-ocr")], [true, true, true, false, false, false, false]);
});

test("page plan: only scanned pages, capped, with the unread count; joined text names blank pages", () => {
  assert.deepEqual(planPages([false, true, true, false, true], 2), { pick: [1, 2], skipped: 1 });
  assert.deepEqual(planPages([false, false], 20), { pick: [], skipped: 0 });
  assert.equal(skippedNote(0, 20), "");
  assert.match(skippedNote(3, 20), /3 more scanned pages not read.*at most 20/);
  assert.equal(joinPages(["only"]), "only");
  assert.equal(joinPages(["a", ""], skippedNote(1, 2)), "--- page 1 ---\na\n\n--- page 2 ---\n(no text)\n\n(1 more scanned page not read: OCR reads at most 2 pages per file.)");
  assert.deepEqual(parseRender({ total: 3, pages: [{ page: 2, image: "QQ==" }, { page: "x", image: "y" }, { page: 3, image: "" }] }), { total: 3, pages: [{ page: 2, image: "QQ==" }] });
  assert.equal(parseRender({}), null);
  assert.deepEqual([isOcrImage("a.JPG"), isOcrImage("a.heic"), isOcrImage("a.pdf")], [true, false, false]);
});

test("doctor 'Document OCR': off / Ollama down / model missing (with the setup command) / ready; never a failure", () => {
  const up = { models: [{ name: "glm-ocr:latest" }] };
  assert.equal(ocrCheck({ ORBIT_OCR: "0" }, up).status, "ok");
  const down = ocrCheck({}, null); assert.deepEqual([down.id, down.label, down.status], ["ocr", "Document OCR", "warn"]);
  const miss = ocrCheck({}, { models: [{ name: "qwen3:8b" }] });
  assert.equal(miss.status, "warn"); assert.match(miss.fix ?? "", /setup\.ps1 -Ocr/);
  const ok = ocrCheck({}, up); assert.equal(ok.status, "ok"); assert.match(ok.detail, /glm-ocr ready/);
});

test("end to end intake: the scanned page goes through render-pdf + GLM-OCR (fences stripped), text pages are not OCR'd, Docling is not used, only loopback contacted", async () => {
  const f = await fakes({ pulled: true }), data = await mkdtemp(path.join(tmpdir(), "orbit-ocr-data-"));
  try {
    const r = await child(`
      const v = await import(${lib("vault.ts")}), it = await import(${lib("vault-intake.ts")});
      const name = await v.saveUpload(new File([Buffer.from("${pdf([INVOICE, null]).toString("base64")}", "base64")], "arve.pdf", { type: "application/pdf" }));
      done({ s: await it.runIntake(name) });`, { ORBIT_DATA_DIR: data, ...f.env });
    assert.ok(r.s, JSON.stringify(r));
    assert.deepEqual(r.s.pages.map((p: { ocr: boolean }) => p.ocr), [false, true]);
    assert.equal(r.s.pages[1].text, OCR_ANSWER);
    assert.deepEqual(f.got.render, ["2"]); // only the page without a text layer was drawn
    assert.deepEqual(f.got.ocr, [{ model: "glm-ocr", numCtx: 16384, prompt: "Text Recognition:", images: 1 }]);
    assert.equal(f.got.docling, 0);
    assert.equal(f.got.llm, 1);
    assert.equal(r.s.fields[0].uncertain, false); // quote found in the OCR text of page 2
    for (const u of r.seen) assert.match(u, /^http:\/\/127\.0\.0\.1:\d+\//);
  } finally { f.close(); await rm(data, { recursive: true, force: true }); }
});

test("model not pulled: intake falls back to Docling's OCR, vault_read of a scan gives no text and calls no OCR", async () => {
  const f = await fakes({ pulled: false }), data = await mkdtemp(path.join(tmpdir(), "orbit-ocr-data-"));
  try {
    const r = await child(`
      const v = await import(${lib("vault.ts")}), it = await import(${lib("vault-intake.ts")});
      const name = await v.saveUpload(new File([Buffer.from("${pdf([INVOICE, null]).toString("base64")}", "base64")], "arve.pdf", { type: "application/pdf" }));
      const text = await v.readVaultText(name);
      done({ s: await it.runIntake(name), text });`, { ORBIT_DATA_DIR: data, ...f.env });
    assert.ok(r.s, JSON.stringify(r));
    assert.equal(r.s.pages[1].text, "docling page");
    assert.equal(f.got.ocr.length, 0);
    assert.match(r.text, /Arve nr 2026-117/); // the text layer still reads normally
  } finally { f.close(); await rm(data, { recursive: true, force: true }); }
});

test("vault_read: a photo and a scanned PDF are read by OCR, cached by file (second read makes no call), a text PDF is not OCR'd, original untouched", async () => {
  const f = await fakes({ pulled: true }), data = await mkdtemp(path.join(tmpdir(), "orbit-ocr-data-"));
  const photo = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#eee" } }).jpeg().toBuffer();
  try {
    const r = await child(`
      const v = await import(${lib("vault.ts")});
      const up = (b, n, t) => v.saveUpload(new File([Buffer.from(b, "base64")], n, { type: t }));
      const img = await up("${photo.toString("base64")}", "kuitu.jpg", "image/jpeg");
      const scan = await up("${pdf([null]).toString("base64")}", "skann.pdf", "application/pdf");
      const txt = await up("${pdf([INVOICE]).toString("base64")}", "tekst.pdf", "application/pdf");
      const a = await v.readVaultText(img), b = await v.readVaultText(img), c = await v.readVaultText(scan), d = await v.readVaultText(txt);
      done({ a, b, c, d, dir: v.vaultDir() });`, { ORBIT_DATA_DIR: data, ...f.env });
    assert.equal(r.a, OCR_ANSWER, JSON.stringify(r));
    assert.equal(r.b, OCR_ANSWER);
    assert.equal(r.c, OCR_ANSWER);
    assert.match(r.d, /Arve nr 2026-117/);
    assert.equal(f.got.ocr.length, 2); // photo once (second read came from the cache) + the scanned PDF page
    assert.deepEqual(f.got.render, ["1"]);
    assert.deepEqual((await readdir(path.join(r.dir, ".ocr"))).length, 2);
    assert.ok((await readFile(path.join(r.dir, "kuitu.jpg"))).equals(photo));
    for (const u of r.seen) assert.match(u, /^http:\/\/127\.0\.0\.1:\d+\//);
  } finally { f.close(); await rm(data, { recursive: true, force: true }); }
});

test("Stop-all and HEIC: with Stop-all on no request is made; a HEIC photo is refused with the JPG advice; non-local Ollama URL falls back to loopback", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "orbit-ocr-data-"));
  try {
    const r = await child(`
      const { setStopAll } = await import(${lib("stop-all.ts")}), o = await import(${lib("ocr.ts")});
      const heic = await o.normalizeImage(new Uint8Array([1, 2]), "iphone.HEIC").catch((e) => e.message);
      const before = seen.length; await setStopAll(true);
      const stopped = await o.ocrImages(["QQ=="]).catch((e) => e.message);
      done({ heic, stopped, calls: seen.length - before });`, { ORBIT_DATA_DIR: data, ORBIT_LOCAL_LLM_URL: "https://api.example.com" });
    assert.equal(r.heic, HEIC_NOTE, JSON.stringify(r));
    assert.match(r.stopped, /Stop-all is on/);
    assert.equal(r.calls, 0);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test("no cloud path: the OCR modules import nothing that reaches Claude, Supabase or another API", () => {
  const imports = (f: string) => [...readFileSync(path.join(root, "src/lib", f), "utf8").matchAll(/^(?!\s*import type)[^\n]*?(?:from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\))/gm)].map((m) => m[1] ?? m[2]);
  for (const f of ["ocr.ts", "ocr-pure.ts", "vault-ocr.ts"])
    for (const i of imports(f)) assert.ok(!/(^|\/)claude(\.ts)?$|anthropic|claude-agent-sdk|openai|supabase|cloud|http/i.test(i), `${f} imports ${i}`);
  assert.ok(!/https?:\/\//.test(readFileSync(path.join(root, "src/lib/ocr.ts"), "utf8").replace(/\/\/.*$/gm, "")), "ocr.ts hard-codes no URL");
});
