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
import * as pure from "../src/lib/pitch-links-pure.ts";
import * as cpure from "../src/lib/contracts-pure.ts";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/pitch-links.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function load(status = "review") {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-pitch-"));
  const contracts = [{ id: "c1", title: "Offer", template: "nda", status, versions: [{ n: 1, at: "x", by: "owner", fields: { partyName: "Bakery" }, clauses: [], hash: "h" }] }];
  const pushes: string[] = [];
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Buffer, Date, Map, globalThis: {}, require: (name: string) => {
    if (name === "node:crypto") return crypto;
    if (name === "node:fs/promises") return fsp;
    if (name === "node:path") return { default: path };
    if (name.endsWith("/data-dir")) return { orbitDataDir: () => dir };
    if (name.endsWith("/workspace")) return { getPreviewKey: async () => Buffer.alloc(32, 1) };
    if (name.endsWith("/contracts")) return { listContracts: async () => contracts };
    if (name.endsWith("contracts-pure")) return cpure;
    if (name.endsWith("remote-push")) return { pushNotify: (k: string) => pushes.push(k) };
    if (name.endsWith("pitch-links-pure")) return pure;
    throw new Error(name);
  } });
  const file = path.join(dir, "pitch-links.json");
  const mtime = async () => (await fsp.stat(file)).mtimeMs;
  return { m: m.exports, file, mtime, pushes, contracts };
}
const tok = (p: string) => p.slice(3);

test("bad tokens never write; a valid open logs one view and pushes once", async () => {
  const { m, file, pushes } = await load();
  const l = await m.createLink("c1", 7, true);
  const before = await fsp.readFile(file, "utf8");
  for (const t of ["junk", tok(l.path).slice(0, -1) + "A", `${l.id}.1.${"x".repeat(22)}`]) {
    assert.equal(await m.beacon(t, "v", 10), false);
    assert.ok("state" in (await m.openLink(t, "Chrome/1", "1.2.3.4")));
  }
  assert.equal(await fsp.readFile(file, "utf8"), before);
  const r = await m.openLink(tok(l.path), "Mozilla Chrome/130 Windows", "203.0.113.9");
  assert.ok(r.viewId && r.text.includes("Bakery"));
  await m.openLink(tok(l.path), "Mozilla Chrome/130 Windows", "203.0.113.9");
  assert.deepEqual(pushes, ["view"]);
  const saved = JSON.parse(await fsp.readFile(file, "utf8")).links[0];
  assert.equal(saved.views.length, 2);
  assert.equal(saved.views[0].ip, "203.0.113");
});

test("previews and HEAD aren't views; unchanged beacon skips the write; rate limit is per link", async () => {
  const { m, file } = await load();
  const l = await m.createLink("c1", 7, false), t = tok(l.path);
  assert.equal((await m.openLink(t, "WhatsApp/2.23", "1.2.3.4")).viewId, "");
  assert.equal((await m.openLink(t, "Chrome/1", "1.2.3.4", true)).viewId, "");
  assert.equal(JSON.parse(await fsp.readFile(file, "utf8")).links[0].views.length, 0);
  const { viewId } = await m.openLink(t, "Chrome/1", "1.2.3.4");
  const before = await fsp.readFile(file, "utf8");
  assert.equal(await m.beacon(t, viewId, 0), true); // nothing grew
  assert.equal(await fsp.readFile(file, "utf8"), before);
  let ok = 0;
  for (let i = 0; i < pure.BEACON_LIMIT + 5; i++) if (await m.beacon(t, viewId, 0)) ok++;
  assert.equal(ok, pure.BEACON_LIMIT - 1); // the first call above used one slot
});

test("revoked and cancelled-contract links are closed", async () => {
  const { m, contracts } = await load();
  const a = await m.createLink("c1", 7, false), b = await m.createLink("c1", 7, false);
  await m.revokeLink(a.id);
  assert.equal((await m.openLink(tok(a.path), "Chrome/1", "")).state, "revoked");
  contracts[0].status = "cancelled";
  assert.equal((await m.openLink(tok(b.path), "Chrome/1", "")).state, "revoked");
  assert.equal((await m.listLinks("c1")).every((x: { revoked: unknown }) => x.revoked), true);
  await assert.rejects(m.createLink("c1", 7, false), /cancelled/);
});
