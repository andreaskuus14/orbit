// MEM08 project handover pack, pure: a compact, revisioned summary of one project's memories (objective, decisions, constraints,
// open questions, authoritative VAULT files by stable id) that CORE/agents can read as data. Guard: only current records of THIS
// project; never other projects, chat-scoped memories, superseded/expired/replaced instructions, or journal/LIFE content.
// Tested in tests/memory-pack.test.ts.
import { currentOnly, memoryType, type Typed } from "./memory-types-pure.ts";
import { projectOf } from "./memory-workspace-pure.ts";

export type PackRec = Typed & { id: string; title: string; content: string; kind: string; tags: string[]; updated_at?: string | null };
export type Line = { id: string; text: string };
export type Pack = {
  v: 1; project: string; rev: number; hash: string; builtAt: string;
  objective: Line[]; decisions: Line[]; constraints: Line[]; questions: Line[];
  files: { vault: string; from: string }[]; sources: { id: string; at: string }[];
};
export const SECTIONS = ["objective", "decisions", "constraints", "questions"] as const;
type Section = (typeof SECTIONS)[number];
const CAP = 12, TEXT = 280;

const PRIVATE = /^(?:journal|life|diary|health|mood)$/i;
/** Journal/LIFE content never enters a pack (it would reach CORE and agents). */
export const isPrivate = (r: { kind?: string; tags?: string[] | null }) => PRIVATE.test(r.kind ?? "") || (r.tags ?? []).some((t) => PRIVATE.test(t) || /^life[:/]/i.test(t));

const same = (a: string | null, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
/** The records a pack may use: current in this project's context, belonging to this project, not chat-scoped, not private. */
export function packable<T extends PackRec>(rows: T[], project: string, now: number): T[] {
  return currentOnly(rows.filter((r) => !isPrivate(r) && !(r.tags ?? []).some((t) => t.startsWith("chat:"))), { now, project })
    .filter((r) => same(projectOf(r), project) && memoryType(r) !== "superseded");
}

const has = (r: PackRec, ...tags: string[]) => tags.some((t) => r.kind === t || r.tags.includes(t));
function sectionOf(r: PackRec): Section | null {
  const text = `${r.title} ${r.content}`.trim();
  if (has(r, "decision", "decided")) return "decisions";
  if (has(r, "question", "open-question") || /\?\s*$/.test(r.content.trim() || r.title)) return "questions";
  if (has(r, "goal", "objective", "project")) return "objective";
  if (has(r, "constraint", "rule") || memoryType(r) === "preference" || /^(?:must|never|always|do not|don'?t|only)\b/i.test(text)) return "constraints";
  if (/^decid(?:ed|e)\b|\bwe (?:chose|decided)\b/i.test(text)) return "decisions";
  return null;
}
const one = (r: PackRec) => (r.content.trim() ? `${r.title}: ${r.content}` : r.title).replace(/\s+/g, " ").slice(0, TEXT);
const at = (r: PackRec) => r.updated_at || r.created_at;

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Builds the pack from the owner's rows (newest first per section). `prev` gives the revision number: same content = same rev. */
export function buildPack(rows: PackRec[], project: string, now: number, prev?: Pack | null): Pack {
  const use = packable(rows, project, now).sort((a, b) => at(b).localeCompare(at(a)) || a.id.localeCompare(b.id));
  const out: Pack = { v: 1, project, rev: 0, hash: "", builtAt: new Date(now).toISOString(), objective: [], decisions: [], constraints: [], questions: [], files: [], sources: [] };
  const files = new Map<string, string>();
  for (const r of use) {
    const s = sectionOf(r);
    if (s && out[s].length < CAP) out[s].push({ id: r.id, text: one(r) });
    for (const t of r.tags) if (t.startsWith("vault:") && t.length > 6 && !files.has(t.slice(6))) files.set(t.slice(6), r.id);
    if (s || r.tags.some((t) => t.startsWith("vault:"))) out.sources.push({ id: r.id, at: at(r) });
  }
  out.files = [...files].map(([vault, from]) => ({ vault, from })).slice(0, CAP * 2);
  out.hash = fnv(JSON.stringify([SECTIONS.map((s) => out[s]), out.files]));
  out.rev = !prev ? 1 : prev.hash === out.hash ? prev.rev : prev.rev + 1;
  return out;
}

/** When a saved pack went out of date: the earliest change to a record it was built from (edited, removed, or no longer
 *  allowed in), or to a record that would now join it. null = still current. */
export function outdatedSince(saved: Pack, rows: PackRec[], now: number): string | null {
  if (buildPack(rows, saved.project, now).hash === saved.hash) return null;
  const live = new Map(packable(rows, saved.project, now).map((r) => [r.id, at(r)]));
  const known = new Set(saved.sources.map((s) => s.id));
  const times = [saved.builtAt].filter(() => saved.sources.some((s) => !live.has(s.id))); // removed or no longer allowed: since the build at least
  for (const s of saved.sources) { const t = live.get(s.id); if (t && t > s.at) times.push(t); }
  for (const [id, t] of live) if (!known.has(id) && t > saved.builtAt) times.push(t);
  return times.sort()[0] ?? saved.builtAt;
}

const TITLES: Record<Section, string> = { objective: "Objective", decisions: "Decisions", constraints: "Constraints", questions: "Open questions" };
/** Markdown export; ids stay in so an agent can cite or fetch the record. */
export function packMarkdown(p: Pack, outdated?: string | null): string {
  const lines = [`# Handover: ${p.project}`, "", `Revision ${p.rev} · built ${p.builtAt} · ${p.hash}${outdated ? ` · OUTDATED since ${outdated}` : ""}`, ""];
  for (const s of SECTIONS) {
    lines.push(`## ${TITLES[s]}`, "");
    lines.push(...(p[s].length ? p[s].map((l) => `- ${l.text} [memory:${l.id}]`) : ["- (none recorded)"]), "");
  }
  lines.push("## Authoritative files", "", ...(p.files.length ? p.files.map((f) => `- vault:${f.vault} (via memory:${f.from})`) : ["- (none linked)"]), "");
  return lines.join("\n");
}

export function parsePacks(raw: string): Record<string, Record<string, Pack>> | null {
  if (!raw.trim()) return {};
  try { const j = JSON.parse(raw); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; }
}
