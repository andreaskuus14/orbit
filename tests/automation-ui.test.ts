import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as edit from "../src/lib/automation-edit-pure.ts";
import { translate } from "../src/lib/i18n-pure.ts";

const require = createRequire(import.meta.url), clone = (x: any) => JSON.parse(JSON.stringify(x));
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const fieldsModule = { exports: {} as any };
runInNewContext(compile("AutomationFields"), { module: fieldsModule, exports: fieldsModule.exports,
  require: (n: string) => n.endsWith("automation-edit-pure") ? edit : require(n),
});
const agents = [
  { slug: "forge", name: "Forge", tools: ["search_memory", "save_memory"] },
  { slug: "custom", name: "My researcher", tools: ["news_search", "fetch_url"] },
  { slug: "off", name: "Disabled researcher", tools: ["news_search"], enabled: false },
];
const draft: edit.AutomationDraft = { name: "Daily", prompt: "Check the latest news", agent: "forge", when: "week", time: "18:30", weekday: 5, kind: "" };
test("shared fields show the real roster/tools, inline capability hint and schedule controls", () => {
  const html = renderToStaticMarkup(createElement(fieldsModule.exports.AutomationFields, { draft, agents, onChange() {} }));
  assert.match(html, /Forge — search_memory, save_memory/); assert.match(html, /My researcher — news_search, fetch_url/);
  assert.doesNotMatch(html, /Disabled researcher/); assert.match(html, /Forge has no live-news tools/);
  assert.match(html, /aria-describedby="automation-agent-hint"/); assert.match(html, /aria-label="Day"/); assert.match(html, /value="18:30"/);
});
test("missing agent is shown as unavailable; fields are disabled during save", () => {
  const html = renderToStaticMarkup(createElement(fieldsModule.exports.AutomationFields, { draft: { ...draft, agent: "gone" }, agents, disabled: true, onChange() {} }));
  assert.match(html, /gone \(unavailable\)/); assert.match(html, /Choose an enabled agent/); assert.match(html, /<fieldset disabled=""/);
});

