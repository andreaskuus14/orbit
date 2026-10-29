import { randomUUID } from "node:crypto";
import path from "node:path";
import { readState, saveState, studioRoot } from "./clips/factory";
import { RECIPES_MAX, type Recipe } from "./recipes-pure";
import { PILOT_RECIPE } from "./research-pilot-pure";

// Agent recipes store: <studio>/recipes.json (local, single owner, like ideas.json). Logic: recipes-pure.ts.
type Store = { recipes: Recipe[] };
const FILE = () => path.join(studioRoot(), "recipes.json");
const problem = (x: unknown) => (x && typeof x === "object" && Array.isArray((x as Store).recipes) ? "" : "no recipes list");
const read = async () => (await readState<Store>(studioRoot(), "recipes", problem)) ?? { recipes: [] };

export async function listRecipes(): Promise<Recipe[]> { return [PILOT_RECIPE, ...(await read()).recipes]; } // built-in workflows first

export async function addRecipe(r: Pick<Recipe, "name" | "agent" | "request">): Promise<Recipe | string> {
  const st = await read();
  if (st.recipes.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) return "A recipe with that name already exists";
  if (st.recipes.length >= RECIPES_MAX) return `At most ${RECIPES_MAX} recipes: delete one first`;
  const rec: Recipe = { id: randomUUID(), ...r, created_at: new Date().toISOString() };
  await saveState("recipes", FILE(), { recipes: [rec, ...st.recipes] });
  return rec;
}

export async function deleteRecipe(id: string): Promise<boolean> {
  const st = await read();
  const recipes = st.recipes.filter((r) => r.id !== id);
  if (recipes.length === st.recipes.length) return false;
  await saveState("recipes", FILE(), { recipes });
  return true;
}
