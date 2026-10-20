// Agent recipes: a finished agent setup (agent + request) saved under a name, re-run as a normal agent task.
export type Recipe = { id: string; name: string; agent: string; request: string; created_at: string };
export const NAME_MAX = 60, REQUEST_MAX = 8000, RECIPES_MAX = 100;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, max) : "");
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A new recipe from a request body, or a message for a 400. */
export function validateRecipe(b: Record<string, unknown>): Pick<Recipe, "name" | "agent" | "request"> | string {
  const name = clean(b.name, NAME_MAX).replace(/\s+/g, " "), agent = clean(b.agent, 40).toLowerCase(), request = clean(b.request, REQUEST_MAX);
  if (!norm(name)) return "Give the recipe a name";
  if (!/^[a-z0-9-]{1,40}$/.test(agent)) return "Unknown agent";
  if (!request) return "The recipe needs a task request";
  return { name, agent, request };
}

/** Whole utterance "run recipe X" / "käivita retsept X" (optional "Orbit," first) → X, else null. */
export function parseRunRecipe(text: string): string | null {
  const m = norm(text).match(/^(?:(?:hey |ok )?orbit )?(?:run|start) (?:the )?recipe (.+)$|^(?:(?:hey |ok )?orbit )?käivita retsept (.+)$/u);
  const name = (m?.[1] ?? m?.[2] ?? "").trim();
  return name || null;
}

/** Exact (normalised) name, else the one recipe whose name contains it; otherwise up to 3 closest names. */
export function matchRecipe(name: string, list: Pick<Recipe, "id" | "name">[]): { id: string } | { closest: string[] } {
  const q = norm(name);
  const exact = list.find((r) => norm(r.name) === q);
  if (exact) return { id: exact.id };
  const part = list.filter((r) => norm(r.name).includes(q) || q.includes(norm(r.name)));
  if (part.length === 1) return { id: part[0].id };
  const words = new Set(q.split(" "));
  const closest = [...list].map((r) => ({ r, k: norm(r.name).split(" ").filter((w) => words.has(w)).length }))
    .sort((a, b) => b.k - a.k).slice(0, 3).map((x) => x.r.name);
  return { closest };
}
