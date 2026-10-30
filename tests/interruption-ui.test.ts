import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as rules from "../src/lib/interruption-pure.ts";
import * as notices from "../src/lib/notify-pure.ts";
import * as herald from "../src/lib/herald-pure.ts";
import * as inbox from "../src/lib/herald-watch-pure.ts";

const require = createRequire(import.meta.url), T = 2_000_000_000_000;
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const clone = (x: any) => JSON.parse(JSON.stringify(x));

// Execute the real components with deterministic hooks/event targets, not duplicated UI decision logic.
function ui(component = "Herald", options: { voice?: boolean; hidden?: boolean; storageBroken?: boolean } = {}) {
  let now = T, cursor = 0, dirty = false, tree: any;
  const hooks: any[] = [], effects: (() => void)[] = [], timers = new Map<number, () => void>(), storage = new Map<string, string>();
  let timerId = 0;
  const bus = new EventTarget(), doc = new EventTarget() as EventTarget & { visibilityState: string; hasFocus: () => boolean };
  doc.visibilityState = options.hidden ? "hidden" : "visible"; doc.hasFocus = () => true;
  const voice: string[] = [], desktop: any[] = [], nav: any[] = [], bell: notices.NotifyItem[] = [];
  bus.addEventListener("orbit:navigate", (e) => nav.push((e as CustomEvent).detail));
  bus.addEventListener(notices.NOTIFY_EVENT, (e) => { const next = notices.addItem(bell, (e as CustomEvent).detail, now); bell.splice(0, bell.length, ...next); });
  const localStorage = {
    getItem(k: string) { if (options.storageBroken) throw new Error("blocked"); return storage.get(k) ?? null; },
    setItem(k: string, v: string) { if (options.storageBroken) throw new Error("quota"); storage.set(k, v); },
  };
  const fakeDate = class extends Date { static now() { return now; } };
  const context: any = { Date: fakeDate, console, CustomEvent, Event, localStorage,
    dispatchEvent: bus.dispatchEvent.bind(bus), addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus),
    document: doc, sessionStorage: localStorage, fetch: async () => ({ ok: false, json: async () => null }),
    setInterval: (f: () => void) => { timers.set(++timerId, f); return timerId; }, clearInterval: (id: number) => timers.delete(id),
    setTimeout: () => ++timerId, clearTimeout() {},
    Notification: class { static permission = "granted"; onclick: any; constructor(title: string, opts: any) { desktop.push({ title, ...opts }); } close() {} },
    window: { focus() {}, open() {}, location: { assign(href: string) { nav.push(href); } } },
  };
  const hooksReact = {
    useState(initial: any) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], (next: any) => { const v = typeof next === "function" ? next(hooks[i]) : next; if (v !== hooks[i]) { hooks[i] = v; dirty = true; } }]; },
    useRef(initial: any) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useCallback(f: any, deps: any[]) { const i = cursor++; if (!hooks[i] || deps.some((x, n) => x !== hooks[i].deps[n])) hooks[i] = { f, deps }; return hooks[i].f; },
    useEffect(f: () => any, deps?: any[]) { const i = cursor++, old = hooks[i]; if (!old || !deps || deps.some((x, n) => x !== old.deps[n])) { effects.push(() => { old?.cleanup?.(); const cleanup = f(); hooks[i] = { deps, cleanup }; }); } },
  };
  function module(path: string, imports: (name: string) => any): any {
    const m = { exports: {} }; runInNewContext(compile(path), { ...context, module: m, exports: m.exports, require: imports }); return m.exports;
  }
  const store = module("components/interruption-store.ts", () => rules);
  const notifyModule = { ...notices, notify: (d: notices.NotifyDetail) => bus.dispatchEvent(new CustomEvent(notices.NOTIFY_EVENT, { detail: d })) };
  const componentModule = module(`components/${component}.tsx`, (name) => {
    if (name === "react") return hooksReact;
    if (name.endsWith("interruption-pure")) return rules;
    if (name.endsWith("notify-pure")) return notifyModule;
    if (name.endsWith("herald-pure")) return herald;
    if (name.endsWith("herald-watch-pure")) return inbox;
    if (name.endsWith("interruption-store")) return store;
    if (name.endsWith("/Herald")) return { HeraldToggle: () => null };
    if (name.endsWith("/AlertWatch")) return { AlertWatch: () => null };
    if (name.endsWith("/sfx")) return { sfx: { chime: () => {}, tick: () => {}, open: () => {}, close: () => {}, whoosh: () => {} } };
    if (name.endsWith("nav-pure")) return { NAV_EVENT: "orbit:navigate" };
    if (name.endsWith("focus-timer-pure")) return { FOCUS_TIMER_KEY: "orbit.focus-timer.v1" };
    if (name.endsWith("/i18n")) return { useT: () => ({ t: (k: string, v?: { n?: number }) => `${k}${v?.n ?? ""}`, lang: "en" }) };
    if (name.endsWith("voice/speak")) return { speechSettings: () => ({ speak: !!options.voice }), speakingOrJustEnded: () => false, speakChunk: (s: string) => voice.push(s) };
    return require(name);
  });
  let props = { home: true, coreBusy: false };
  function flush() { let n = 0; do { dirty = false; cursor = 0; tree = componentModule[component](props); while (effects.length) effects.shift()!(); } while (dirty && ++n < 20); assert.ok(n < 20, "effects settle"); }
  const nodes = (type: string) => { const found: any[] = []; const visit = (node: any) => { if (Array.isArray(node)) { node.forEach(visit); return; } if (!node || typeof node !== "object") return; if (node.type === type) found.push(node); visit(node.props?.children); }; visit(tree); return found; };
  flush();
  return { store, storage, voice, desktop, bell, nav, nodes, flush,
    emit(d: notices.NotifyDetail) { notifyModule.notify(d); flush(); },
    tick(ms: number) { now += ms; for (const f of [...timers.values()]) f(); flush(); },
    setProps(next: Partial<typeof props>) { props = { ...props, ...next }; flush(); },
    event(name: string, detail: any) { bus.dispatchEvent(new CustomEvent(name, { detail })); flush(); },
    close() { for (const h of hooks) h?.cleanup?.(); },
  };
}
const d = (signal: rules.Signal, key: string): notices.NotifyDetail => ({ title: `Update ${key}`, key, signal, kind: "system", reason: `Measured reason ${key}`, nav: { panel: "studio" } });

