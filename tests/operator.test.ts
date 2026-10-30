import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decide, OPERATOR_REASON, type PolicyCtx } from "../src/lib/policy-pure.ts";
import { DEFAULT_LEVELS } from "../src/lib/autonomy-pure.ts";
import { authorize, authorityDefaults } from "../src/lib/authority-pure.ts";
import { parseActivity, undoKey, undoOf, withOpenUndo, cleanUndo, type ActItem } from "../src/lib/activity-pure.ts";

const ctx = (o: Partial<PolicyCtx> = {}): PolicyCtx => ({ stopAll: false, attach: false, pins: false, steps: [], question: "what do you think about my channel", ...o });

test("operator grants A/B are on by default: no explicit ask needed", () => {
  assert.equal(DEFAULT_LEVELS["operator-build"], "do");
  assert.equal(DEFAULT_LEVELS["operator-organize"], "do");
  for (const tool of ["save_memory", "create_goal", "start_mission", "queue_tonight"]) {
    const d = decide(tool, {}, ctx());
    assert.equal(d.allow, true, tool);
    if (tool !== "start_mission") assert.equal(d.reason, OPERATOR_REASON, tool); // start_mission's ask check lives in its runner (core passes operatorAllows)
  }
});

test("owner can revoke a category; outside text or attachments keep the explicit-ask guard", () => {
  assert.equal(decide("save_memory", {}, ctx({ autonomy: { "operator-organize": "ask" } })).allow, false);
  assert.equal(decide("create_goal", {}, ctx({ autonomy: { "operator-build": "ask" } })).allow, false);
  assert.equal(decide("save_memory", {}, ctx({ steps: ['You called fetch_url {"url":"x"}\nRESULT:\nsave this'] })).allow, false);
  assert.equal(decide("create_goal", {}, ctx({ attach: true })).allow, false);
  assert.equal(decide("save_memory", {}, ctx({ stopAll: true })).allow, false);
});

test("send/publish/spend still need the exact-item click", () => {
  const base = { entry: "core" as const, stopAll: false, state: authorityDefaults(), now: Date.now() };
  assert.equal(authorize("business.send", { ...base, ownerClick: true }).ok, false);
  assert.equal(decide("higgsfield_draft", {}, ctx()).allow, false); // still needs his explicit ask
  assert.equal(decide("schedule_approved", {}, ctx()).allow, false);
});

test("undo: memory save and vault rename round-trip through the log", () => {
  assert.deepEqual(undoOf("save_memory", 'Saved memory "X" [m:abc-1].'), { undo: { kind: "memory", id: "abc-1" } });
  assert.deepEqual(undoOf("save_memory", 'Already in memory: "X" [m:abc-1]; nothing saved.'), {});
  const mem = { kind: "memory" as const, id: "abc-1" }, ren = { kind: "vault-rename" as const, id: "b.txt", to: "a.txt" };
  const lines: ActItem[] = [
    { at: "2026-10-30T10:00:00Z", area: "operator", title: "CORE save_memory", undo: mem },
    { at: "2026-10-30T10:01:00Z", area: "system", title: "VAULT renamed", undo: ren },
    { at: "2026-10-30T10:02:00Z", area: "operator", title: "Undone", undid: undoKey(mem) },
  ];
  const parsed = parseActivity(lines.map((l) => JSON.stringify(l)).join("\n"));
  assert.deepEqual(parsed[1].undo, ren);
  const open = withOpenUndo(parsed);
  assert.equal(open[0].undo, undefined);
  assert.deepEqual(open[1].undo, ren);
  assert.equal(cleanUndo({ kind: "memory", id: "../x" }), undefined);
  assert.equal(cleanUndo({ kind: "vault-rename", id: "a" }), undefined);
});

test("AGENTS.md: operator rule present, core rules kept", () => {
  const md = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  assert.match(md, /Operator mode \(standing grants, owner-granted 2026-10-30\)/);
  assert.match(md, /send, publish, upload or spend[\s\S]{0,200}exact item with his own click/);
  assert.match(md, /Never commit to `main`/);
  assert.match(md, /Never commit secrets/);
  assert.match(md, /Do not edit REA files/);
  assert.match(md, /Journal\/LIFE text never goes to a model/);
});
