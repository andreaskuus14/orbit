"use client";
import { automationCapabilityHint, type AutomationAgent, type AutomationDraft } from "@/lib/automation-edit-pure";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Shared by creation and inline editing. Roster/tool lists come from /api/agents, not a hardcoded mirror. */
export function AutomationFields({ draft, agents, onChange, disabled = false }: {
  draft: AutomationDraft; agents: AutomationAgent[]; onChange: (patch: Partial<AutomationDraft>) => void; disabled?: boolean;
}) {
  const available = agents.filter((a) => a.enabled !== false);
  const chosen = available.find((a) => a.slug === draft.agent);
  const hint = automationCapabilityHint(chosen, draft.prompt);
  return <fieldset disabled={disabled} className="space-y-2">
    <label className="block text-sm">Name
      <input required className="field mt-1 w-full" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Automation name" maxLength={100} />
    </label>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select className="field" value={draft.when} onChange={(e) => onChange({ when: e.target.value as AutomationDraft["when"] })} aria-label="When">
        <option value="day">Every day</option><option value="week">Every week</option><option value="hour">Every hour</option>
        <option value="memory">When I save a memory</option><option value="briefing">When a new briefing is ready</option>
      </select>
      {draft.when === "week" && <select className="field" value={draft.weekday} onChange={(e) => onChange({ weekday: Number(e.target.value) })} aria-label="Day">
        {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
      </select>}
      {(draft.when === "day" || draft.when === "week") && <input required type="time" className="field" value={draft.time} onChange={(e) => onChange({ time: e.target.value })} aria-label="Time" />}
      {draft.when === "hour" && <label className="muted">at minute <input required type="number" min={0} max={59} step={1} className="field w-16" value={Number(draft.time.split(":")[1])} onChange={(e) => onChange({ time: `00:${e.target.value.padStart(2, "0")}` })} aria-label="Minute" /></label>}
      {draft.when === "memory" && <select className="field" value={draft.kind} onChange={(e) => onChange({ kind: e.target.value })} aria-label="Kind of memory">
        <option value="">any kind</option><option value="document">documents</option><option value="link">links</option><option value="note">notes</option><option value="idea">ideas</option>
        {draft.kind && !["document", "link", "note", "idea"].includes(draft.kind) && <option value={draft.kind}>{draft.kind}</option>}
      </select>}
    </div>
    <label className="block text-sm">Who does it
      <select className="field ml-2 max-w-full" value={draft.agent} onChange={(e) => onChange({ agent: e.target.value })} aria-label="Automation agent" aria-describedby="automation-agent-hint">
        {!chosen && <option value={draft.agent} disabled>{draft.agent || "Choose an agent"} (unavailable)</option>}
        {available.map((a) => <option key={a.slug} value={a.slug}>{a.name} — {a.tools.join(", ") || "no tools"}</option>)}
      </select>
    </label>
    <p className="muted text-xs">Tools: {chosen?.tools.join(", ") || "none"}. Writes still require approval.</p>
    <p id="automation-agent-hint" className="text-xs text-amber-300" role="status">{hint}</p>
    <label className="block text-sm">Instructions
      <textarea required minLength={5} className="field mt-1 h-28 w-full" value={draft.prompt} onChange={(e) => onChange({ prompt: e.target.value })} aria-label="Instructions" maxLength={4000} />
    </label>
    <p className="muted text-xs">Runs while ORBIT's server is on, using this PC's time. Each run is a normal task with the usual approvals.</p>
  </fieldset>;
}
