import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PAUSED_MSG, STARTS_WORK, STOP_ALL_EVENT, STOP_ALL_REQUEST_EVENT, type StopAllDetail, coreToolRefusal, parseStop } from "../src/lib/stop-all-pure.ts";

test("Stop-all event contract carries both on and off states", () => {
  assert.equal(STOP_ALL_EVENT, "orbit:stop-all");
  assert.equal(STOP_ALL_REQUEST_EVENT, "orbit:stop-all-request");
  const bus = new EventTarget();
  const received: StopAllDetail[] = [];
  bus.addEventListener(STOP_ALL_EVENT, e => received.push((e as CustomEvent<StopAllDetail>).detail));
  for (const on of [true, false]) bus.dispatchEvent(new CustomEvent<StopAllDetail>(STOP_ALL_EVENT, { detail: { on } }));
  assert.deepEqual(received, [{ on: true }, { on: false }]);
});

test("coreToolRefusal: work-starting tools are refused only while Stop-all is on", () => {
  for (const t of STARTS_WORK) {
    assert.equal(coreToolRefusal(true, t), `Error: ${PAUSED_MSG}`);
    assert.equal(coreToolRefusal(false, t), "");
  }
  for (const t of ["save_memory", "fetch_url", "navigate", "life_remind", "ws_write", "studio_status"]) assert.equal(coreToolRefusal(true, t), "");
  assert.match(PAUSED_MSG, /ORBIT is paused \(Stop-all is on\)/);
});

test("parseStop: valid state round-trips, anything else is off", () => {
  assert.deepEqual(parseStop(JSON.stringify({ on: true, at: "2026-10-18T10:00:00Z" })), { on: true, at: "2026-10-18T10:00:00Z" });
  assert.deepEqual(parseStop(JSON.stringify({ on: false })), { on: false, at: "" });
  for (const bad of [null, "", "{", "[]", '{"on":"yes"}', "null"]) assert.equal(parseStop(bad).on, false);
});

test("setStopAll persists atomically and stopAllOn reflects it at once", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-stop-"));
  process.env.ORBIT_DATA_DIR = dir;
  const m = await import("../src/lib/stop-all.ts");
  delete (globalThis as { __orbitStopAll?: unknown }).__orbitStopAll;
  assert.equal(m.stopAllOn(), false); // no file yet
  await m.setStopAll(true);
  assert.equal(m.stopAllOn(), true);
  assert.equal(parseStop(await readFile(path.join(dir, "stop-all.json"), "utf8")).on, true);
  delete (globalThis as { __orbitStopAll?: unknown }).__orbitStopAll; // a restart re-reads the file
  assert.equal(m.stopAllOn(), true);
  await m.setStopAll(false);
  assert.equal(m.stopAllOn(), false);
  delete process.env.ORBIT_DATA_DIR;
  delete (globalThis as { __orbitStopAll?: unknown }).__orbitStopAll;
});

test("a stop-all.json that can't be read or is damaged fails closed until Resume; only a missing one is off", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-stop-bad-")), f = path.join(dir, "stop-all.json");
  process.env.ORBIT_DATA_DIR = dir;
  const m = await import("../src/lib/stop-all.ts");
  const fresh = () => { delete (globalThis as { __orbitStopAll?: unknown }).__orbitStopAll; return m.stopAllOn(); }; // a restart
  assert.equal(fresh(), false, "missing: off");
  for (const bad of ["", "{", '{"on":"yes"}']) { await writeFile(f, bad); assert.equal(fresh(), true, `damaged ${JSON.stringify(bad)}: on`); }
  await rm(f); await mkdir(f); // unreadable (EISDIR here; EBUSY/EPERM from a Windows lock)
  assert.equal(fresh(), true, "unreadable: on");
  await rm(f, { recursive: true });
  assert.equal(m.stopAllOn(), false, "a read error is retried: once the lock is gone the real state shows");
  await writeFile(f, "");
  assert.equal(fresh(), true);
  await m.setStopAll(false); // Resume
  assert.equal(fresh(), false, "Resume rewrites the file");
  delete process.env.ORBIT_DATA_DIR;
  delete (globalThis as { __orbitStopAll?: unknown }).__orbitStopAll;
});
