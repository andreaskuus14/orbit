// Test fixtures (tests/fixtures/*, e.g. earth-ground-tallinn.json) must never ship in the app bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir: string, ext: RegExp, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
};

// import x from "…", import("…"), require("…"), export … from "…"
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'`]([^"'`]+)["'`]/gm;

test("no app source imports from tests/ or a fixtures folder", () => {
  const bad: string[] = [];
  for (const f of walk("src", /\.(ts|tsx|js|jsx|mjs)$/)) {
    for (const m of readFileSync(f, "utf8").matchAll(SPEC)) {
      if (/(^|\/)(tests|fixtures)(\/|$)/.test(m[1])) bad.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("built client files hold no fixture data (skipped without a build)", (t) => {
  if (!existsSync(".next/static")) return t.skip("no .next build");
  // Each JSON fixture with a "note" carries a unique sentence; none may appear in a shipped chunk.
  const notes = walk("tests/fixtures", /\.json$/)
    .map((f) => { try { const j = JSON.parse(readFileSync(f, "utf8")); return typeof j?.note === "string" && j.note.length > 30 ? j.note.slice(0, 60) : null; } catch { return null; } })
    .filter((n): n is string => !!n);
  const hits: string[] = [];
  for (const f of walk(".next/static", /\.js$/)) {
    const s = readFileSync(f, "utf8");
    for (const n of notes) if (s.includes(n)) hits.push(`${f}: ${n}`);
  }
  assert.deepEqual(hits, []);
});
