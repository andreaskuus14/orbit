import { matchRecipe, parseRunRecipe, type Recipe } from "@/lib/recipes-pure";
import { NAV_EVENT } from "@/lib/nav-pure";

/** Start a recipe as a normal agent task (same POST /api/tasks as the Recipes tab and agent commands). */
export async function startRecipe(r: Pick<Recipe, "name" | "agent" | "request">): Promise<string> {
  const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: r.agent, request: r.request, title: r.name }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Couldn't start "${r.name}" (${res.status})`);
  return `Started recipe "${r.name}".`;
}

/** "run recipe daily ideas" / "käivita retsept …": no CORE call. Null when the text isn't that command;
 *  otherwise onDone gets the outcome (started, or the closest recipe names). */
export function runRecipeCommand(text: string, onDone: (msg: string, ok: boolean) => void): boolean {
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
