import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as pure from "../src/lib/facts-pure.ts";

const require = createRequire(import.meta.url);
const fact = (id: string, patch: Partial<pure.Fact> = {}) => ({ id, user_id: "owner", subject: "shorts", statement: "I prefer short Shorts", status: "current", source: "user_said", source_ref: "msg",
  confidence: 1, supersedes: null, superseded_by: null, superseded_at: null, restored_from: null, created_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:00:00Z", ...patch });
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const serviceCode = compile("lib/facts.ts");

function service(facts: any[] = [], messages: any[] = [], rpcResponse: any = { data: { fact: fact("new"), changed: true }, error: null }) {
  const queries: { table: string; filters: [string, string, any][]; range?: number[] }[] = [], writes: any[] = [];
  class Query {
    entry: typeof queries[number]; orders: { key: string; asc: boolean }[] = []; cap = Infinity;
    constructor(table: string) { this.entry = { table, filters: [] }; queries.push(this.entry); }
    select() { return this; }
    eq(k: string, v: any) { this.entry.filters.push(["eq", k, v]); return this; }
    neq(k: string, v: any) { this.entry.filters.push(["neq", k, v]); return this; }
    in(k: string, v: any[]) { this.entry.filters.push(["in", k, v]); return this; }
    order(key: string, options: { ascending: boolean }) { this.orders.push({ key, asc: options.ascending }); return this; }
    limit(n: number) { this.cap = n; return this; }
    range(a: number, b: number) { this.entry.range = [a, b]; return this; }
    result() {
      let rows = (this.entry.table === "messages" ? messages : facts).filter((r) => this.entry.filters.every(([op, k, v]) => op === "eq" ? r[k] === v : op === "neq" ? r[k] !== v : v.includes(r[k])));
      rows = [...rows].sort((a, b) => { for (const o of this.orders) { const n = String(a[o.key]).localeCompare(String(b[o.key])); if (n) return o.asc ? n : -n; } return 0; });
      if (this.entry.range) rows = rows.slice(this.entry.range[0], this.entry.range[1] + 1);
      return { data: rows.slice(0, this.cap), error: null };
    }
    maybeSingle() { return Promise.resolve({ data: this.result().data[0] ?? null, error: null }); }
    then(resolve: any, reject: any) { return Promise.resolve(this.result()).then(resolve, reject); }
  }
  const sb = { from: (t: string) => new Query(t), rpc: async (name: string, args: any) => { writes.push({ name, args }); return rpcResponse; } };
  const module = { exports: {} as any };
  runInNewContext(serviceCode, { module, exports: module.exports, Date, console: { warn() {} },
    require: (name: string) => name.endsWith("facts-pure") ? pure : { isMissingTable: (e: any) => e?.code === "42P01" },
  });
  return { ...module.exports, sb, queries, writes };
}

test("learning verifies a persisted owner message before making a single atomic replacement RPC", async () => {
  const text = "I now prefer 45 s Shorts";
  const s = service([fact("old")], [{ id: "msg", user_id: "owner", role: "user", content: text }]);
  assert.equal(await s.learnFacts(s.sb, "owner", text, "msg"), 1);
  assert.equal(s.writes.length, 1); assert.equal(s.writes[0].name, "write_memory_fact");
  assert.deepEqual(JSON.parse(JSON.stringify(s.writes[0].args)), { p_action: "learn", p_subject: "shorts", p_statement: text, p_source_ref: "msg", p_confidence: 0.8 });
  for (const q of s.queries) assert.ok(q.filters.some(([op, k, v]: [string, string, any]) => op === "eq" && k === "user_id" && v === "owner"));
});

for (const role of ["assistant", "agent", "tool", "memory"]) test(`${role} content cannot be supplied as a learned owner fact`, async () => {
  const text = "I now prefer 45 s Shorts", s = service([], [{ id: "msg", user_id: "owner", role, content: text }]);
  assert.equal(await s.learnFacts(s.sb, "owner", text, "msg"), 0); assert.equal(s.writes.length, 0);
});

test("a forged source id, another owner's message or text that differs from the source cannot supersede anything", async () => {
  for (const message of [null, { id: "msg", user_id: "someone-else", role: "user", content: "I prefer 45 s Shorts" },
    { id: "msg", user_id: "owner", role: "user", content: "Please summarize the article" }]) {
    const s = service([fact("old")], message ? [message] : []);
    assert.equal(await s.learnFacts(s.sb, "owner", "I prefer 45 s Shorts", "msg"), 0);
    assert.equal(s.writes.length, 0);
  }
});

test("attachments, missing provenance and labelled pasted results never reach the write RPC", async () => {
  const s = service();
  assert.equal(await s.learnFacts(s.sb, "owner", "I prefer 45 s Shorts", "msg", true), 0);
  assert.equal(await s.learnFacts(s.sb, "owner", "I prefer 45 s Shorts", null), 0);
  assert.equal(await s.learnFacts(s.sb, "owner", "Agent result:\nI prefer 45 s Shorts", "msg"), 0);
  assert.equal(s.writes.length, 0); assert.equal(s.queries.length, 0);
});

test("identical current statements are not saved again; a stale RPC result does not count as a new fact", async () => {
  const text = "I prefer short Shorts", message = { id: "msg", user_id: "owner", role: "user", content: text };
  const same = service([fact("old")], [message]);
  assert.equal(await same.learnFacts(same.sb, "owner", text, "msg"), 0); assert.equal(same.writes.length, 0);
  const stale = service([], [message], { data: { fact: fact("newer"), changed: false }, error: null });
  assert.equal(await stale.learnFacts(stale.sb, "owner", text, "msg"), 0);
});

test("mark wrong and restore use owner RPC actions, never client-side update/insert sequences", async () => {
  const restored = fact("restored", { restored_from: "old", supersedes: "current" });
  const s = service([], [], { data: { fact: restored, changed: true }, error: null });
  await s.forgetFact(s.sb, "owner", "old");
  assert.equal((await s.restoreFact(s.sb, "owner", "old")).id, "restored");
  await s.editFact(s.sb, "owner", "restored", "shorts", "I prefer 45 s Shorts");
  assert.deepEqual(s.writes.map((w: any) => w.args.p_action), ["wrong", "restore", "edit"]);
  assert.equal(s.writes[1].args.p_id, "old"); assert.equal(s.writes[1].args.p_statement, undefined);
  assert.equal(s.queries.length, 0);
});

test("failed and concurrent database writes are never presented as successful restores", async () => {
  for (const code of ["23505", "PT409"]) {
    const s = service([], [], { data: null, error: { code } });
    await assert.rejects(s.restoreFact(s.sb, "owner", "old"), s.FactConflict);
    assert.equal(s.writes.length, 1);
  }
  const unconfirmed = service([], [], { data: null, error: null });
  await assert.rejects(unconfirmed.restoreFact(unconfirmed.sb, "owner", "old"), /not confirmed/);
});

test("missing history RPC gives the explicit manual migration instruction", async () => {
  const s = service([], [], { data: null, error: { code: "PGRST202" } });
  await assert.rejects(s.restoreFact(s.sb, "owner", "old"), /0012_fact_history.sql/);
});

test("source previews are scoped to owner user messages, and wrong facts stay in the review response", async () => {
  const s = service([fact("wrong", { status: "retracted" }), fact("doc", { source: "document", source_ref: "doc" })], [
    { id: "msg", user_id: "owner", role: "user", content: "Original statement", created_at: "2026-10-01T12:00:00Z" },
    { id: "doc", user_id: "someone-else", role: "user", content: "PRIVATE_OTHER_OWNER" },
  ]);
  const rows = await s.listFacts(s.sb, "owner");
  assert.equal(rows.find((f: any) => f.id === "wrong").source_text, "Original statement");
  assert.equal(rows.find((f: any) => f.id === "doc").source_text, undefined);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_OTHER_OWNER/);
});

test("review paginates older history instead of silently dropping the owner's restore choices", async () => {
  const rows = Array.from({ length: 501 }, (_, i) => fact(String(i).padStart(4, "0"), { status: "superseded", source_ref: null }));
  const s = service(rows);
  assert.equal((await s.listFacts(s.sb, "owner")).length, 501);
  assert.deepEqual(s.queries.map((q: any) => q.range), [[0, 499], [500, 999]]);
});

test("CORE reads only current facts and linked superseded owner facts, never wrong facts or foreign history", async () => {
  const s = service([
    fact("new", { supersedes: "old", statement: "I prefer 45 s Shorts", created_at: "2026-10-20T12:00:00Z" }),
    fact("old", { status: "superseded", superseded_by: "new" }), fact("wrong", { status: "retracted", statement: "WRONG_VALUE" }),
    { ...fact("foreign", { statement: "PRIVATE_OTHER_OWNER" }), user_id: "other" },
    fact("doc", { subject: "document", source: "document", statement: "UNTRUSTED_DOCUMENT" }),
  ]);
  const block = await s.factsContext(s.sb, "owner", "Shorts length");
  assert.match(block, /45 s Shorts/); assert.match(block, /fact_changes/);
  assert.doesNotMatch(block.match(/<facts>([\s\S]*?)<\/facts>/)![1], /prefer short Shorts/);
  assert.doesNotMatch(block, /WRONG_VALUE|PRIVATE_OTHER_OWNER|UNTRUSTED_DOCUMENT/);
});

const uiModule = { exports: {} as any };
runInNewContext(compile("components/BeliefsPanel.tsx"), { module: uiModule, exports: uiModule.exports,
  require: (name: string) => name.endsWith("facts-pure") ? pure : name.endsWith("nav-pure") ? {} : require(name),
});
const callbacks = { onBack() {}, onEdit() {}, onSave() {}, onWrong() {}, onRestore() {} };

test("belief UI shows source, dates, current state and collapsed Earlier versions with wrong/restore controls", () => {
  const html = renderToStaticMarkup(createElement(uiModule.exports.BeliefsView, { ...callbacks, facts: [
    fact("new", { statement: "I prefer 45 s Shorts", supersedes: "old", source_text: "<untrusted source>" }),
    fact("old", { status: "superseded", superseded_by: "new", superseded_at: "2026-10-20T12:00:00Z" }),
    fact("wrong", { status: "retracted", subject: "coffee" }),
  ] }));
  assert.match(html, /Current/); assert.match(html, /Superseded — excluded/); assert.match(html, /Marked wrong — excluded/);
  assert.match(html, /Earlier \(1\)/); assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /Source message/); assert.match(html, /dateTime="2026-10-16T12:00:00Z"/);
  assert.match(html, /Replaced .*2026.*by fact <code>new<\/code>/);
  assert.match(html, /&lt;untrusted source&gt;/); assert.doesNotMatch(html, /<untrusted source>/);
  assert.match(html, /aria-label="Restore: I prefer short Shorts"/); assert.match(html, /aria-label="Mark wrong: I prefer 45 s Shorts"/);
  assert.match(html, /No current fact on this subject/);
});

