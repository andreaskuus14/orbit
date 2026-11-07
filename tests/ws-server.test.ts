import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FULLSTACK_TEMPLATE, apiRoutes, envExampleError, idleExpired, IDLE_MS, inside, minimalEnv, nodeArgs, smokeReport, startBlocked } from "../src/lib/ws-server-pure.ts";
import { freePort, hasPermission, serverStatus, smokeCheck, startServer, stopAllServers, stopServer } from "../src/lib/ws-server.ts";
import { checkPath } from "../src/lib/workspace-pure.ts";
import { STARTS_WORK } from "../src/lib/stop-all-pure.ts";

test("env is stripped to a minimal allowlist", () => {
  const e = minimalEnv({ SUPABASE_SERVICE_ROLE_KEY: "x", ANTHROPIC_API_KEY: "y", ORBIT_DATA_DIR: "/d", PATH: "/bin", HOME: "/h", TZ: "UTC" }, 4321);
  assert.deepEqual(e, { PORT: "4321", HOST: "127.0.0.1", NODE_ENV: "development", TZ: "UTC" });
});

test("path containment, flags, guards", () => {
  const d = path.resolve("/w/ws");
  assert.ok(inside(d, path.join(d, "logs/server.log")) && inside(d, d));
  assert.ok(!inside(d, path.resolve("/w/ws2/x")) && !inside(d, path.resolve("/w/x")));
  assert.deepEqual(nodeArgs(d, true).slice(0, 3), ["--permission", `--allow-fs-read=${d}`, `--allow-fs-write=${d}`]);
  assert.ok(!nodeArgs(d, true).some((a) => /allow-(child|worker|addons|wasi)/.test(a)));
  assert.match(startBlocked({ hasServer: true, permission: false, running: false, stopAll: false }), /permission/);
  assert.match(startBlocked({ hasServer: true, permission: true, running: false, stopAll: true }), /Stop-all/);
  assert.equal(startBlocked({ hasServer: true, permission: true, running: false, stopAll: false }), "");
  assert.ok(idleExpired(0, IDLE_MS) && !idleExpired(1, IDLE_MS));
  assert.ok(STARTS_WORK.includes("ws_run"));
});

test("template paths pass checkPath; .env.example takes names only", () => {
  for (const p of Object.keys(FULLSTACK_TEMPLATE)) assert.ok(!("error" in checkPath(p)), p);
  assert.ok("error" in checkPath(".env") && "error" in checkPath(".trash/x.md"));
  assert.equal(envExampleError(FULLSTACK_TEMPLATE[".env.example"]), "");
  assert.match(envExampleError("API_KEY=sk-123"), /empty value/);
  assert.deepEqual(apiRoutes(FULLSTACK_TEMPLATE["server.mjs"]), ["/api/health", "/api/items"]);
  assert.match(smokeReport([{ what: "GET /", ok: true }, { what: "GET /api/x", ok: false, detail: "HTTP 500" }]).line, /1\/2 passed/);
});

test("port pick gives a free port", async () => {
  const p = await freePort();
  assert.ok(p > 0 && p < 65536);
});

