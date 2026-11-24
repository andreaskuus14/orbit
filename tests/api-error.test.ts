import { test } from "node:test";
import assert from "node:assert/strict";
import { authUnreachable, classifyError, errorResponse, isPrivateRoute, logLine, redactMessage, safeMessage, supabaseTimeoutMs, TEXT, timeoutSignal } from "../src/lib/api-error-pure.ts";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as apiErrorPure from "../src/lib/api-error-pure.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const req = createRequire(import.meta.url);
const { notFound, redirect } = req("next/navigation") as typeof import("next/navigation");
// api-route.ts imports "next/navigation" (Next's bundler resolves it; native ESM can't), so load it like the other route tests do
const guard: typeof import("../src/lib/api-route.ts").guard = (() => {
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/api-route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response, process, console: { error: (...a: unknown[]) => console.error(...a) },
    require: (n: string) => (n.endsWith("api-error-pure.ts") ? apiErrorPure : req(n)) });
  return m.exports.guard;
})();

const net = (code: string, msg = "fetch failed") => Object.assign(new TypeError(msg), { cause: Object.assign(new Error(`connect ${code} 127.0.0.1:11434`), { code }) });

test("classifies timeouts, offline services and plain bugs", () => {
  assert.equal(classifyError(new DOMException("x", "TimeoutError")), "timeout");
  assert.equal(classifyError(Object.assign(new Error("a"), { name: "AbortError" })), "timeout");
  assert.equal(classifyError(net("ECONNREFUSED")), "offline");
  assert.equal(classifyError(new TypeError("Failed to fetch")), "offline");
  assert.equal(classifyError(new Error("x is undefined")), "internal");
  assert.equal(classifyError(null), "internal");
});

test("errorResponse names Ollama / Supabase and never leaks raw messages", () => {
  assert.deepEqual(errorResponse(net("ECONNREFUSED")), { status: 503, body: { error: TEXT.ollama, kind: "offline" } });
  const sb = errorResponse(new TypeError("fetch failed https://abc.supabase.co/rest/v1"), {});
  assert.equal(sb.body.error, TEXT.supabase);
  assert.equal(errorResponse(new DOMException("t", "TimeoutError")).status, 504);
  const bug = errorResponse(new Error("ENOENT C:\\Users\\me\\secret.txt key=sk-ant-abcdefghijkl"));
  assert.deepEqual(bug, { status: 500, body: { error: TEXT.internal, kind: "internal" } });
});

test("redactMessage strips secrets, paths, stacks", () => {
  const env = { ANTHROPIC_API_KEY: "supersecretvalue123", HOME: "/home/x" };
  const r = redactMessage("bad supersecretvalue123 sk-abcdefghijk Bearer abc.def eyJhbGciOiJ.eyJzdWIiOiIx.sig ghp_abcdefghijk C:\\Users\\me\\a.txt /home/me/x https://u:p@host/?token=zz\n    at foo (file.ts:1)", env);
  for (const bad of ["supersecretvalue123", "sk-abc", "abc.def", "eyJ", "ghp_", "Users", "/home/me", "u:p@", "zz", "at foo"]) assert.ok(!r.includes(bad), `${bad} leaked: ${r}`);
  assert.ok(redactMessage("x".repeat(1000)).length <= 300);
});

test("safeMessage keeps intended messages, made safe", () => {
  assert.equal(safeMessage(new Error("Local model isn't available"), "Failed"), "Local model isn't available");
  assert.equal(safeMessage("nope", "Failed"), "Failed");
  assert.equal(safeMessage(net("ECONNREFUSED"), "Failed"), TEXT.ollama);
  assert.ok(!safeMessage(new Error("open /home/me/a"), "F").includes("/home/me"));
});

test("private (LIFE/journal) routes log no details", () => {
  assert.ok(isPrivateRoute("life") && isPrivateRoute("life/journal") && isPrivateRoute("diary") && isPrivateRoute("evening") && isPrivateRoute("capsule"));
  assert.ok(isPrivateRoute("lifestyle") && !isPrivateRoute("studio")); // life* is private by path, erring on the safe side
  const line = logLine("life", new Error("my secret journal text"));
  assert.ok(!line.includes("journal text"));
  assert.match(logLine("studio", new Error("boom")), /studio failed \(internal\): Error: boom/);
});

