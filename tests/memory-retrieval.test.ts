import { test } from "node:test";
import assert from "node:assert/strict";
import { rerankMemories, matchesMemoryProject, memoryLimit, memoryProject, memoryProjectFilter, type MemoryCandidate } from "../src/lib/memory-retrieval-pure.ts";
import { retrieveMemories } from "../src/lib/memory-search.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const memory = (id: string, content: string, rest: Partial<MemoryCandidate> = {}): MemoryCandidate => ({ id, title: "Note", content, ...rest });

test("reranks before trimming: a precise answer below the old top eight reaches CORE", () => {
  const ms = Array.from({ length: 12 }, (_, i) => memory(`${i}`, "Deployment background"));
  ms.push(memory("answer", "Deploy to Helsinki using the staging cluster.", { title: "Staging cluster location" }));
  const ranked = rerankMemories(ms, "Where is the staging cluster?", ms.map((m) => m.id), 8, "", NOW);
  assert.equal(ranked[0].id, "answer");
  assert.equal(ranked.length, 8);
});

test("project metadata disambiguates a vague question without excluding another project's explicit answer", () => {
  const a = memory("a", "Launch on Friday", { title: "Budget", folder: "Nebula" });
  const b = memory("b", "Launch on Monday", { title: "Budget", tags: ["Planet Forge"] });
  assert.equal(rerankMemories([a, b], "What did we decide?", ["a"], 8, "Planet Forge", NOW)[0].id, "b");
  a.content = "Roblox deployment uses the production universe.";
  assert.equal(rerankMemories([a, b], "Roblox deployment production universe", ["a"], 8, "Planet Forge", NOW)[0].id, "a");
  assert.equal(matchesMemoryProject(b, "Planet Forge"), true);
  assert.equal(matchesMemoryProject(b, "Planet"), true);
  assert.equal(matchesMemoryProject(memory("c", "Planet Forge in the body only"), "Planet Forge"), false);
});

test("project hints don't promote off-topic context-only candidates", () => {
  const m = memory("body", "Nebula was mentioned in an unrelated transcript.");
  assert.deepEqual(rerankMemories([m], "staging region", [], 8, "Nebula", NOW), []);
});

test("small recency preference keeps old decisions available and never beats relevance", () => {
  const old = memory("old", "Cadence: daily", { title: "Upload cadence", updated_at: "2024-01-01" });
  const fresh = memory("new", "Cadence: weekly", { title: "Upload cadence", updated_at: "2026-10-19" });
  const unrelated = memory("other", "Dinner ideas", { updated_at: "2026-10-19" });
  const out = rerankMemories([old, fresh, unrelated], "upload cadence", ["old", "new", "other"], 8, "", NOW);
  assert.deepEqual(out.map((m) => m.id), ["new", "old", "other"]);
});

test("bounded, stable, unicode-aware; repetitions don't inflate lexical relevance", () => {
  const a = memory("a", "Eelarve on 4500 eurot.");
  const b = memory("b", "Eelarve ".repeat(1000));
  assert.equal(rerankMemories([b, a, a], "eelarve 4500", ["b", "a"], 8, "", NOW)[0].id, "a");
  assert.equal(rerankMemories([a, b], "zzzz", ["a", "b"], 1, "", NOW).length, 1);
  assert.deepEqual(rerankMemories([a], "", ["a"], 0), []);
  assert.equal(memoryLimit(Infinity), 10);
  assert.equal(memoryLimit(-1), 0);
  assert.equal(memoryLimit(1e6), 50);
  assert.equal(memoryProject("  Planet\n Forge  "), "Planet Forge");
  assert.equal(memoryProject("x".repeat(1000)).length, 80);
  const copy = structuredClone([a, b]);
  rerankMemories(copy, "test", ["a", "b"]);
  assert.deepEqual(copy, [a, b], "doesn't mutate memories");
});

