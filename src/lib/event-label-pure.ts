const LABELS: Record<string, string> = {
  "memory.created": "Memory saved", "memory.updated": "Memory updated", "memory.deleted": "Memory deleted",
  "core.started": "CORE is thinking", "core.completed": "CORE replied", "core.failed": "CORE reply failed",
  "pulse.started": "Briefing started", "pulse.completed": "Briefing ready", "pulse.failed": "Briefing failed",
  "agent.started": "Agent started", "agent.completed": "Agent finished", "agent.failed": "Agent failed",
  "task.delivered": "Task delivered", "proposal.created": "Proposal ready",
};
const ICONS: Record<string, string> = {
  memory: "🧠", core: "✨", pulse: "🌐", intelligence: "🌐", agent: "🤖", agents: "🤖",
  task: "⚙️", proposal: "⚙️", operations: "⚙️", automation: "⚙️", studio: "🎬", creation: "🎮",
  life: "🌱", vault: "📁", analytics: "📊", theater: "🎥", markets: "📈", business: "💼", arch: "🏛️",
};

/** Events stay readable even when a newer server introduces an unknown type. React renders this as text. */
export function eventLabel(type: string): { label: string; icon: string } {
  const cleaned = type.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    label: Object.hasOwn(LABELS, type) ? LABELS[type] : (cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : "Activity"),
    icon: Object.hasOwn(ICONS, type.split(".")[0]) ? ICONS[type.split(".")[0]] : "🪐",
  };
}