test("real server: start, smoke check, sandbox, stop, Stop-all", { skip: !hasPermission() && "no --permission on this Node" }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orbit-ws-"));
  try {
    for (const [p, text] of Object.entries(FULLSTACK_TEMPLATE)) { mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); writeFileSync(path.join(dir, p), text); }
    const r = await startServer("t/a", dir);
    assert.ok(!("error" in r), JSON.stringify(r));
    if ("error" in r) return;
    assert.equal(serverStatus("t/a").running, true);
    const smoke = await smokeCheck(r.url, r.routes);
    assert.deepEqual(smoke.issues, []);
    assert.match(smoke.line, /4\/4 passed/);
    assert.equal(JSON.parse(readFileSync(path.join(dir, "data/db.json"), "utf8")).length, 1); // smoke item cleaned up
    assert.match(readFileSync(path.join(dir, "logs/server.log"), "utf8"), /GET \/api\/items/);
    mkdirSync(path.join(dir, "assets")); writeFileSync(path.join(dir, "assets/a.svg"), "<svg/>"); writeFileSync(path.join(dir, "secret.json"), "{}");
    assert.equal(await fetch(r.url + "assets/a.svg").then((x) => x.text()), "<svg/>"); // licensed images from ws_fetch_image
    assert.equal((await fetch(r.url + "assets/..%2Fsecret.json")).status, 403);
    // sandbox: a server that reads outside its folder or spawns a process fails
    writeFileSync(path.join(dir, "server.mjs"), `import http from "node:http"; import fs from "node:fs"; import cp from "node:child_process";
const t = (f) => { try { f(); return "open"; } catch (e) { return e.code; } };
const out = { env: Object.keys(process.env).sort(), read: t(() => fs.readFileSync(${JSON.stringify(path.join(os.tmpdir(), ".."))})), spawn: t(() => cp.execSync("echo")) };
http.createServer((q, s) => s.end(JSON.stringify(out))).listen(+process.env.PORT, "127.0.0.1");`);
    const r2 = await startServer("t/a", dir); // restart replaces the first
    assert.ok(!("error" in r2));
    if ("error" in r2) return;
    const o = await fetch(r2.url).then((x) => x.json());
    assert.deepEqual(o, { env: Object.keys(minimalEnv(process.env, 1)).sort(), read: "ERR_ACCESS_DENIED", spawn: "ERR_ACCESS_DENIED" });
    assert.equal(await stopServer("t/a"), true);
    assert.equal(serverStatus("t/a").running, false);
    await new Promise((s) => setTimeout(s, 300));
    await assert.rejects(fetch(r2.url, { signal: AbortSignal.timeout(1000) }));
    const r3 = await startServer("t/b", dir);
    assert.ok(!("error" in r3));
    assert.equal(await stopAllServers(), 1);
    assert.equal(serverStatus("t/b").running, false);
    rmSync(dir, { recursive: true }); // no retries: Stop-all returned only after the server let go of its folder (Windows locks it)
  } finally { await stopAllServers(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("Stop returns only after the server exited, so its folder can be removed right away (Windows EBUSY regression)", { skip: !hasPermission() && "no --permission on this Node" }, async () => {
  for (let i = 0; i < 5; i++) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "orbit-ws-stop-"));
    try {
      writeFileSync(path.join(dir, "server.mjs"), `import http from "node:http"; http.createServer((q, s) => s.end("ok")).listen(+process.env.PORT, "127.0.0.1");`);
      const r = await startServer(`stop/${i}`, dir);
      assert.ok(!("error" in r), JSON.stringify(r));
      if (i % 2) assert.equal(await stopAllServers(), 1); else assert.equal(await stopServer(`stop/${i}`), true);
      assert.equal(serverStatus(`stop/${i}`).running, false);
      rmSync(dir, { recursive: true }); // EBUSY on Windows if Stop returned while the process still held the folder
      assert.equal(await stopServer(`stop/${i}`), false, "a second Stop finds nothing to stop");
    } finally { await stopAllServers(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  }
});

test("site pipeline: a fullstack plan's front end lives in public/ and the server step points at the template + ws_run", async () => {
  const { nextSiteStep, siteStepHint } = await import("../src/lib/site-pipeline-pure.ts");
  const plan = "Type: fullstack";
  assert.match(siteStepHint(["plan.md"], plan), /"template": "fullstack".*ws_run/);
  assert.equal(nextSiteStep(["plan.md", "server.mjs", "css/style.css"], plan), "layout");
  assert.match(siteStepHint(["plan.md", "server.mjs"], plan), /public\/css\/style\.css/);
  assert.equal(nextSiteStep(["plan.md", "server.mjs", "public/style.css"], plan), "pages");
  assert.equal(nextSiteStep(["plan.md", "server.mjs", "public/style.css", "public/index.html", "assets/a.webp"], plan), "check");
  assert.match(siteStepHint(["plan.md"], "Type: static"), /\(css\/style\.css\)/);
});

test("smoke plan: POST-only routes aren't probed with GET; validated POST routes count when they refuse the test item", async () => {
  const { apiEndpoints, smokePlan } = await import("../src/lib/ws-server-pure.ts");
  const src = `const routes = { "GET /api/club": a, "POST /api/club/x": b, "GET /api/bookings": c, "POST /api/bookings": d, "POST /api/contact": e, "GET /api/health": f };`;
  const eps = apiEndpoints(src);
  assert.deepEqual(eps["/api/contact"], ["POST"]);
  const p = smokePlan(eps);
  assert.ok(!p.gets.includes("/api/contact") && p.gets.includes("/api/club"));
  assert.equal(p.post, "/api/bookings"); assert.equal(p.readBack, true);
  assert.deepEqual(smokePlan(apiEndpoints(`"GET /api/items" "POST /api/items"`)), { gets: ["/api/items"], post: "/api/items", readBack: true });
  assert.equal(smokePlan(apiEndpoints(`"/api/notes"`)).post, "/api/notes"); // no method named: probed as before
});

test("minimal env keeps Windows' SystemRoot in any spelling", async () => {
  const { minimalEnv, nodeArgs } = await import("../src/lib/ws-server-pure.ts");
  assert.equal(minimalEnv({ SystemRoot: "C:\\Windows" }, 1).SYSTEMROOT, "C:\\Windows");
  assert.match(nodeArgs("/w", true).at(-1)!, /keep\.has\(key\.toUpperCase\(\)\)/);
});
