import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as pure from "../src/lib/project-desk-pure.ts";
import { translate } from "../src/lib/i18n-pure.ts";
import * as chats from "../src/lib/core-chats-pure.ts";

const require = createRequire(import.meta.url), project = "11111111-1111-4111-8111-111111111111";
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
test("project access rejects invalid and unowned projects before exposing records", async () => {
  const m = { exports: {} as any }, conditions: [string, string][] = [];
  runInNewContext(compile("lib/project-access.ts"), { module: m, exports: m.exports, URL, Response, require: () => pure });
  const sb = { from: () => ({ select() { return this; }, eq(k: string, v: string) { conditions.push([k, v]); return this; }, maybeSingle: async () => ({ data: null, error: null }) }) };
  assert.equal(await m.exports.projectScope(new Request("http://orbit/api/arch/scene"), sb, "owner"), null);
  assert.equal((await m.exports.projectScope(new Request("http://orbit/?project=../x"), sb, "owner")).status, 400);
  assert.equal(conditions.length, 0);
  assert.equal((await m.exports.projectScope(new Request(`http://orbit/?project=${project}`), sb, "owner")).status, 404);
  assert.deepEqual(conditions, [["id", project], ["user_id", "owner"]]);
});
test("ARCH scene and history routes scope every read/write to the authorized project", async () => {
  for (const kind of ["scene", "versions"]) {
    const code = compile(`app/api/arch/${kind}/route.ts`), m = { exports: {} as any };
    let reads = 0, allowed = false;
    runInNewContext(code, { module: m, exports: m.exports, Response, JSON, require: (name: string) => {
      if (name === "node:fs/promises") return { readFile: async () => { reads++; return JSON.stringify({ users: { "owner": { rev: 9 }, [`owner:${project}`]: { rev: 3 } } }); } };
      if (name === "node:path") return require(name);
      if (name.endsWith("/supabase/server")) return { requireUser: async () => ({ user: { id: "owner" }, sb: {} }) };
      if (name.endsWith("/project-access")) return { projectScope: async () => allowed ? project : new Response(null, { status: 404 }) };
      if (name.endsWith("/project-desk-pure")) return pure;
      if (name.endsWith("/data-dir")) return { orbitDataDir: () => "/test" };
      if (name.endsWith("/arch-time-pure")) return { readSnapshots: (raw: unknown) => raw };
      return {};
    } });
    const req = new Request(`http://orbit/api/arch/${kind}?project=${project}`);
    assert.equal((await m.exports.GET(req)).status, 404);
    assert.equal((await m.exports.POST(req)).status, 404);
    assert.equal(reads, 0);
    allowed = true;
    const body = await (await m.exports.GET(req)).json();
    assert.equal((body.saved ?? body.versions).rev, 3);
  }
});
test("project desk renders project selection, local notes, references and task links", () => {
  const m = { exports: {} as any };
  const desk = { rev: 2, notes: "Use timber", references: [{ title: "Reference", url: "https://example.com/" }], files: [{ id: project, label: "Old name.png" }], productions: [{ id: "job:clip", title: "Project film" }], palette: ["#aabbcc"] };
  const state: any[] = [[{ id: project, name: "My house", status: "active" }], "", desk, desk, true, false, "", [{ id: "task-1", title: "Study site", status: "done" }], "", "", "", [{ id: project, name: "Renamed.png", type: "image", version: 3 }], "#112233"];
  runInNewContext(compile("components/ProjectDesk.tsx"), { module: m, exports: m.exports, JSON, require: (name: string) => {
    if (name === "react") return { ...require("react"), useState: () => [state.shift(), () => {}], useEffect: () => {} };
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith("/project-desk-pure")) return pure;
    if (name.endsWith("/deeplink-pure")) return { linkToHash: (target: any) => `#o=${target.planet}&id=${target.id}` };
    if (name.endsWith("/core-chats-pure")) return chats;
    if (name.endsWith("/nav-pure")) return { NAV_EVENT: "orbit:navigate" };
    if (name === "./i18n") return { useT: () => ({ t: (key: any, params: any) => translate("en", key, params) }) };
    throw new Error(name);
  } });
  const html = renderToStaticMarkup(createElement(m.exports.ProjectDesk, { project, onSelect: () => {} }));
  assert.match(html, /My house/); assert.match(html, /Use timber/); assert.match(html, /https:\/\/example.com\//);
  assert.match(html, /Study site/); assert.match(html, /#o=operations/); assert.match(html, /not sent to AI/);
  assert.match(html, /Save notes and references/);
  assert.match(html, /Renamed.png/); assert.match(html, /file=Renamed.png/); assert.doesNotMatch(html, /file=Old/);
  assert.match(html, /Project film/); assert.match(html, /#o=studio/); assert.match(html, /#aabbcc/); assert.match(html, /Open project in CORE/);
});
test("project chat requests are navigation data only and reject malformed IDs", () => {
  assert.deepEqual(chats.projectChatRequest({ projectId: project, chatId: "chat-1", message: "Must never be sent" }), { projectId: project, chatId: "chat-1" });
  assert.equal(chats.projectChatRequest({ projectId: "../other" }), null);
  assert.equal(chats.projectChatRequest({ projectId: project, chatId: "<script>" }), null);
  assert.equal(chats.projectChatRequest(null), null);
});
test("connecting CORE uses the existing project ID, preserves pins and never copies desk notes", async () => {
  const m = { exports: {} as any }, store = chats.emptyChats(), events: any[] = [];
  let allowed = true, writes = 0;
  runInNewContext(compile("app/api/projects/core/route.ts"), { module: m, exports: m.exports, Response, Date, require: (name: string) => {
    if (name.endsWith("/supabase/server")) return { requireUser: async () => ({ user: { id: "owner" }, sb: { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { name: "My house" }, error: null }) }) } }) };
    if (name.endsWith("/project-access")) return { projectScope: async () => allowed ? project : new Response(null, { status: 404 }) };
    if (name.endsWith("/core-chats")) return { updateChats: async (_user: string, fn: any) => { writes++; return fn(store); } };
    if (name.endsWith("/core-chats-pure")) return chats;
    if (name.endsWith("/activity")) return { logActivity: (event: any) => events.push(event) };
    throw new Error(name);
  } });
  const req = new Request(`http://orbit/api/projects/core?project=${project}`, { method: "POST" });
  assert.equal((await m.exports.POST(req)).status, 200);
  assert.equal(store.projects[0].id, project); assert.equal(store.projects[0].instructions, ""); assert.equal(store.projects[0].pins.length, 0);
  store.projects[0].pins.push({ id: "pin", title: "Owner pin", text: "Preserve", at: "now" });
  assert.equal((await m.exports.POST(req)).status, 200);
  assert.equal(store.projects.length, 1); assert.equal(store.projects[0].pins.length, 1); assert.equal(events.length, 1);
  allowed = false;
  assert.equal((await m.exports.POST(req)).status, 404); assert.equal(writes, 2);
});
