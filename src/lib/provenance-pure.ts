// Source-backed memory (roadmap 3 / batch item 7), pure. Records carry source, timestamp, confirmation and an optional
// recheck date (migration 0019). Builds: exact-match boost for names/ids on top of the existing hybrid ranking
// (memory-search.ts), a compact linked context set for CORE, per-project briefings from recorded outcomes only, and the
// four memory controls. Journal (LIFE) records are dropped everywhere here. Tested in tests/provenance.test.ts.

export type Confirmation = "suggested" | "confirmed";
export type MemRecord = {
  id: string; kind: string; title: string; content: string; source: string; source_ref?: string | null;
  created_at: string; confirmation?: Confirmation | null; recheck_at?: string | null;
  tags?: string[]; folder?: string | null; url?: string | null; storage_path?: string | null;
};
export type ContextItem = { id: string; title: string; line: string; link: string; confirmation: Confirmation; stale: boolean };

const notJournal = <T extends { kind: string }>(r: T) => r.kind !== "journal";
export const confirmationOf = (r: Pick<MemRecord, "confirmation">): Confirmation => r.confirmation === "suggested" ? "suggested" : "confirmed";
/** Inferred / model-made records start as suggestions; owner-made ones are confirmed. */
export const initialConfirmation = (source: string): Confirmation => /^(?:capture|upload|url|user_said|owner)$/.test(source) ? "confirmed" : "suggested";
export const needsRecheck = (r: Pick<MemRecord, "recheck_at">, now: number) => !!r.recheck_at && Date.parse(r.recheck_at) <= now;
export const memoryLink = (id: string) => `/?planet=memory&id=${encodeURIComponent(id)}`;

