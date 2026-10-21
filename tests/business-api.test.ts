import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pure from "../src/lib/business-pure.ts";

const code = ts.transpileModule(readFileSync(new URL("../src/app/api/business/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api(answer = "Tere! Kas minu eelmine idee võiks teile kasulik olla?", stage = "contacted", draft = "Tere! Pakun tasuta pilooti.") {
  const row = { id: "11111111-1111-1111-1111-111111111111", name: "Bakery", kind: "cakes", notes: "", draft, stage, updated_at: "2026-10-01T00:00:00Z" };
  const writes: object[] = [], asks: any[] = [];
  const sb = { from: () => {
    let patch: any;
    const q = { select: () => q, eq: () => q, update: (p: object) => { patch = p; return q; }, maybeSingle: async () => {
      if (patch) { writes.push(patch); Object.assign(row, patch); }
      return { data: { ...row }, error: null };
    } };
    return q;
  } };
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response, process: { env: {} },
    fetch: () => { throw new Error("Drafting must never send"); },
    require: (name: string) => {
      if (name.endsWith("business-pure")) return pure;
      if (name.endsWith("supabase/server")) return { requireUser: async () => ({ sb }) };
      if (name.endsWith("/csrf")) return { crossSiteBlocked: () => false };
      if (name.endsWith("/claude")) return { BusyError: class extends Error {}, askClaude: async (...args: any[]) => { asks.push(args); return { text: answer }; } };
      if (name.endsWith("usage-meter")) return { usageHold: () => null };
      if (name.endsWith("stop-all")) return { stopAllOn: () => false };
      throw new Error(name);
    },
  });
  return { row, writes, asks, request: (lang = "Estonian") => m.exports.POST(new Request("http://localhost/api/business", {
    method: "POST", body: JSON.stringify({ action: "followup", id: row.id, lang }),
  })) };
}

test("followup API uses CORE and the chosen language, saves the draft, keeps contacted and never sends", async () => {
  const a = api(), first = a.row.draft;
  const res = await a.request("Russian");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).draft, a.row.draft);
  assert.equal(a.row.stage, "contacted");
  assert.equal(a.writes.length, 1);
  assert.deepEqual(Object.keys(a.writes[0]).sort(), ["draft", "updated_at"]);
  assert.equal(a.asks.length, 1);
  assert.match(a.asks[0][0], /^Write it in Russian/);
  assert.ok(a.asks[0][0].includes(first));
  assert.equal(a.asks[0][1], pure.FOLLOWUP_SYSTEM);
  assert.equal(a.asks[0][2].purpose, "business.followup");
});

test("followup API refuses missing first drafts, other stages, empty or verbatim AI output", async () => {
  for (const a of [api("", "contacted"), api("Tere! Pakun tasuta pilooti."), api("second", "lead"), api("second", "contacted", "")]) {
    assert.ok((await a.request()).status >= 400);
    assert.equal(a.writes.length, 0);
  }
});
