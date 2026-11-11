// Voice tasks for agents, the pure part: "Atlas, research CS2 trends" / "ask Echo to write …" → { agent, request }.
// No I/O — tested in tests/agent-command.test.ts. Anything that isn't plainly a task for a known agent returns null.

export type AgentName = { slug: string; name: string };
export type AgentCommand = { agent: string; request: string };

// Mirrors BUILTIN_AGENTS in agents.ts (that module is server-only, so the client can't import it).
export const BUILTIN_AGENT_NAMES: AgentName[] = [
  { slug: "nova", name: "Nova" }, { slug: "atlas", name: "Atlas" }, { slug: "pulse", name: "Pulse" },
  { slug: "echo", name: "Echo" }, { slug: "forge", name: "Forge" }, { slug: "vector", name: "Vector" },
  { slug: "sentinel", name: "Sentinel" }, { slug: "flow", name: "Flow" }, { slug: "qa", name: "Orbit QA" },
  { slug: "scout", name: "Scout" }, { slug: "muse", name: "Muse" }, { slug: "plinth", name: "Plinth" }, { slug: "closer", name: "Closer" }, { slug: "prospector", name: "Prospector" }, { slug: "outreach", name: "Outreach" },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Spoken filler in front of the command; stripped one at a time only if the text doesn't already parse
// (so an agent called "Orbit QA" still wins over the "orbit," wake word).
const PREFIX = /^(?:(?:hey|hi|ok|okay|yo)\b|orbit\b|please\b|(?:can|could|would|will) you\b)[\s,:;.!-]*/i;
// A vocative followed by one of these is talking ABOUT the agent ("Atlas is busy", "Atlas, what are you doing").
const ABOUT = /^(?:is|are|was|were|has|have|had|does|did|do|doing|status|stats|busy|there|here|up|you|your)\b/i;
const IMPERATIVE = "(?:research|find|write|make|create|check|summari[sz]e|analy[sz]e|look|search|scout|draft|build|plan|compare|review|fix|test|monitor|watch|brief|get|collect|prepare|translate|list|track)";
const QUESTION_TO_AGENT = /^(?:what|who|how|where|why|when|which|are|is|do|did|have)\b.*\byou(?:r|'re)?\b/i;

/** The command, or null. agents: the known roster (built-ins + custom), matched case-insensitively by name or slug. */
export function parseAgentCommand(text: string, agents: AgentName[]): AgentCommand | null {
  const bySay = new Map<string, string>();
  for (const a of agents) { bySay.set(a.name.toLowerCase(), a.slug); bySay.set(a.slug.toLowerCase(), a.slug); }
  if (!bySay.size) return null;
  const N = `(${[...bySay.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")})`;
  const patterns: [RegExp, boolean][] = [ // [pattern, vocative]
    [new RegExp(`^(?:ask|tell|get|have)\\s+${N}\\s+(?:to\\s+)?(.+)$`, "i"), false],
    [new RegExp(`^give\\s+${N}\\s+(?:a|an|this|the|one)\\s+(?:new\\s+)?(?:task|job)\\s*[:,;.-]?\\s*(?:to\\s+)?(.+)$`, "i"), false],
    [new RegExp(`^${N}\\s*[,:;.!–—-]+\\s*(.+)$`, "i"), true],
    // No punctuation after the name: only with an imperative, so "Echo chamber effects explained" stays a CORE question.
    [new RegExp(`^${N}\\s+(${IMPERATIVE}\\b.*)$`, "i"), true],
  ];
  let t = text.normalize("NFC").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 6 && t; i++) {
    for (const [re, vocative] of patterns) {
      const m = t.match(re);
      if (!m) continue;
      const request = m[2].replace(/^(?:please|to)\s+/i, "").replace(/[\s,]+please[.!]?$/i, "").replace(/[\s.!]+$/, "").trim();
      if (vocative && (ABOUT.test(request) || QUESTION_TO_AGENT.test(request))) return null;
      if (request.split(" ").length < 3 && request.length < 12) return null;
      return { agent: bySay.get(m[1].toLowerCase())!, request };
    }
    const next = t.replace(PREFIX, "");
    if (next === t) break;
    t = next;
  }
  return null;
}

export const agentAck = (name: string) => `${name} is on it.`;
export const agentReply = (name: string, title: string) => `${name} started: ${title}`;
