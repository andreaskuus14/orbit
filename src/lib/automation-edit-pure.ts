import { validateAutomation, type AutomationSpec } from "./pure.ts";

export type AutomationAgent = { slug: string; name: string; tools: string[]; enabled?: boolean };
export type AutomationDraft = { name: string; when: "day" | "week" | "hour" | "memory" | "briefing"; time: string; weekday: number; kind: string; agent: string; prompt: string };
type Patch = Partial<AutomationSpec> & { enabled?: boolean };
const EDITABLE = ["name", "agent", "prompt", "trigger", "schedule", "event", "kind_filter", "enabled"];
const own = (o: object, k: string) => Object.hasOwn(o, k);
const record = (o: unknown): o is Record<string, unknown> => !!o && typeof o === "object" && !Array.isArray(o);

/** Merge only editable fields, then use the creation validator. Reject invalid supplied values rather than
 * silently replacing an explicit agent/time with the creation validator's defaults. Metadata is never writable. */
export function validateAutomationPatch(input: unknown, current: AutomationSpec): { error: string } | { patch: Patch } {
  if (!record(input)) return { error: "JSON object required" };
  if (Object.keys(input).some((k) => k !== "id" && !EDITABLE.includes(k))) return { error: "Unknown automation field" };
  const keys = EDITABLE.filter((k) => own(input, k));
  if (!keys.length) return { error: "Choose a field to update" };
  if (own(input, "enabled") && typeof input.enabled !== "boolean") return { error: "Enabled must be true or false" };
  for (const [k, min, max] of [["name", 1, 100], ["prompt", 5, 4000]] as const) {
    if (own(input, k) && (typeof input[k] !== "string" || input[k].trim().length < min || input[k].trim().length > max)) return { error: `${k === "name" ? "Name" : "Instructions"} must be ${min}–${max} characters` };
  }
  if (own(input, "agent") && (typeof input.agent !== "string" || !/^[a-z0-9-]{2,40}$/.test(input.agent))) return { error: "Choose a valid agent" };
  if (own(input, "trigger") && input.trigger !== "schedule" && input.trigger !== "event") return { error: "Trigger must be schedule or event" };
  if (own(input, "event") && input.event !== null && input.event !== "memory.created" && input.event !== "briefing.ready") return { error: "Choose a supported event" };
  if (own(input, "kind_filter") && input.kind_filter !== null && (typeof input.kind_filter !== "string" || !/^[a-z]{2,20}$/.test(input.kind_filter))) return { error: "Memory kind must be 2–20 lowercase letters, or null" };
  if (own(input, "schedule") && input.schedule !== null) {
    if (!record(input.schedule)) return { error: "Schedule must be an object" };
    const s = input.schedule;
    if (Object.keys(s).some((k) => !["every", "hour", "minute", "weekday"].includes(k))) return { error: "Unknown schedule field" };
    if (own(s, "every") && (typeof s.every !== "string" || !["hour", "day", "week"].includes(s.every))) return { error: "Schedule must repeat every hour, day or week" };
    for (const [k, max] of [["hour", 23], ["minute", 59], ["weekday", 6]] as const) if (own(s, k)) {
      const n = typeof s[k] === "string" && s[k].trim() ? Number(s[k]) : s[k];
      if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > max) return { error: `${k} must be a whole number from 0 to ${max}` };
    }
  }
  // Toggling a legacy automation must keep working even when its old specification needs repair.
  if (keys.length === 1 && keys[0] === "enabled") return { patch: { enabled: input.enabled as boolean } };
  const merged = { ...current, ...Object.fromEntries(keys.map((k) => [k, input[k]])) };
  if (record(input.schedule)) merged.schedule = { ...(current.schedule ?? {}), ...input.schedule } as AutomationSpec["schedule"];
  if (merged.trigger === "event" && record(input.schedule)) return { error: "Event automations cannot have a schedule" };
  if (merged.trigger === "schedule" && input.event != null) return { error: "Switch the trigger to event before choosing an event" };
  const v = validateAutomation(merged);
  if ("error" in v) return v;
  const patch: Patch = {};
  for (const k of keys) Object.assign(patch, { [k]: k === "enabled" ? input.enabled : v.spec[k as keyof AutomationSpec] });
  // Trigger fields form one consistent set; clear stale schedule/event/filter when switching modes.
  if (keys.some((k) => ["trigger", "schedule", "event", "kind_filter"].includes(k))) Object.assign(patch, {
    trigger: v.spec.trigger, schedule: v.spec.schedule, event: v.spec.event, kind_filter: v.spec.kind_filter,
  });
  return { patch };
}

export function automationDraft(a: AutomationSpec): AutomationDraft {
  const s = a.schedule;
  return { name: a.name, agent: a.agent, prompt: a.prompt,
    when: a.trigger === "event" ? a.event === "briefing.ready" ? "briefing" : "memory" : s?.every ?? "day",
    time: `${String(s?.hour ?? 0).padStart(2, "0")}:${String(s?.minute ?? 0).padStart(2, "0")}`, weekday: s?.weekday ?? 0, kind: a.kind_filter ?? "" };
}
export function automationSpec(d: AutomationDraft): AutomationSpec {
  const base = { name: d.name, agent: d.agent, prompt: d.prompt };
  if (d.when === "memory" || d.when === "briefing") return { ...base, trigger: "event", event: d.when === "memory" ? "memory.created" : "briefing.ready", kind_filter: d.when === "memory" ? d.kind || null : null, schedule: null };
  const [hour, minute] = d.time.split(":").map(Number);
  return { ...base, trigger: "schedule", schedule: { every: d.when, minute, ...(d.when !== "hour" && { hour }), ...(d.when === "week" && { weekday: d.weekday }) }, event: null, kind_filter: null };
}

/** Advisory, deterministic tool mismatch, never a promise that a model will succeed. No model call. */
export function automationCapabilityHint(agent: AutomationAgent | undefined, prompt: string): string | null {
  if (!agent || agent.enabled === false) return "This agent is unavailable. Choose an enabled agent.";
  const has = (...tools: string[]) => tools.some((t) => agent.tools.includes(t));
  if (has("delegate")) return null;
  const live = /\b(?:latest|live|fresh|breaking|current|today'?s?)\s+(?:\w+\s+){0,2}(?:news|headlines)\b|\b(?:news|headlines)\s+(?:\w+\s+){0,2}(?:today|now|latest)\b/i.test(prompt);
  const lookup = /\b(?:look up|search|fetch|check|find)\s+(?:\w+\s+){0,4}(?:news|headlines)\b/i.test(prompt);
  const saved = /\b(?:using|from|in)\b.{0,70}\b(?:memor(?:y|ies)|saved briefings|saved notes)\b/i.test(prompt);
  if ((lookup || live && !saved) && !has("read_news", "news_search", "run_pulse")) return `${agent.name} has no live-news tools: it can't look up live news. Choose Pulse, Sentinel or another news-enabled agent.`;
  if (/https?:\/\/|\b(?:search|browse) (?:the )?(?:web|internet)\b/i.test(prompt) && !has("fetch_url", "news_search", "read_news")) return `${agent.name} has no web tools: it can't look up online sources.`;
  if (/\b(?:search|read|find|use|summari[sz]e)\s+(?:\w+\s+){0,3}(?:memories|saved notes|saved documents)\b/i.test(prompt) && !has("search_memory", "recent_memories")) return `${agent.name} has no memory-reading tools: it can't retrieve your saved material.`;
  return null;
}
