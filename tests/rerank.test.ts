import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkText, meanVector, CHUNK_AT, CHUNK_SIZE } from "../src/lib/embeddings-pure.ts";
import { applyRerank, rerankDoc, rerankable, rerankPrompt, yesProbability, RERANK_DOC_CHARS } from "../src/lib/rerank-pure.ts";
import { retrieveMemories } from "../src/lib/memory-search.ts";

test("short text is one chunk; long text is split on paragraphs, loses nothing and respects the size", () => {
  assert.deepEqual(chunkText("a".repeat(CHUNK_AT)), ["a".repeat(CHUNK_AT)]);
  const para = (i: number) => `Paragraph ${i}. ` + "word ".repeat(300);
  const text = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
  const chunks = chunkText(text);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.length <= CHUNK_SIZE));
  assert.ok(chunks.join(" ").replace(/\s+/g, " ") === text.replace(/\s+/g, " ").trim(), "lossless");
  assert.ok(chunks.slice(1).every((c) => /^Paragraph \d+\./.test(c)), "cuts land on paragraph boundaries");
  assert.equal(chunkText("x".repeat(500_000)).length, 12, "capped");
});

test("meanVector is unit length, and a fact in only one chunk still moves the document toward it", () => {
  const a = [1, 0, 0], b = [0, 1, 0];
  const m = meanVector([a, a, b])!;
  assert.ok(Math.abs(Math.hypot(...m) - 1) < 1e-9);
  assert.ok(m[1] > 0, "tail chunk contributes");
  assert.equal(meanVector([[1, 2], [1]]), null);
  assert.equal(meanVector([]), null);
});

test("applyRerank reorders scored ids in their own slots and leaves unscored ids where they were", () => {
  const scores = new Map([["a", 0.1], ["c", 0.9], ["d", 0.5]]);
  assert.deepEqual(applyRerank(["a", "journal", "c", "d", "tail"], scores), ["c", "journal", "d", "a", "tail"]);
  assert.deepEqual(applyRerank(["a", "b"], new Map()), ["a", "b"]);
  assert.deepEqual(applyRerank(["a", "b", "c"], new Map([["a", 0.5], ["b", 0.5], ["c", 0.5]])), ["a", "b", "c"], "stable on ties");
  assert.deepEqual(applyRerank(["a", "b"], new Map([["a", NaN], ["b", 0.2]])), ["a", "b"]);
});

test("reranker input: journal is never rerankable, docs are capped, prompt and probability are well formed", () => {
  assert.equal(rerankable({ id: "1", kind: "journal" }), false);
  assert.equal(rerankable({ id: "1", kind: "note" }), true);
  assert.equal(rerankDoc({ id: "1", title: "T", content: "x".repeat(5000) }).length, RERANK_DOC_CHARS);
  assert.ok(rerankPrompt("q?", "doc").includes("<Query>: q?"));
  assert.ok(yesProbability(5, -5) > 0.99 && yesProbability(-5, 5) < 0.01 && Math.abs(yesProbability(1, 1) - 0.5) < 1e-9);
});

type Row = { id: string; kind?: string; title: string; content: string };
function store(rows: Row[], fts: string[]) {
  const client = {
    from() {
      const c: { ids?: string[]; notKind?: string } = {};
      const b = {
        select() { return b; }, eq() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; },
        neq(_k: string, v: string) { c.notKind = v; return b; }, textSearch() { return b; },
        in(_k: string, ids: string[]) { c.ids = ids; return b; },
        then(res: (x: unknown) => unknown) {
          const data = c.ids ? rows.filter((r) => c.ids!.includes(r.id) && r.kind !== c.notKind) : fts.map((id) => ({ id }));
          return Promise.resolve({ data, error: null }).then(res);
        },
      }; return b;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  };
  return client as unknown as SupabaseClient;
}

test("memory search: reranker promotes the right note, never sees journal text, and failure keeps hybrid order", async () => {
  const rows: Row[] = [
    { id: "a", kind: "note", title: "Pet sim ideas", content: "colors" },
    { id: "diary", kind: "journal", title: "Day", content: "PRIVATE DIARY" },
    { id: "b", kind: "note", title: "DataStore decision", content: "use a write queue" },
  ];
  const seen: string[] = [];
  const rerank = async (_q: string, docs: string[]) => { seen.push(...docs); return docs.map((d) => d.includes("write queue") ? 0.95 : 0.05); };
  const base = await retrieveMemories(store(rows, ["a", "diary", "b"]), "datastore decision", 8, "u", async () => null, { includeJournal: true });
  assert.deepEqual(base.results.map((m) => m.id), ["a", "diary", "b"]);
  const out = await retrieveMemories(store(rows, ["a", "diary", "b"]), "datastore decision", 8, "u", async () => null, { includeJournal: true, rerank });
  assert.deepEqual(out.results.map((m) => m.id), ["b", "diary", "a"], "journal keeps its slot");
  assert.ok(seen.length === 2 && !seen.some((d) => d.includes("PRIVATE")), "journal text never reaches the reranker");
  for (const failing of [async () => null, async () => { throw new Error("boom"); }]) {
    const f = await retrieveMemories(store(rows, ["a", "diary", "b"]), "datastore decision", 8, "u", async () => null, { includeJournal: true, rerank: failing });
    assert.deepEqual(f.results.map((m) => m.id), ["a", "diary", "b"]);
  }
});
