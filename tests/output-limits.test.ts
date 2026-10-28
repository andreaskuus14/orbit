import { test } from "node:test";
import assert from "node:assert/strict";
import { createClipStore } from "../src/lib/clip-store-pure.ts";
import { createForeground } from "../src/lib/foreground-pure.ts";
import { latencyCheck } from "../src/lib/doctor-pure.ts";
import { TIERS, decide } from "../src/lib/policy-pure.ts";
import { EFFECTS } from "../src/lib/approval-pure.ts";
import { CORE_BUILTINS } from "../src/lib/core-sdk-pure.ts";

test("clip store: short text passes, long text gets a pointer and reads back in full", () => {
  const c = createClipStore(10);
  assert.equal(c.clip("short"), "short");
  const full = "abcdefghij" + "klmnopqrst" + "uvw";
  const out = c.clip(full);
  assert.ok(out.startsWith("abcdefghij") && out.includes('13 chars omitted') && out.includes('"ref":"r1","offset":10'));
  const p2 = c.read({ ref: "r1", offset: 10 });
  assert.ok(p2.startsWith("klmnopqrst") && p2.includes('"offset":20'));
  assert.equal(c.read({ ref: "r1", offset: 20 }), "uvw\n[end of result]");
  assert.match(c.read({ ref: "r9", offset: 0 }), /^Error: unknown ref/);
  assert.match(c.read({ ref: "r1", offset: 99 }), /^Error: offset past/);
  assert.ok(c.read({ ref: "r1", offset: -5 }).startsWith("abcdefghij"));
});

test("read_more is a T1 read tool in every list", () => {
  assert.equal(TIERS.read_more, "T1");
  assert.equal(EFFECTS.read_more, "read");
  assert.ok((CORE_BUILTINS as readonly string[]).includes("read_more"));
  assert.ok(decide("read_more", { ref: "r1", offset: 0 }, { stopAll: false, attach: false, pins: false, steps: [], question: "hi" }).allow);
});

test("foreground gate: background waits while a turn runs, never past maxMs", async () => {
  let t = 0;
  const fg = createForeground(async (ms) => { t += ms; }, () => t);
  assert.equal(await fg.idle(), true);
  const leave = fg.enter();
  assert.equal(fg.active(), true);
  assert.equal(await fg.idle(2000, 500), false);
  assert.equal(t, 2000);
  leave(); leave(); // idempotent
  assert.equal(fg.active(), false);
  const l2 = fg.enter();
  const p = fg.idle(60_000, 500);
  l2();
  assert.equal(await p, true);
});

test("latency check: medians of first token and total", () => {
  assert.match(latencyCheck([]).detail, /No CORE turns/);
  const c = latencyCheck([{ ms: { first_token: 1000, total: 4000 } }, { ms: { first_token: 3000, total: 9000 } }, { ms: { total: 5000 } }]);
  assert.equal(c.status, "ok");
  assert.match(c.detail, /3 turns: first words 1\.0 s, full answer 5\.0 s/);
});
