import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as nav from "../src/lib/nav-pure.ts";
import { endpointDelay, ENDPOINT_MS, pickBestAlternative, shouldBargeIn, turnWaitMs } from "../src/components/voice/hear.ts";
import { isAddressedToOrbit } from "../src/components/voice/conversation.ts";

const commands: [string, nav.NavTarget][] = [
  ["stop all", { panel: null, stopAll: true }], ["stop everything", { panel: null, stopAll: true }],
  ["peata kõik", { panel: null, stopAll: true }],
  ["mute", { panel: null, voice: false }], ["vaigista", { panel: null, voice: false }],
  ["unmute", { panel: null, voice: true }], ["lülita heli sisse", { panel: null, voice: true }],
  ["status report", { panel: null, morning: true }], ["olukord", { panel: null, morning: true }],
  ["show my work", { panel: null, continueWork: true }], ["continue my work", { panel: null, continueWork: true }],
  ["näita minu tööd", { panel: null, continueWork: true }], ["jätka minu tööd", { panel: null, continueWork: true }],
  ["back", { panel: null }], ["galaxy", { panel: null }], ["tagasi", { panel: null }], ["galaktika", { panel: null }],
];
for (const [text, want] of commands) test(`instant command: ${text}`, () => {
  for (const current of [undefined, null, "core", "studio", "intelligence"] as const) {
    const target = want.stopAll || want.voice !== undefined ? { ...want, panel: current ?? null } : want;
    assert.deepEqual(nav.parseNavCommand(text, { current }), target);
    assert.deepEqual(nav.parseNavCommand(`Hey Orbit, ${text.toUpperCase()} please!`, { current }), target);
  }
  assert.equal(isAddressedToOrbit(text), true, "recognized in a hands-free conversation");
  assert.equal(endpointDelay(text), ENDPOINT_MS);
  assert.equal(turnWaitMs(text, 600), 0);
  assert.match(nav.navReply(want), /\S/);
  assert.doesNotMatch(nav.navReply(want), /\n/);
});

for (const text of [
  "how do I stop procrastinating", "explain how to mute a video", "write a status report for my project",
  "show my work and help me plan tomorrow", "how far back does the galaxy extend",
  "kuidas peata nupp töötab", "selgita mida vaigista tähendab", "milline on olukord maailmas",
  "näita minu tööd ja koosta plaan", "kuidas ma tagasi kooli lähen",
]) test(`longer sentence stays with CORE: ${text}`, () => {
  for (const current of [undefined, null, "core", "studio", "intelligence"] as const)
    assert.equal(nav.parseNavCommand(text, { current }), null);
});

test("speech alternatives cannot invent Stop-all or a voice setting", () => {
  for (const text of ["stop everything", "peata kõik", "mute", "unmute", "vaigista"])
    assert.equal(pickBestAlternative(["a transcription fragment", text]), "a transcription fragment");
  assert.equal(pickBestAlternative(["how do I stop procrastinating", "stop"]), "how do I stop procrastinating");
});

test("English and Estonian Stop-all can interrupt speech, but never its echo or a longer question", () => {
  for (const text of ["stop", "stop everything", "peata", "peata kõik", "Orbit, peata"])
    assert.equal(shouldBargeIn(text, "Here is today's news."), "stop");
  assert.equal(shouldBargeIn("peata", "Peata kõik."), null);
  assert.equal(shouldBargeIn("how do I stop procrastinating", "Here is today's news."), null);
});

test("the model's navigate tool cannot invoke Stop-all or change voice settings", () => {
  for (const target of ["stop", "stop everything", "mute", "unmute", "vaigista", "peata"])
    assert.equal(nav.validateNav({ target }), null);
});

