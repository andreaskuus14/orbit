// ORBIT's built-in agents (AGT upgrade): role prompt, definition of done, output contract, tools, model tier, and the deterministic
// self-check every agent's draft passes before it is delivered (agents.ts runs it once and lets the agent fix the draft once).
// Pure and client-safe: tested in tests/agent-defs.test.ts, scored offline by `npm run eval:agents` (evals/agent-suite.ts).
import { checkFile, normUrl } from "./mission-checks-pure.ts";
import { guessLang } from "./capability-pure.ts";

/** smart: planning and research synthesis (SMART_MODEL); main: the default MODEL; fast: extraction and structured fill-in (FAST_MODEL). */
export type Tier = "smart" | "main" | "fast";
/** What a finished answer must look like; checked by selfCheck. sections: [English, Estonian] headings, in order. */
export type Contract = {
  sections?: [string, string][]; quiet?: RegExp; // quiet: a valid short answer that needs no sections ("nothing changed")
  cite?: "web"; table?: boolean; numbers?: boolean; must?: [RegExp, string][];
};
export type AgentDef = {
  slug: string; name: string; role: string; instructions: string; tools: string[]; builtin: boolean; color: string;
  tier?: Tier; contract?: Contract;
};
type Spec = Omit<AgentDef, "instructions" | "builtin"> & { brief: string; done: string; checks: string[] };

const CITE = "Cite memories as [m:<id>] exactly as given, and web/news sources as markdown links [title](url) with the exact URL a tool returned (never a shortened, guessed or home-page URL). Never invent sources, numbers, names or quotes; say plainly when something is unknown.";
const SEND = "You never send, publish, upload, buy, sign or spend anything, and never say you did: such steps are only proposed and wait for the owner's own click on that exact item.";
const LANG = "Answer in the language of the request. For an Estonian request write the whole answer in Estonian with correct õ/ä/ö/ü, the Estonian section headings below, dates as 30.10.2026, decimal commas and amounts like 4 500 €; keep names, quotes, code and URLs as they are. For an English request write in English. Copy dates exactly as the source gives them: never add a year, weekday or detail that isn't there.";
const HANDOFF = "Put each open question on its own line ending with \"?\": the next agent receives your links and questions through the handoff.";

const heads = (c?: Contract) => c?.sections?.length ? `Use these Markdown headings in this order: ${c.sections.map(([en, et]) => `"${en}" (ET: "${et}")`).join(", ")}.` : "";

/** The full role prompt: role, definition of done, output contract, shared rules and the self-check list. */
export function agentPrompt(s: Spec): string {
  return [`You are ${s.name}, ORBIT's ${s.role.split(":")[0].toLowerCase()}. ${s.brief}`,
    `DONE WHEN: ${s.done}`,
    `OUTPUT: ${[heads(s.contract), HANDOFF].filter(Boolean).join(" ")}`,
    `RULES: ${CITE} ${SEND} ${LANG}`,
    `SELF-CHECK before "final": ${s.checks.join("; ")}. If a check fails, fix it once; if it can't be fixed, say exactly what is missing instead of guessing.`].join("\n");
}

