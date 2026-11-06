import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorize, authorityDefaults, consume, ENTRIES, newGrant, parseAuthority, setMode, POLICY_VERSION, type AuthCtx, type AuthorityState, type Grant } from "../src/lib/authority-pure.ts";
import { CONSEQUENTIAL, EFFECTS, contentHash } from "../src/lib/approval-pure.ts";

const now = Date.parse("2026-10-29T12:00:00Z");
const grant = (over: Partial<Grant> = {}) => ({ ...(newGrant({ workflow: "rule:r1", actions: ["rules.run"], limits: { count: 2 } }, "g1", now) as Grant), ...over });
const st = (grants: Grant[] = [grant()], modes: AuthorityState["modes"] = { "rule:r1": "prepare" }): AuthorityState => ({ grants, modes });
const ctx = (over: Partial<AuthCtx> = {}): AuthCtx => ({ entry: "rule", workflow: "rule:r1", stopAll: false, state: st(), now, ...over });

test("a matching grant covers a reversible action in Prepare mode; outside it is blocked with a reason", () => {
  assert.equal(authorize("rules.run", ctx()).by, "grant");
  assert.match(authorize("rules.run", ctx({ workflow: "rule:r2", state: st([grant()], { "rule:r2": "prepare" }) })).why, /not covered/);
  assert.match(authorize("rules.run", ctx({ state: st([], { "rule:r1": "observe" }) })).why, /Observe/);
  assert.match(authorize("rules.run", ctx({ state: st([grant()], { "rule:r1": "hold" }) })).why, /hold/);
  assert.equal(authorize("rules.run", ctx({ state: authorityDefaults() })).by, "legacy"); // no mode set: behaviour as before
  assert.match(authorize("rules.run", ctx({ stopAll: true })).why, /Stop-all/);
});

test("limits, destinations, expiry and policy version", () => {
  let s = st();
  s = consume(s, "g1", {}); s = consume(s, "g1", {});
  assert.match(authorize("rules.run", ctx({ state: s })).why, /count used up/);
  assert.match(authorize("rules.run", ctx({ destination: "x@y.z" })).why, /allow-list/);
  assert.ok(authorize("rules.run", ctx({ destination: "X@y.z ", state: st([grant({ destinations: ["x@y.z"] })]) })).ok);
  assert.match(authorize("rules.run", ctx({ money: 1 })).why, /money/);
  assert.match(authorize("rules.run", ctx({ state: st([grant({ expiresAt: "2026-10-01T00:00:00Z" })]) })).why, /expired/);
  assert.match(authorize("rules.run", ctx({ state: st([grant({ policyVersion: "old" })]) })).why, /older policy/);
});

test("alternate entry points can't gain broader authority: same ctx, same verdict from every entry", () => {
  for (const c of [ctx(), ctx({ workflow: "rule:r2" }), ctx({ state: st([grant({ revoked: true })]) }), ctx({ stopAll: true })])
    for (const action of Object.keys(EFFECTS)) {
      const vs = ENTRIES.map((entry) => authorize(action, { ...c, entry }));
      assert.ok(vs.every((v) => v.ok === vs[0].ok && v.why === vs[0].why), `${action} differs by entry`);
    }
  assert.equal(authorize("anything.new", ctx({ ownerClick: true })).ok, false); // unknown fails closed
  assert.equal(authorize("rules.run", ctx({ decision: { allow: false, reason: "policy says no" } })).why, "policy says no"); // decide() first
});

