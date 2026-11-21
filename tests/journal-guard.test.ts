// Journal / LIFE guard (AGENTS.md rule 6): the owner's journal never reaches any model (Claude, Haiku, local Ollama, the
// reranker, the hosted embedder): not content, not titles. One shared guard (src/lib/private-pure.ts) plus a repo-wide scan
// of every memories read, in the style of the LIF07 test in life-planning.test.ts and tests/local-llm.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { dropPrivate, isPrivate, isPrivateKind, memoryEventPayload, privateMemoryEvent, PRIVATE_KIND_LIST } from "../src/lib/private-pure.ts";
import { provider } from "../src/lib/embeddings-pure.ts";
import { rerankable } from "../src/lib/rerank-pure.ts";
import { studyable } from "../src/lib/study-pure.ts";
import { buildFacts } from "../src/lib/court-pure.ts";
import { usable } from "../src/lib/entity-graph-pure.ts";
import { isPrivate as packPrivate } from "../src/lib/memory-pack-pure.ts";
import { classifyItem, isPrivateText, planMemo } from "../src/lib/memos-pure.ts";

const SECRET = "journal-secret-9c2e";
const j = { id: "j", kind: "journal", title: SECRET, content: SECRET, tags: [] as string[] };
const tagged = { id: "t", kind: "note", title: SECRET, content: SECRET, tags: ["journal"] };
const ok = { id: "n", kind: "note", title: "Pet sim plan", content: "Plan", tags: ["gamedev"] };

test("JG01: one guard: journal kind, journal/LIFE tags and a missing row are private", () => {
  for (const r of [j, tagged, { kind: "Journal" }, { kind: "note", tags: ["life:habits"] }, { kind: "diary" }, null, undefined]) assert.equal(isPrivate(r), true, JSON.stringify(r));
  for (const r of [ok, { kind: "conversation", tags: ["chat"] }, { kind: "decision" }, { kind: "note", tags: ["lifestyle"] }]) assert.equal(isPrivate(r), false, JSON.stringify(r));
  assert.deepEqual(dropPrivate([j, ok, tagged]).map((r) => r.id), ["n"]);
  assert.deepEqual(dropPrivate(null), []);
  assert.ok(isPrivateKind("journal") && !isPrivateKind("note"));
  assert.match(PRIVATE_KIND_LIST, /^\(journal,/);
  assert.equal(packPrivate, isPrivate, "memory packs use the same guard");
});

test("JG02: every in-memory model filter uses the shared guard", () => {
  assert.equal(rerankable(tagged), false, "the local reranker never scores a journal-tagged row");
  assert.equal(studyable(tagged), false);
  assert.deepEqual(usable([j as never, tagged as never, ok as never]).map((m: { id: string }) => m.id), ["n"]);
  const facts = buildFacts({ memories: [j, tagged, ok] });
  assert.ok(!JSON.stringify(facts).includes(SECRET), "court facts never carry journal text");
});

test("JG03: embedding: a private row (kind or tag) is always embedded locally, never by Voyage", () => {
  const env = { VOYAGE_API_KEY: "k" };
  assert.equal(provider(env, "journal"), "local");
  assert.equal(provider(env, { kind: "note", tags: ["journal"] }), "local");
  assert.equal(provider(env, { kind: "journal" }), "local");
  assert.equal(provider({ ORBIT_EMBED: "voyage", VOYAGE_API_KEY: "k" }, { kind: "note", tags: ["life:x"] }), "local");
  assert.equal(provider(env, ok), "voyage");
  assert.equal(provider(env), "voyage");
});

test("JG04: a journal memory's title never enters the events table, and its event never starts an automation or rule", () => {
  const priv = memoryEventPayload({ id: "j", title: SECRET, kind: "journal", source: "capture" }, 0);
  assert.ok(!JSON.stringify(priv).includes(SECRET));
  assert.equal(privateMemoryEvent(priv), true);
  assert.equal(privateMemoryEvent({ kind: "journal", title: SECRET } as never), true, "older events that still carry a title");
  const pub = memoryEventPayload({ id: "n", title: "Pet sim plan", kind: "note", source: "capture" }, 1);
  assert.equal((pub as { title?: string }).title, "Pet sim plan");
  assert.equal(privateMemoryEvent(pub), false);
});

test("JG05: voice memos: private text is always a rule-sure local journal item, never a model call", () => {
  const text = "Dear diary, I feel so anxious today";
  assert.ok(isPrivateText(text));
  const c = classifyItem(text);
  assert.equal(c.kind, "journal"); assert.equal(c.sure, true);
  const p = planMemo(text);
  assert.equal(p.legacy, false, "the legacy path (which may ask the model) never sees private text");
  assert.ok(p.items.every((i) => i.by === "local" && i.sure));
});

// ── repo-wide scan ────────────────────────────────────────────────────────────────────────────────────────────────────
const src = path.join(import.meta.dirname, "../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
const files = walk(src).map((f) => ({ rel: path.relative(src, f).split(path.sep).join("/"), code: readFileSync(f, "utf8") }));
const MODEL = /\b(askClaude|askClaudeStream|chatLocal|reviewDraft|rerankScores|callModel|generateText|streamText)\b/;
const GUARD = /\b(isPrivate|dropPrivate|packable|studyable|rerankable|privateMemoryEvent)\b/;
const PRIV = /journal|life|diary|health|mood/;
// Reads that return title/content without a kind filter in the statement itself. Each is either owner-only (the file never
// calls a model) or guarded in code right after the read (the file must use the shared guard).
const OWNER_ONLY: Record<string, string> = {
  "app/api/memories/route.ts": "MEMORY panel list (his own view)",
  "app/api/memories/[id]/route.ts": "one memory for the MEMORY panel; re-embed passes kind+tags",
  "app/api/memories/[id]/control/route.ts": "MEMORY controls; re-embed passes the row",
  "app/api/memories/map/route.ts": "MEMORY map (his own view)",
  "app/api/memories/reembed/route.ts": "re-embed passes the row: private rows stay on the local model",
  "lib/memory-hygiene.ts": "hygiene proposals: rules only, no model",
  "lib/life-journal.ts": "LIFE → Journal: opens encrypted journal rows for the owner only, no model",
  "lib/doctor.ts": "journal encryption check: counts plain-text rows, returns no text",
};
const GUARDED = ["app/api/arch/crit/route.ts", "lib/chronicle.ts", "lib/memory.ts", "lib/memory-pack.ts", "lib/memory-search.ts", "lib/memory-types.ts", "lib/people.ts", "lib/study.ts"];

function unguardedReads(code: string): string[] {
  const out: string[] = [];
  for (let i = code.indexOf('from("memories")'); i >= 0; i = code.indexOf('from("memories")', i + 1)) {
    let seg = code.slice(i, i + 900);
    const end = seg.search(/;\s*$|;\n|\)\),?\n|\n\s*\n/m);
    if (end > 0) seg = seg.slice(0, end);
    if (/^from\("memories"\)\s*\.(insert|update|delete|upsert)\(/.test(seg)) continue;
    const eqKind = seg.match(/\.eq\("kind", "([a-z-]+)"\)/)?.[1], inKind = seg.match(/\.in\("kind", \[([^\]]*)\]\)/)?.[1];
    const filtered = /\.neq\("kind", "journal"\)|\.not\("kind", "in", "\([^)]*journal|PRIVATE_KIND_LIST|head: true/.test(seg)
      || (eqKind !== undefined && !PRIV.test(eqKind)) || (inKind !== undefined && !PRIV.test(inKind));
    const cols = seg.match(/\.select\("([^"]*)"/)?.[1];
    const metaOnly = cols !== undefined && !/\b(title|content|\*)\b/.test(cols);
    if (!filtered && !metaOnly) out.push(seg.replace(/\s+/g, " ").slice(0, 120));
  }
  return out;
}

test("JG06: every memories read that returns titles or content is journal-filtered, owner-only, or guarded in code", () => {
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    const bad = unguardedReads(code);
    if (!bad.length) continue;
    if (rel in OWNER_ONLY) { if (MODEL.test(code)) offenders.push(`${rel}: owner-only read in a file that calls a model`); }
    else if (GUARDED.includes(rel)) { if (!GUARD.test(code)) offenders.push(`${rel}: must use the private-pure guard`); }
    else offenders.push(...bad.map((b) => `${rel}: ${b}`));
  }
  assert.deepEqual(offenders, [], "add .neq(\"kind\", \"journal\") / dropPrivate, or justify the file in OWNER_ONLY");
});

