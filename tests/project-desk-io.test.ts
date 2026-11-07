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
  const state: any[] = [[{ id: project, name: "My house", status: "active" }], "", desk, desk, true, false, "", [{ id: "task-1", title: "Study site", status: "done" }], "", "", "", [{ id: project, name: "Renamed.png", type: "image", version: 3 }], "#112233", []];
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
  assert.doesNotMatch(html, /Only in the cloud/);
});
test("project desk lists cloud-only VAULT files as unselectable and says to restore them in VAULT first", () => {
  const m = { exports: {} as any };
  const desk = { rev: 1, notes: "", references: [], files: [], productions: [], palette: [] };
  const state: any[] = [[], "", desk, desk, true, false, "", [], "", "", "", [{ id: project, name: "Local.png", type: "image", version: 1 }], "#112233", [{ name: "Cloud plan.pdf" }, { name: "Site photo.jpg" }]];
  runInNewContext(compile("components/ProjectDesk.tsx"), { module: m, exports: m.exports, JSON, require: (name: string) => {
    if (name === "react") return { ...require("react"), useState: () => [state.shift(), () => {}], useEffect: () => {} };
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith("/project-desk-pure")) return pure;
    if (name.endsWith("/deeplink-pure")) return { linkToHash: () => "#" };
    if (name.endsWith("/core-chats-pure")) return chats;
    if (name.endsWith("/nav-pure")) return { NAV_EVENT: "orbit:navigate" };
    if (name === "./i18n") return { useT: () => ({ t: (key: any, params: any) => translate("en", key, params) }) };
    throw new Error(name);
  } });
  const html = renderToStaticMarkup(createElement(m.exports.ProjectDesk, { project, onSelect: () => {} }));
  assert.match(html, new RegExp(`<option value="${project}">Local.png</option>`));
  assert.match(html, /<optgroup label="Only in the cloud: restore in VAULT first"><option value="cloud:Cloud plan.pdf" disabled="">Cloud plan.pdf<\/option><option value="cloud:Site photo.jpg" disabled="">Site photo.jpg<\/option><\/optgroup>/);
  assert.match(html, /2 file\(s\) are only in the cloud\. Restore them in VAULT \(Download to this PC\) before linking them here\./);
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
test("connecting CORE returns not-found for a missing project, keeps the owner filter, and 503 only for a read error", async () => {
  const m = { exports: {} as any }, conditions: [string, string][] = [];
  let row: any = { data: null, error: null }, writes = 0;
  runInNewContext(compile("app/api/projects/core/route.ts"), { module: m, exports: m.exports, Response, Date, require: (name: string) => {
    if (name.endsWith("/supabase/server")) return { requireUser: async () => ({ user: { id: "owner" }, sb: { from: () => ({ select() { return this; }, eq(k: string, v: string) { conditions.push([k, v]); return this; }, maybeSingle: async () => row }) } }) };
    if (name.endsWith("/project-access")) return { projectScope: async () => project };
    if (name.endsWith("/core-chats")) return { updateChats: async () => { writes++; return { error: "unexpected" }; } };
    if (name.endsWith("/core-chats-pure")) return chats;
    if (name.endsWith("/activity")) return { logActivity: () => {} };
    throw new Error(name);
  } });
  const req = new Request(`http://orbit/api/projects/core?project=${project}`, { method: "POST" });
  const missing = await m.exports.POST(req);
  assert.equal(missing.status, 404); assert.equal((await missing.json()).error, "Project not found");
  assert.deepEqual(conditions, [["id", project], ["user_id", "owner"]]);
  row = { data: null, error: { message: "connection reset" } };
  assert.equal((await m.exports.POST(req)).status, 503);
  assert.equal(writes, 0);
});
test("task creation links only a project the signed-in user owns (two synthetic accounts)", async () => {
  const alice = "alice-user", bob = "bob-user", bobProject = "22222222-2222-4222-8222-222222222222";
  const projects = [{ id: project, user_id: alice }, { id: bobProject, user_id: bob }];
  const inserts: any[] = [];
  let as = alice, failRead = false;
  const sb = { from: (table: string) => {
    const where: Record<string, string> = {};
    const q: any = { select() { return q; }, eq(k: string, v: string) { where[k] = v; return q; },
      maybeSingle: async () => failRead ? { data: null, error: { message: "down" } } : { data: projects.find((p) => p.id === where.id && p.user_id === where.user_id) ?? null, error: null },
      insert(row: any) { inserts.push({ table, row }); return { select: () => ({ single: async () => ({ data: { id: "t1", ...row }, error: null }) }) }; } };
    return q;
  } };
  const m = { exports: {} as any };
  runInNewContext(compile("app/api/tasks/route.ts"), { module: m, exports: m.exports, Response, require: (name: string) => {
    if (name.endsWith("/supabase/server")) return { requireUser: async () => ({ user: { id: as }, sb }) };
    if (name.endsWith("/agents")) return { getAgent: async () => ({ slug: "nova" }), kickQueue: async () => {} };
    if (name.endsWith("/lib/pure")) return { str: (v: unknown, max: number, min = 0) => typeof v === "string" && v.trim().length >= min ? v.trim().slice(0, max) : "" };
    if (name.endsWith("/capability")) return { capabilityStart: async () => ({ block: null, headsUp: [] }) };
    if (name.endsWith("/capability-pure")) return { withHeadsUp: (title: string, request: string) => ({ title, request }) };
    if (name.endsWith("/project-desk-pure")) return pure;
    throw new Error(name);
  } });
  const post = (project_id?: unknown) => m.exports.POST(new Request("http://orbit/api/tasks", { method: "POST", body: JSON.stringify({ request: "Study the site", ...(project_id !== undefined && { project_id }) }) }));
  const r = await post(bobProject); // Alice names Bob's project
  assert.equal(r.status, 404); assert.equal((await r.json()).error, "Project not found");
  assert.equal(inserts.length, 0);
  assert.equal((await post("../x")).status, 400);
  assert.equal((await post(project)).status, 201); // her own project links
  as = bob;
  assert.equal((await post(project)).status, 404); // and Bob can't use Alice's
  assert.equal((await post(bobProject)).status, 201);
  assert.equal((await post()).status, 201); // no project: unchanged
  failRead = true;
  assert.equal((await post(bobProject)).status, 503);
  assert.deepEqual(inserts.map((i) => [i.row.user_id, i.row.project_id]), [[alice, project], [bob, bobProject], [bob, null]]);
});
test("sign-out and the login page clear desk drafts and the pending CORE project request from the tab", async () => {
  const fakeStorage = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => { m.delete(k); }, getItem: (k: string) => m.get(k) ?? null, dump: () => [...m.entries()] };
  };
  const tab = () => fakeStorage({
    [pure.deskDraftKey(project)]: JSON.stringify({ desk: { rev: 1, notes: "Private renovation budget", references: [] }, title: "", url: "", request: "Price the kitchen" }),
    [pure.deskDraftKey("22222222-2222-4222-8222-222222222222")]: "{\"desk\":{\"notes\":\"Second project draft\"}}",
    [chats.CORE_PROJECT_REQUEST_KEY]: JSON.stringify({ projectId: project }),
    "orbit.view": "galaxy",
  });
  const s = tab();
  pure.clearProjectSession(s);
  assert.deepEqual(s.dump(), [["orbit.view", "galaxy"]]); // unrelated keys stay
  assert.doesNotMatch(JSON.stringify(s.dump()), /renovation|kitchen|Second project|pendingProject/i);

  // The login page (reached on sign-out and when the server ends an expired session) clears the same keys on load.
  const login = tab(), m = { exports: {} as any };
  runInNewContext(compile("app/login/page.tsx"), { module: m, exports: m.exports, URLSearchParams, location: { search: "" }, sessionStorage: login, require: (name: string) => {
    if (name === "react") return { ...require("react"), useState: (v: unknown) => [v, () => {}], useEffect: (fn: () => void) => fn() };
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith("/supabase/client")) return { createClient: () => ({ auth: {} }) };
    if (name.endsWith("/BrandMark")) return { BrandMark: () => null };
    if (name.endsWith("/project-desk-pure")) return pure;
    throw new Error(name);
  } });
  renderToStaticMarkup(createElement(m.exports.default));
  assert.deepEqual(login.dump(), [["orbit.view", "galaxy"]]);
  // Explicit sign-out clears before the auth call and the redirect.
  const orbit = readFileSync(new URL("../src/components/Orbit.tsx", import.meta.url), "utf8");
  assert.match(orbit, /async function signOut\(\) \{ try \{ clearProjectSession\(sessionStorage\); \} catch \{[^}]*\} await sb\.auth\.signOut\(\); location\.href = "\/login"; \}/);
});
