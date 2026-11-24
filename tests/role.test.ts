import { test } from "node:test";
import assert from "node:assert/strict";
import { allowHit, clientIp, isCloud, journalWriteBlocked, laptopOnlyApi, laptopOnlyTool, orbitRole, rateRule, type Buckets } from "../src/lib/role-pure.ts";
import { queueOn, workerOn } from "../src/lib/gpu-queue-pure.ts";

test("role: laptop unless ORBIT_ROLE=cloud", () => {
  assert.equal(orbitRole({}), "laptop");
  assert.equal(orbitRole({ ORBIT_ROLE: "laptop" }), "laptop");
  assert.equal(orbitRole({ ORBIT_ROLE: "somethingelse" }), "laptop");
  assert.equal(orbitRole({ ORBIT_ROLE: " Cloud " }), "cloud");
  assert.equal(isCloud({ ORBIT_ROLE: "cloud" }), true);
});

test("gpu queue: cloud always queues and never works jobs itself", () => {
  assert.equal(queueOn({}), false);
  assert.equal(workerOn({ ORBIT_GPU_QUEUE: "1" }), true);
  assert.equal(queueOn({ ORBIT_ROLE: "cloud" }), true);
  assert.equal(workerOn({ ORBIT_ROLE: "cloud" }), false);
  assert.equal(workerOn({ ORBIT_ROLE: "cloud", ORBIT_GPU_QUEUE: "1", ORBIT_GPU_WORKER: "1" }), false);
  assert.equal(workerOn({ ORBIT_GPU_QUEUE: "1", ORBIT_GPU_WORKER: "0" }), false);
});

test("laptop-only routes and tools", () => {
  for (const p of ["/api/terminal", "/api/pc", "/api/pc/x", "/api/system/update", "/api/voice/desk", "/api/studio/clips/1", "/api/arch/render"]) assert.ok(laptopOnlyApi(p), p);
  for (const p of ["/api/core", "/api/pcx", "/api/studio", "/api/studio/analytics", "/api/vault", "/api/gpu-jobs", "/api/health", "/api/voice/transcribe"]) assert.ok(!laptopOnlyApi(p), p);
  assert.ok(laptopOnlyTool("pc_act") && laptopOnlyTool("terminal_run") && laptopOnlyTool("local_transcribe"));
  assert.ok(!laptopOnlyTool("local_image") && !laptopOnlyTool("vault_search"));
});

test("rate limit: per key fixed window", () => {
  const b: Buckets = new Map();
  for (let i = 0; i < 3; i++) assert.ok(allowHit(b, "a", 0, 3, 1000));
  assert.equal(allowHit(b, "a", 10, 3, 1000), false);
  assert.ok(allowHit(b, "b", 10, 3, 1000));
  assert.ok(allowHit(b, "a", 1000, 3, 1000));
  assert.equal(rateRule("/auth/callback")?.limit, 20);
  assert.equal(rateRule("/api/remote/pair")?.limit, 10);
  assert.equal(rateRule("/api/core"), null);
  assert.equal(rateRule("/projects"), null);
  assert.equal(clientIp("1.2.3.4, 5.6.7.8", null), "1.2.3.4");
  assert.equal(clientIp(null, "9.9.9.9"), "9.9.9.9");
  assert.equal(clientIp(null, null), "?");
});

test("journal: cloud without key can't write plain text", () => {
  assert.equal(journalWriteBlocked({ ORBIT_ROLE: "cloud" }, false), true);
  assert.equal(journalWriteBlocked({ ORBIT_ROLE: "cloud" }, true), false);
  assert.equal(journalWriteBlocked({}, false), false);
});

test("allow-list: cloud with an empty list lets nobody in", async () => {
  const { isAllowedEmail } = await import("../src/lib/allow.ts");
  const keep = { r: process.env.ORBIT_ROLE, a: process.env.ORBIT_ALLOWED_EMAILS };
  try {
    delete process.env.ORBIT_ALLOWED_EMAILS;
    delete process.env.ORBIT_ROLE; assert.equal(isAllowedEmail("x@y.z"), true);
    process.env.ORBIT_ROLE = "cloud"; assert.equal(isAllowedEmail("x@y.z"), false);
    process.env.ORBIT_ALLOWED_EMAILS = "X@y.z"; assert.equal(isAllowedEmail("x@y.z"), true); assert.equal(isAllowedEmail("o@y.z"), false);
  } finally {
    if (keep.r === undefined) delete process.env.ORBIT_ROLE; else process.env.ORBIT_ROLE = keep.r;
    if (keep.a === undefined) delete process.env.ORBIT_ALLOWED_EMAILS; else process.env.ORBIT_ALLOWED_EMAILS = keep.a;
  }
});

test("scheduler switch", async () => {
  const { schedulerOn } = await import("../src/lib/role-pure.ts");
  assert.equal(schedulerOn({}), true);
  assert.equal(schedulerOn({ ORBIT_SCHEDULER: "0" }), false);
});
