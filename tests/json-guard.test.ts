import { test } from "node:test";
import assert from "node:assert/strict";
import { okJson, errorOf, isPcView, isKaggleView, isCalView, isTrackView, isServerView, isMissionCat, isEconomyView, isHealthView, isComfyView } from "../src/lib/json-guard-pure.ts";

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const bad = (status: number) => ({ ok: false, status, json: async () => { throw new Error("html"); } });
const ERR = { error: "boom" };

const cases: [string, (v: unknown) => boolean, unknown][] = [
  ["ThisPc", isPcView, { brain: { state: "ok", text: "" }, autostart: { on: true, text: "", command: "" } }],
  ["KaggleBurst", isKaggleView, { on: true, setup: { ok: true, hint: "" }, quota: null, hoursLeft: 30, job: null, offers: [] }],
  ["CalendarCard", isCalView, { configured: true, connected: false }],
  ["StudioTrack", isTrackView, { stages: [], tracks: [] }],
  ["ServerCard", isServerView, { running: false, routes: [], note: "" }],
  ["MissionTargets", isMissionCat, { targets: [], defaults: [] }],
  ["GameCopilot", isEconomyView, { table: "", voice: "", notesAt: "" }],
  ["LocalAi health", isHealthView, { running: false }],
  ["LocalAi comfy", isComfyView, { running: false, installed: false }],
];

for (const [name, check, good] of cases) {
  test(`${name}: error reply is not stored as data`, async () => {
    assert.equal(await okJson(res(500, ERR), check), null);
    assert.equal(await okJson(res(200, ERR), check), null, "200 with { error } still rejected");
    assert.equal(await okJson(bad(500), check), null, "non-JSON 500 page");
    assert.equal(await okJson(res(200, null), check), null);
    assert.equal(await okJson(res(200, []), check), null);
    assert.deepEqual(await okJson(res(200, good), check), good);
  });
}

test("errorOf reads the error text or falls back", () => {
  assert.equal(errorOf(ERR, "x"), "boom");
  assert.equal(errorOf({}, "x"), "x");
  assert.equal(errorOf(null, "x"), "x");
});
