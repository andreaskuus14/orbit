// C01 guard: every memory read that pulls text (title/content) on the way to a model must filter with isCurrent/currentOnly
// (memory-types-pure.ts), so another chat's or project's scoped instruction, or a lapsed one, never reaches a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Owner-only views and non-model reads (each file is checked as a whole; add here only with a reason).
const OWNER_ONLY = new Set([
  "src/app/api/memories/route.ts", "src/app/api/memories/[id]/route.ts", "src/app/api/memories/[id]/file/route.ts", "src/app/api/memories/[id]/control/route.ts",
  "src/app/api/memories/map/route.ts", "src/app/api/memories/reembed/route.ts", // owner's library, map, re-embedding
  "src/app/api/arch/crit/route.ts", "src/app/api/arch/studio/route.ts", "src/lib/study.ts", // one memory the owner picked; owner's studio list
  "src/lib/chronicle.ts", "src/lib/memory-hygiene.ts", "src/lib/reflect.ts", // owner timeline; owner's dedupe suggestions; title dedupe
  "src/lib/memory-pack.ts", // filtered by packable() in memory-pack-pure.ts (currentOnly + project/chat/journal guard)
  "src/app/api/search/route.ts", // owner's own search (includeJournal: unfiltered by design)
]);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
const READ = /from\("memories"\)\s*\.select\(\s*(?:MEMORY_COLUMNS|"[^"]*\b(?:title|content)\b[^"]*")/;

test("C01: model-facing memory reads filter by current chat/project scope", () => {
  const bad = walk("src").map((f) => f.split(path.sep).join("/"))
    .filter((f) => !OWNER_ONLY.has(f) && READ.test(readFileSync(f, "utf8")) && !/\b(?:isCurrent|currentOnly|currentMemories)\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, [], `memory text read without isCurrent filter (or add to OWNER_ONLY with a reason): ${bad.join(", ")}`);
});
