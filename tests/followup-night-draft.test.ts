// Due follow-up → reviewable draft without a second model call: BUSINESS reuses last night's draft (night-pure nightFollowupDraft).
// The text comes from the server's night report, never the request; sending still needs his own approval. Synthetic data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as nightPure from "../src/lib/night-pure.ts";
import * as biz from "../src/lib/business-pure.ts";
import { nightFollowupDraft, type NightReport } from "../src/lib/night-pure.ts";

const req = createRequire(import.meta.url);
const report = (draft: string, ref = "11111111-1111-4111-8111-111111111111") => ({ approvals: [
  { kind: "research", ref: "x", label: "Other", status: "approval", at: "", draft: "Not a follow-up" },
  { kind: "business", ref, label: "Follow-up for Kalev Bakery", status: "approval", at: "", draft },
] } as unknown as Pick<NightReport, "approvals">);

test("picks last night's follow-up for that client only, and only if it's new to the card", () => {
  assert.equal(nightFollowupDraft(report("  Hi again, did my note reach you?  "), "11111111-1111-4111-8111-111111111111", "Hello, first message"), "Hi again, did my note reach you?");
  assert.equal(nightFollowupDraft(report("Hi again"), "p2", "x"), null);
  assert.equal(nightFollowupDraft(report("Hi again"), "11111111-1111-4111-8111-111111111111", " Hi again "), null, "already on the card");
  assert.equal(nightFollowupDraft(report("   "), "11111111-1111-4111-8111-111111111111", "x"), null);
  assert.equal(nightFollowupDraft(null, "11111111-1111-4111-8111-111111111111", "x"), null);
});

function route(o: { stage?: string; night?: unknown; stopAll?: boolean } = {}) {
  const saved: object[] = [], models: string[] = [];
  const prospect = { name: "Kalev Bakery", kind: "bakery", notes: "", draft: "Hello, first message", stage: o.stage ?? "contacted", updated_at: "2026-11-01T00:00:00Z" };
  const sb = { from: () => {
    const q: any = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", fee: 0, ...prospect }], error: null }),
      maybeSingle: async () => ({ data: prospect, error: null }),
      update(patch: object) { saved.push(patch); return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "11111111-1111-4111-8111-111111111111", ...prospect, ...patch }, error: null }) }) }) }; } };
    return q;
  } };
  const code = ts.transpileModule(readFileSync(new URL("../src/app/api/business/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const m = { exports: {} as any };
  const night = o.night === undefined ? report("Hi again, did my note reach you?") : o.night;
  const stub = (name: string): unknown => {
    if (name === "@/lib/supabase/server") return { requireUser: async () => ({ sb, user: { id: "owner" } }) };
    if (name === "@/lib/csrf") return { crossSiteBlocked: () => false };
    if (name === "@/lib/claude") return { BusyError: class {}, emit() {}, askClaude: async (p: string) => { models.push(p); return { text: "A brand new model draft" }; } };
    if (name === "@/lib/usage-meter") return { pastBudget: () => false, usageHardHold: () => null };
    if (name === "@/lib/stop-all") return { stopAllOn: () => !!o.stopAll };
    if (name === "@/lib/business-send") return { sendDraft: async () => Response.json({ sent: true }) };
    if (name === "@/lib/remote-push") return { pushNotify() {} };
    if (name === "@/lib/prospect-crm") return { crmOf: () => ({ events: [] }), loadCrm: async () => ({}), logEvent() {}, updateCrm: async () => {} };
    if (name === "@/lib/prospect-crm-pure") return { touch: () => null };
    if (name === "@/lib/business-pure") return biz;
    if (name === "@/lib/night-pure") return nightPure;
    if (name === "@/lib/night") return { getNightReport: async () => night };
    return req(name);
  };
  runInNewContext(code, { module: m, exports: m.exports, Response, Date, require: stub, process, Promise });
  // `await import("@/lib/…")` compiles to a require inside Promise.resolve; route the specifiers to the same stubs
  const post = (body: object) => m.exports.POST(new Request("http://orbit/api/business", { method: "POST", body: JSON.stringify(body) }));
  return { post, get: () => m.exports.GET(), saved, models };
}

test("Use last night's draft: saves the night report's text, no model call, and ignores text sent by the browser", async () => {
  const r = route();
  const res = await r.post({ action: "followup", id: "11111111-1111-4111-8111-111111111111", use: "night", draft: "INJECTED TEXT FROM THE PAGE" });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(r.models.length, 0, "no second model call");
  assert.equal((r.saved[0] as { draft: string }).draft, "Hi again, did my note reach you?");
  assert.doesNotMatch(JSON.stringify(r.saved), /INJECTED/);
});

test("no night draft, a client not waiting on a follow-up, or Stop-all: refused, nothing saved", async () => {
  for (const [o, status] of [[{ night: null }, 404], [{ night: report("Hello, first message") }, 404], [{ stage: "lead" }, 400], [{ stopAll: true }, 503]] as const) {
    const r = route(o as object);
    assert.equal((await r.post({ action: "followup", id: "11111111-1111-4111-8111-111111111111", use: "night" })).status, status, JSON.stringify(o));
    assert.equal(r.saved.length, 0); assert.equal(r.models.length, 0);
  }
});

test("the ordinary Draft follow-up still asks CORE; GET tells the card which clients have a night draft (ids, not text)", async () => {
  const r = route();
  await r.post({ action: "followup", id: "11111111-1111-4111-8111-111111111111" });
  assert.equal(r.models.length, 1);
  const g = await (await route().get()).json();
  assert.deepEqual(g.nightDrafts, ["11111111-1111-4111-8111-111111111111"]);
  assert.doesNotMatch(JSON.stringify(g.nightDrafts), /did my note/);
});
