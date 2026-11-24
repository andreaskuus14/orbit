import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAction, bizResults, type BizState } from "../src/lib/business-state-pure.ts";
import { funnel, type Prospect } from "../src/lib/business-pure.ts";

const crm = { source: "manual", verified: false, key: "k", events: [] } as unknown as NonNullable<Prospect["crm"]>;
const P = (id: string, stage: Prospect["stage"], fee = 0): Prospect => ({ id, name: id.toUpperCase(), kind: "", contact: "", stage, fee, notes: "", draft: "", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", crm, touch: null });
const S = (ps: Prospect[]): BizState => ({ prospects: ps, funnel: funnel(ps), canSend: true, nightDrafts: ["b"] });
const AT = "2026-11-24T10:00:00.000Z";

test("update merges the saved row, keeps crm, logs the stage and recounts", () => {
  const s = S([P("a", "lead"), P("b", "contacted")]);
  const { crm: _c, touch: _t, ...row } = { ...P("a", "paying", 120) };
  const n = applyAction(s, { action: "update", id: "a", stage: "paying" } as never, row, AT)!;
  assert.equal(n.prospects[0].stage, "paying");
  assert.equal(n.prospects[0].crm?.events.at(-1)?.text, "paying");
  assert.equal(n.funnel.counts.paying, 1);
  assert.equal(n.funnel.monthly, 120);
  assert.equal(s.prospects[0].stage, "lead", "old state untouched");
});

test("add puts the new row first; followup clears last night's draft mark", () => {
  const s = S([P("a", "lead")]);
  assert.equal(applyAction(s, { action: "add" }, P("z", "lead"), AT)!.prospects[0].id, "z");
  assert.deepEqual(applyAction(S([P("b", "contacted")]), { action: "followup", id: "b" }, P("b", "contacted"), AT)!.nightDrafts, []);
});

test("delete, verify, lost and log patch locally", () => {
  const s = S([P("a", "lead"), P("b", "lost")]);
  assert.equal(applyAction(s, { action: "delete", id: "a" }, { ok: true }, AT)!.prospects.length, 1);
  assert.equal(applyAction(s, { action: "verify", id: "a" }, { ok: true }, AT)!.prospects[0].crm?.verified, true);
  assert.equal(applyAction(s, { action: "lost", id: "b", reason: "price" }, { ok: true }, AT)!.prospects[1].crm?.lost?.reason, "price");
  const l = applyAction(s, { action: "log", id: "a", kind: "reply", text: " hi " }, { ok: true }, AT)!.prospects[0];
  assert.deepEqual(l.crm?.events.at(-1), { at: AT, kind: "reply", text: "hi" });
  assert.equal(l.touch?.replied, true);
});

test("send, unknown actions, bad replies and missing rows ask the server", () => {
  const s = S([P("a", "lead")]);
  assert.equal(applyAction(s, { action: "send", id: "a" }, { ok: true }, AT), null);
  assert.equal(applyAction(s, { action: "update", id: "a" }, { ok: true }, AT), null);
  assert.equal(applyAction(s, { action: "verify", id: "nope" }, { ok: true }, AT), null);
  assert.equal(applyAction(S([{ ...P("a", "lead"), crm: undefined }]), { action: "verify", id: "a" }, { ok: true }, AT), null);
});

test("results count open clients, replies, pilots and money", () => {
  assert.deepEqual(bizResults(S([P("a", "lead"), P("b", "lost"), P("c", "paying", 50), P("d", "pilot")])), { open: 3, replied: 0, pilots: 1, paying: 1, monthly: 50 });
});
