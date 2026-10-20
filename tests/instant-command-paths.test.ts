import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as nav from "../src/lib/nav-pure.ts";
import * as planets from "../src/lib/planets.ts";
import * as hear from "../src/components/voice/hear.ts";
import * as wake from "../src/components/voice/wake.ts";
import * as conversation from "../src/components/voice/conversation.ts";

// Run the real component handlers with React hooks and I/O replaced. No browser, Supabase or Claude required.
const require = createRequire(import.meta.url);
const sources = new Map<string, string>();
type Element = { type: unknown; props: Record<string, any> };
function find(element: any, predicate: (e: Element) => boolean): Element | undefined {
  if (!element || typeof element !== "object") return;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = find(child, predicate);
    if (found) return found;
  }
}
function component(file: string, attachments = false) {
  let cursor = 0;
  let attachmentsTaken = 0;
  const state: any[] = [], effects: (() => void)[] = [], callbacks: Function[] = [], calls: nav.NavTarget[] = [], requests: string[] = [], events: Event[] = [];
  const listeners = new Map<string, Function>();
  const noop = () => {};
  const hooks = {
    useState(initial: any) {
      const i = cursor++;
      if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
      return [state[i], (next: any) => { state[i] = typeof next === "function" ? next(state[i]) : next; }];
    },
    useRef: (current: any) => ({ current }), useMemo: (f: Function) => f(),
    useCallback: (f: Function) => { callbacks.push(f); return f; }, useEffect: (f: () => void) => effects.push(f),
  };
  const speech = { stop: noop, speechSettings: () => ({ speak: false }), speechGen: () => 0, takeVoiceAsked: () => false };
  const bus = { VOICE_ASK: "orbit:voice-ask", voiceContext: {} };
  const voice = { listening: false, clearError: noop, stop: noop, supported: true };
  const module = { exports: {} as Record<string, Function> };
  if (!sources.has(file)) sources.set(file, ts.transpileModule(readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  runInNewContext(sources.get(file)!, { module, exports: module.exports, Event, CustomEvent, AbortController, console,
    process: { env: { NODE_ENV: "test" } }, cancelAnimationFrame: noop,
    addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: noop,
    dispatchEvent: (e: Event) => { events.push(e); listeners.get(e.type)?.(e); }, localStorage: { setItem: noop },
    fetch: async (url: string) => { requests.push(url); return { ok: false, status: 503, json: async () => ({ error: "Test response" }) }; },
    require: (name: string) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "next/dynamic") return { default: () => noop };
      if (name.includes("nav-pure")) return nav;
      if (name.includes("nav-command")) return { COMMAND_REPLY_EVENT: "orbit:command-reply", runNavCommand: async (t: nav.NavTarget) => { calls.push(t); return nav.navReply(t); } };
      if (name.includes("/planets")) return planets;
      if (name.endsWith("/speak")) return speech;
      if (name.endsWith("/bus")) return bus;
      if (name.endsWith("/useVoiceInput")) return { useVoiceInput: () => voice };
      if (name.endsWith("/CoreAttach")) return { useAttachments: () => ({ has: () => attachments, take: () => { attachmentsTaken++; return []; }, items: [] }) };
      if (name.endsWith("/CoreChats")) return { useCoreChats: () => ({ map: {}, chats: [], projects: [], reload: noop }) };
      if (name.endsWith("/speech-text")) return { sentenceStream: () => ({}) };
      if (name.endsWith("/wake")) return { isSleepCommand: () => false };
      return new Proxy({}, { get: () => noop });
    },
  });
  const render = () => { cursor = 0; effects.length = 0; callbacks.length = 0; return file === "panels.tsx"
    ? module.exports.CorePanel({ initial: null, onConsumed: noop, onOpenMemory: noop })
    : module.exports.default({ userId: "test-user", email: "test@example.com" }); };
  return { render, state, effects, callbacks, calls, requests, events, listeners, attachmentsTaken: () => attachmentsTaken };
}

const commands = ["stop everything", "stop all", "peata kõik", "mute", "unmute", "vaigista", "lülita heli sisse",
  "status report", "olukord", "show my work", "continue my work", "näita minu tööd", "jätka minu tööd", "back", "galaxy", "tagasi", "galaktika"];

