import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { oauthRedirect } from "../src/lib/plugins-pure.ts";

// The sign-in route with fake auth + plugins: only the route's own checks (host, sec-fetch-site, callback mapping) run.
const code = ts.transpileModule(readFileSync(new URL("../src/app/api/plugins/oauth/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function route(finishes: Array<{ name?: string; error?: string }> = []) {
  const calls = { start: 0, finish: 0 };
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response, URL,
    require: (n: string) => {
      if (n === "next/server") return { NextResponse: { redirect: (u: string | URL) => new Response(null, { status: 307, headers: { location: String(u) } }) } };
      if (n.endsWith("supabase/server")) return { requireUser: async () => ({}) };
      if (n.endsWith("lib/plugins-pure")) return { oauthRedirect };
      if (n.endsWith("lib/plugins")) return {
        startOAuth: async () => { calls.start++; return { url: "https://login.example/authorize?x=1" }; },
        finishOAuth: async () => { calls.finish++; return finishes.shift() ?? { error: "state" }; },
      };
      throw new Error("unexpected import " + n);
    } });
  const get = (qs: string, headers: Record<string, string> = {}) => m.exports.GET({ headers: new Headers({ host: "127.0.0.1:3000", ...headers }), nextUrl: new URL(`http://127.0.0.1:3000/api/plugins/oauth${qs}`) }) as Promise<Response>;
  return { get, calls };
}

test("starting a sign-in from another site (sec-fetch-site: cross-site / same-site) is refused before anything starts", async () => {
  const { get, calls } = route();
  for (const site of ["cross-site", "same-site"]) {
    const r = await get("?name=vid", { "sec-fetch-site": site });
    assert.equal(r.status, 403, site);
  }
  assert.equal((await get("?name=vid")).status, 403, "no header at all is refused too");
  assert.equal(calls.start, 0);
  for (const site of ["same-origin", "none"]) assert.equal((await get("?name=vid", { "sec-fetch-site": site })).status, 307, site);
  assert.equal(calls.start, 2);
});

test("a doubled callback: the first lands on ?plugins=signed-in, the repeat on ?plugins=signin-state", async () => {
  const { get } = route([{ name: "vid" }]); // the real finishOAuth uses the saved state once (tests/plugins-http.test.ts)
  const to = async () => (await get("?code=c&state=vid.s")).headers.get("location");
  assert.equal(await to(), "http://127.0.0.1:3000/?plugins=signed-in");
  assert.equal(await to(), "http://127.0.0.1:3000/?plugins=signin-state");
});

test("a callback on a proxied or non-127.0.0.1 host is refused", async () => {
  const { get, calls } = route();
  assert.equal((await get("?code=c&state=s", { host: "evil.example" })).status, 400);
  assert.equal((await get("?code=c&state=s", { "x-forwarded-host": "evil.example" })).status, 400);
  assert.equal(calls.finish, 0);
});
