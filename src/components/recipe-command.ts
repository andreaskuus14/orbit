import { matchRecipe, parseRunRecipe, type Recipe } from "@/lib/recipes-pure";
import { NAV_EVENT } from "@/lib/nav-pure";
import { parseResearchPlan, RESEARCH_PILOT } from "@/lib/research-pilot-pure";
import { ACTIVE_CHAT_KEY } from "@/lib/core-chats-pure";

/** Launch the G01 saved workflow as a mission; the active CORE chat's checkpoint is its project context. */
export async function startResearchPilot(topic: string): Promise<string> {
  let chatId = ""; try { chatId = localStorage.getItem(ACTIVE_CHAT_KEY) ?? ""; } catch { /* private mode */ }
  const res = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: RESEARCH_PILOT, topic, chatId }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Couldn't start the research (${res.status})`);
  return `Researching "${topic}": the report lands in the research workspace. Progress is under Work.`;
}

/** Start a recipe as a normal agent task (same POST /api/tasks as the Recipes tab and agent commands). */
export async function startRecipe(r: Pick<Recipe, "name" | "agent" | "request" | "workflow">, topic?: string): Promise<string> {
  if (r.workflow === RESEARCH_PILOT) return startResearchPilot(topic ?? "");
  const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: r.agent, request: r.request, title: r.name }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Couldn't start "${r.name}" (${res.status})`);
  return `Started recipe "${r.name}".`;
}

/** "run recipe daily ideas" / "käivita retsept …": no CORE call. Null when the text isn't that command;
 *  otherwise onDone gets the outcome (started, or the closest recipe names). */
export function runRecipeCommand(text: string, onDone: (msg: string, ok: boolean) => void): boolean {
  const topic = parseResearchPlan(text); // "research and plan: …" → the saved research workflow, no CORE call
  if (topic) {
    startResearchPilot(topic).then((m) => { onDone(m, true); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "agents" } })); }, (e) => onDone(e instanceof Error ? e.message : "Couldn't start the research", false));
    return true;
  }
  const name = parseRunRecipe(text);
  if (!name) return false;
  fetch("/api/recipes").then((r) => r.json()).then(async (j: { recipes?: Recipe[] }) => {
    const list = j.recipes ?? [];
    const m = matchRecipe(name, list);
    if ("closest" in m) return onDone(list.length ? `No recipe "${name}". Closest: ${m.closest.join(", ")}.` : "You have no recipes yet: save one from a finished task.", false);
    onDone(await startRecipe(list.find((r) => r.id === m.id)!), true);
    dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "agents" } }));
  }).catch((e) => onDone(e instanceof Error ? e.message : "Couldn't run the recipe", false));
  return true;
}
