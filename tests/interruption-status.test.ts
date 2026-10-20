import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function route(file: string, imports: Record<string, any>) {
  const code = ts.transpileModule(readFileSync(new URL(`../src/app/api/${file}/route.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Response, URL, require: (name: string) => imports[name] });
  return m.exports.GET;
}
test("notification disk check is authenticated and never runs boot/CLI/network doctor checks", async () => {
  let reads = 0;
  const imports = {
    "@/lib/supabase/server": { requireUser: async () => ({ sb: {} }) },
    "@/lib/doctor": { disk: async () => { reads++; return { id: "disk", status: "fail", detail: "1 GB free" }; }, runDoctor() { throw new Error("Full doctor must not run"); } },
    "@/lib/doctor-boot": { bootSelfTest() { throw new Error("Boot must not run"); } },
  };
  const get = route("doctor", imports);
  assert.deepEqual(await (await get(new Request("http://localhost/api/doctor?interruptions=1"))).json(), { checks: [{ id: "disk", status: "fail", detail: "1 GB free" }] });
  assert.equal(reads, 1);
  imports["@/lib/supabase/server"].requireUser = async () => ({ res: new Response("Unauthorized", { status: 401 }) }) as any;
  assert.equal((await get(new Request("http://localhost/api/doctor?interruptions=1"))).status, 401); assert.equal(reads, 1);
});
test("a failed disk read stays unknown instead of falsely resolving a red alert", async () => {
  const get = route("doctor", {
    "@/lib/supabase/server": { requireUser: async () => ({ sb: {} }) },
    "@/lib/doctor": { disk: async () => { throw new Error("unavailable"); } },
  });
  assert.deepEqual(await (await get(new Request("http://localhost/api/doctor?interruptions=1"))).json(), { checks: [] });
});
test("YouTube status exposes only the existing expiry flag, never credentials or a token refresh", async () => {
  let expired = true;
  const get = route("studio/oauth/status", {
    "@/lib/supabase/server": { requireUser: async () => ({}) },
    "@/lib/yt-oauth": { oauthEnv: () => ({ secret: "PRIVATE_SECRET" }), readStored: async () => ({ refresh_token: "PRIVATE_TOKEN", channelTitle: "My channel", connectedAt: "today" }), wasExpired: () => expired },
    "@/lib/yt-analytics-pure": { hasScopes: () => true, YT_UPLOAD_SCOPE: "upload" },
  });
  const response = await (await get()).json();
  assert.equal(response.expired, true); assert.equal(response.channelTitle, "My channel");
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_/);
  expired = false; assert.equal((await (await get()).json()).expired, false);
});
test("YouTube notification status refuses signed-out callers", async () => {
  const get = route("studio/oauth/status", {
    "@/lib/supabase/server": { requireUser: async () => ({ res: new Response("Unauthorized", { status: 401 }) }) },
    "@/lib/yt-oauth": { readStored() { throw new Error("Must not read tokens"); } },
    "@/lib/yt-analytics-pure": {},
  });
  assert.equal((await get()).status, 401);
});
