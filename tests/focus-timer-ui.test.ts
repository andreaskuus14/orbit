import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as focus from "../src/lib/focus-timer-pure.ts";
import { translate } from "../src/lib/i18n-pure.ts";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL("../src/components/LifePanel.tsx", import.meta.url), "utf8")
  + "\nexport { timer, Focus };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function browser(raw: string | null, now = 1_000_000) {
  const storage = new Map<string, string>();
  if (raw !== null) storage.set(focus.FOCUS_TIMER_KEY, raw);
  const logs: number[] = [], signals: boolean[] = [];
  const mounted: { tick: () => void; close: () => void }[] = [];
  function load() {
    const intervals = new Map<number, () => void>();
    const mod = { exports: {} as any };
    runInNewContext(code, {
      module: mod, exports: mod.exports, window: {},
      Date: class extends Date { static now() { return now; } },
      CustomEvent,
      dispatchEvent: (e: CustomEvent) => { if (e.type === "orbit:focus") signals.push(e.detail.on); },
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
      setInterval(fn: () => void) { const id = intervals.size + 1; intervals.set(id, fn); return id; },
      clearInterval(id: number) { intervals.delete(id); },
      fetch: async (_url: string, options: { body: string }) => {
        const body = JSON.parse(options.body);
        if (body.action === "timer") return { ok: true, json: async () => ({ ok: true }) }; // live relay for /screen
        // The durable break must exist before any focus logging request leaves the page.
        assert.equal(JSON.parse(storage.get(focus.FOCUS_TIMER_KEY)!).phase, "break");
        logs.push(body.minutes);
        return { ok: true, json: async () => ({ today: body.minutes }) };
      },
      require: (id: string) => {
        if (id === "react") return { useState: (v: unknown) => [v, () => {}], useRef: (current: unknown) => ({ current }), useEffect() {}, useCallback: (fn: unknown) => fn };
        if (id.endsWith("focus-timer-pure")) return focus;
        if (id.endsWith("life-pure")) return { ALL_DAYS: [] };
        if (id.endsWith("habit-nudge-pure")) return {};
        if (id === "./i18n") return { useT: () => ({ t: (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate("en", k, v) }) };
        if (id === "./voice/bus" || id === "./CalendarCard" || id === "./SchoolPanel") return {};
        return require(id);
      },
    });
    const tick = () => [...intervals.values()].forEach(fn => fn());
    const close = () => intervals.clear(); // unloading a page discards all its intervals
    mounted.push({ tick, close });
    function click(label: string) {
      const tree = mod.exports.Focus({ st: { focus: { today: 0, week: 0 } }, reload: async () => {} });
      const visit = (node: any): any => {
        if (Array.isArray(node)) return node.map(visit).find(Boolean);
        if (!node || typeof node !== "object") return null;
        if (node.type === "button" && node.props.children === label) return node;
        return visit(node.props?.children);
      };
      const button = visit(tree);
      assert.ok(button, label);
      button.props.onClick();
    }
    return { tick, close, click, timer: mod.exports.timer, intervals };
  }
  return { load, logs, signals, storage, advance: (ms: number) => { now += ms; }, close: () => mounted.forEach(m => m.close()) };
}

test("expired restore persists the break before logging and repeated reloads never log it twice", () => {
  const b = browser(JSON.stringify({ plan: 50, phase: "focus", endAt: 999_000, left: 3000 }));
  const first = b.load();
  assert.deepEqual(b.logs, [50]);
  assert.equal(first.timer.phase, "break");
  assert.equal(first.intervals.size, 1); // no Focus tab needed
  first.close();
  const second = b.load(); second.tick();
  assert.deepEqual(b.logs, [50]);
  b.advance(600_000); second.tick();
  assert.equal(second.timer.phase, "focus");
  assert.equal(second.timer.endAt, 0);
  assert.deepEqual(b.logs, [50]);
  second.close(); b.load();
  assert.deepEqual(b.logs, [50]);
  b.close();
});

test("start, pause, resume, live completion and reset survive reloads and preserve focus signals", () => {
  const b = browser(null);
  const first = b.load();
  first.click("Start");
  assert.equal(b.signals.at(-1), true);
  b.advance(20_000);
  first.click("Pause");
  assert.equal(b.signals.at(-1), false);
  first.close();
  const second = b.load();
  assert.equal(second.timer.endAt, 0);
  assert.equal(second.timer.left, 1480);
  second.click("Start");
  const deadline = second.timer.endAt;
  second.close();
  const third = b.load(); third.tick();
  assert.equal(third.timer.endAt, deadline);
  assert.equal(b.signals.at(-1), true);
  b.advance(1480_000); third.tick(); third.tick();
  assert.deepEqual(b.logs, [25]);
  assert.equal(b.signals.at(-1), false);
  third.click("Reset"); third.close();
  const fourth = b.load();
  assert.equal(fourth.timer.phase, "focus");
  assert.equal(fourth.timer.endAt, 0);
  assert.equal(fourth.timer.left, 1500);
  b.close();
});
