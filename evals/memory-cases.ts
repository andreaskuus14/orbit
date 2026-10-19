import type { MemoryCandidate } from "../src/lib/memory-retrieval-pure.ts";
export type RetrievalCase = { id: string; query: string; project?: string; primary: MemoryCandidate[]; context?: MemoryCandidate[]; relevant: string[] };
const m = (id: string, title: string, content: string, rest: Partial<MemoryCandidate> = {}): MemoryCandidate => ({ id, title, content, ...rest });
const nebula = m("nebula", "Nebula launch", "Launch Monday.", { folder: "Nebula" });
const comet = m("comet", "Comet launch", "Launch Friday.", { tags: ["Comet"] });
const noise = m("noise", "General planning", "Discuss the project later.");
const old = m("old", "Upload cadence", "Daily uploads.", { updated_at: "2024-01-01" });
const fresh = m("fresh", "Upload cadence", "Weekly uploads.", { updated_at: "2026-10-19" });
const precise = m("precise", "Staging cluster region", "The staging cluster is in Helsinki.");
export const RETRIEVAL_CASES: RetrievalCase[] = [
  { id: "project-vague", query: "What did we decide?", project: "Nebula", primary: [comet, noise], context: [nebula], relevant: ["nebula"] },
  { id: "project-launch", query: "launch", project: "Nebula", primary: [comet, nebula], relevant: ["nebula"] },
  { id: "project-tags", query: "launch", project: "Comet", primary: [nebula, comet], relevant: ["comet"] },
  { id: "project-explicit-override", query: "Comet launch Friday", project: "Nebula", primary: [nebula, comet], relevant: ["comet"] },
  { id: "project-context-only", query: "What did we decide?", project: "Nebula", primary: [], context: [nebula], relevant: ["nebula"] },
  { id: "project-missing", query: "staging cluster", project: "Missing", primary: [noise, precise], relevant: ["precise"] },
  { id: "exact-title", query: "staging cluster region", primary: [noise, precise], relevant: ["precise"] },
  { id: "below-eight", query: "staging cluster region", primary: [...Array.from({ length: 9 }, (_, i) => m(`n${i}`, "Deployment", "General infrastructure.")), precise], relevant: ["precise"] },
  { id: "partial-versus-full", query: "staging cluster Helsinki", primary: [m("partial", "Staging", "Deployment."), precise], relevant: ["precise"] },
  { id: "body-match", query: "cobalt deployment", primary: [noise, m("body", "Technical note", "The cobalt deployment needs review.")], relevant: ["body"] },
  { id: "tags-match", query: "cobalt", primary: [noise, m("tag", "Technical note", "Deployment.", { tags: ["cobalt"] })], relevant: ["tag"] },
  { id: "folder-match", query: "cobalt", primary: [noise, m("folder", "Technical note", "Deployment.", { folder: "cobalt" })], relevant: ["folder"] },
  { id: "recent-equivalent", query: "upload cadence", primary: [old, fresh], relevant: ["fresh"] },
  { id: "relevance-before-recency", query: "staging cluster", primary: [m("new-noise", "Lunch", "Today's menu.", { updated_at: "2026-10-19" }), precise], relevant: ["precise"] },
  { id: "old-specific-question", query: "daily uploads", primary: [fresh, old], relevant: ["old"] },
  { id: "invalid-date", query: "staging cluster", primary: [m("bad-date", "Lunch", "Menu", { updated_at: "not-a-date" }), precise], relevant: ["precise"] },
  { id: "unicode-estonian", query: "eelarve 4500", primary: [noise, m("ee", "Eelarve", "Eelarve on 4500 eurot.")], relevant: ["ee"] },
  { id: "unicode-japanese", query: "予算", primary: [noise, m("jp", "予算", "4500 円")], relevant: ["jp"] },
  { id: "number-disambiguation", query: "budget 4500", primary: [m("wrong", "Budget", "2000 euros"), m("right", "Budget", "4500 euros")], relevant: ["right"] },
  { id: "repetition", query: "budget 4500", primary: [m("spam", "Budget", "budget ".repeat(100)), m("right", "Budget", "4500 euros")], relevant: ["right"] },
  { id: "semantic-no-overlap", query: "zzzz", primary: [m("semantic", "Synonym", "No lexical overlap.")], relevant: ["semantic"] },
  { id: "no-candidates", query: "unknown", primary: [], relevant: [] },
  { id: "deduplicate", query: "staging cluster", primary: [precise, precise, noise], relevant: ["precise"] },
  { id: "long-note-end", query: "staging cluster Helsinki", primary: [noise, m("long", "Operations", `${"General background. ".repeat(1100)}\n## Deployment\nThe staging cluster is in Helsinki.`)], relevant: ["long"] },
];
