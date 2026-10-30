import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as pure from "../src/lib/ideas-pure.ts";

const require = createRequire(import.meta.url), DAY = 86_400_000;
const compile = (file: string) => ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const code = compile("lib/ideas.ts");
function radar(options: { source?: string; advanceAfterCaptions?: boolean } = {}) {
  let now = Date.now();
  const raw = options.source ?? new Date(now - 2 * DAY).toISOString().slice(0, 10).replace(/-/g, "");
  const legacy = { id: "legacy", video: "other", videoTitle: "Old source", title: "Old idea", summary: "", next: "", area: "core", score: 99 };
  let saved: { ideas: any[] } = { ideas: [legacy] };
  const runs: string[][] = [], asks: any[] = [], writes: any[] = [];
  const m = { exports: {} as any };
  runInNewContext(code, { module: m, exports: m.exports, Date: class extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } },
    require: (name: string) => {
      if (name === "node:crypto" || name === "node:path" || name === "node:os") return require(name);
      if (name === "node:fs/promises") return { mkdtemp: async () => "/test-radar", rm: async () => {}, readdir: async () => ["cap.en.vtt"], readFile: async () => "WEBVTT\n" + "A useful new business idea for the owner. ".repeat(12) };
      if (name.endsWith("/ideas-pure")) return pure;
      if (name.endsWith("/claude")) return { askClaude: async (...args: any[]) => { asks.push(args); return { text: '[{"title":"New idea","area":"core","score":90}]' }; } };
      if (name.endsWith("/stop-all")) return { stopAllOn: () => false };
      if (name.endsWith("/stop-all-pure")) return {};
      if (name.endsWith("/usage-meter")) return { usageHold: () => null, usageHardHold: () => "", pastBudget: () => false };
      if (name.endsWith("/clips/pure")) return { ytdlpError: (s: string) => s };
      if (name.endsWith("/clips/factory")) return {
        studioRoot: () => "/test-store", readState: async () => saved, saveState: async (_kind: string, _path: string, data: any) => { writes.push(data); saved = data; },
        ytdlpPath: async () => "yt-dlp", runYtdlp: async (_yt: string, args: string[], _signal: any, onLine: any) => {
          runs.push(args);
          onLine("TITLE:Source title", true);
          if (args.includes("--simulate")) onLine(`SOURCE:${raw}`, true);
          else if (options.advanceAfterCaptions) now += 3 * DAY;
          return "";
        },
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { api: m.exports, runs, asks, writes, state: () => saved };
}

test("radar gates old and unknown sources before captions and CORE, preserving the saved board", async () => {
  const old = new Date(Date.now() - 31 * DAY).toISOString().slice(0, 10).replace(/-/g, "");
  for (const source of [old, "NA", "20260230"]) {
    const r = radar({ source });
    await assert.rejects(r.api.radar("https://youtu.be/abcdefghijk", new AbortController().signal), /skipped before CORE/);
    assert.equal(r.runs.length, 1); assert.ok(r.runs[0].includes("--simulate"));
    assert.equal(r.asks.length, 0); assert.equal(r.writes.length, 0);
    assert.equal((await r.api.listIdeas()).busy, null);
    assert.equal(r.state().ideas[0].id, "legacy");
  }
});

test("radar saves found/source dates from real metadata and keeps legacy ideas unchanged", async () => {
  const r = radar(), found = await r.api.radar("https://youtu.be/abcdefghijk", new AbortController().signal);
  assert.equal(r.runs.length, 2); assert.equal(r.asks.length, 1); assert.equal(r.writes.length, 1);
  assert.ok(r.runs[1].includes("--write-subs"));
  assert.equal(found[0].sourceAt, pure.sourceDate(new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10).replace(/-/g, "")));
  assert.ok(Math.abs(Date.parse(found[0].at) - Date.now()) < 10_000);
  assert.deepEqual(Array.from((await r.api.listIdeas()).shown, (i: any) => i.id), [found[0].id, "legacy"]);
  assert.equal(r.state().ideas[1].at, undefined);
});

test("radar rechecks the cutoff after a long transcript before calling CORE", async () => {
  const raw = new Date(Date.now() - 29 * DAY).toISOString().slice(0, 10).replace(/-/g, "");
  const r = radar({ source: raw, advanceAfterCaptions: true });
  await assert.rejects(r.api.radar("https://youtu.be/abcdefghijk", new AbortController().signal), /over 30 days/);
  assert.equal(r.runs.length, 2); assert.equal(r.asks.length, 0); assert.equal(r.writes.length, 0);
});

const NOW = Date.parse("2026-10-21T12:00:00Z");
function panel(hideStale: boolean) {
  const rows = [
    { id: "old", title: "Old strong idea", video: "abcdefghijk", videoTitle: "Old source", summary: "", next: "", area: "core" as const, score: 100, at: "2026-10-19T12:00:00Z", sourceAt: "2026-10-01T12:00:00Z" },
    { id: "fresh", title: "Fresh idea", video: "abcdefghijk", videoTitle: "Fresh source", summary: "", next: "", area: "core" as const, score: 80, at: "2026-10-19T12:00:00Z", sourceAt: "2026-10-16T12:00:00Z" },
    { id: "legacy", title: "Legacy idea", video: "abcdefghijk", videoTitle: "Unknown source", summary: "", next: "", area: "core" as const, score: 99 },
  ];
  const states = [{ shown: rows, hidden: 0, busy: null }, "", false, hideStale, null]; let index = 0;
  const m = { exports: {} as any };
  runInNewContext(compile("components/IdeasPanel.tsx"), { module: m, exports: m.exports, Date: class extends Date { static now() { return NOW; } },
    require: (name: string) => name === "react" ? { ...require("react"), useState: () => [states[index++], () => {}], useEffect() {}, useCallback: (f: any) => f }
      : name.endsWith("ideas-pure") ? pure : require(name),
  });
  return renderToStaticMarkup(createElement(m.exports.default, {}));
}

test("IdeasPanel hides stale by default, labels both dates, and shows grey stale rows last when toggled off", () => {
  const hidden = panel(true);
  assert.match(hidden, /type="checkbox" checked=""/); assert.match(hidden, /Hide stale/);
  assert.match(hidden, /found 2d ago · source 5d old/); assert.match(hidden, /2 stale ideas hidden/);
  assert.doesNotMatch(hidden, /Old strong idea|Legacy idea/);
  const shown = panel(false);
  assert.doesNotMatch(shown, /checked=""/); assert.match(shown, /opacity-50 grayscale/);
  assert.match(shown, /found unknown · source unknown · stale/);
  assert.ok(shown.indexOf("Fresh idea") < shown.indexOf("Old strong idea"));
  assert.ok(shown.indexOf("Old strong idea") < shown.indexOf("Legacy idea"));
});