test("real Herald waits for idle, renders why, and batches the next useful item into the bell", () => {
  const h = ui(); h.emit(d("briefing", "one")); assert.equal(h.nodes("article").length, 0);
  h.tick(rules.IDLE_MS); assert.equal(h.nodes("article").length, 1);
  assert.equal(h.nodes("p").find((p) => p.props["aria-label"] === "Why this appeared").props.children, "Measured reason one");
  h.emit(d("agent-finished", "two")); assert.equal(h.nodes("article").length, 1); assert.equal(h.bell.length, 2); h.close();
});
test("real Herald blocks world/core work and immediately shows urgent without speaking while voice is off", () => {
  const h = ui(); h.setProps({ home: false, coreBusy: true }); h.emit(d("briefing", "brief")); h.tick(30_000);
  assert.equal(h.nodes("article").length, 0); h.emit(d("disk-full", "disk")); assert.equal(h.nodes("article").length, 1);
  assert.deepEqual(h.voice, []); assert.deepEqual(h.desktop, []); h.close();
});
test("real dismiss controls quiet a kind twice; subsequent notices remain in the bell", () => {
  const h = ui();
  for (const key of ["one", "two"]) { h.emit(d("disk-full", key)); const close = h.nodes("button").find((b) => b.props["aria-label"] === `Dismiss: Update ${key}`); assert.ok(close); close.props.onClick(); h.flush(); }
  assert.deepEqual(clone(h.store.loadJudgment().muted), ["disk-full"]);
  h.emit(d("disk-full", "three")); assert.equal(h.nodes("article").length, 0); assert.equal(h.bell.length, 3); h.close();
});
test("blocked localStorage still retains per-kind mute state for the session", () => {
  const h = ui("Herald", { storageBroken: true }); let s = h.store.loadJudgment();
  s = rules.dismissKind(rules.dismissKind(s, "briefing", T), "briefing", T + 1); h.store.saveJudgment(s);
  assert.deepEqual(clone(h.store.loadJudgment().muted), ["briefing"]);
  h.emit(d("briefing", "quiet")); h.tick(30_000); assert.equal(h.nodes("article").length, 0); assert.equal(h.bell.length, 1); h.close();
});
test("hidden urgent desktop alert is silent; visible voice-on urgent speaks only once", () => {
  const hidden = ui("Herald", { hidden: true, voice: true }); hidden.emit(d("youtube-expired", "yt"));
  assert.equal(hidden.desktop.length, 1); assert.equal(hidden.desktop[0].silent, true); assert.equal(hidden.voice.length, 0); hidden.close();
  const front = ui("Herald", { voice: true }); front.emit(d("disk-full", "disk")); front.emit(d("disk-full", "disk"));
  assert.deepEqual(front.voice, ["Measured reason disk"]); front.close();
});
test("resolved problems disappear from Herald; quiet scout actions remain available", () => {
  const h = ui(); h.emit(d("disk-full", "disk")); h.event(rules.RESOLVE_ALERT, "disk-full"); assert.equal(h.nodes("article").length, 0);
  h.emit({ ...d("scout", "scout"), herald: { key: "scout", kind: "trend", title: "Scout", actions: [{ label: "Open radar", nav: { panel: "creation" } }] } });
  assert.equal(h.nodes("article").length, 0); assert.equal(h.bell[0].herald?.actions[0].label, "Open radar");
  h.event("orbit:herald-action", { card: h.bell[0].herald, action: h.bell[0].herald!.actions[0] });
  assert.deepEqual(clone(h.nav.at(-1)), { panel: "creation" }); h.close();
});
test("real bell keeps quiet items, shows the red fix chip, and clears it only on resolution", () => {
  const h = ui("NotificationCenter"); h.emit(d("scout", "scout")); h.emit(d("disk-full", "disk"));
  assert.ok(h.nodes("button").some((b) => b.props["aria-label"] === "Unread: Update scout"));
  const red = h.nodes("button").find((b) => String(b.props["aria-label"]).startsWith("Red alert:")); assert.ok(red); red.props.onClick();
  assert.deepEqual(clone(h.nav.at(-1)), { panel: "studio" });
  h.nodes("button").find((b) => b.props.children === "Clear history").props.onClick(); h.flush();
  assert.ok(h.nodes("button").some((b) => String(b.props["aria-label"]).startsWith("Red alert:")));
  h.event(rules.RESOLVE_ALERT, "disk-full"); assert.equal(h.nodes("button").some((b) => String(b.props["aria-label"]).startsWith("Red alert:")), false); h.close();
});
test("real bell Unmute clears that kind's dismissal count", () => {
  const h = ui("NotificationCenter"); h.store.saveJudgment(rules.dismissKind(rules.dismissKind(rules.emptyJudgment(), "briefing", T), "briefing", T)); h.flush();
  const unmute = h.nodes("button").find((b) => Array.isArray(b.props.children) && b.props.children[0] === "Unmute "); assert.ok(unmute); unmute.props.onClick(); h.flush();
  assert.deepEqual(clone(h.store.loadJudgment().muted), []); assert.deepEqual(clone(h.store.loadJudgment().dismissals.briefing), []); h.close();
});

