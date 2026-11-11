import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfPages } from "../src/lib/pdf-open.ts";
import { checkFile, checkPdf, checkResearch, checkTests, evidenceLevels, fetchedFromTrace, normUrl, parseCsv, type Fetched } from "../src/lib/mission-checks-pure.ts";

const src = (url: string, evidence: string): Fetched => ({ url, at: "2026-10-29T10:00:00Z", evidence });

test("research: an unread page on a known host does not pass as cited", () => {
  const fetched = [src("https://www.reuters.com/markets/a", "Oil prices rose 8% on Monday after supply cuts.")];
  const r = checkResearch("Oil rose 8% [R](https://www.reuters.com/markets/OTHER-unread)", fetched);
  assert.ok(!r[0].ok, r[0].what);
  assert.match(r[0].what, /never fetched/);
});

test("research: exact (normalized) URL passes; claims are checked against fetched text", () => {
  const fetched = [src("https://www.reuters.com/markets/a", "Oil prices rose 8% on Monday after supply cuts by producers.")];
  const ok = checkResearch("Oil prices rose 8% after supply cuts [R](https://reuters.com/markets/a/#top).", fetched);
  assert.ok(ok.every((c) => c.ok), JSON.stringify(ok));
  const bad = checkResearch("Gold demand collapsed in Asian jewelry markets [R](https://reuters.com/markets/a).", fetched);
  assert.ok(bad[0].ok, "the source was fetched");
  assert.ok(!bad[1].ok && /unresolved/.test(bad[1].what) && /heuristic/.test(bad[1].what), bad[1].what);
  assert.equal(normUrl("HTTPS://WWW.Example.com/a/?utm_source=x&b=1#f"), "https://example.com/a?b=1");
});

test("fetchedFromTrace reads full source records, not 160-char detail strings", () => {
  const trace = [
    { step: "fetch_url", detail: '{"url":"https://example.com/a"} → ok', ok: true },
    { step: "source", detail: "https://example.com/b", ok: true, url: "https://example.com/b", at: "t", evidence: "text" },
  ];
  assert.deepEqual(fetchedFromTrace(trace).map((f) => f.url), ["https://example.com/b"]);
});

test("pdf: a fake %PDF- … %%EOF string fails; a real PDF opens", async () => {
  assert.ok(!checkFile("p.pdf", "%PDF-1.4 hello %%EOF").ok);
  assert.ok(!(await checkPdf("p.pdf", new TextEncoder().encode("%PDF-1.4 hello %%EOF"), 0, pdfPages)).ok);
  const r = await checkPdf("p.pdf", new TextEncoder().encode(minimalPdf()), 0, pdfPages);
  assert.ok(r.ok, r.what);
  assert.ok(checkFile("p.pdf", minimalPdf()).ok);
});

test("csv: RFC 4180 quoted fields with commas, quotes and newlines parse", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n"multi\nline",2'), [["a", "b"], ["x, y", 'say "hi"'], ["multi\nline", "2"]]);
  assert.ok(checkFile("x.csv", 'name,city\n"Doe, Jane","Tallinn, EE"\n').ok);
  assert.ok(!checkFile("x.csv", 'a,b\n"open,1').ok);
  assert.ok(!checkFile("x.csv", "a,b\n1,2,3").ok);
});

test("tests: zero-exit with no tests found is inconclusive, never a pass", () => {
  for (const out of ["No tests found, exiting with code 0", "# tests 0\n# pass 0\n# fail 0", ""]) {
    const c = checkTests(0, out);
    assert.ok(!c.ok, out);
    assert.match(c.what, /inconclusive/);
  }
  const run = checkTests(0, "# tests 5\n# pass 4\n# fail 0\n# skipped 1", 0, { command: "npm test", cwd: "/w", revision: "abc123" });
  assert.ok(run.ok);
  assert.deepEqual(run.test, { command: "npm test", cwd: "/w", revision: "abc123", exit: 0, total: 5, passed: 4, failed: 0, skipped: 1 });
  assert.ok(!checkTests(0, "Tests: 1 failed, 3 passed, 4 total").ok);
  assert.ok(checkTests(0, "Tests: 3 passed, 3 total").ok);
});

test("evidence categories: a file marker or fetched host never becomes a broad success", () => {
  const e = evidenceLevels(true, [{ step: 0, ok: true, what: "x", kind: "artifact" }]);
  assert.equal(e.executed, "yes");
  assert.equal(e.artifact, "yes");
  assert.equal(e.requirements, "unchecked");
  assert.equal(e.outcome, "unchecked");
  assert.equal(evidenceLevels(true, [{ step: 0, ok: false, what: "x", kind: "requirements" }]).requirements, "failed");
});

/** A real one-page PDF with correct xref byte offsets. */
function minimalPdf() {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
}
