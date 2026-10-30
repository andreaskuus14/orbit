// MEM04 capture without duplicates, pure. Quick note, link, voice memo and file captures share one provenance shape, kept in
// existing columns (no migration): source kind + content fingerprint + stable source id as tags ("via:", "fp:", "sid:"),
// the URL in `url`, captured-at = created_at. IO: captureMemory in memory.ts. Tested in tests/memory-capture.test.ts.
import { mergedContent, normText } from "./memory-hygiene-pure.ts";

export type SourceKind = "note" | "link" | "voice" | "file";
export type Provenance = { kind: SourceKind; sourceId: string | null; fp: string };
export type DupRow = { id: string; title: string; content: string; tags: string[]; url?: string | null; created_at: string };
export type Dup = { id: string; title: string; by: "source" | "content" };
export type DupChoice = "keep" | "merge" | "update";

/** FNV-1a 64-bit as 16 hex chars: stable, no crypto import, fits a 40-char tag. Not a security hash. */
export function hash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
}

/** Same page however it was pasted: lowercase host, no www., no #hash, no utm_/fbclid/gclid, no trailing slash. */
export function normUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch { return raw.trim(); }
}

export const fingerprint = (text: string) => hash(normText(text));
const EMPTY = fingerprint("");

/** One shape for every capture. sourceId: the normalized URL, "vault:<file>" for a VAULT file, "sha:<bytes hash>" for an upload. */
export function provenance(i: { source: string; content: string; url?: string | null; vault?: string | null; fileHash?: string | null }): Provenance {
  const kind: SourceKind = i.url ? "link" : i.vault || i.fileHash || i.source === "upload" ? "file" : /voice/.test(i.source) ? "voice" : "note";
  const sourceId = i.url ? normUrl(i.url) : i.vault ? `vault:${i.vault}` : i.fileHash ? `sha:${i.fileHash}` : null;
  return { kind, sourceId, fp: fingerprint(i.content) };
}

export const provenanceTags = (p: Provenance) => [`via:${p.kind}`, `fp:${p.fp}`, ...(p.sourceId ? [`sid:${hash(p.sourceId)}`] : [])];
/** Provenance tags are bookkeeping, not the owner's topics: hidden in lists. */
export const isProvTag = (t: string) => /^(via|fp|sid|v):/.test(t);

/** The existing memory this capture repeats: same stable source first, else the same normalized text. History copies and
 *  rows the owner marked as a separate version of each other ("v:<id>") never count. */
export function findDuplicate(p: Provenance, rows: DupRow[]): Dup | null {
  const live = rows.filter((r) => !r.tags.includes("superseded"));
  const sid = p.sourceId && `sid:${hash(p.sourceId)}`;
  const bySrc = sid ? live.find((r) => r.tags.includes(sid) || (!!r.url && normUrl(r.url) === p.sourceId)) : undefined;
  if (bySrc) return { id: bySrc.id, title: bySrc.title, by: "source" };
  const byText = p.fp !== EMPTY && live.find((r) => r.tags.includes(`fp:${p.fp}`) || fingerprint(r.content) === p.fp);
  return byText ? { id: byText.id, title: byText.title, by: "content" } : null;
}

/** What the owner sees before choosing, and what each choice writes. keep: a new memory marked as a version of the old one;
 *  merge: the old one gains the new text (null = it already says it all); update: the new text replaces it (old kept as history). */
export function dupPlan(existing: Pick<DupRow, "id" | "content">, incoming: string, choice?: DupChoice) {
  const merged = mergedContent(existing.content, incoming);
  if (choice === "keep") return { create: true as const, tags: [`v:${existing.id}`] };
  if (choice === "merge") return { create: false as const, content: merged };
  if (choice === "update") return { create: false as const, content: incoming.trim() === existing.content.trim() ? null : incoming, history: true };
  return { preview: { existing: existing.content.slice(0, 400), merged: (merged ?? existing.content).slice(0, 600), changes: merged !== null } };
}
