import { test } from "node:test";
import assert from "node:assert/strict";
import { TOKEN_MS, isPhoneAct, markUsed, phoneActionable, signAct, verifyAct } from "../src/lib/ntfy-action-pure.ts";

const key = Buffer.alloc(32, 7), now = Date.parse("2026-11-02T10:00:00Z");

test("a signed token verifies once, for 24 h, with the right key only", () => {
  const tok = signAct(key, "task-1", "user-1", now, "nonce1");
  const v = verifyAct(key, tok, now + 1000, {});
  assert.deepEqual(v, { t: "task-1", u: "user-1", e: now + TOKEN_MS, n: "nonce1" });
  assert.match((verifyAct(key, tok, now + TOKEN_MS, {}) as { error: string }).error, /expired/);
  assert.match((verifyAct(key, tok, now, { nonce1: now + TOKEN_MS }) as { error: string }).error, /Already answered/);
  assert.equal((verifyAct(Buffer.alloc(32, 8), tok, now, {}) as { error: string }).error, "bad token");
});

test("tampered or malformed tokens are refused", () => {
  const tok = signAct(key, "task-1", "user-1", now, "n");
  const [body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ t: "task-2", u: "user-1", e: now + TOKEN_MS, n: "n" })).toString("base64url");
  for (const bad of [`${forged}.${sig}`, `${body}.`, body, `${tok}.x`, 42, "", "a".repeat(700)]) assert.ok("error" in verifyAct(key, bad, now, {}), String(bad).slice(0, 20));
});

test("markUsed spends a nonce and drops expired ones", () => {
  assert.deepEqual(markUsed({ old: now - 1, live: now + 5 }, "new", now + 9, now), { live: now + 5, new: now + 9 });
});

test("buttons only for one waiting reversible action", () => {
  assert.equal(phoneActionable([{ tool: "save_memory", status: "pending" }]), true);
  assert.equal(phoneActionable([{ tool: "save_memory", status: "pending" }, { tool: "add_task", status: "pending" }]), false); // grouped: Open only
  assert.equal(phoneActionable([{ tool: "save_memory", status: "approved" }, { tool: "add_task", status: "pending" }]), true);
  assert.equal(phoneActionable([{ tool: "business.send", status: "pending" }]), false); // send
  assert.equal(phoneActionable([{ tool: "story.approve", status: "pending" }]), false); // spend
  assert.equal(phoneActionable([{ tool: "made_up_tool", status: "pending" }]), false); // unknown fails closed
  assert.equal(phoneActionable(null), false);
  assert.ok(isPhoneAct("approve") && isPhoneAct("reject") && !isPhoneAct("resume"));
});