/** A suggestion never becomes a commitment on its own: only a confirmed record AND the owner's own click. */
export function canCommit(r: Pick<MemRecord, "confirmation">, ownerClicked: boolean): boolean {
  return ownerClicked && confirmationOf(r) === "confirmed";
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Exact terms in a question: ids, "quoted phrases", and Capitalized names not at the sentence start. */
export function exactTerms(query: string): string[] {
  const out = new Set<string>();
  for (const m of query.matchAll(UUID)) out.add(m[0].toLowerCase());
  for (const m of query.matchAll(/["“']([^"”']{2,80})["”']/g)) out.add(m[1].trim().toLowerCase());
  for (const m of query.matchAll(/(?<![.!?]\s|^)\b([A-Z][\p{L}\p{N}-]*(?:\s+[A-Z][\p{L}\p{N}-]*)*)/gu)) if (m[1].length > 2) out.add(m[1].toLowerCase());
  return [...out];
}

/** Rows whose id equals a term, or whose title/tags/folder contain it as a whole word. */
export function exactMatchIds(terms: string[], rows: Pick<MemRecord, "id" | "kind" | "title" | "tags" | "folder">[]): string[] {
  if (!terms.length) return [];
  const word = (hay: string, t: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\p{N}])`, "u").test(hay);
  return rows.filter(notJournal).filter((r) => terms.some((t) => r.id.toLowerCase() === t
    || [r.title, r.folder ?? "", ...(r.tags ?? [])].some((h) => word(h.toLowerCase(), t)))).map((r) => r.id);
}

/**
 * CORE's compact set: exact hits first, then the hybrid order. Within that, confirmed + fresh before suggested or
 * due-for-recheck (still included, flagged). One line each, with a link to the full memory.
 */
export function compactContext(exactIds: string[], hybridIds: string[], rows: MemRecord[], now: number, limit = 8, lineMax = 160): ContextItem[] {
  const byId = new Map(rows.filter(notJournal).map((r) => [r.id, r]));
  const order = [...new Set([...exactIds, ...hybridIds])].filter((id) => byId.has(id));
  const rank = (id: string) => { const r = byId.get(id)!; return (confirmationOf(r) === "suggested" ? 1 : 0) + (needsRecheck(r, now) ? 1 : 0); };
  const exact = new Set(exactIds);
  const sorted = order.map((id, i) => ({ id, i })).sort((a, b) => (exact.has(b.id) ? 1 : 0) - (exact.has(a.id) ? 1 : 0) || rank(a.id) - rank(b.id) || a.i - b.i);
  return sorted.slice(0, Math.max(0, limit)).map(({ id }) => {
    const r = byId.get(id)!, t = r.content.replace(/\s+/g, " ").trim();
    return { id, title: r.title, line: t.length > lineMax ? `${t.slice(0, lineMax - 1).trimEnd()}…` : t, link: memoryLink(id), confirmation: confirmationOf(r), stale: needsRecheck(r, now) };
  });
}

// ---------- project briefings ----------
export type Outcome = { id: string; kind: "goal" | "done" | "decision_open" | "decision_made" | "file" | "next"; text: string; at: string; source: string; ref?: string | null; confirmation?: Confirmation | null };
export type Briefing = { project: string; objective: string | null; done: string[]; openDecisions: string[]; files: string[]; nextSteps: string[]; sources: string[]; updated_at: string | null };

/** From recorded outcomes only (confirmed ones; suggestions are speculation). Newest wins for the objective; a made decision closes the open one with the same text. */
export function projectBriefing(project: string, outcomes: Outcome[], max = 5): Briefing {
  const ok = outcomes.filter((o) => confirmationOf(o) === "confirmed").sort((a, b) => b.at.localeCompare(a.at));
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const made = new Set(ok.filter((o) => o.kind === "decision_made").map((o) => norm(o.text)));
  const pick = (k: Outcome["kind"]) => [...new Set(ok.filter((o) => o.kind === k).map((o) => o.text.trim()))].slice(0, max);
  return {
    project, objective: ok.find((o) => o.kind === "goal")?.text ?? null,
    done: [...new Set([...pick("done"), ...ok.filter((o) => o.kind === "decision_made").map((o) => `Decided: ${o.text}`)])].slice(0, max),
    openDecisions: pick("decision_open").filter((t) => !made.has(norm(t))),
    files: pick("file"), nextSteps: pick("next"),
    sources: [...new Set(ok.map((o) => o.ref ?? o.id))], updated_at: ok[0]?.at ?? null,
  };
}

// ---------- memory controls ----------
export type Control = { action: "why" | "remember" | "correct" | "forget"; text: string };
/** "Why do you think that?", "Remember this: …", "Correct this: … → …", "Forget this/that …". */
export function parseControl(input: string): Control | null {
  const s = input.trim();
  if (/^why do you (?:think|believe|say) (?:that|this)\??$/i.test(s) || /^why do you think\b/i.test(s)) return { action: "why", text: s.replace(/^why do you (?:think|believe|say)\s*/i, "").replace(/\?$/, "").trim() };
  const m = /^(remember|correct|forget)(?: this| that)?\s*[:,-]?\s*([\s\S]*)$/i.exec(s);
  return m ? { action: m[1].toLowerCase() as Control["action"], text: m[2].trim() } : null;
}

export type Source = { id: string; title: string; source: string; when: string; confirmation: Confirmation; link: string };
/** "Why do you think that?": the records behind a belief, plus the records they cite (source_ref), newest first. */
export function whySources(ids: string[], rows: MemRecord[]): Source[] {
  const byId = new Map(rows.filter(notJournal).map((r) => [r.id, r]));
  const seen = new Set<string>(), out: Source[] = [];
  const add = (id: string | null | undefined) => {
    const r = id ? byId.get(id) : undefined;
    if (!r || seen.has(r.id)) return;
    seen.add(r.id);
    out.push({ id: r.id, title: r.title, source: r.source, when: r.created_at, confirmation: confirmationOf(r), link: memoryLink(r.id) });
    add(r.source_ref);
  };
  ids.forEach(add);
  return out.sort((a, b) => b.when.localeCompare(a.when));
}

/** "Remember this": an owner-stated record, confirmed, with its source and optional recheck. */
export function rememberRecord(text: string, sourceRef: string | null, now: number, recheckDays?: number) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return {
    kind: "note", title: t.slice(0, 80), content: t, source: "owner", source_ref: sourceRef, confirmation: "confirmed" as const,
    recheck_at: recheckDays && recheckDays > 0 ? new Date(now + recheckDays * 86_400_000).toISOString() : null,
  };
}

/** Records derived from `id` (consolidated notes tag their members' ids; episodes link via tags/source_ref). */
export const derivedFrom = (id: string, rows: Pick<MemRecord, "id" | "tags" | "source_ref">[]) =>
  rows.filter((r) => r.id !== id && (r.source_ref === id || (r.tags ?? []).includes(id))).map((r) => r.id);

/** "Correct this": patch the record (confirmed, re-embed), and mark summaries built from it for rebuild. */
export function correctionPlan(id: string, newContent: string, rows: Pick<MemRecord, "id" | "tags" | "source_ref">[]) {
  return { patch: { content: newContent.trim(), confirmation: "confirmed" as const, embedding: null }, reindex: [id], rebuild: derivedFrom(id, rows) };
}

/** "Forget this": delete the record; derived summaries are rebuilt without it (not deleted: they hold other sources). Audit keeps ids only. */
export function forgetPlan(id: string, rows: Pick<MemRecord, "id" | "tags" | "source_ref">[]) {
  return { delete: [id], rebuild: derivedFrom(id, rows), audit: { action: "forget", id } };
}
