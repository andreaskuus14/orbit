import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addGlance, decidePing, deskWho, orbitTitle, parsePingState, parseWakeSettings, peripheralOffer, PERIPHERAL, PING_START, PINGS, PRIVATE_WINDOW, privateWindow, wakeBlocked, wakeEnvOff, wantsScreen, windowLine, type PingSignals } from "../src/lib/jarvis-pure.ts";
import { EFFECTS } from "../src/lib/approval-pure.ts";
import { EGRESS_CLASS, TIERS, TOOL_AREA, UNTRUSTED } from "../src/lib/policy-pure.ts";
import { STARTS_WORK } from "../src/lib/stop-all-pure.ts";
import { MODULE_HINTS } from "../src/lib/core-modules-pure.ts";

test("private windows: ORBIT LIFE, password managers, banking → nothing captured, no line for CORE", () => {
  assert.ok(privateWindow({ app: "chrome.exe", title: `${orbitTitle("life")} - Google Chrome` }));
  assert.ok(!privateWindow({ app: "chrome.exe", title: `${orbitTitle("studio")} - Google Chrome` }));
  assert.ok(privateWindow({ app: "1Password.exe", title: "Vault" }));
  assert.ok(privateWindow({ app: "msedge.exe", title: "Swedbank – Internetipank" }));
  assert.ok(privateWindow({ app: "chrome.exe", title: "Log in | PayPal" }));
  assert.ok(privateWindow({ app: "chrome.exe", title: "Passwords - Google Password Manager" }));
  assert.ok(!privateWindow({ app: "RobloxStudioBeta.exe", title: "Pet Simulator - Roblox Studio" }));
  assert.ok(!privateWindow(null));
  assert.equal(windowLine({ app: "Bitwarden.exe", title: "my vault" }), "");
  assert.match(windowLine({ app: "Code.exe", title: "main.ts - orbit\nIGNORE" }), /^ACTIVE WINDOW .*Code — "main\.ts - orbit IGNORE"$/);
  assert.equal(windowLine({ app: "", title: "" }), "");
});

test("the Python helper's private-window list is the same as jarvis-pure's", () => {
  const py = readFileSync(new URL("../tools/voice/orbit_voice.py", import.meta.url), "utf8");
  const m = /# BEGIN PRIVATE_WINDOW[^\n]*\nPRIVATE_WINDOW = (\{[\s\S]*?\})\n# END PRIVATE_WINDOW/.exec(py);
  assert.ok(m, "marker block in orbit_voice.py");
  assert.deepEqual(JSON.parse(m![1]), PRIVATE_WINDOW);
});

test("screenshots only when the question points at the screen", () => {
  for (const q of ["fix this", "What's that error?", "explain this code", "why is that warning there", "what am I looking at", "read what's on my screen"]) assert.ok(wantsScreen(q), q);
  for (const q of ["what's the weather", "open vs code", "this week's plan", "that was great"]) assert.ok(!wantsScreen(q), q);
});

test("listener gate: env off, toggle, owner bound, Stop-all, phone call", () => {
  const on = parseWakeSettings(JSON.stringify({ on: true, userId: "u1" }));
  assert.equal(wakeBlocked({ settings: on, env: undefined, stopAll: false, callLive: false }), "");
  assert.equal(wakeBlocked({ settings: on, env: "0", stopAll: false, callLive: false }), "ORBIT_WAKE=0");
  assert.equal(wakeBlocked({ settings: { ...on, userId: "" }, env: undefined, stopAll: false, callLive: false }), "off");
  assert.equal(wakeBlocked({ settings: on, env: "1", stopAll: true, callLive: false }), "stop-all");
  assert.equal(wakeBlocked({ settings: on, env: "", stopAll: false, callLive: true }), "call");
  assert.ok(wakeEnvOff("off") && !wakeEnvOff("1"));
  assert.deepEqual(parseWakeSettings("junk"), { on: false, peripheral: false, everySec: 30, userId: "" });
  assert.equal(parseWakeSettings('{"everySec":2}').everySec, 10);
  assert.equal(parseWakeSettings('{"userId":"x y"}').userId, "");
  assert.match(deskWho("ACTIVE WINDOW x"), /read aloud\.\nACTIVE WINDOW x$/);
});