test("CORE typed commands return before the Claude request; a longer question still reaches CORE", async () => {
  for (const text of [...commands, "how do I stop procrastinating"]) {
    const h = component("panels.tsx"); h.render();
    const send = h.callbacks.find((f) => f.toString().includes("const message = text.trim()"));
    assert.ok(send);
    await send(text);
    if (text.startsWith("how")) { assert.deepEqual(h.requests, ["/api/core?stream=1"]); assert.equal(h.calls.length, 0); }
    else {
      assert.equal(h.requests.length, 0, text); assert.deepEqual(h.calls, [nav.parseNavCommand(text, { current: "core" })]);
      const reply = h.events.find((e) => e.type === "orbit:command-reply") as CustomEvent;
      assert.equal(reply.detail, nav.navReply(h.calls[0]), "confirmation survives CORE closing");
    }
  }
});

test("CORE still accepts an instant command while an earlier answer is in progress", async () => {
  const h = component("panels.tsx"); h.render();
  const send = () => h.callbacks.find((f) => f.toString().includes("const message = text.trim()"))!;
  const answering = send()("explain my project"); // first fetch is waiting on its response
  h.render();
  await send()("peata kõik");
  await answering;
  assert.deepEqual(h.calls, [{ panel: "core", stopAll: true }]);
  assert.deepEqual(h.requests, ["/api/core?stream=1"]); // only the original question
});

test("queued attachments do not route a short command to Claude or get consumed by mute", async () => {
  const h = component("panels.tsx", true); h.render();
  await h.callbacks.find((f) => f.toString().includes("const message = text.trim()"))!("mute");
  assert.deepEqual(h.calls, [{ panel: "core", voice: false }]);
  assert.equal(h.requests.length, 0);
  assert.equal(h.attachmentsTaken(), 0);
});

test("the command bar runs commands directly in both Ask and Task modes", async () => {
  for (const task of [false, true]) for (const text of commands) {
    const h = component("Orbit.tsx");
    let tree = h.render();
    if (task) {
      find(tree, (e) => e.type === "button" && String(e.props["aria-label"]).startsWith("Mode:"))!.props.onClick();
      tree = h.render();
    }
    find(tree, (e) => e.type === "input" && String(e.props["aria-label"]).startsWith("Command bar:"))!.props.onChange({ target: { value: text } });
    tree = h.render();
    await find(tree, (e) => e.type === "form")!.props.onSubmit({ preventDefault() {} });
    assert.deepEqual(h.calls, [nav.parseNavCommand(text, { current: null })], text);
    assert.equal(h.requests.length, 0, "no CORE or agent task request");
    assert.ok(h.state.includes(nav.navReply(h.calls[0])), "visible confirmation");
  }
});

test("spoken commands run directly; longer spoken questions are handed to CORE", async () => {
  for (const text of [...commands, "how do I stop procrastinating"]) {
    const h = component("Orbit.tsx"); h.render();
    h.effects.find((f) => f.toString().includes("VOICE_ASK, onAsk"))!();
    await h.listeners.get("orbit:voice-ask")!(new CustomEvent("orbit:voice-ask", { detail: { text } }));
    assert.equal(h.requests.length, 0);
    if (text.startsWith("how")) { assert.equal(h.calls.length, 0); assert.ok(h.state.includes(text)); assert.ok(h.state.includes("core")); }
    else { assert.deepEqual(h.calls, [nav.parseNavCommand(text, { current: null })]); assert.ok(h.state.includes(nav.navReply(h.calls[0]))); }
  }
});

