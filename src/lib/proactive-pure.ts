// Dependency-free proposal logic (parsing, validation, dedupe), unit-tested in tests/proactive.test.ts.
// Keep this file free of imports and non-erasable TS syntax.

export const PROPOSAL_KINDS = ["research", "news", "followup", "create", "watch", "organize"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalDraft = { title: string; why: string; agent: string; prompt: string; kind: ProposalKind };

export const MAX_PER_RUN = 3;
export const MAX_PENDING = 6;

/** Lowercase, drop punctuation/emoji, collapse spaces: "Research: EU AI-Act!" → "research eu ai act". */
export function normTitle(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Pull the proposals array out of a model reply: tolerates code fences, prose around the JSON, {proposals:[...]} or [...]. */
export function extractProposalJson(text: string): unknown[] {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) return [];
  const start = Math.min(...starts);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end <= start) return [];
  try {
    const j = JSON.parse(t.slice(start, end + 1)) as unknown;
    if (Array.isArray(j)) return j;
    const p = (j as { proposals?: unknown })?.proposals;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/**
 * Validate and dedupe model proposals. Drops unknown agents, too-short fields, and titles that match
 * (normalized) an existing open task, a recent proposal, or another proposal in the same batch.
 */
export function cleanProposals(raw: unknown[], opts: { agents: string[]; existingTitles: string[]; max: number }): ProposalDraft[] {
  const seen = new Set(opts.existingTitles.map(normTitle).filter(Boolean));
  const out: ProposalDraft[] = [];
  for (const r of raw) {
    if (out.length >= Math.max(0, opts.max)) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = clip(o.title, 120);
    const why = clip(o.why, 400);
    const agent = clip(o.agent, 40).toLowerCase();
    const prompt = typeof o.prompt === "string" ? o.prompt.trim().slice(0, 4000) : "";
    const kind = (PROPOSAL_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as ProposalKind) : "followup";
    if (title.length < 4 || why.length < 8 || prompt.length < 15 || !opts.agents.includes(agent)) continue;
    const key = normTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, why, agent, prompt, kind });
  }
  return out;
}

/** True when a Supabase error means the proposals table hasn't been created yet (migration 0006 not applied). */
export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(err.message ?? "");
}