test("bell batch count excludes the update already shown as a popup", () => {
  const h = ui("NotificationCenter"); h.emit(d("briefing", "one")); h.emit(d("agent-finished", "two")); h.emit(d("scout", "three")); h.emit(d("scout", "four"));
  h.event(rules.POPUP_SHOWN, ["one"]);
  const summary = h.nodes("p").find((p) => p.props["aria-live"] === "polite");
  assert.equal(summary.props.children[0], 3); h.close();
});

test("blocked storage keeps the insight baseline in memory and every new insight reaches the shared bus", async () => {
  const m = { exports: {} as any }, got: notices.NotifyDetail[] = [];
  let items: any[] = [{ key: "old", kind: "hot", priority: "high", title: "Old Short", detail: "100 views" }];
  runInNewContext(compile("components/StudioNotifier.tsx") + "\nexports.pollInsights = insightNotes;", {
    module: m, exports: m.exports,
    localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } },
    fetch: async () => ({ ok: true, json: async () => ({ items }) }),
    require: (name: string) => name.endsWith("notify-pure") ? { notify: (d: notices.NotifyDetail) => got.push(d) } : name.endsWith("interruption-pure") ? rules : name === "react" || name.endsWith("studio-notify") ? {} : require(name),
  });
  await m.exports.pollInsights(); assert.equal(got.length, 0);
  items = [...items, ...[1, 2, 3].map((n) => ({ key: `new${n}`, kind: "hot", priority: "high", title: `Short ${n}`, detail: `${n * 1000} views` }))];
  await m.exports.pollInsights(); assert.equal(got.length, 3);
  assert.ok(got.every((d) => d.signal === "short-hot"));
  await m.exports.pollInsights(); assert.equal(got.length, 3);
});

test("THEATER playback holds a useful pop-up; urgent still shows", () => {
  const h = ui(); h.event(rules.THEATER_EVENT, true); h.emit(d("briefing", "brief")); h.tick(rules.IDLE_MS);
  assert.equal(h.nodes("article").length, 0); h.emit(d("disk-full", "disk")); assert.equal(h.nodes("article").length, 1);
  assert.equal(h.bell.length, 2); h.close(); // held, not lost: still in the bell
});
test("back after a day: waiting notices become one ranked digest card; each stays in the bell", () => {
  const h = ui(); h.storage.set(rules.LAST_SEEN_KEY, String(T - rules.AWAY_MS - 1)); h.tick(0);
  for (const k of ["a", "b", "c"]) h.emit(d("briefing", k));
  h.tick(rules.GATHER_MS + 1000);
  const cards = h.nodes("article"); assert.equal(cards.length, 1); assert.equal(cards[0].props["aria-label"], "herald.digest3");
  assert.equal(h.bell.length, 4); h.close();
});