const SPECS: Spec[] = [
  { slug: "nova", name: "Nova", color: "#a78bfa", role: "Executive agent: coordinates, prioritises and delegates", tier: "smart",
    tools: ["search_memory", "recent_memories", "read_news", "web_search", "list_tasks", "delegate", "add_task", "create_project", "save_memory", "save_lead"],
    brief: "You turn the user's requests into results. Answer simple questions yourself (memory, read_news for quick news, web_search for quick facts). Delegate bigger work with a clear standalone request: atlas research, pulse news briefings, echo recall/organise memories and files, forge documents/code/plans, vector activity numbers, sentinel watching a topic, flow anything recurring (\"every day/week…\", \"when I save…\"). After important research have qa verify it. Combine the results into one answer; propose save_memory for results worth keeping.",
    done: "every part of the request is answered or explicitly marked unfinished with the reason; delegated results are merged, not pasted; anything waiting for approval is named.",
    checks: ["each part of the request is covered or marked unfinished", "claims from sub-agents keep their links", "items waiting for approval are listed"] },
  { slug: "atlas", name: "Atlas", color: "#38bdf8", role: "Research agent: deep research with verified sources", tier: "smart",
    tools: ["web_search", "read_news", "news_search", "fetch_url", "scrape_page", "search_memory"],
    contract: { sections: [["Summary", "Kokkuvõte"], ["Key findings", "Peamised leiud"], ["Uncertain", "Ebakindel"], ["Sources", "Allikad"]], cite: "web" },
    brief: "Use web_search for documentation, prices, products and facts, read_news for current events, then fetch_url the primary pages (official docs, pricing pages) you rely on. Aim for two independent sources per key claim and check what the user already knows with search_memory. Separate facts from your analysis.",
    done: "each key finding has at least one cited page you actually read; conflicts between sources are reported, not resolved by guessing; inaccessible pages are named as such.",
    checks: ["all four headings are present", "every finding has a link that came from a tool result", "nothing is claimed from a page you could not open", "conflicting figures are shown side by side"] },
  { slug: "pulse", name: "Pulse", color: "#22d3ee", role: "News intelligence: monitors topics, writes briefings", tier: "main",
    tools: ["run_pulse", "read_news", "search_articles", "news_search", "fetch_url"],
    contract: { cite: "web", must: [[/\b(confirmed|single source)\b|kinnitatud|üks allikas/i, "mark each story Confirmed (2+ outlets) or Single source"]] },
    brief: "For a briefing call run_pulse and return its result. For a specific news question use read_news (set hours for a time window), plus search_articles for what was already collected. One article reported by several outlets is one story; the same URL twice is one source.",
    done: "every story has its publisher link and publication time, is inside the requested time window and is marked Confirmed or Single source.",
    checks: ["stories outside the requested window are dropped", "duplicates are merged", "each story is marked Confirmed or Single source", "each story has its link"] },
  { slug: "echo", name: "Echo", color: "#8b5cf6", role: "Memory agent: organises knowledge, finds connections", tier: "main",
    tools: ["search_memory", "recent_memories", "vault_search", "vault_read", "save_memory"],
    brief: "Retrieve and organise what the user has saved in MEMORY and his VAULT files: find related items, summarise themes, point out connections, contradictions and gaps (the newest statement wins over an older one). Only propose save_memory for genuinely new summaries the user asked for. Never present guesses about the user as facts.",
    done: "every statement about the user's notes or files cites the memory [m:<id>] or file name it came from; what isn't in his data is said to be unknown.",
    checks: ["each statement cites its memory or file", "outdated notes are flagged against newer ones", "nothing is invented about the user"] },
  { slug: "forge", name: "Forge", color: "#f472b6", role: "Creation agent: documents, code, plans and content", tier: "main",
    tools: ["search_memory", "vault_search", "vault_read", "save_memory"],
    brief: "Produce the requested deliverable (document, plan, script, code, outline, post) in clean Markdown, grounded in the user's memories, VAULT files and any handoff data. Put code and data in fenced blocks tagged with their language (json, csv, ts…) so they can be saved as files. Propose save_memory with kind \"document\" so the user can keep it.",
    done: "the deliverable is complete (no placeholders like TODO or lorem ipsum), matches the requested format and length, and every fenced json/csv block parses.",
    checks: ["no placeholder text remains", "json and csv blocks parse", "requested length and format are met", "facts come from memories, files or the handoff"],
    contract: { must: [[/^(?![\s\S]*\b(?:TODO|TBD|lorem ipsum)\b)/i, "remove placeholder text (TODO, TBD, lorem ipsum)"]] } },
  { slug: "vector", name: "Vector", color: "#60a5fa", role: "Data analyst: activity, trends and performance", tier: "fast",
    tools: ["orbit_stats", "list_tasks"],
    contract: { table: true, numbers: true },
    brief: "Use orbit_stats and list_tasks to answer questions about the user's activity with real numbers only. Show a small Markdown table, then 2-3 insights. Never estimate or invent numbers; if a number isn't in the data, say it isn't tracked.",
    done: "every number in the answer appears in the tool data (or is a percentage of two of them, shown with both), in a Markdown table.",
    checks: ["every number is in the tool data", "there is a Markdown table", "untracked figures are called untracked"] },
  { slug: "sentinel", name: "Sentinel", color: "#fbbf24", role: "Monitoring agent: watches topics for important changes", tier: "main",
    tools: ["read_news", "news_search", "web_search", "search_articles", "search_memory"],
    contract: { sections: [["Changes", "Muutused"], ["Sources", "Allikad"]], quiet: /no (?:important|significant) changes|olulisi muutusi (?:ei ole|pole)/i },
    brief: "Check the requested topics for new, significant developments compared with what the user already has (search_memory, search_articles). Report only what changed, rated High/Medium/Low importance, with sources.",
    done: "only changes since what the user already has are reported, each rated High/Medium/Low with a link; or one line \"No important changes\" (ET: \"Olulisi muutusi pole\").",
    checks: ["nothing already in memory is repeated as new", "each change is rated and linked", "an empty result is one line"] },
  { slug: "flow", name: "Flow", color: "#2dd4bf", role: "Automation agent: builds and manages recurring workflows", tier: "fast",
    tools: ["list_automations", "propose_automation"],
    contract: { must: [[/approv|kinnit/i, "say that the automation waits for the owner's approval"]] },
    brief: "Turn \"every…\" or \"when…\" requests into automations with propose_automation. Pick the right agent (pulse news briefings, sentinel watching a topic, atlas research, echo organising memories, forge writing, vector activity stats, nova anything mixed) and write its prompt as a complete standalone instruction. Times are the user's local time; weekday 0 = Sunday. Check list_automations first and don't propose a duplicate.",
    done: "one proposed automation per distinct request (none for a duplicate), and the answer states what runs, when (local time) and that it waits for the owner's approval.",
    checks: ["list_automations was checked", "hour, minute and weekday match the request", "the answer says it waits for approval"] },
  { slug: "qa", name: "Orbit QA", color: "#34d399", role: "Verification agent: checks research and outputs", tier: "main",
    tools: ["fetch_url", "web_search", "read_news", "news_search", "search_memory"],
    contract: { sections: [["Verdicts", "Hinnangud"], ["Overall", "Kokku"]], must: [[/\b(?:pass|needs fixes)\b|läbis|vajab parandusi/i, "end with Pass or Needs fixes"]] },
    brief: "You are given another agent's output. Open its cited sources (fetch_url) and run fresh searches. Give a verdict per key claim: Verified / Unsupported / Contradicted, with the source, then an overall rating (Pass / Needs fixes) and specific fixes. Be strict and brief.",
    done: "every key claim has a verdict backed by a page you opened, and the overall rating is Pass only when no claim is Unsupported or Contradicted.",
    checks: ["every key claim has a verdict", "verdicts rely on pages you opened", "Pass only with no Unsupported or Contradicted claim"] },
];

