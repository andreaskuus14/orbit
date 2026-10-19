import type { MemoryMetadata } from "../src/lib/memory-retrieval-pure.ts";
export type RetrievalCase = { id: string; query: string; project?: string; fts: string[]; semantic: string[]; context?: MemoryMetadata[]; relevant: string[] };
const note = (id: string, title: string, folder = "Nebula"): MemoryMetadata => ({ id, title, folder });
const sprints = Array.from({ length: 10 }, (_, i) => note(`sprint${i}`, `Nebula sprint ${i}`));
const eight = Array.from({ length: 8 }, (_, i) => `hit${i}`);
export const RETRIEVAL_CASES: RetrievalCase[] = [
  { id: "review-project-crowding", query: "Roblox DataStore", project: "Nebula", fts: ["datastore", "cache"], semantic: ["datastore", "cache"], context: sprints, relevant: ["datastore", "cache"] },
  { id: "review-food-semantics", query: "Favourite food?", project: "Nebula", fts: ["dog", "sushi"], semantic: ["sushi", "meal", "dog"], context: [note("dog", "Nebula buy dog food")], relevant: ["sushi"] },
  { id: "negation", query: "not Roblox", project: "Nebula", fts: ["other", "roblox"], semantic: ["other"], context: [note("roblox", "Nebula Roblox")], relevant: ["other"] },
  { id: "no-negation", query: "no uploads", project: "Nebula", fts: ["paused"], semantic: [], context: [note("upload", "Nebula uploads")], relevant: ["paused"] },
  { id: "vague-supplement", query: "What did we decide?", project: "Nebula", fts: ["general"], semantic: [], context: sprints, relevant: ["sprint0"] },
  { id: "context-only", query: "What did we decide?", project: "Nebula", fts: [], semantic: [], context: sprints, relevant: ["sprint0"] },
  { id: "specific-supplement", query: "launch budget", project: "Nebula", fts: [], semantic: [], context: [note("budget", "Nebula launch budget")], relevant: ["budget"] },
  { id: "reject-partial-overlap", query: "Roblox DataStore", project: "Nebula", fts: [], semantic: [], context: [note("wrong", "Nebula Roblox sprint")], relevant: [] },
  { id: "full-pool-no-eviction", query: "Roblox DataStore", project: "Nebula", fts: eight, semantic: eight, context: [note("project", "Nebula Roblox DataStore")], relevant: ["hit7"] },
  { id: "bounded-tail-promotion", query: "launch budget", project: "Nebula", fts: eight, semantic: eight, context: [note("hit6", "Nebula launch budget")], relevant: ["hit6"] },
  { id: "protect-first-two", query: "launch budget", project: "Nebula", fts: eight, semantic: eight, context: [note("hit6", "Nebula launch budget")], relevant: ["hit0", "hit1"] },
  { id: "off-topic-tail", query: "Roblox DataStore", project: "Nebula", fts: eight, semantic: eight, context: [note("hit6", "Nebula sprint")], relevant: ["hit2"] },
  { id: "explicit-other-project", query: "Comet launch", project: "Nebula", fts: ["comet"], semantic: ["comet"], context: [note("nebula", "Nebula launch")], relevant: ["comet"] },
  { id: "unfiled-semantic", query: "favourite food", fts: ["dog", "sushi"], semantic: ["sushi", "meal", "dog"], relevant: ["sushi"] },
  { id: "old-semantic-hit", query: "hosting", fts: ["new", "old"], semantic: ["old", "other", "new"], relevant: ["old"] },
  { id: "semantic-only", query: "quiet getaway", fts: [], semantic: ["cabin"], relevant: ["cabin"] },
  { id: "keyword-only", query: "4500", fts: ["budget"], semantic: [], relevant: ["budget"] },
  { id: "no-candidates", query: "unknown", fts: [], semantic: [], relevant: [] },
  { id: "tag-supplement", query: "budget", project: "Nebula", fts: [], semantic: [], context: [{ id: "tag", title: "Budget", tags: ["nebula"] }], relevant: ["tag"] },
  { id: "folder-supplement", query: "budget", project: "Nebula", fts: [], semantic: [], context: [note("folder", "Budget")], relevant: ["folder"] },
  { id: "unicode", query: "eelarve 4500", project: "Nebula", fts: [], semantic: [], context: [note("ee", "Eelarve 4500")], relevant: ["ee"] },
  { id: "repetition-does-not-rerank", query: "budget 4500", fts: ["repeat", "precise"], semantic: ["precise", "other", "repeat"], relevant: ["precise"] },
  { id: "known-cutoff-limitation", query: "staging cluster", fts: [...eight, "answer"], semantic: [], relevant: ["answer"] },
  { id: "unknown-project-metadata", query: "budget", project: "Nebula", fts: ["real"], semantic: [], context: [note("wrong", "Budget", "Comet")], relevant: ["real"] },
];
