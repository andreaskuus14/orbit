import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as i18n from "../src/lib/i18n-pure.ts";
import * as stop from "../src/lib/stop-all-pure.ts";

const require = createRequire(import.meta.url);

test("StopAll alone polls; HalEye receives initial, replayed, toggled and polled state and cleans up", async () => {
  const bus = new EventTarget(), timers = new Map<number, () => void>();
  const events: boolean[] = [], requests: string[] = [];
  let serverOn = false, failGet = false;
  bus.addEventListener(stop.STOP_ALL_EVENT, e => events.push((e as CustomEvent<stop.StopAllDetail>).detail.on));

  function mount(name: string) {
    const states: unknown[] = [], effects: (() => void | (() => void))[] = [], cleanups: (() => void)[] = [];
    const react = {
      useState(initial: unknown) { const i = states.length; states.push(initial); return [initial, (value: unknown) => { states[i] = value; }]; },
      useRef(current: unknown) { return { current }; },
      useCallback(fn: unknown) { return fn; },
      useEffect(fn: () => void | (() => void)) { effects.push(fn); },
    };
    const mod = { exports: {} as Record<string, () => any> };
    const source = ts.transpileModule(readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(source, {
      module: mod, exports: mod.exports,
      require: (id: string) => {
        if (id === "react") return react;
        if (id.endsWith("stop-all-pure")) return stop;
        if (id.endsWith("notify-pure")) return { notify() {} };
        if (id.endsWith("interruption-pure")) return { RESOLVE_ALERT: "resolve" };
        if (id === "./nav-command") return { STOP_ALL_CHANGED: "changed", async changeStopAll(on: boolean) { serverOn = on; bus.dispatchEvent(new Event("changed")); } };
        if (id === "./i18n") return { useT: () => ({ lang: "en", t: (k: any, v?: any) => i18n.translate("en", k, v) }) };
        if (id === "./voice/bus") return { loadVoiceSettings: () => ({ speak: true }) };
        return require(id);
      },
      Event, CustomEvent, Date,
      addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus), dispatchEvent: bus.dispatchEvent.bind(bus),
      setInterval(fn: () => void, ms: number) { assert.equal(ms, 30_000); const id = timers.size + 1; timers.set(id, fn); return id; },
      clearInterval(id: number) { timers.delete(id); },
      confirm: () => true,
      fetch: async (url: string) => { requests.push(url); if (failGet) throw new Error("offline"); return { ok: true, json: async () => ({ stop: { on: serverOn, at: "now" }, hold: "", limit: null }) }; },
    });
    const tree = mod.exports[name]();
    for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    return { states, tree, close: () => cleanups.forEach(fn => fn()) };
  }
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  const hud = mount("StopAll");
  await settle();
  assert.deepEqual(events, [false]);
  const eye = mount("HalEye"); // mount after the first poll: must get the cached state immediately
  assert.equal(eye.states[1], false);
  assert.equal(requests.length, 1);
  assert.equal(timers.size, 1);

  failGet = true;
  // A successful toggle must broadcast even when its subsequent GET fails.
  await hud.tree.props.children[0].props.onClick();
  await settle();
  assert.equal(eye.states[1], true);
  assert.equal(events.at(-1), true);
  failGet = false; serverOn = false;
  for (const tick of timers.values()) tick();
  await settle();
  assert.equal(eye.states[1], false);
  eye.close();
  serverOn = true;
  for (const tick of timers.values()) tick();
  await settle();
  assert.equal(eye.states[1], false);
  hud.close();
  assert.equal(timers.size, 0);
  const count = events.length;
  bus.dispatchEvent(new Event(stop.STOP_ALL_REQUEST_EVENT));
  assert.equal(events.length, count);
});
