import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pure from "../src/lib/business-pure.ts";

test("mailOutcome: only a clear 2xx is sent, only a clear refusal is refused, anything that may have gone out is unknown", () => {
  assert.equal(pure.mailOutcome(200), "sent");
  assert.equal(pure.mailOutcome(null), "unknown"); // timeout / no answer: maybe sent
  assert.equal(pure.mailOutcome(500), "unknown");
  assert.equal(pure.mailOutcome(503), "unknown");
  assert.equal(pure.mailOutcome(429), "unknown");
  assert.equal(pure.mailOutcome(409), "unknown"); // same Idempotency-Key still running, or already used: maybe sent
  for (const s of [400, 401, 403, 422]) assert.equal(pure.mailOutcome(s), "refused");
});

// resendMail (business-send.ts), the path invoice reminders use, with fetch stubbed: no network, no real email.
function loadResendMail(fetchStub: (url: string, init: RequestInit) => Promise<Response>) {
  const src = readFileSync(new URL("../src/lib/business-send.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const require = (id: string) => (id === "@/lib/business-pure" ? pure : {});
  const env = { RESEND_API_KEY: "test-key", ORBIT_MAIL_FROM: "orbit@example.test" };
  runInNewContext(code, { module: mod, exports: mod.exports, require, process: { env }, fetch: fetchStub, AbortSignal, Response, JSON });
  return mod.exports.resendMail as (m: { to: string; subject: string; text: string; idempotencyKey: string }) => Promise<{ result: string; why?: string }>;
}
const mail = { to: "client@example.test", subject: "Reminder", text: "Hi", idempotencyKey: "orbit-invoice-1-v1" };

test("resendMail: no answer before or after the effect is unknown, never refused, so it is not offered for copy-and-send", async () => {
  const timeout = loadResendMail(async () => { throw new DOMException("timed out", "TimeoutError"); });
  assert.equal((await timeout(mail)).result, "unknown");
  const inFlight = loadResendMail(async () => new Response("{\"name\":\"concurrent_idempotent_requests\"}", { status: 409 }));
  assert.equal((await inFlight(mail)).result, "unknown");
});

test("resendMail: a clear refusal is refused, a 2xx is sent, and the idempotency key goes out unchanged", async () => {
  let key: string | null = null;
  const ok = loadResendMail(async (_u, init) => { key = new Headers(init.headers).get("Idempotency-Key"); return new Response("{}", { status: 200 }); });
  assert.deepEqual({ ...(await ok(mail)) }, { result: "sent" }); // spread: the object comes from the vm realm
  assert.equal(key, "orbit-invoice-1-v1");
  const bad = loadResendMail(async () => new Response("{}", { status: 422 }));
  assert.deepEqual({ ...(await bad(mail)) }, { result: "refused", why: "Resend 422" });
});