test("JG07: model-calling modules that read memories also use the shared guard", () => {
  const offenders = files.filter(({ code }) => MODEL.test(code) && /from\("memories"\)\.select\([^)]*\b(title|content|MEMORY_COLUMNS)\b/.test(code) && !GUARD.test(code))
    .map((f) => f.rel)
    // these read only memories whose kind or tags exclude journal at the query and never pass rows on unfiltered
    .filter((r) => !["lib/call.ts", "lib/episodes.ts", "lib/morning.ts", "lib/goal-autopilot.ts", "lib/future.ts", "lib/chronicle.ts"].includes(r));
  assert.deepEqual(offenders, []);
});

test("JG08: every document embedding says what it embeds, so private rows can stay local", () => {
  const offenders: string[] = [];
  for (const { rel, code } of files) {
    if (rel === "lib/embeddings.ts") continue;
    for (const m of code.matchAll(/\bembed\(([^;\n]*?)"document"\s*\)/g)) offenders.push(`${rel}: ${m[0].slice(0, 80)}`);
  }
  assert.deepEqual(offenders, []);
});

test("JG09: the known leak sites stay closed", () => {
  const read = (f: string) => readFileSync(path.join(src, f), "utf8");
  assert.match(read("lib/reflect.ts"), /select\("title, kind, tags"\)\.eq\("user_id", userId\)\.neq\("kind", "journal"\)[^\n]*\n\s*return dropPrivate\(data\)/, "reflection KNOWN MEMORIES titles");
  assert.match(read("lib/memory.ts"), /return dropPrivate\(\(data \?\? \[\]\)/, "findSimilar never returns a journal title to CORE");
  assert.match(read("lib/memory.ts"), /"memory\.created", "memory", memoryEventPayload\(/, "no journal title in events");
  assert.match(read("lib/automations.ts"), /privateMemoryEvent\(p\)/);
  assert.match(read("lib/rules.ts"), /!privateMemoryEvent\(p\)/);
  assert.match(read("lib/people.ts"), /memoryTouches\(sb, userId, p\.name, 1, true\)[^\n]*\n\s*return peopleBlock/, "CORE's people block skips journal touches");
  assert.match(read("lib/memos.ts"), /if \(r\.sure \|\| isPrivateText\(text\)/);
  assert.match(read("lib/memos.ts"), /parts\.some\(isPrivateText\)/);
  assert.match(read("lib/memory-search.ts"), /options\.includeJournal \|\| \(!isPrivate\(m\)/);
});
