// Pure helpers for CORE chat: fast-model routing, live step labels and follow-up chips. Pure imports only: loads in tests and the browser.
import { progressLabel } from "./long-work-pure.ts";

const AGENTS = "nova|atlas|pulse|echo|forge|vector|sentinel|flow|qa";
// Anything that needs memories, tools or real thinking stays on the main model.
const HEAVY = new RegExp(String.raw`https?:|www\.|\.(com|org|net|io)\b|\b(memor|note|remember|save|saved|news|headline|studio|clip|shorts?\b|scout|niche|schedul|youtube|channel|video|agent|${AGENTS}|file|upload|document|search|find|look\s*up|latest|today|yesterday|tonight|this week|go to|open|show|fly|navigate|zoom|globe|planet|project|idea|goal|rea|repository|source|audit|research|explain|why|how (do|does|can|should|would)|write|story|summar|plan|code|compare|analy|list|my|mine|i (said|told|wrote|asked)|we (talked|discussed)|earlier|last time|weather|price|stock|score)`, "i");
const AFFIRM = /^\W*(yes|yeah|yep|yup|sure|ok(ay)?|do it|go ahead|please( do)?|sounds good|go for it)\b/i;
// The user asks for depth outright ("deep: ...", "think hard").
const DEEP_ASK = /^\W*deep\s*:|\bthink (hard|deeply|carefully|it through)\b|\bdeep[- ]dive\b/i;
// Clearly hard work (planning, architecture, code, comparisons) that also states constraints or asks a question.
const HARD = /\b(plan|roadmap|strateg(y|ies|ic)|architect(ure)?|design|refactor|debug|algorithm|compare|comparison|versus|trade-?offs?|pros and cons|analy[sz]e|analysis|evaluate|optimi[sz]e|prove|derive)\b/i;
const CONSTRAINED = /[?:]|\b(given|must|need|without|budget|constraint)/i;

/** "fast" for short chit-chat that clearly needs no tool or memory; "deep" for clearly hard asks (plan + answer +
 *  self-check on the deep model); everything else is "smart" (the main model). */
export function pickModel(question: string, prevAssistant = ""): "fast" | "smart" | "deep" {
  const q = question.trim();
  if (DEEP_ASK.test(q) || (q.length > 160 && HARD.test(q) && CONSTRAINED.test(q))) return "deep";
  if (!q || q.length > 80 || q.split(/\s+/).length > 12 || q.includes("\n")) return "smart";
  if (HEAVY.test(q)) return "smart";
  // "yes" to CORE's own offer ("Want me to run the scout?") is a request to act: keep tools on hand.
  if (AFFIRM.test(q) && /\?\s*$/.test(prevAssistant.trim())) return "smart";
  return "fast";
}

/** What CORE is doing right now, for the typing indicator. */
export function stepLabel(tool: string, input: Record<string, unknown> = {}): string {
  const agent = typeof input.agent === "string" && input.agent ? input.agent[0].toUpperCase() + input.agent.slice(1) : "an agent";
  const labels: Record<string, string> = {
    search_memory: "Searching memories…", think: "Thinking…", fetch_url: "Reading the page…", web_search: "Searching the web…", read_news: "Reading news…",
    ask_agent: `Asking ${agent}…`, save_memory: "Saving to memory…", navigate: "Flying there…",
    studio_status: "Checking the studio…", learned: "Checking what works…", run_scout: "Starting the scout…",
    run_niche: "Starting niche research…", schedule_approved: "Scheduling clips…",

    suggestions: "Checking what needs attention…", plan_task: "Starting the plan…", create_goal: "Setting up the goal…", goal_status: "Checking your goals…", wishlist: "Checking your wishlist…", add_wish: "Adding to your wishlist…", propose_rule: "Writing up the rule…", review: "Double-checking the answer…",
  };
  return labels[tool] ?? progressLabel(tool, input) ?? "Working…";
}

/** 2-3 follow-up chips from the tools used (first match wins) or the question; [] when nothing fits. */
export function followUps(question: string, tools: string[]): string[] {
  const used = (t: string) => tools.includes(t);
  if (used("studio_status")) return ["Review clips", "Run the scout", "What has worked best?"];
  if (used("learned")) return ["Review clips", "Find my niche", "Studio status"];
  if (used("run_scout") || used("run_niche")) return ["Studio status", "Review clips"];
  if (used("schedule_approved")) return ["When do the next Shorts go live?", "Studio status"];
  if (used("read_news")) return ["More on this", "Open the globe", "Any other big news?"];
  if (used("web_search")) return ["Search deeper", "Save this to memory"];
  if (used("fetch_url")) return ["Summarise it shorter", "Save this to memory"];
  if (used("ask_agent")) return ["Go deeper", "Save this to memory"];
  if (used("save_memory")) return ["What else do you know about me?", "Open memory"];
  if (used("navigate")) return [];
  if (/\b(idea|project|plan|goal)s?\b/i.test(question)) return ["What should I do next?", "Save this to memory"];
  if (question.trim().length > 25) return ["Tell me more", "Give me a short version"];
  return [];
}

/** Agents: one self-review pass only for big results (long, or built from several tool steps), to save cost.
 *  Top-level research is already cross-checked by verifyAnswer and sub-tasks are reviewed by their parent. */
export function needsSelfReview(result: string, toolSteps: number, depth: number, verified: boolean): boolean {
  return depth === 0 && !verified && (result.length >= 1500 || toolSteps >= 3);
}