test("supabase deadlines and auth reachability", () => {
  assert.equal(supabaseTimeoutMs("https://x.supabase.co/storage/v1/object/vault/a", "POST"), 120_000);
  assert.equal(supabaseTimeoutMs("https://x.supabase.co/rest/v1/t", "POST"), 20_000);
  // restoreFromCloud downloads up to 50 MB: storage GETs get the long deadline too
  assert.equal(supabaseTimeoutMs("https://x.supabase.co/storage/v1/object/vault/backup.zip", "GET"), 120_000);
  assert.equal(supabaseTimeoutMs("https://x.supabase.co/storage/v1/object/sign/vault/a"), 120_000);
  assert.equal(supabaseTimeoutMs("https://x.supabase.co/auth/v1/user"), 20_000);
  assert.ok(authUnreachable({ name: "AuthRetryableFetchError", status: 0 }));
  assert.ok(authUnreachable({ name: "AuthApiError", status: 503 }));
  assert.ok(!authUnreachable({ name: "AuthSessionMissingError", status: 400 }));
  assert.ok(!authUnreachable(null));
});

test("timeoutSignal aborts and joins a caller signal", async () => {
  const s = timeoutSignal(10);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(s.aborted);
  const c = new AbortController(), j = timeoutSignal(10_000, c.signal);
  c.abort(); assert.ok(j.aborted);
});

test("guard turns throws into JSON and passes answers through", async () => {
  const logs: string[] = [], orig = console.error;
  console.error = (m: string) => logs.push(m);
  try {
    const ok = await guard("x", async () => Response.json({ a: 1 }))();
    assert.deepEqual(await ok.json(), { a: 1 });
    const bad = await guard("life", async () => { throw new Error("journal words at C:\\x"); })();
    assert.equal(bad.status, 500);
    const body = await bad.json();
    assert.deepEqual(body, { error: TEXT.internal, kind: "internal" });
    assert.ok(!logs.join().includes("journal words"));
    const down = await guard("core", async () => { throw net("ECONNREFUSED"); })();
    assert.equal(down.status, 503);
  } finally { console.error = orig; }
});

test("timeoutSignal works without AbortSignal.any / AbortSignal.timeout (old iOS Safari)", async () => {
  const A = AbortSignal as unknown as Record<string, unknown>, any = A.any, timeout = A.timeout;
  A.any = undefined; A.timeout = undefined;
  try {
    const s = timeoutSignal(10);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(s.aborted);
    assert.equal((s.reason as DOMException).name, "TimeoutError");
    assert.equal(classifyError(s.reason), "timeout");
    const c = new AbortController(), j = timeoutSignal(10_000, c.signal);
    assert.ok(!j.aborted); c.abort(); assert.ok(j.aborted);
    const pre = new AbortController(); pre.abort();
    assert.ok(timeoutSignal(10_000, pre.signal).aborted);
  } finally { A.any = any; A.timeout = timeout; }
});

test("private by path: LIFE/journal/memories folders and the routes that read journal text", () => {
  for (const p of ["life", "life/journal", "lifelog", "journal-x", "diary", "evening", "capsule", "dream", "memories", "memories/[id]", "memories/reembed", "search", "time-machine", "core/chats", "core/chats/[id]", "src/app/api/life/route.ts", "/memories/upload"])
    assert.ok(isPrivateRoute(p), p);
  for (const p of ["studio", "school", "core", "core/allow-once", "research", "arch/studio"]) assert.ok(!isPrivateRoute(p), p);
});

test("every guard() name is its route's path under src/app/api (so the private rule follows the path)", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : n === "route.ts" ? [p] : []; });
  let n = 0;
  for (const f of walk("src/app/api")) {
    const path = f.replace(/\\/g, "/").replace(/^src\/app\/api\//, "").replace(/\/route\.ts$/, "");
    for (const m of readFileSync(f, "utf8").matchAll(/guard\("([^"]+)"/g)) { n++; assert.equal(m[1], path, f); }
  }
  assert.ok(n >= 86, `found ${n} guarded handlers`);
});

test("guard lets redirect() and notFound() through to Next", async () => {
  await assert.rejects(guard("x", async () => redirect("/login"))(), (e: unknown) => String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT"));
  await assert.rejects(guard("x", async () => notFound())(), (e: unknown) => /NEXT_(HTTP_ERROR_FALLBACK|NOT_FOUND)/.test(String((e as { digest?: string }).digest)));
});
