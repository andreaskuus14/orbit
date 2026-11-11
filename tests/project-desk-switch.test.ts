// #423 Agent 7: ARCH mounts ProjectDesk without a key, so switching projects keeps the same instance. A tiny hook harness
// (state survives renders, effects run when their deps change, like React) drives the real component through that switch.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as pure from "../src/lib/project-desk-pure.ts";
import * as chats from "../src/lib/core-chats-pure.ts";
import { translate } from "../src/lib/i18n-pure.ts";

const require = createRequire(import.meta.url);
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const code = ts.transpileModule(readFileSync(new URL("../src/components/ProjectDesk.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;

function harness(server: { desks: Record<string, pure.Desk>; hold?: string; fail?: string }) {
  const hooks: any[] = [], queue: (() => void)[] = [], posts: { project: string; body: any }[] = [], store = new Map<string, string>();
  let i = 0, dirty = false, tree: any, props: any;
  const held: (() => void)[] = [];
  const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const u = new URL(url, "http://orbit"), project = u.searchParams.get("project") ?? "";
    if (u.pathname === "/api/projects") return reply({ projects: [{ id: A, name: "House A" }, { id: B, name: "House B" }] });
    if (u.pathname === "/api/tasks") return reply({ tasks: [] });
    if (u.pathname !== "/api/projects/desk") return reply({});
    if (init?.method === "POST") {
      const body = JSON.parse(init.body!); posts.push({ project, body });
      if (body.rev !== server.desks[project].rev) return reply({ error: "stale" }, 409);
      server.desks[project] = { ...body, rev: body.rev + 1 }; return reply({ desk: server.desks[project] });
    }
    if (project === server.fail) return reply({ error: "Project desk could not be read" }, 503);
    if (project === server.hold) await new Promise<void>((r) => held.push(r));
    return reply({ desk: structuredClone(server.desks[project]) });
  };
  const react = { ...require("react"),
    useState(init: unknown) { const k = i++; if (!(k in hooks)) hooks[k] = typeof init === "function" ? (init as () => unknown)() : init;
      return [hooks[k], (v: unknown) => { const next = typeof v === "function" ? (v as (x: unknown) => unknown)(hooks[k]) : v; if (!Object.is(next, hooks[k])) { hooks[k] = next; dirty = true; } }]; },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) { const k = i++, prev = hooks[k];
      if (!prev || !deps || deps.some((d, j) => !Object.is(d, prev.deps[j]))) queue.push(() => { prev?.cleanup?.(); hooks[k] = { deps, cleanup: fn() }; }); },
  };
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, JSON, URL, fetch, sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, CustomEvent: class {}, require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return require(name);
      if (name.endsWith("/project-desk-pure")) return pure;
      if (name.endsWith("/core-chats-pure")) return chats;
      if (name.endsWith("/deeplink-pure")) return { linkToHash: () => "#" };
      if (name.endsWith("/nav-pure")) return { NAV_EVENT: "orbit:navigate" };
      if (name.endsWith("/project-list")) return { watchProjects: (load: () => void) => (load(), () => {}), notifyProjectsChanged: () => {} };
      if (name === "./i18n") return { useT: () => ({ t: (key: any, p: any) => translate("en", key, p) }) };
      throw new Error(name);
    } });
  const render = () => { i = 0; dirty = false; tree = m.exports.ProjectDesk(props); for (const run of queue.splice(0)) run(); };
  const settle = async () => { for (let n = 0; n < 20; n++) { await new Promise((r) => setTimeout(r, 0)); if (dirty) render(); } };
  const find = (pred: (p: any, type: string) => boolean, node: any): any => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) { for (const c of node) { const f = find(pred, c); if (f) return f; } return null; }
    if (node.props && pred(node.props, node.type)) return node.props;
    return find(pred, node.props?.children);
  };
  const text = (p: any): string => [p?.children].flat(9).map((c: any) => typeof c === "string" ? c : c?.props ? text(c.props) : "").join("");
  return {
    store, posts, release: () => held.splice(0).forEach((r) => r()),
    async show(project: string) { props = { project, onSelect: () => {} }; render(); await settle(); },
    notes: () => find((_, t) => t === "textarea", tree),
    saveButton: () => find((p, t) => t === "button" && text(p) === "Save notes and references", tree),
    async type(value: string) { const ta = this.notes(); if (!ta.disabled) { ta.onChange({ target: { value } }); render(); await settle(); } },
    async clickSave() { const b = this.saveButton(); if (!b.disabled) { b.onClick(); await settle(); } },
  };
}
const desks = () => ({ [A]: { rev: 2, notes: "A private notes", references: [] }, [B]: { rev: 2, notes: "B notes", references: [] } });
const bDraft = JSON.stringify({ desk: { rev: 2, notes: "B unsaved draft", references: [] }, title: "", url: "", request: "" });

for (const mode of ["slow", "failed"] as const) {
  test(`switching A → B while B's desk load is ${mode} never saves into B or touches B's draft`, async () => {
    const server: { desks: Record<string, pure.Desk>; hold?: string; fail?: string } = { desks: desks(), ...(mode === "slow" ? { hold: B } : { fail: B }) };
    const h = harness(server);
    h.store.set(pure.deskDraftKey(B), bDraft);
    await h.show(A);
    assert.equal(h.notes().value, "A private notes");
    await h.show(B); // same instance, as ARCH mounts it
    assert.equal(h.notes().disabled, true, "editing waits for B's own desk");
    assert.equal(h.saveButton().disabled, true);
    await h.type("typed during the switch"); await h.clickSave();
    assert.equal(h.posts.length, 0, "nothing was saved");
    assert.deepEqual(server.desks[B], { rev: 2, notes: "B notes", references: [] }, "B's notes stay untouched");
    assert.equal(h.store.get(pure.deskDraftKey(B)), bDraft, "B's recovery draft is neither deleted nor overwritten");
    assert.equal(h.store.get(pure.deskDraftKey(A)), undefined);
    if (mode === "slow") {
      h.release(); await new Promise((r) => setTimeout(r, 0)); await h.show(B);
      assert.equal(h.notes().value, "B unsaved draft"); // B's own draft recovered once B loaded
      await h.type("B edited"); await h.clickSave();
      assert.deepEqual(h.posts.map((p) => [p.project, p.body.notes]), [[B, "B edited"]]);
      assert.equal(server.desks[A].notes, "A private notes");
    }
  });
}
