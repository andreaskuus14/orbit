import { BUILTIN_AGENT_NAMES, agentAck, agentReply, parseAgentCommand, type AgentName } from "@/lib/agent-command-pure";
import { NAV_EVENT } from "@/lib/nav-pure";

// Roster for name matching: built-ins right away, custom agents once /api/agents answered (refreshed after 60 s).
let roster: AgentName[] = BUILTIN_AGENT_NAMES;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
function refreshRoster() {
  if (inflight || Date.now() - fetchedAt < 60_000) return;
  inflight = fetch("/api/agents").then((r) => r.ok ? r.json() : null).then((j) => {
    if (Array.isArray(j?.agents)) roster = j.agents.map((a: AgentName) => ({ slug: a.slug, name: a.name }));
    fetchedAt = Date.now();
  }).catch(() => {}).finally(() => { inflight = null; });
}
// shortcut: parsing is synchronous, so a custom agent created in the last 60 s isn't known until the next refresh.
if (typeof window !== "undefined") refreshRoster();

/** "Atlas, research CS2 trends" / "ask Echo to write …": queues the task in the background, opens AGENTS and returns
 *  an immediate "Atlas is on it."; onDone gets "Atlas started: <title>" or the server's error. Null if not a command. */
export function runAgentCommand(text: string, onDone?: (msg: string, ok: boolean) => void): string | null {
  refreshRoster();
  const cmd = parseAgentCommand(text, roster);
  if (!cmd) return null;
  const name = roster.find((a) => a.slug === cmd.agent)?.name ?? cmd.agent;
  fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) })
    .then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't give ${name} the task (${res.status})`);
      onDone?.(agentReply(name, json.task?.title ?? cmd.request), true);
    })
    .catch((e) => onDone?.(e instanceof Error ? e.message : `Couldn't give ${name} the task`, false));
  dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "agents" } }));
  return agentAck(name);
}
