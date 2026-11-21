// THE privacy rule for the owner's journal / LIFE data (AGENTS.md rule 6: journal/LIFE text never goes to a model or out of
// ORBIT). One definition, used at every call site that could hand a memory row, a title or an event payload to a model
// (Claude, Haiku, the local Ollama brain, the reranker) or to the hosted embedder. Fails closed: a missing row is private.
// Tested in tests/journal-guard.test.ts (unit + a repo-wide scan of every memories read).

/** Memory kinds that are the owner's private LIFE data. Only "journal" exists in the DB today; the rest are reserved. */
export const PRIVATE_KINDS = ["journal", "life", "diary", "health", "mood"] as const;
const PRIVATE = new RegExp(`^(?:${PRIVATE_KINDS.join("|")})$`, "i");
/** PostgREST list for `.not("kind", "in", PRIVATE_KIND_LIST)`. */
export const PRIVATE_KIND_LIST = `(${PRIVATE_KINDS.join(",")})`;

export type PrivRow = { kind?: unknown; tags?: unknown };

export const isPrivateKind = (kind: unknown): boolean => typeof kind === "string" && PRIVATE.test(kind.trim());
const privateTag = (t: unknown) => typeof t === "string" && (PRIVATE.test(t.trim()) || /^life[:/]/i.test(t.trim()));

/** A memory (or anything with kind/tags) that is journal/LIFE data. null/undefined counts as private (fail closed). */
export function isPrivate(row: PrivRow | null | undefined): boolean {
  if (!row || typeof row !== "object") return true;
  return isPrivateKind(row.kind) || (Array.isArray(row.tags) && row.tags.some(privateTag));
}

/** The rows a model may see. */
export const dropPrivate = <T extends PrivRow>(rows: readonly T[] | null | undefined): T[] => (rows ?? []).filter((r) => !isPrivate(r));

/** The "memory.created" event payload: a private memory's title never enters the events table (automations, rules and
 *  agents read event payloads into prompts). */
export function memoryEventPayload(row: { id: string; title?: unknown; kind?: unknown; source?: unknown; tags?: unknown }, suggested: number) {
  return isPrivate(row) ? { id: row.id, kind: row.kind, source: row.source, private: true, suggested }
    : { id: row.id, title: row.title, kind: row.kind, source: row.source, suggested };
}

/** A "memory.created" payload that must not start an automation or rule (also older events that still carry a title). */
export const privateMemoryEvent = (p: { kind?: unknown; tags?: unknown; private?: unknown } | null | undefined) =>
  !p || p.private === true || isPrivate({ kind: p.kind, tags: p.tags });
