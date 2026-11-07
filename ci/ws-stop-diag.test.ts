// Windows diagnosis (Agent 3): does stopServer return before the workspace server exits, or does something else hold the folder?
// Copied into tests/ of the commit under test by the workflow; runs the real ws-server.ts with a minimal server.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { hasPermission, startServer, stopServer } from "../src/lib/ws-server.ts";

const runs = () => (globalThis as unknown as { __orbitWsRuns: Map<string, { child: ChildProcess }> }).__orbitWsRuns;
const tryRm = (dir: string) => { try { rmSync(dir, { recursive: true, force: true }); return "removed"; } catch (e) { return (e as NodeJS.ErrnoException).code ?? String(e); } };

test("diagnose: folder removal right after Stop vs after the server's exit", { skip: !hasPermission() && "no --permission" }, async () => {
  const rows: string[] = [];
  for (let i = 0; i < 5; i++) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "orbit-wsdiag-"));
    mkdirSync(path.join(dir, "data"), { recursive: true });
    writeFileSync(path.join(dir, "server.mjs"), `import http from "node:http"; http.createServer((q, s) => s.end("ok")).listen(+process.env.PORT, "127.0.0.1");`);
    const r = await startServer(`diag/${i}`, dir);
    assert.ok(!("error" in r), JSON.stringify(r));
    const child = runs().get(`diag/${i}`)!.child;
    const exited = new Promise<number>((res) => { const t0 = Date.now(); child.once("exit", () => res(Date.now() - t0)); });
    const t0 = Date.now();
    assert.equal(stopServer(`diag/${i}`), true);
    const returnedMs = Date.now() - t0, aliveAtReturn = child.exitCode === null && child.signalCode === null;
    const rmNow = tryRm(dir);
    const exitMs = await exited;
    const rmAfterExit = rmNow === "removed" ? "-" : tryRm(dir);
    rows.push(`run ${i}: stop returned in ${returnedMs} ms, child alive at return=${aliveAtReturn}, rm right after Stop=${rmNow}, exit after ${exitMs} ms, rm after exit=${rmAfterExit}`);
  }
  console.log(rows.join("\n"));
});