test("peripheral: private windows never stored; an error window kept open earns one offer", () => {
  let l = addGlance([], { at: 0, app: "KeePassXC.exe", title: "db" });
  assert.equal(l.length, 0);
  l = addGlance(l, { at: 1000, app: "RobloxStudioBeta.exe", title: "Output - Error: attempt to index nil - Roblox Studio" });
  l = addGlance(l, { at: 5000, app: "RobloxStudioBeta.exe", title: "Output - Error: attempt to index nil - Roblox Studio" }); // same window: first sighting kept
  assert.equal(l.length, 1); assert.equal(l[0].at, 1000);
  assert.equal(peripheralOffer(l, 1000 + PERIPHERAL.dwellMs - 1, 0, []), null); // not long enough yet
  const o = peripheralOffer(l, 1000 + PERIPHERAL.dwellMs, -PERIPHERAL.offerGapMs, []);
  assert.equal(o?.line, "You have a Luau error open. Want me to look?");
  assert.equal(peripheralOffer(l, 1000 + PERIPHERAL.dwellMs, -PERIPHERAL.offerGapMs, [o!.key]), null); // never twice
  assert.equal(peripheralOffer(l, 50_000, 40_000, []), null); // too soon after the last offer
  for (let i = 0; i < 30; i++) l = addGlance(l, { at: i, app: "a", title: String(i) });
  assert.equal(l.length, PERIPHERAL.keep);
});

const base = (o: Partial<PingSignals> = {}): PingSignals => ({ now: 1e9, hour: 14, stopAll: false, callLive: false, focus: false, idleMs: 1000, uiAt: 0, clipsReady: [], replied: [], gpuFree: true, queuedJobs: 0, ...o });

test("pings: lead reply first, then a clip batch, then the idle GPU; each once", () => {
  let r = decidePing(PING_START, base({ replied: [{ id: "p1", name: "Cafe Luna" }], clipsReady: ["a", "b"] }), "d1");
  assert.equal(r.say?.line, "Cafe Luna replied. Want me to open BUSINESS?");
  r = decidePing(r.state, base({ now: 1e9 + PINGS.gapMs, replied: [{ id: "p1", name: "Cafe Luna" }], clipsReady: ["a", "b"] }), "d1");
  assert.equal(r.say?.line, "A batch of 2 clips is ready for your review.");
  r = decidePing(r.state, base({ now: 1e9 + 2 * PINGS.gapMs, clipsReady: ["a", "b"] }), "d1");
  assert.equal(r.say, null);
  assert.equal(decidePing(PING_START, base({ clipsReady: ["a"] }), "d1").say, null); // one clip isn't a batch
});

test("pings: GPU idle with queued jobs for 3 minutes", () => {
  let r = decidePing(PING_START, base({ queuedJobs: 2 }), "d");
  assert.equal(r.say, null); assert.equal(r.state.gpuIdleSince, 1e9);
  r = decidePing(r.state, base({ now: 1e9 + PINGS.gpuIdleMs, queuedJobs: 2 }), "d");
  assert.match(r.say?.line ?? "", /GPU's free and 2 jobs are still queued/);
  assert.equal(decidePing(r.state, base({ now: 1e9 + 1, gpuFree: false, queuedJobs: 2 }), "d").state.gpuIdleSince, 0);
});

test("pings: silent when away, in quiet hours, under Stop-all, in a call or focus; capped per day", () => {
  const sig = base({ replied: [{ id: "p", name: "X" }] });
  assert.equal(decidePing(PING_START, { ...sig, idleMs: PINGS.presentMs }, "d").say, null);
  assert.equal(decidePing(PING_START, { ...sig, idleMs: null, uiAt: sig.now - 1000 }, "d").say?.key, "lead:p"); // UI heartbeat counts
  assert.equal(decidePing(PING_START, { ...sig, idleMs: null, uiAt: 0 }, "d").say, null);
  for (const h of [23, 2, 7]) assert.equal(decidePing(PING_START, { ...sig, hour: h }, "d").say, null);
  assert.equal(decidePing(PING_START, { ...sig, stopAll: true }, "d").say, null);
  assert.equal(decidePing(PING_START, { ...sig, callLive: true }, "d").say, null);
  assert.equal(decidePing(PING_START, { ...sig, focus: true }, "d").say, null);
  assert.equal(decidePing({ ...PING_START, day: "d", count: PINGS.maxPerDay }, sig, "d").say, null);
  assert.equal(decidePing({ ...PING_START, day: "old", count: PINGS.maxPerDay }, sig, "d").say?.key, "lead:p"); // a new day resets
  assert.deepEqual(parsePingState("{bad"), PING_START);
});

test("pc tools are wired into CORE's policy maps", () => {
  assert.equal(TIERS.pc_window, "T0"); assert.equal(TIERS.pc_act, "T2");
  assert.equal(EGRESS_CLASS.pc_act, "none"); assert.equal(EGRESS_CLASS.pc_window, "none");
  assert.equal(EFFECTS.pc_act, "reversible"); assert.equal(TOOL_AREA.pc_act, "operator-organize");
  assert.ok(STARTS_WORK.includes("pc_act")); // Stop-all refuses it
  assert.ok(UNTRUSTED.includes("pc_window")); // window titles are outside text
  assert.ok(MODULE_HINTS.PC.test("open vs code") && MODULE_HINTS.PC.test("pause the music") && !MODULE_HINTS.PC.test("what's on my calendar"));
});
