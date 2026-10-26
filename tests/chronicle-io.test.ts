import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/chronicle.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test("titleMonth: two requests at once for the same month make one model call", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "orbit-chron-"));
  let calls = 0;
  const m = { exports: {} as any };
  const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, then: (ok: (v: unknown) => unknown) => ok({ data: [] }) };
  const sb = { from: () => q };
  const g: Record<string, unknown> = { module: m, exports: m.exports, console, Date,
    require: (name: string) => {
      if (name === "node:fs/promises") return fsp;
      if (name === "node:path") return { default: path };
      if (name.endsWith("ledger-pure")) return { fromRows: () => [] };
      if (name.endsWith("/claude")) return { askClaude: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { text: "{}" }; }, recordUsage: async () => {}, FAST_MODEL: "f" };
      if (name.endsWith("/data-dir")) return { orbitDataDir: () => dir };
      if (name.endsWith("usage-meter")) return { usageHold: () => null };
      if (name.endsWith("/stop-all")) return { stopAllOn: () => false };
      if (name.endsWith("chronicle-pure")) return { ARC_SYSTEM: "", arcPrompt: () => "", buildChronicle: () => ({}), monthArcs: () => [], parseArcTitles: () => ({}), titleableMonths: () => ["2026-09"] };
      if (name.endsWith("/goals")) return { listGoals: async () => [] };
      if (name.endsWith("/factory")) return { listJobs: async () => [] };
      if (name.endsWith("dev-session")) return { listDevSessions: async () => [] };
      throw new Error(name);
    },
  };
  runInNewContext(code, g);
  await Promise.all([m.exports.titleMonth(sb, "u", "2026-09"), m.exports.titleMonth(sb, "u", "2026-09")]);
  assert.equal(calls, 1);
  await m.exports.titleMonth(sb, "u", "2026-09"); // and never again once titled
  assert.equal(calls, 1);
});