function ui(options: { failSave?: boolean; failRun?: boolean } = {}) {
  let cursor = 0, dirty = false, tree: any; const hooks: any[] = [], effects: (() => void)[] = [];
  const requests: { method: string; body: any }[] = [], opened: string[] = [];
  const rows = ["one", "two"].map((id) => ({ ...edit.automationSpec(draft), id, name: id === "one" ? "First" : "Second", enabled: false, when: "Every Friday", run_count: 7, runs: [], last: null }));
  const react = {
    useState(initial: any) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], (v: any) => { hooks[i] = typeof v === "function" ? v(hooks[i]) : v; dirty = true; }]; },
    useRef(initial: any) { const i = cursor++; return hooks[i] ??= { current: initial }; },
    useCallback(f: any, deps: any[]) { const i = cursor++; if (!hooks[i] || deps.some((x, n) => x !== hooks[i].deps[n])) hooks[i] = { f, deps }; return hooks[i].f; },
    useEffect(f: () => any, deps: any[]) { const i = cursor++, old = hooks[i]; if (!old || deps.some((x, n) => x !== old.deps[n])) effects.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: f() }; }); },
  };
  const m = { exports: {} as any };
  runInNewContext(compile("AgentsPanels"), { module: m, exports: m.exports, Error, confirm: () => true, setInterval: () => 1, clearInterval() {},
    require: (name: string) => name === "react" ? react : name.endsWith("automation-edit-pure") ? edit : name.endsWith("AutomationFields") ? fieldsModule.exports : name.endsWith("world-paused") ? { useWorldPaused: () => false } : name === "./i18n" ? { useT: () => ({ t: (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate("en", k, v), tn: (b: string, n: number) => translate("en", `${b}.${n === 1 ? "one" : "other"}` as Parameters<typeof translate>[1], { n }) }) } : name === "react/jsx-runtime" ? require(name) : {},
    fetch: async (_url: string, init: any = {}) => {
      const method = init.method ?? "GET", body = init.body ? JSON.parse(init.body) : null;
      if (method === "GET") return { ok: true, json: async () => ({ automations: clone(rows) }) };
      requests.push({ method, body });
      if (method === "PATCH") {
        if (options.failSave) return { ok: false, json: async () => ({ error: "Unknown agent" }) };
        const row = rows.find((a) => a.id === body.id)!;
        const v = edit.validateAutomationPatch(body, row); assert.ok("patch" in v); Object.assign(row, v.patch);
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (body.run && options.failRun) return { ok: false, json: async () => ({ error: "Stop-all is on" }) };
      return { ok: true, json: async () => ({ task: "new-task" }) };
    },
  });
  function flush() { let n = 0; do { dirty = false; cursor = 0; tree = m.exports.AutomationsView({ agents, onOpenTask: (id: string) => opened.push(id) }); while (effects.length) effects.shift()!(); } while (dirty && ++n < 10); assert.ok(n < 10); }
  const nodes = (type: string) => { const out: any[] = []; const visit = (n: any) => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== "object") return; if (typeof n.type === "function") return visit(n.type(n.props)); if (n.type === type) out.push(n); visit(n.props?.children); }; visit(tree); return out; };
  flush();
  return { requests, opened, rows, nodes, flush,
    async settle() { await new Promise(setImmediate); flush(); },
    button(text: string) { const node = nodes("button").find((n) => n.props.children === text); assert.ok(node, text); return node; },
    change(label: string, value: string) { const node = [...nodes("input"), ...nodes("textarea"), ...nodes("select")].find((n) => n.props["aria-label"] === label); assert.ok(node, label); node.props.onChange({ target: { value } }); flush(); },
    close() { for (const h of hooks) h?.cleanup?.(); },
  };
}
test("Edit opens inline on the chosen row; Save changes PATCHes fields without enabling it", async () => {
  const h = ui(); await h.settle(); h.nodes("button").find((b) => b.props["aria-label"] === "Edit First").props.onClick(); h.flush();
  assert.equal(h.nodes("form")[0].props["aria-label"], "Edit automation"); assert.equal(h.nodes("li").length, 2);
  assert.equal(h.nodes("input").find((n) => n.props["aria-label"] === "Automation name").props.value, "First");
  h.change("Automation name", "Updated"); h.change("Automation agent", "custom"); h.change("Instructions", "Find live news from two sources"); h.change("Time", "00:15");
  await h.nodes("form")[0].props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].method, "PATCH"); assert.equal(h.requests[0].body.id, "one");
  assert.equal(h.rows[0].agent, "custom"); assert.equal(h.rows[0].name, "Updated"); assert.equal(h.rows[0].enabled, false); assert.equal(h.rows[0].run_count, 7);
  assert.equal(h.nodes("form").length, 0); h.close();
});
test("Cancel discards the draft and polling does not reset fields being edited", async () => {
  const h = ui(); await h.settle(); h.button("Edit").props.onClick(); h.flush(); h.change("Instructions", "Unsaved new instructions"); await h.settle();
  assert.equal(h.nodes("textarea")[0].props.value, "Unsaved new instructions");
  h.button("Cancel").props.onClick(); h.flush(); assert.equal(h.requests.length, 0); assert.equal(h.rows[0].prompt, draft.prompt); assert.equal(h.nodes("form").length, 0); h.close();
});
test("Run now uses only the saved id and double clicks start only one request", async () => {
  const h = ui(); await h.settle(); const run = h.button("Run now");
  const first = run.props.onClick(), second = run.props.onClick(); h.flush();
  assert.equal(h.button("Run now").props.disabled, true);
  await Promise.all([first, second]); await h.settle();
  assert.deepEqual(h.requests, [{ method: "POST", body: { run: "one" } }]); assert.deepEqual(h.opened, ["new-task"]); h.close();
});
test("unsaved edits cannot be run and Save failure keeps the draft with a visible error", async () => {
  const h = ui({ failSave: true }); await h.settle(); h.button("Edit").props.onClick(); h.flush();
  h.change("Instructions", "Keep these unsaved instructions"); assert.equal(h.button("Run now").props.disabled, true);
  await h.button("Run now").props.onClick(); assert.equal(h.requests.length, 0);
  await h.nodes("form")[0].props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(h.nodes("textarea")[0].props.value, "Keep these unsaved instructions");
  assert.equal(h.nodes("p").find((n) => n.props.role === "alert").props.children, "Unknown agent"); h.close();
});
test("Run now displays the runner's refusal and never opens a nonexistent task", async () => {
  const h = ui({ failRun: true }); await h.settle(); await h.button("Run now").props.onClick(); await h.settle();
  assert.deepEqual(h.opened, []); assert.equal(h.nodes("p").find((n) => n.props.role === "alert").props.children, "Stop-all is on"); h.close();
});
test("Pause/Resume retains the enabled-only PATCH contract", async () => {
  const h = ui(); await h.settle(); await h.button("Resume").props.onClick(); await h.settle();
  assert.deepEqual(h.requests, [{ method: "PATCH", body: { id: "one", enabled: true } }]); assert.equal(h.rows[0].enabled, true); h.close();
});
