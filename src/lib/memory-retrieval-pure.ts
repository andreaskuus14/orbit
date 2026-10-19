// Bounded, deterministic second-pass ranking. Project names are search hints, never permissions or instructions.
import { stems } from "./passages.ts";

export type MemoryCandidate = {
  id: string; title: string; content: string; tags?: string[] | null; folder?: string | null;
  created_at?: string; updated_at?: string;
};
export const CANDIDATE_LIMIT = 25; // per retrieval channel; at most 75 ids are hydrated
const STOP = new Set("the a an and or of to in on at for is are was were be by with what which who how when where why does do did it this that these those from as my me i we our you your about please tell show recall remember saved note notes project latest recent decide decided decision decisions".split(" ").flatMap(stems));

export const memoryTerms = (text: string): string[] => [...new Set(stems(text.slice(0, 50_000)).filter((w) => w.length > 1 && !STOP.has(w)))];
export const memoryLimit = (n: number): number => Number.isFinite(n) ? Math.max(0, Math.min(50, Math.floor(n))) : 10;

/** Only the structured project name is used, never its instructions or pinned notes. */
export function memoryProject(name?: string): string {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

/** PostgREST quoted values: project punctuation cannot add filters; %/_ stay literal in ILIKE. */
export function memoryProjectFilter(name: string): string {
  const project = memoryProject(name);
  const quote = (v: string) => JSON.stringify(v);
  const literal = project.replace(/[\\%_]/g, "\\$&");
  const tags = [...new Set([project, project.toLowerCase()])].map((tag) => `tags.cs.{${quote(tag)}}`);
  return [`title.ilike.${quote(`%${literal}%`)}`, `folder.ilike.${quote(literal)}`, ...tags].join(",");
}

const coverage = (terms: string[], text: string): number => {
  if (!terms.length) return 0;
  const words = new Set(stems(text));
  return terms.filter((t) => words.has(t)).length / terms.length;
};

/** Metadata match is a preference only: projects and memories do not share an ownership key today. */
export function matchesMemoryProject(m: MemoryCandidate, projectName: string): boolean {
  const terms = memoryTerms(projectName);
  if (!terms.length) return false;
  return [m.title, m.folder ?? "", ...(m.tags ?? [])].some((field) => coverage(terms, field) === 1);
}

/**
 * Keep the upstream hybrid order as a small prior, then reward query coverage and metadata matches.
 * Repetition cannot inflate coverage. Recency is a small, bounded tie preference, never supersession.
 * No memory is deleted or declared obsolete here; contradictory decisions remain available to cite.
 */
export function rerankMemories<T extends MemoryCandidate>(
  candidates: T[], query: string, primaryIds: string[], limit = 8, projectName = "", now = Date.now(),
): T[] {
  const q = memoryTerms(query);
  const project = memoryProject(projectName);
  const ranks = new Map(primaryIds.map((id, i) => [id, i]));
  const seen = new Set<string>();
  return candidates.filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
    .map((m, i) => {
      const rank = ranks.get(m.id);
      const meta = [m.title, m.folder ?? "", ...(m.tags ?? [])].join(" ");
      const lexical = coverage(q, `${meta}\n${m.content.slice(0, 50_000)}`);
      const projectHit = !!project && matchesMemoryProject(m, project);
      const updated = Date.parse(m.updated_at || m.created_at || "");
      const age = Number.isFinite(updated) && updated <= now ? (now - updated) / 86_400_000 : Infinity;
      const recency = 0.08 / (1 + age / 30);
      const score = lexical * 2 + coverage(q, meta) * 0.5 + (projectHit ? 0.8 : 0)
        + (rank === undefined ? 0 : 0.15 / (1 + rank / 10)) + recency;
      // Context-only candidates must match the question or have project metadata, not just appear in a broad FTS match.
      return { m, i, score, keep: rank !== undefined || lexical > 0 || projectHit };
    })
    .filter((x) => x.keep)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, memoryLimit(limit)).map((x) => x.m);
}