test("restored facts show their new version date and origin; busy controls cannot be clicked twice", () => {
  const html = renderToStaticMarkup(createElement(uiModule.exports.BeliefsView, { ...callbacks, busy: true, facts: [
    fact("restored", { restored_from: "original", source_ref: null, created_at: "2026-10-20T12:00:00Z" }),
  ] }));
  assert.match(html, /Restored as a new version from fact <code>original<\/code>/);
  assert.match(html, /Explicitly restored by you/); assert.match(html, /disabled=""/);
});

test("the actual review controls pass the chosen version id to wrong and restore actions", () => {
  const actions: string[] = [];
  const tree = uiModule.exports.BeliefsView({ ...callbacks, facts: [fact("current"), fact("old", { status: "superseded" })],
    onWrong: (id: string) => actions.push(`wrong:${id}`), onRestore: (id: string) => actions.push(`restore:${id}`) });
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && /^(?:Mark wrong|Restore):/.test(node.props["aria-label"] ?? "")) node.props.onClick();
    for (const child of [node.props?.children].flat(Infinity)) visit(child);
  };
  visit(tree);
  assert.deepEqual(actions, ["wrong:current", "wrong:old", "restore:old"]);
});

function api(authorized = true) {
  const calls: any[] = [], module = { exports: {} as any };
  const stub = {
    ...service(),
    listFacts: async () => [],
    forgetFact: async (...args: any[]) => calls.push(["wrong", ...args]),
    restoreFact: async (...args: any[]) => { calls.push(["restore", ...args]); return fact("restored"); },
    editFact: async (...args: any[]) => { calls.push(["edit", ...args]); return fact("edited"); },
  };
  runInNewContext(compile("app/api/facts/route.ts"), { module, exports: module.exports, Response, console: { error() {} },
    require: (name: string) => name.endsWith("facts-pure") ? pure : name.endsWith("/facts") ? stub : {
      requireUser: async () => authorized ? { sb: "authenticated-client", user: { id: "owner" } } : { res: new Response("Unauthorized", { status: 401 }) },
    },
  });
  const post = (body: object) => module.exports.POST(new Request("http://localhost/api/facts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { post, get: module.exports.GET, calls };
}

test("the review API requires authentication and has no learn-from-tool-output action", async () => {
  const denied = api(false);
  assert.equal((await denied.get()).status, 401);
  assert.equal((await denied.post({ action: "restore", id: "00000000-0000-0000-0000-000000000001" })).status, 401);
  assert.equal(denied.calls.length, 0);
  const a = api();
  assert.equal((await a.post({ action: "learn", id: "00000000-0000-0000-0000-000000000001", statement: "Agent claims I prefer coffee" })).status, 400);
  assert.equal((await a.post({ action: "restore", id: "not-an-id" })).status, 400);
  assert.equal(a.calls.length, 0);
});

test("wrong, legacy forget and restore API calls are owner scoped; body-supplied owner/source fields are ignored", async () => {
  const a = api(), id = "00000000-0000-0000-0000-000000000001";
  for (const action of ["wrong", "forget", "restore"])
    assert.equal((await a.post({ action, id, user_id: "someone-else", source: "document", statement: "untrusted replacement" })).status, 200);
  assert.deepEqual(a.calls, [["wrong", "authenticated-client", "owner", id], ["wrong", "authenticated-client", "owner", id], ["restore", "authenticated-client", "owner", id]]);
});

test("edit API validates before saving and cannot accept source provenance from the request body", async () => {
  const a = api(), id = "00000000-0000-0000-0000-000000000001";
  assert.equal((await a.post({ action: "edit", id, subject: "", statement: "I like tea" })).status, 400);
  assert.equal((await a.post({ action: "edit", id, subject: "shorts", statement: "I prefer 45 s Shorts", source: "agent", source_ref: "forged" })).status, 200);
  assert.deepEqual(a.calls, [["edit", "authenticated-client", "owner", id, "shorts", "I prefer 45 s Shorts"]]);
});