// Execute the real browser action module with isolated browser/network boundaries, using the existing compiler.
function actions(response: { ok: boolean; status?: number; body: object } = { ok: true, body: { stop: { on: true } } }) {
  const requests: { url: string; init: RequestInit }[] = [], events: Event[] = [];
  let settings = { speak: true, lang: "et-EE", rate: 1.05 };
  const module = { exports: {} as { runNavCommand(t: nav.NavTarget): Promise<string>; changeStopAll(on: boolean): Promise<string | undefined> } };
  const code = ts.transpileModule(readFileSync(new URL("../src/components/nav-command.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports: module.exports, module, Event, CustomEvent,
    require: (name: string) => {
      if (name.endsWith("nav-pure.ts")) return nav;
      if (name.endsWith("bus.ts")) return { loadVoiceSettings: () => settings, saveVoiceSettings: (s: typeof settings) => { settings = s; } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    dispatchEvent: (event: Event) => { events.push(event); },
    fetch: async (url: string, init: RequestInit) => { requests.push({ url, init }); return { ok: response.ok, status: response.status ?? 200, json: async () => response.body }; },
  });
  return { ...module.exports, requests, events, settings: () => settings };
}

test("Stop-all posts on=true to the existing endpoint, refreshes the HUD and never navigates or calls CORE", async () => {
  const a = actions();
  assert.equal(await a.runNavCommand(nav.parseNavCommand("stop everything")!), "Stop-all is on; background work is paused.");
  assert.equal(a.requests.length, 1);
  assert.equal(a.requests[0].url, "/api/stop-all");
  assert.equal(a.requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(a.requests[0].init.body as string), { on: true });
  assert.deepEqual(a.events.map((e) => e.type), ["orbit:stop-all-changed"]);
});

test("Stop-all failures and an unconfirmed response never produce a success confirmation", async () => {
  for (const response of [{ ok: false, status: 401, body: { error: "Sign in first" } }, { ok: true, body: { stop: { on: false } } }]) {
    const a = actions(response);
    await assert.rejects(a.runNavCommand(nav.parseNavCommand("peata kõik")!));
    assert.equal(a.events.length, 0);
  }
  assert.equal(await actions({ ok: true, body: { stop: { on: true }, warning: "Active now, but not saved to disk" } }).runNavCommand({ panel: null, stopAll: true }), "Active now, but not saved to disk");
});

test("mute and unmute set voice output idempotently, preserve other settings and make no requests", async () => {
  const a = actions();
  for (const text of ["mute", "vaigista", "mute"]) {
    assert.equal(await a.runNavCommand(nav.parseNavCommand(text)!), "Voice output muted.");
    assert.equal(a.settings().speak, false);
  }
  for (const text of ["unmute", "lülita heli sisse", "unmute"]) {
    assert.equal(await a.runNavCommand(nav.parseNavCommand(text)!), "Voice output on.");
    assert.equal(a.settings().speak, true);
  }
  assert.equal(a.settings().lang, "et-EE");
  assert.equal(a.settings().rate, 1.05);
  assert.equal(a.requests.length, 0);
  assert.equal(a.events.length, 0);
});

test("status, unfinished work and back dispatch the correct app actions without requesting an AI answer", async () => {
  for (const [text, target] of commands.filter(([, t]) => !t.stopAll && t.voice === undefined)) {
    const a = actions();
    assert.equal(await a.runNavCommand(nav.parseNavCommand(text)!), nav.navReply(target));
    assert.equal(a.requests.length, 0);
    assert.equal(a.events.length, 1);
    assert.equal(a.events[0].type, nav.NAV_EVENT);
    assert.deepEqual((a.events[0] as CustomEvent).detail, target);
  }
});

test("plain stop / peata only silence ORBIT: Stop-all needs the explicit phrase", () => {
  for (const text of ["stop", "peata", "Orbit, stop"]) assert.equal(nav.parseNavCommand(text)?.stopAll, undefined, text);
  for (const text of ["stop everything", "stop all", "peata kõik"]) assert.equal(nav.parseNavCommand(text)?.stopAll, true, text);
});