test("a consequential action is never authorized by a grant", async () => {
  const kinds = Object.keys(EFFECTS).filter((k) => CONSEQUENTIAL.includes(EFFECTS[k]));
  assert.ok(kinds.length >= 8);
  for (const action of kinds) {
    assert.match(newGrant({ workflow: "w", actions: [action] }, "x", now) as string, /can't be granted/, action);
    // even a forged stored grant, in any mode, from any entry, with or without his click
    const forged = { ...grant(), workflow: "w", actions: [action] };
    assert.equal(parseAuthority(JSON.stringify({ grants: [forged], modes: { w: "operate" } })).grants.length, 0, action);
    for (const entry of ENTRIES) for (const ownerClick of [false, true])
      assert.equal(authorize(action, { ...ctx(), entry, ownerClick, workflow: "w", state: { grants: [forged], modes: { w: "prepare" } } }).ok, false, action);
    const h = await contentHash({ a: 1 });
    assert.equal(authorize(action, ctx({ approval: { approved: h, hash: h } })).by, "approval"); // only his exact-content approval
    assert.match(authorize(action, ctx({ approval: { approved: h, hash: "other" } })).why, /changed/);
  }
  assert.match(setMode(authorityDefaults(), "w", "operate") as string, /not enabled/);
});

test("stale approvals and bindings are refused", () => {
  const first = authorize("rules.run", ctx());
  assert.ok(authorize("rules.run", ctx({ binding: first.binding })).ok);
  assert.match(authorize("rules.run", ctx({ binding: first.binding, state: st([grant({ id: "g2" })]) })).why, /stale/);
  assert.match(authorize("rules.run", ctx({ binding: first.binding.replace(POLICY_VERSION, "old") })).why, /stale/);
  const h = "h1", a = authorize("business.send", ctx({ approval: { approved: h, hash: h } }));
  assert.match(authorize("business.send", ctx({ binding: a.binding, approval: { approved: "h2", hash: "h2" } })).why, /stale/); // re-approved other content can't reuse a binding
});

test("revocation applies at the next action boundary (file store)", async () => {
  process.env.ORBIT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "orbit-auth-"));
  const { authorizeAction, updateAuthority } = await import("../src/lib/authority.ts");
  await updateAuthority((s) => ({ out: null, state: { ...s, grants: [grant({ limits: {} })], modes: { "rule:r1": "prepare" } } }));
  assert.equal((await authorizeAction("rules.run", { entry: "rule", workflow: "rule:r1" })).by, "grant");
  await updateAuthority((s) => ({ out: null, state: { ...s, grants: s.grants.map((g) => ({ ...g, revoked: true })) } }));
  const v = await authorizeAction("rules.run", { entry: "rule", workflow: "rule:r1" });
  assert.equal(v.ok, false); assert.match(v.why, /revoked/);
  assert.equal(parseAuthority("not json").grants.length, 0);
  assert.equal(parseAuthority(JSON.stringify({ grants: [{ ...grant(), revoked: undefined }] })).grants[0].revoked, true); // missing flag fails closed
});

test("an unreadable authority.json fails closed and is never saved over", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "orbit-auth-bad-"));
  process.env.ORBIT_DATA_DIR = dir;
  const { authorizeAction, authorizeTool, authorityState, updateAuthority } = await import("../src/lib/authority.ts");
  const { writeFileSync, readFileSync } = await import("node:fs");
  const f = path.join(dir, "authority.json"), damaged = '{"grants": [], "modes": {"rule:r1": "hold"'; // a hold he set, half-written by another tool
  writeFileSync(f, damaged);
  const v = await authorizeAction("rules.run", { entry: "rule", workflow: "rule:r1" });
  assert.equal(v.ok, false); assert.match(v.why, /Permissions couldn't be loaded/); // no mode/grant = "legacy" allow on the old code
  assert.equal((await authorizeAction("rules.run", { entry: "automation", workflow: "other" })).ok, false); // every workflow, not just held ones
  assert.ok(authorityState().unreadable);
  await assert.rejects(updateAuthority((s) => ({ out: null, state: { ...s, grants: [] } })));
  assert.equal(readFileSync(f, "utf8"), damaged); // his file untouched
  assert.equal(authorizeTool("rules.run", { allow: true, reason: "ok", tier: "T1" }).allow, true); // his own chat ask still acts
});
