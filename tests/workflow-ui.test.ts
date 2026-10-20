import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the actual components using the installed compiler; no extra test runtime.
const require = createRequire(import.meta.url);
function component(file: string, name: string) {
  const source = readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, React.ComponentType<any>> };
  runInNewContext(output, { exports: module.exports, module, require });
  return module.exports[name];
}
const Continue = component("ContinueWork", "ContinueWorkView");
const Evidence = component("ResultEvidence", "ResultEvidence");
const callbacks = { onOpenTask() {}, onOpenGoal() {}, onRefresh() {} };

test("a failed refresh never presents a stale empty inbox as caught up", () => {
  const data = { items: [], more: 0, problems: [] };
  const html = renderToStaticMarkup(createElement(Continue, { ...callbacks, data, error: "Couldn't refresh your work. Try again." }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Showing the last loaded results/);
  assert.doesNotMatch(html, /You're caught up/);
  const good = renderToStaticMarkup(createElement(Continue, { ...callbacks, data }));
  assert.match(good, /You&#x27;re caught up/);
});

test("refresh keeps current work visible, disables duplicate clicks and labels repeated actions", () => {
  const html = renderToStaticMarkup(createElement(Continue, { ...callbacks, loading: true, updatedAt: new Date("2026-10-20T10:00:00Z"), data: {
    items: [{ kind: "task", id: "t", title: "Check <the site>", status: "awaiting_approval", detail: "Waiting for your decision", action: "Review approval" }], more: 0, problems: [],
  } }));
  assert.match(html, /disabled=""/);
  assert.match(html, /Refreshing/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /aria-label="Review approval: Check &lt;the site&gt;"/);
  assert.match(html, /Your decision/);
  assert.match(html, /dateTime="2026-10-20T10:00:00.000Z"/);
});

test("receipts separate read-back evidence from quality claims and safely encode file links", () => {
  const html = renderToStaticMarkup(createElement(Evidence, { openMemory() {}, items: [
    { kind: "memory", id: "memory-ref" }, { kind: "file", id: "workspace & one", path: "a&b.html", bytes: 1200 }, { kind: "project", id: "<untrusted>" },
  ] }));
  assert.match(html, /doesn&#x27;t check the quality/);
  assert.match(html, /Receipt details/);
  assert.match(html, /ws=workspace%20%26%20one&amp;file=a%26b.html&amp;open=1/);
  assert.match(html, /in a new tab/);
  assert.match(html, /Reference: &lt;untrusted&gt;/);
  assert.doesNotMatch(html, /undefined/);
  assert.equal(renderToStaticMarkup(createElement(Evidence, { items: [], openMemory() {} })), "");
});