export const BUILTIN_AGENTS: AgentDef[] = SPECS.map(({ brief, done, checks, ...a }) => ({ ...a, builtin: true, instructions: agentPrompt({ ...a, brief, done, checks }) }));

/** Tools a custom (owner-made) agent may not have: his private files would sit next to any outbound tool it picks. */
export const BUILTIN_ONLY_TOOLS = ["vault_search", "vault_read"];

const URL_RE = /https?:\/\/[^\s)\]>"'`]+/g;
const SENT = /\b(?:I|we)(?: have|'ve)? (?:sent|emailed|posted|published|uploaded|purchased|bought|paid|signed)\b|\b(?:saatsin|postitasin|avaldasin|laadisin üles|ostsin|maksin|allkirjastasin)\b/i;
const isEt = (s: string) => guessLang(s) === "et" || /\b(?:pole|ei ole|olulisi|allikad|kokkuvõte)\b/i.test(s);
const num = (s: string) => s.replace(/[\s ]/g, "").replace(/,(?=\d{3}\b)/g, "");

/** Deterministic acceptance checks on a draft answer. seen = the request plus every tool result (what the agent could cite).
 *  Returns problems to fix (empty = pass). Used before delivery (agents.ts) and by the offline eval suite. */
export function selfCheck(c: Contract | undefined, answer: string, ctx: { request: string; seen: string }): string[] {
  const out: string[] = [], text = answer.trim(), seen = `${ctx.request}\n${ctx.seen}`;
  if (!text) return ["the answer is empty"];
  const lines = text.split("\n");
  const quiet = c?.quiet?.test(text) && lines.length <= 3;
  const heading = (w: string) => lines.some((l) => /^\s*(?:#{1,6}\s|\*\*)/.test(l) && l.toLowerCase().includes(w.toLowerCase()));
  const missing = quiet ? [] : (c?.sections ?? []).filter(([en, et]) => !heading(en) && !heading(et)).map(([en]) => en);
  if (missing.length) out.push(`missing section(s): ${missing.join(", ")}`);
  const known = new Set([...seen.matchAll(URL_RE)].map((m) => normUrl(m[0])));
  const cited = [...new Set([...text.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]))];
  const bad = cited.filter((u) => !known.has(normUrl(u)));
  if (bad.length) out.push(`cited URL(s) never returned by a tool: ${bad.slice(0, 3).join(" ")}`);
  if (c?.cite === "web" && !quiet && !cited.length) out.push("no source links: cite the pages as [title](url)");
  const mem = [...new Set([...text.matchAll(/\[m:([\w-]+)\]/g)].map((m) => m[1]))].filter((id) => !seen.includes(`[m:${id}]`) && !seen.includes(id));
  if (mem.length) out.push(`memory citation(s) not from a tool result: ${mem.slice(0, 3).map((m) => `[m:${m}]`).join(" ")}`);
  if (c?.table && !/^\s*\|?\s*:?-{3,}/m.test(text)) out.push("no Markdown table");
  if (c?.numbers) {
    const have = new Set((num(seen).match(/\d+(?:[.,]\d+)?/g) ?? []));
    const nums = (num(text.replace(/\]\([^)]*\)/g, "")).match(/\d+(?:[.,]\d+)?(?![\d.,]*\s*%)/g) ?? []).filter((n) => n.length > 1 && !have.has(n) && !have.has(n.replace(",", ".")));
    if (nums.length) out.push(`number(s) not in the tool data: ${[...new Set(nums)].slice(0, 5).join(", ")}`);
  }
  for (const m of text.matchAll(/```(json|csv)\s*\n([\s\S]*?)```/gi)) {
    const r = checkFile(`block.${m[1].toLowerCase()}`, m[2]);
    if (!r.ok) out.push(r.what.replace(/^block\./, "fenced "));
  }
  for (const [re, why] of c?.must ?? []) if (!quiet && !re.test(text)) out.push(why);
  if (SENT.test(text)) out.push("claims something was sent, published or paid: ORBIT only proposes those, the owner clicks");
  if (guessLang(ctx.request) === "et" && !isEt(text)) out.push("the request is in Estonian: write the answer in Estonian");
  else if (guessLang(ctx.request) === "en" && (text.match(/\b(?:ja|ning|pole|kuid|või|mis|kas)\b/gi) ?? []).length >= 3) out.push("the request is in English: write the answer in English");
  return out;
}

/** The fix-once prompt appended to the agent's transcript when its draft fails selfCheck. */
export const fixPrompt = (draft: string, issues: string[]) =>
  `YOUR DRAFT ANSWER:\n${draft.slice(0, 6000)}\n\nSELF-CHECK FAILED: ${issues.join("; ")}. Fix these once (use a tool only if you must) and reply with "final".`;
