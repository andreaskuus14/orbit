// F10: BUSINESS "Approve & send" at its exact-item boundary, through the real sendDraft with a fake database and a fake Resend.
// Every effect is counted; nothing leaves the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as approval from "../src/lib/approval-pure.ts";
import * as biz from "../src/lib/business-pure.ts";
import * as crmPure from "../src/lib/prospect-crm-pure.ts";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/business-send.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

type Row = { name: string; contact: string; draft: string; stage: string; notes: string | null; updated_at: string };
function load(opts: { resend?: () => Promise<Response>; stopAll?: boolean } = {}) {
  const row: Row = { name: "Kask Bakery", contact: "tere@kask.ee", draft: "Subject: Your website\n\nTere! I made you a preview.", stage: "lead", notes: null, updated_at: "2026-11-08T10:00:00Z" };
  const sends: { to: string; key: string }[] = [], events: string[] = [];
  class Q { // prospects: select … maybeSingle, and update … eq … select (the claim's compare-and-set)
    patch: Partial<Row> | null = null; conds: [string, unknown][] = [];
    select() { return this; } update(p: Partial<Row>) { this.patch = p; return this; }
    eq(k: string, v: unknown) { if (k !== "id") this.conds.push([k, v]); return this; }
    async maybeSingle() { return this.patch ? this.apply() : { data: { ...row }, error: null }; }
    async apply() {
      await Promise.resolve(); // a round trip: a second click can interleave here
      if (!this.conds.every(([k, v]) => (row as Record<string, unknown>)[k] === v)) return { data: [], error: null };
      Object.assign(row, this.patch); return { data: [{ id: "p1", ...row }], error: null };
    }
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return this.apply().then(res, rej); }
  }
  const sb = { from: () => new Q() }, m = { exports: {} as Record<string, any> };
  runInNewContext(code, {
    module: m, exports: m.exports, Response, AbortSignal, JSON, Date, Promise, console: { log() {}, error() {} },
    process: { env: { RESEND_API_KEY: "test-key", ORBIT_MAIL_FROM: "me@example.test" } },
    fetch: async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      sends.push({ to: JSON.parse(init.body).to, key: init.headers["Idempotency-Key"] });
      return opts.resend ? opts.resend() : new Response("{}", { status: 200 });
    },
    require: (n: string) => {
      if (n.endsWith("/authority")) return { authorizeApproval: approval.approvalGate };
      if (n.endsWith("/claude")) return { emit: async (_sb: unknown, _u: string, kind: string) => { events.push(kind); } };
      if (n.endsWith("/stop-all")) return { stopAllOn: () => !!opts.stopAll };
      if (n.endsWith("business-pure")) return biz;
      if (n.endsWith("/autonomy")) return { allows: () => ({ ok: true }) };
      if (n.endsWith("prospect-crm-pure")) return crmPure;
      if (n.endsWith("/prospect-crm")) return { loadCrm: async () => ({}), crmOf: () => ({ verified: true, events: [] }), logEvent: async () => {} };
      throw new Error(n);
    },
  });
  const send = async (seen: unknown) => { const r: Response = await m.exports.sendDraft(sb, "u1", "p1", seen); return { status: r.status, body: await r.json() }; };
  return { row, sends, events, send, seen: () => biz.sendStamp(row) };
}

test("the exact approved email sends once; Resend gets an idempotency key tied to it", async () => {
  const s = load(), seen = await s.seen();
  const r = await s.send(seen);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(s.sends.map((x) => x.to), ["tere@kask.ee"]);
  assert.equal(s.sends[0].key, `orbit-p1-${seen}`);
  assert.equal(s.row.stage, "contacted");
});

test("modified text after approval: refused, nothing sent, still To contact", async () => {
  const s = load(), seen = await s.seen();
  s.row.draft += "\n\nP.S. 50% off today only!"; // changed after he read it (an agent, another tab)
  const r = await s.send(seen);
  assert.equal(r.status, 409);
  assert.equal(s.sends.length, 0);
  assert.equal(s.row.stage, "lead");
});

test("changed recipient after approval: refused, nothing sent", async () => {
  const s = load(), seen = await s.seen();
  s.row.contact = "someone-else@example.test";
  assert.equal((await s.send(seen)).status, 409);
  assert.equal(s.sends.length, 0);
});

test("a stale or missing approval stamp is refused", async () => {
  const s = load();
  for (const seen of [undefined, "", "not-a-hash", await biz.sendStamp({ ...s.row, draft: "an older draft" })]) {
    assert.equal((await s.send(seen)).status, 409, String(seen));
  }
  assert.equal(s.sends.length, 0);
});

test("double click (two requests at once): exactly one email, the other is refused", async () => {
  const s = load(), seen = await s.seen();
  const [a, b] = await Promise.all([s.send(seen), s.send(seen)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(s.sends.length, 1);
});

test("Resend gives no answer: 'may or may not have been sent', stays Contacted, a second click can't send again", async () => {
  const s = load({ resend: async () => { throw new Error("timeout"); } }), seen = await s.seen();
  const r = await s.send(seen);
  assert.equal(r.status, 504);
  assert.match(r.body.error, /may or may not have been sent/);
  assert.equal(s.row.stage, "contacted");
  assert.match(s.row.notes ?? "", /result unknown/);
  assert.equal((await s.send(seen)).status, 409);
  assert.equal(s.sends.length, 1);
});

test("Resend 5xx is treated as unknown too; a clear 4xx means nothing went out and returns it to To contact", async () => {
  const five = load({ resend: async () => new Response("down", { status: 503 }) });
  assert.equal((await five.send(await five.seen())).status, 502);
  assert.equal(five.row.stage, "contacted");
  const four = load({ resend: async () => new Response("bad address", { status: 422 }) });
  assert.equal((await four.send(await four.seen())).status, 502);
  assert.equal(four.row.stage, "lead");
});

test("Stop-all on: nothing is sent, even with a valid approval", async () => {
  const s = load({ stopAll: true });
  assert.equal((await s.send(await s.seen())).status, 503);
  assert.equal(s.sends.length, 0);
  assert.equal(s.row.stage, "lead");
});