test("Chrome hands-free forwards Stop-all while ORBIT speaks instead of swallowing it as a speech-only stop", () => {
  const code = ts.transpileModule(readFileSync(new URL("../src/components/voice/useWakeWord.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const text of ["stop", "stop everything", "peata", "peata kõik", "Orbit, stop", "stop talking"]) {
    const effects: Function[] = [], events: Event[] = [];
    let speaking = true, rec: any;
    const noop = () => {};
    class Recognizer { constructor() { rec = this; } start() {} abort() {} }
    const module = { exports: {} as { useWakeWord: Function } };
    runInNewContext(code, { module, exports: module.exports, Event, CustomEvent, AbortController, setTimeout, clearTimeout,
      addEventListener: noop, removeEventListener: noop,
      dispatchEvent: (e: Event) => { events.push(e); if (e.type === "orbit:voice-interrupt") speaking = false; },
      require: (name: string) => {
        if (name === "react") return { useState: (v: unknown) => [v, noop], useRef: (current: unknown) => ({ current }), useEffect: (f: Function) => effects.push(f) };
        if (name.endsWith("/nav-pure")) return nav;
        if (name === "./hear") return hear;
        if (name === "./wake") return wake;
        if (name === "./conversation") return conversation;
        if (name === "./bus") return { recognizerFor: () => "chrome", whisperLang: () => "et", voiceContext: {}, VOICE_ASK: "orbit:voice-ask", VOICE_INTERRUPT: "orbit:voice-interrupt" };
        if (name === "./speak") return { isSpeaking: () => speaking, spokenText: () => "Here is today's news." };
        if (name === "./useVoiceInput") return { getSpeechRecognition: () => Recognizer, alternatives: (r: any) => [r[0].transcript] };
        return {};
      },
    });
    module.exports.useWakeWord("chrome", false, "et-EE");
    const cleanup = effects.find((f) => f.toString().includes("const engine ="))!();
    try {
      rec.onresult({ resultIndex: 0, results: [{ isFinal: true, length: 1, 0: { transcript: text } }] });
      const asked = events.filter((e) => e.type === "orbit:voice-ask");
      assert.equal(asked.length, /everything|kõik/.test(text) ? 1 : 0, text); // plain "stop" only silences
      if (asked.length) assert.equal((asked[0] as CustomEvent).detail.text, text);
      assert.ok(events.some((e) => e.type === "orbit:voice-interrupt"), text);
    } finally { cleanup(); }
  }
});

test("ORBIT mic forwards Stop-all with and without voice barge-in enabled", async () => {
  const code = ts.transpileModule(readFileSync(new URL("../src/components/voice/useWakeWord.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const barged of [false, true]) for (const text of ["stop everything", "peata kõik", "stop talking"]) {
    const effects: Function[] = [], events: Event[] = [];
    let mic: any, speaking = true;
    const noop = () => {};
    const module = { exports: {} as { useWakeWord: Function } };
    runInNewContext(code, { module, exports: module.exports, Event, CustomEvent, AbortController, setTimeout, clearTimeout,
      addEventListener: noop, removeEventListener: noop,
      dispatchEvent: (e: Event) => { events.push(e); if (e.type === "orbit:voice-interrupt") speaking = false; },
      require: (name: string) => {
        if (name === "react") return { useState: (v: unknown) => [v, noop], useRef: (current: unknown) => ({ current }), useEffect: (f: Function) => effects.push(f) };
        if (name.endsWith("/nav-pure")) return nav;
        if (name === "./hear") return hear;
        if (name === "./wake") return wake;
        if (name === "./conversation") return conversation;
        if (name === "./bus") return { recognizerFor: () => "whisper", whisperLang: () => "et", voiceContext: {}, VOICE_ASK: "orbit:voice-ask", VOICE_INTERRUPT: "orbit:voice-interrupt" };
        if (name === "./speak") return { isSpeaking: () => speaking, spokenText: () => "Here is today's news." };
        if (name === "./orbitmic") return { startOrbitMic: async (options: any) => { mic = options; return { stop: noop }; } };
        if (name === "./whisper") return { transcribeAudio: async () => text };
        return {};
      },
    });
    module.exports.useWakeWord("orbit", false, "et-EE");
    const cleanup = effects.find((f) => f.toString().includes("const engine ="))!();
    try {
      await Promise.resolve(); // microphone setup
      mic.onSegment({}, { overOrbit: true, barged });
      await new Promise((resolve) => setImmediate(resolve)); // ordered transcription chain
      const asked = events.filter((e) => e.type === "orbit:voice-ask");
      assert.equal(asked.length, text === "stop talking" ? 0 : 1, `${text}, barged=${barged}`);
      if (asked.length) assert.equal((asked[0] as CustomEvent).detail.text, text);
    } finally { cleanup(); }
  }
});
