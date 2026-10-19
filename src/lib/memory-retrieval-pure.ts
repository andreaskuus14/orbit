// Conservative CORE project hints. The existing hybrid ranking remains authoritative.
import { stems } from "./passages.ts";

export type MemoryMetadata = { id: string; title: string; tags?: string[] | null; folder?: string | null };
export const CANDIDATE_LIMIT = 25;
const STOP = new Set("the a an and or of to in on at for is are was were be by with what which who how when where why does do did it this that these those from as my me i we our you your about please tell show recall remember saved note notes project latest recent decide decided decision decisions".split(" ").flatMap(stems));
const terms = (text: string) => [...new Set(stems(text).filter((w) => w.length > 1 && !STOP.has(w)))];
export const memoryLimit = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(50, Math.floor(n))) : 10;
export const memoryProject = (name?: string) => typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 80) : "";

/** PostgREST quoted values: punctuation cannot add filters; %/_ stay literal in ILIKE. */
export function memoryProjectFilter(name: string): string {
  const project = memoryProject(name);
  const literal = project.replace(/[\\%_]/g, "\\$&");
  const tags = [...new Set([project, project.toLowerCase()])].map((tag) => `tags.cs.{${JSON.stringify(tag)}}`);
  return [`title.ilike.${JSON.stringify(`%${literal}%`)}`, `folder.ilike.${JSON.stringify(literal)}`, ...tags].join(",");
}

/**
 * Never evict an original top-N hit or move its first two results. At most two already-selected
 * project notes can move forward within the remaining slots. New project notes only fill unused
 * slots (at most two). For specific questions every non-project query term must match metadata.
 * ponytail: metadata hints cannot reason about negation; keep baseline order for such questions.
 */
export function selectCoreMemoryIds(primaryIds: string[], projectRows: MemoryMetadata[], query: string, limit = 8, projectName = ""): string[] {
  const count = memoryLimit(limit);
  const baseline = [...new Set(primaryIds)].slice(0, count);
  const project = memoryProject(projectName);
  if (!project || /\b(?:not|no|without|except|never|don['’]t)\b/i.test(query)) return baseline;
  const projectTerms = new Set(terms(project));
  const question = terms(query).filter((t) => !projectTerms.has(t));
  const normalized = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const eligible = projectRows.filter((m) => {
    const title = new Set(stems(m.title));
    const matches = [m.folder ?? "", ...(m.tags ?? [])].some((v) => normalized(v) === normalized(project))
      || (projectTerms.size > 0 && [...projectTerms].every((t) => title.has(t)));
    const words = new Set(stems([m.title, m.folder ?? "", ...(m.tags ?? [])].join(" ")));
    return matches && question.every((t) => words.has(t));
  });
  const eligibleIds = new Set(eligible.map((m) => m.id));
  const tail = baseline.slice(2);
  const preferred = tail.filter((id) => eligibleIds.has(id)).slice(0, 2);
  const out = [...baseline.slice(0, 2), ...preferred, ...tail.filter((id) => !preferred.includes(id))];
  for (const m of eligible) {
    if (out.length >= Math.min(count, baseline.length + 2)) break;
    if (!out.includes(m.id)) out.push(m.id);
  }
  return out;
}
