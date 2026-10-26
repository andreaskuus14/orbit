import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pure from "../src/lib/contracts-pure.ts";
import * as biz from "../src/lib/business-pure.ts";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/contracts.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function load(vault: object) {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-contracts-"));
  const fields = { partyName: "Bakery", partyEmail: "a@b.ee" };
  const c = { id: "c1", title: "Deal", template: "nda", status: "signed", at: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", versions: [{ n: 1, at: "x", by: "owner", fields, clauses: [], hash: "h1" }],
    comments: [], signed: { n: 1, hash: "h1", at: "x", kind: "typed", pdf: "gone.pdf", pdfSha: "s" }, cover: "Hi" };
  await fsp.writeFile(path.join(dir, "contracts.json"), JSON.stringify({ contracts: [c] }));
  const sends: unknown[] = [];
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response, Buffer, AbortSignal, structuredClone, process: { env: { RESEND_API_KEY: "k", ORBIT_MAIL_FROM: "me@x.ee" } },
    fetch: async (...a: unknown[]) => { sends.push(a); return new Response("{}"); },
    require: (name: string) => {
      if (name === "node:crypto") return crypto;
      if (name === "node:fs/promises") return fsp;
      if (name === "node:path") return { default: path };
      if (name.endsWith("contracts-pure")) return pure;
      if (name.endsWith("business-pure")) return biz;
      if (name.endsWith("/data-dir")) return { orbitDataDir: () => dir };
      if (name.endsWith("/claude")) return { askClaude: () => { throw new Error("no"); }, emit: async () => {}, recordUsage: async () => {}, MODEL: "m" };
      if (name.endsWith("/stop-all")) return { stopAllOn: () => false };
      if (name.endsWith("usage-meter")) return { usageHold: () => null };
      if (name.endsWith("/autonomy")) return { allows: () => ({ ok: true }) };
      if (name.endsWith("remote-push")) return { pushNotify: () => {} };
      if (name.endsWith("/vault")) return vault;
      throw new Error(name);
    },
  });
  return { m, dir, sends };
}

test("sendContract: a missing signed PDF un-claims (back to Signed) and sends nothing", async () => {
  const { m, dir, sends } = await load({ readStream: async () => { throw new Error("ENOENT"); } });
  await assert.rejects(m.exports.sendContract({}, "u", "c1", "2026-10-02T00:00:00Z"), /nothing was sent/);
  assert.equal(sends.length, 0);
  const saved = JSON.parse(await fsp.readFile(path.join(dir, "contracts.json"), "utf8")).contracts[0];
  assert.equal(saved.status, "signed");
  assert.equal(saved.sent, undefined);
});

test("sendContract: with the PDF it sends once and stays Sent", async () => {
  const { m, dir, sends } = await load({ readStream: async () => ({ stream: new Blob(["%PDF"]).stream() }) });
  const c = await m.exports.sendContract({}, "u", "c1", "2026-10-02T00:00:00Z");
  assert.equal(c.status, "sent");
  assert.equal(sends.length, 1);
  assert.equal(JSON.parse(await fsp.readFile(path.join(dir, "contracts.json"), "utf8")).contracts[0].status, "sent");
});
