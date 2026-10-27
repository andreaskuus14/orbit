import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { TOUR_KEY } from "../src/lib/tour-key-pure.ts";
import * as tour from "../src/lib/tour-pure.ts";

// The always-mounted boot gates (docs/PERF.md): the real components with a tiny hook runtime and require-stubs.
const require = createRequire(import.meta.url);
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(`../src/components/${path}`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function run(path: string, stubs: (name: string) => any, globals: Record<string, any> = {}) {
  let cursor = 0;
  const hooks: any[] = [], effects: (() => void)[] = [], bus = new EventTarget();
  const react = {
    useState(initial: any) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], (n: any) => { hooks[i] = typeof n === "function" ? n(hooks[i]) : n; }]; },
    useRef(initial: any) { const i = cursor++; return (hooks[i] ??= { current: initial }); },
    useId: () => "id",
    useEffect(f: () => any, deps?: any[]) { const i = cursor++, old = hooks[i]; if (!old || !deps || deps.some((x, n) => x !== old.deps[n])) effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: f() }; }); },
  };
  const m = { exports: {} as any };
  runInNewContext(compile(path), { module: m, exports: m.exports, console, Event, CustomEvent, Date, ...globals,
    addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus), dispatchEvent: bus.dispatchEvent.bind(bus),
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return require(name);
      // next/dynamic: a marker component that remembers which file it would load
      if (name === "next/dynamic") return { default: (load: Function) => Object.assign(() => null, { file: String(load) }) };
      return stubs(name) ?? new Proxy({}, { get: () => () => null });
    } });
  const render = (fn: Function, props: any) => { for (let k = 0; k < 4; k++) { cursor = 0; effects.length = 0; const out = fn(props); if (!effects.length) return out; effects.splice(0).forEach((e) => e()); } cursor = 0; return fn(props); };
  const unmount = () => hooks.forEach((h) => h?.cleanup?.());
  return { exports: m.exports, render, unmount, bus };
}
const find = (el: any, file: string): any => {
  if (!el || typeof el !== "object") return;
  if (el.type?.file?.includes(file)) return el;
  for (const c of [el.props?.children].flat(Infinity)) { const f = find(c, file); if (f) return f; }
};
const storage = (data: Record<string, string>) => ({ getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } });

test("VoiceControls loads the wake-word listener only once hands-free is on, and passes its settings", () => {
  for (const handsFree of ["off", "chrome", "orbit"]) {
    const settings = { handsFree, lang: "et-EE", speak: false, rate: 1, conversation: "stay", engine: "chrome", voiceURI: null, bargeByVoice: false };
    const c = run("voice/VoiceControls.tsx", (n) => n.endsWith("/bus") ? { DEFAULT_VOICE: { ...settings, handsFree: "off" }, loadVoiceSettings: () => settings, recognizerFor: () => null, voiceLevel: { mic: 0, speak: 0 }, whisperLang: () => "et", saveVoiceSettings() {} } : undefined,
      { navigator: { language: "en" }, window: {} });
    const out = c.render(c.exports.VoiceControls, { voice: { listening: false, supported: true, toggle() {}, cancel() {} } });
    const wake = find(out, "WakeWord");
    if (handsFree === "off") assert.equal(wake, undefined);
    else assert.deepEqual([wake.props.mode, wake.props.paused, wake.props.lang], [handsFree, false, "et-EE"]);
  }
});

test("WakeWord reports the hook's state and resets to off when unmounted", () => {
  const seen: any[] = [], w = { state: "listening", error: "", interim: "", conversation: "idle", note: "" };
  const c = run("voice/WakeWord.tsx", (n) => n.endsWith("/useWakeWord") ? { useWakeWord: (...a: any[]) => { seen.push(a); return w; } } : undefined);
  const got: any[] = [];
  c.render(c.exports.default, { mode: "chrome", paused: true, lang: "en-US", onChange: (x: any) => got.push(x) });
  assert.deepEqual(seen[0], ["chrome", true, "en-US"]);
  assert.equal(got.at(-1), w);
  c.unmount();
  assert.equal(got.at(-1), null);
});

test("WhatsNew gate: body only when the tour is unseen (same rule as parseProgress) or reopened", () => {
  const gate = (stored: Record<string, string>) => {
    const c = run("WhatsNew.tsx", (n) => n.endsWith("tour-key-pure") ? { TOUR_KEY, TOUR_EVENT: tour.TOUR_EVENT } : undefined, { localStorage: storage(stored) });
    return { c, out: () => c.render(c.exports.WhatsNew, { home: true }) };
  };
  for (const raw of [undefined, "", "garbage", "5", "null"]) {
    assert.equal(tour.shouldAutoOpen(tour.parseProgress(raw ?? null)), true);
    const { out } = gate(raw === undefined ? {} : { [TOUR_KEY]: raw });
    assert.equal(find(out(), "WhatsNewBody").props.reopen, false, String(raw));
  }
  const seen = gate({ [TOUR_KEY]: JSON.stringify({ at: "x", seen: [], closed: true, done: true }) });
  assert.equal(seen.out(), null);
  seen.c.bus.dispatchEvent(new Event(tour.TOUR_EVENT));
  assert.equal(find(seen.out(), "WhatsNewBody").props.reopen, true);
});

test("MorningBrief gate: mounts the body when the brief is due, keyed by day, and unmounts on close", () => {
  const data: Record<string, string> = {};
  const c = run("MorningBrief.tsx", (n) => n.endsWith("brief-pure") ? { shouldShowBrief: (last: string | null, _h: number, today: string) => last !== today } : n.endsWith("morning-pure") ? { localDay: () => "2026-10-27" } : undefined,
    { localStorage: storage(data), document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
  const body = c.render(c.exports.MorningBrief, { home: true, onOpenTask() {}, onOpenGoal() {} });
  assert.ok(body.type.file.includes("MorningBriefBody"));
  assert.equal(body.key, "2026-10-27");
  assert.equal(data["orbit.brief"], "2026-10-27");
  body.props.onClose();
  assert.equal(c.render(c.exports.MorningBrief, { home: true, onOpenTask() {}, onOpenGoal() {} }), null);
});
