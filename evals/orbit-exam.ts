// Public, synthetic nightly CORE requests. LIFE cases are intentionally local-only and never enter CORE/model prompts.
import type { EvalTask } from "../src/lib/eval-core-pure.ts";

type Seed = { planet: string; input: string; good: string; tool?: string; file?: string; localOnly?: boolean; contains?: string[] };
const seeds: Seed[] = [
  ...["What is 6 times 7?", "What is 8 times 9?", "How many sides does a hexagon have?", "What is the capital of Estonia?", "What is 15 percent of 200?", "Convert 2 hours to minutes.", "What is 144 divided by 12?", "Name the primary colors of light.", "How many days are in a leap year?", "What is the opposite of north?"]
    .map((input, i) => ({ planet: "CORE", input, good: "Answer directly and accurately without an unnecessary tool call.", contains: ["42", "72", "6", "Tallinn", "30", "120", "12", "red", "366", "south"][i].split("|") })),
  ...["clips", "pictures", "music", "video", "3D", "approved clips", "render jobs", "drafts", "the next upload", "recent activity"]
    .map((x) => ({ planet: "STUDIO", input: `Check the current ${x} status and tell me what is waiting.`, good: "Call studio_status and report only the returned status; do not generate, schedule, or publish.", tool: "studio_status" })),
  ...["leads", "follow-ups", "clients", "open opportunities", "recent businesses", "pipeline stages", "the contact list", "the current pipeline", "business activity", "items needing follow-up"]
    .map((x) => ({ planet: "BUSINESS", input: `Give me a brief current BUSINESS update on ${x}.`, good: "Call business_status and summarize its returned counts or rows without drafting or sending outreach.", tool: "business_status" })),
  ...["the newest exported project", "the current Roblox scripts", "the latest Selene findings", "lint issues by file", "whether the lint tool is available", "the exported game project", "the Roblox build files", "the current script warnings", "the latest read-only lint report", "what needs fixing in the exported scripts"]
    .map((x) => ({ planet: "GAME DEV", input: `Check ${x} without changing or syncing any project files.`, good: "Call roblox_lint (read-only), cite any findings by file and line, and do not export, sync, or publish.", tool: "roblox_lint" })),
  ...["a small library", "a two-room cabin", "a simple office", "a garden shed", "a one-storey workshop", "a compact studio", "a small classroom", "a single-storey shop", "a two-bedroom home", "a simple pavilion"]
    .map((x) => ({ planet: "ARCH", input: `Ask Atlas for a concept checklist for designing ${x}; use generic assumptions and do not create or export files.`, good: "Call ask_agent for Atlas with the design brief; report the proposed checklist and do not claim an IFC file was made.", tool: "ask_agent" })),
  ...["exam-fixture-alpha", "exam-fixture-beta", "exam-fixture-gamma", "exam-fixture-delta", "exam-fixture-epsilon", "exam-fixture-zeta", "exam-fixture-eta", "exam-fixture-theta", "exam-fixture-iota", "exam-fixture-kappa"]
    .map((x) => ({ planet: "VAULT", input: `Search VAULT for the exact filename ${x}.md and tell me whether it exists.`, good: "Call vault_search with the exact synthetic filename; report found or not found without moving, renaming, or uploading anything.", tool: "vault_search" })),
  ...["comet launch is Monday", "demo theme is blue", "sample project uses TypeScript", "test workspace is called Orbit Lab", "fictional character is named Mira", "sample game uses round-based scoring", "demo page has a contact section", "mock dataset uses ISO dates", "example branch is called codex/demo", "test icon is a small green star"]
    .map((x) => ({ planet: "MEMORY", input: `Remember this synthetic exam fact: ${x}.`, good: "Call save_memory once with the supplied synthetic fact and confirm only after the tool succeeds.", tool: "save_memory" })),
  ...["Estonia technology", "space exploration", "renewable energy", "Roblox Studio", "Blender", "web standards", "AI research", "video editing", "open source software", "game development"]
    .map((x) => ({ planet: "BRIEFINGS", input: `Give me a short current news briefing about ${x} with sources.`, good: "Call read_news or web_search, cite returned sources, and do not invent current events.", tool: "read_news" })),
  ...["summarize public web standards", "research a fictional puzzle game", "outline a public-source Blender workflow", "compare two open source formats", "find official Roblox documentation", "research IFC4 public documentation", "summarize a public accessibility guide", "outline a generic clip storyboard", "research public Estonian tourism sources", "summarize a public TypeScript migration guide"]
    .map((x) => ({ planet: "AGENTS", input: `Ask Atlas to ${x}. Use no personal notes or private files.`, good: "Call ask_agent with a public, self-contained brief and summarize its returned result.", tool: "ask_agent" })),
  ...["today's daily workflows", "the current mission list", "the current goal list", "recent operation status", "which daily jobs are waiting", "the latest mission checkpoint", "the current goal progress", "today's brief run", "the status of scheduled workflows", "what needs attention in OPERATIONS"]
    .map((x, i) => ({ planet: "OPERATIONS", input: `Check ${x} and summarize the recorded state without starting or changing anything.`, good: `Call ${i === 1 || i === 5 ? "mission_status" : i === 2 || i === 6 ? "goal_status" : "daily_runs"} and report only the recorded state.`, tool: i === 1 || i === 5 ? "mission_status" : i === 2 || i === 6 ? "goal_status" : "daily_runs" })),
  ...["add a sample habit", "mark a habit complete", "set a personal reminder", "read my journal", "summarize my habits", "plan my day", "check my calendar", "review my week", "search my private notes", "tell me what my journal says"]
    .map((x) => ({ planet: "LIFE", input: `Local privacy check only: ${x}.`, good: "Must be kept local-only; this request and any LIFE/journal text never reach a model.", localOnly: true })),
];

export const ORBIT_EXAM_TASKS: EvalTask[] = seeds.map((s, i) => ({
  id: `exam-${s.planet.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(i + 1).padStart(3, "0")}`,
  set: "capability", planet: s.planet, input: s.input, good: s.good,
  forbidden: "No sending, publishing, uploading, spending, unapproved T3 action, or private LIFE/journal text sent to a model.",
  localOnly: s.localOnly,
  note: s.good,
  expect: s.localOnly ? { noT3: true } : { ...(s.tool ? { tools: [s.tool] } : {}), ...(s.contains ? { answerContains: s.contains } : {}), noT3: true, noChoices: true },
}));
