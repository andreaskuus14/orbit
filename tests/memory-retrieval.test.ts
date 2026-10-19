import { test } from "node:test";
import assert from "node:assert/strict";
import { selectCoreMemoryIds, memoryLimit, memoryProject, memoryProjectFilter, type MemoryMetadata } from "../src/lib/memory-retrieval-pure.ts";
import { retrieveMemories } from "../src/lib/memory-search.ts";
import { rrfMerge } from "../src/lib/pure.ts";
import { legacyMemoryIds } from "../evals/legacy-memory-pure.ts";
import { RETRIEVAL_CASES } from "../evals/memory-cases.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const project = (id: string, title: string): MemoryMetadata => ({ id, title, folder: "Nebula" });
test("council regression: ten project sprint notes cannot evict Roblox DataStore answers", () => {
  const primary = ["datastore", "cache"];
  const sprints = Array.from({ length: 10 }, (_, i) => project(`s${i}`, `Nebula sprint ${i}`));
  assert.deepEqual(selectCoreMemoryIds(primary, sprints, "Roblox DataStore", 8, "Nebula"), primary);
  assert.equal(selectCoreMemoryIds([], sprints, "What did we decide?", 8, "Nebula").length, 2);
});

test("semantic leaders and the original selected set survive every contextual selection", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `hit${i}`);
  const rows = ids.map((id) => project(id, "Nebula launch budget"));
  for (let limit = 0; limit <= 10; limit++) {
    const out = selectCoreMemoryIds(ids, rows, "launch budget", limit, "Nebula");
    assert.deepEqual(out.slice(0, Math.min(2, limit)), ids.slice(0, Math.min(2, limit)));
    assert.deepEqual(new Set(out), new Set(ids.slice(0, limit)), "no baseline hit is evicted");
  }
  assert.deepEqual(selectCoreMemoryIds(["sushi", "dog"], [project("dog", "Nebula buy dog food")], "Favourite food?", 8, "Nebula"), ["sushi", "dog"]);
});

test("only query-matching project metadata is promoted, with at most two promotions", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const rows = [project("f", "Nebula launch budget"), project("g", "Nebula launch budget"), project("h", "Nebula launch budget")];
  assert.deepEqual(selectCoreMemoryIds(ids, rows, "launch budget", 8, "Nebula"), ["a", "b", "f", "g", "c", "d", "e", "h"]);
  assert.deepEqual(selectCoreMemoryIds(ids, rows, "Roblox DataStore", 8, "Nebula"), ids);
  for (const query of ["not launch", "no budget", "without budget", "don't launch", "never launch", "everything except budget"]) assert.deepEqual(selectCoreMemoryIds(ids, rows, query, 8, "Nebula"), ids);
});

test("project-only additions fill at most two empty slots and never bypass metadata matching", () => {
  const rows = Array.from({ length: 10 }, (_, i) => project(`p${i}`, "Nebula budget"));
  assert.deepEqual(selectCoreMemoryIds(["first"], rows, "budget", 8, "Nebula"), ["first", "p0", "p1"]);
  assert.deepEqual(selectCoreMemoryIds([], [{ id: "wrong", title: "Budget", folder: "Comet" }], "budget", 8, "Nebula"), []);
  assert.deepEqual(selectCoreMemoryIds([], rows, "budget launch", 8, "Nebula"), []);
  assert.equal(memoryLimit(Infinity), 10);
  assert.equal(memoryLimit(-1), 0);
  assert.equal(memoryProject("  Planet\n Forge  "), "Planet Forge");
});

test("metadata filter quotes punctuation and escapes SQL wildcards", () => {
  assert.equal(memoryProjectFilter("Planet Forge"), 'title.ilike."%Planet Forge%",folder.ilike."Planet Forge",tags.cs.{"Planet Forge"},tags.cs.{"planet forge"}');
  const filter = memoryProjectFilter('A%,_"),user_id.neq.x');
  assert.equal(JSON.parse(filter.slice("title.ilike.".length, filter.indexOf(",folder.ilike."))), '%A\\%,\\_"),user\\_id.neq.x%');
});