test("metadata lookup escapes punctuation and wildcard characters in project names", () => {
  assert.equal(memoryProjectFilter("Planet Forge"), 'title.ilike."%Planet Forge%",folder.ilike."Planet Forge",tags.cs.{"Planet Forge"},tags.cs.{"planet forge"}');
  const filter = memoryProjectFilter('A%,_"),user_id.neq.x');
  const quoted = filter.slice("title.ilike.".length, filter.indexOf(",folder.ilike."));
  assert.equal(JSON.parse(quoted), '%A\\%,\\_"),user\\_id.neq.x%');
});

type Call = { columns: string; user?: string; query?: string; filter?: string; ids?: string[]; limit?: number };
function fakeStore(opts: { primary: string[]; project?: string[]; rows: MemoryCandidate[]; vectors?: string[]; projectError?: boolean; hydrateError?: boolean }) {
  const calls: Call[] = [];
  let lookups = 0;
  const client = {
    from() {
      const call: Call = { columns: "" }; calls.push(call);
      const builder = {
        select(columns: string) { call.columns = columns; return builder; },
        eq(_key: string, value: string) { call.user = value; return builder; },
        textSearch(_key: string, query: string) { call.query = query; return builder; },
        or(filter: string) { call.filter = filter; return builder; },
        order() { return builder; },
        limit(n: number) { call.limit = n; return builder; },
        in(_key: string, ids: string[]) { call.ids = ids; return builder; },
        then(resolve: (x: unknown) => unknown) {
          if (call.ids) return Promise.resolve({ data: opts.rows.filter((m) => call.ids!.includes(m.id)), error: opts.hydrateError ? new Error("hydrate failed") : null }).then(resolve);
          const project = lookups++ > 0;
          return Promise.resolve({ data: (project ? opts.project ?? [] : opts.primary).map((id) => ({ id })), error: project && opts.projectError ? new Error("context failed") : null }).then(resolve);
        },
      };
      return builder;
    },
    rpc() { return Promise.resolve({ data: (opts.vectors ?? []).map((id) => ({ id })), error: null }); },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test("query flow adds project candidates, embeds once, and owner-filters every DB read", async () => {
  const rows = [memory("general", "Unrelated"), memory("project", "Launch Monday", { folder: "Planet Forge" })];
  const { client, calls } = fakeStore({ rows, primary: ["general"], project: ["project"] });
  const embedded: string[] = [];
  const out = await retrieveMemories(client, "What did we decide?", 8, "owner", async (q) => { embedded.push(q); return null; }, { projectName: "Planet Forge" });
  assert.equal(out.results[0].id, "project");
  assert.equal(out.mode, "fulltext");
  assert.deepEqual(embedded, ["What did we decide?"]);
  assert.ok(calls.every((c) => c.user === "owner"), "admin-client lookups and hydration must filter ownership");
  assert.equal(calls.filter((c) => c.query).length, 1);
  assert.equal(calls.filter((c) => c.filter).length, 1, "folder/tag-only notes can enter the project pool even though FTS doesn't index metadata");
  assert.ok(calls.filter((c) => c.query || c.filter).every((c) => c.limit === 25));
});

test("semantic-only results survive; ids denied at hydration cannot reach the answer", async () => {
  const { client, calls } = fakeStore({ primary: [], vectors: ["denied", "semantic"], rows: [memory("semantic", "A synonym, no lexical overlap")] });
  const out = await retrieveMemories(client, "zzzz", 8, "owner", async () => [1]);
  assert.deepEqual(out.results.map((m) => m.id), ["semantic"]);
  assert.equal(out.mode, "hybrid");
  assert.equal(calls.length, 2, "no project lookup for an unfiled chat");
});

test("a failed optional project lookup degrades gracefully; hydration failures stay visible", async () => {
  const opts = { primary: ["a"], rows: [memory("a", "budget")], projectError: true };
  const a = fakeStore(opts);
  assert.equal((await retrieveMemories(a.client, "budget", 8, "owner", async () => null, { projectName: "Nebula" })).results.length, 1);
  const b = fakeStore({ ...opts, hydrateError: true });
  await assert.rejects(retrieveMemories(b.client, "budget", 8, "owner", async () => null), /hydrate failed/);
});