type Row = MemoryMetadata & { content: string };
type Call = { columns: string; user?: string; query?: string; filter?: string; ids?: string[]; limit?: number; ordered?: boolean };
function fakeStore(opts: { fts: string[]; semantic?: string[]; project?: MemoryMetadata[]; rows: Row[]; projectError?: boolean; hydrateError?: boolean }) {
  const calls: Call[] = [];
  const client = {
    from() {
      const call: Call = { columns: "" }; calls.push(call);
      const builder = {
        select(columns: string) { call.columns = columns; return builder; },
        eq(_key: string, value: string) { call.user = value; return builder; },
        textSearch(_key: string, query: string) { call.query = query; return builder; },
        or(filter: string) { call.filter = filter; return builder; },
        order() { call.ordered = true; return builder; },
        limit(n: number) { call.limit = n; return builder; },
        in(_key: string, ids: string[]) { call.ids = ids; return builder; },
        then(resolve: (x: unknown) => unknown) {
          if (call.ids) return Promise.resolve({ data: opts.rows.filter((m) => call.ids!.includes(m.id)), error: opts.hydrateError ? new Error("hydrate failed") : null }).then(resolve);
          return Promise.resolve({ data: call.filter ? opts.project ?? [] : opts.fts.map((id) => ({ id })), error: call.filter && opts.projectError ? new Error("context failed") : null }).then(resolve);
        },
      }; return builder;
    },
    rpc() { return Promise.resolve({ data: (opts.semantic ?? []).map((id) => ({ id })), error: null }); },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test("query flow loads no more than the final eight bodies; project lookup is metadata only", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, title: "Note", content: "x".repeat(1000) }));
  const ctx = Array.from({ length: 25 }, (_, i) => project(`ctx${i}`, "Nebula sprint"));
  const { client, calls } = fakeStore({ rows, fts: rows.slice(0, 25).map((m) => m.id), semantic: rows.slice(25).map((m) => m.id), project: ctx });
  let embeds = 0;
  const out = await retrieveMemories(client, "Roblox DataStore", 8, "owner", async () => { embeds++; return [1]; }, { projectName: "Nebula" });
  assert.equal(out.results.length, 8);
  assert.equal(embeds, 1);
  assert.ok(calls.every((c) => c.user === "owner"));
  assert.equal(calls.find((c) => c.filter)?.columns, "id,title,tags,folder");
  assert.equal(calls.find((c) => c.query)?.ordered, undefined, "no new recency sort on ordinary FTS candidates");
  assert.equal(calls.find((c) => c.ids)?.ids?.length, 8);
});

test("default Memories and agent searches exactly match the frozen original ranking on every fixture", async () => {
  for (const c of RETRIEVAL_CASES) {
    const ids = [...new Set([...c.fts, ...c.semantic])];
    const rows = ids.map((id) => ({ id, title: id, content: "Fixture" }));
    const { client, calls } = fakeStore({ rows, fts: c.fts, semantic: c.semantic });
    const out = await retrieveMemories(client, c.query, 8, "owner", async () => c.semantic.length ? [1] : null);
    assert.deepEqual(out.results.map((m) => m.id), legacyMemoryIds(c.fts, c.semantic), c.id);
    assert.ok(!calls.some((call) => call.filter), "ordinary callers do not request project metadata");
    assert.deepEqual(rrfMerge([c.fts, c.semantic]).slice(0, 8).map((r) => r.id), legacyMemoryIds(c.fts, c.semantic));
  }
});

test("optional project errors fall back to baseline; hydration cannot return unauthorized missing ids", async () => {
  const opts = { fts: ["denied", "allowed"], rows: [{ id: "allowed", title: "Note", content: "Text" }], projectError: true };
  const { client } = fakeStore(opts);
  assert.deepEqual((await retrieveMemories(client, "question", 8, "owner", async () => null, { projectName: "Nebula" })).results.map((m) => m.id), ["allowed"]);
  await assert.rejects(retrieveMemories(fakeStore({ ...opts, hydrateError: true }).client, "question", 8, "owner", async () => null), /hydrate failed/);
});
