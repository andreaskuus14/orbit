// CORE command workspace (roadmap 7.1–7.3, 7.9): what the last turn produced and how far its work honestly got. Pure; tests in
// tests/core-workspace-pure.test.ts. UI: src/components/CoreWorkspace.tsx.
import type { WriteEvidence } from "./completion-pure.ts";

type Step = { step: string; detail: string; ok: boolean; evidence?: WriteEvidence[] };
export type Artifact = { kind: "preview" | "diff" | "code" | "table" | "document"; title: string; body: string; href?: string };

/** The one thing a turn produced, most concrete first: a workspace preview, a diff/code block, a table, a long draft. */
export function turnArtifact(answer: string): Artifact | null {
  const href = answer.match(/(?:^|[\s(<])(\/w\/[^\s)>\]]+)/)?.[1];
  if (href) return { kind: "preview", title: "Preview", body: href, href };
  const blocks = [...answer.matchAll(/```([\w+-]*)\n([\s\S]*?)```/g)].sort((a, b) => b[2].length - a[2].length);
  if (blocks.length) {
    const [, lang, body] = blocks[0];
    const diff = lang === "diff" || /^(?:@@|\+\+\+|---) /m.test(body);
    return { kind: diff ? "diff" : "code", title: diff ? "Code diff" : lang ? `${lang} code` : "Code", body: body.replace(/\n$/, "") };
  }
  const table = answer.match(/^\|.*\|[ \t]*\n\|[ \t:|-]+\|[ \t]*\n(?:\|.*\|[ \t]*(?:\n|$))+/m);
  if (table) return { kind: "table", title: "Table", body: table[0].trimEnd() };
  const text = answer.replace(/\s*\[[ma]:[^\]]+\]/g, "").trim();
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (text.length >= 600 && (heading || text.split(/\n\s*\n/).length >= 3)) return { kind: "document", title: heading?.slice(0, 80) ?? "Draft", body: text };
  return null;
}

/** "Select a section → change this": the follow-up message CORE gets. The section is quoted as data. */
export function changeRequest(a: Pick<Artifact, "kind" | "title">, section: string, instruction: string): string {
  return `Change this part of the ${a.kind} "${a.title}" and give me the full updated version.\nPart:\n"""\n${section.trim().slice(0, 4000)}\n"""\nChange: ${instruction.trim()}`;
}

// Steps that only read or think: they never count as "executed".
const READS = new Set(["reflex", "search_memory", "think", "review", "fallback", "ws_list", "ws_read", "navigate", "web_search", "fetch_url", "read_url"]);
const label = (s: Step) => `${s.step.replace(/_/g, " ")}${s.detail ? ` — ${s.detail.replace(/\s+/g, " ").slice(0, 90)}` : ""}`;

export type Proof = "prepared" | "executed" | "verified";
export type Mission = { done: string[]; now: string | null; waiting: string[]; blockers: string[]; proof: Proof | null };

/** Completed steps, what runs now, what waits on the owner, what failed; and the honest proof level. No percentages. */
export function missionOf(trace: Step[] = [], activity: string[] = [], busy = false, produced = false): Mission {
  const done = trace.filter((s) => s.ok).map(label);
  const blockers = trace.filter((s) => !s.ok && s.step !== "fallback").map(label);
  const waiting = trace.some((s) => /awaiting_approval|can approve|needs? (?:your )?approval/i.test(s.detail)) ? ["Your approval in OPERATIONS"] : [];
  const acted = trace.filter((s) => s.ok && !READS.has(s.step));
  const checked = acted.some((s) => s.evidence?.length || /Check: checked/.test(s.detail) && !/Problems|Still open/.test(s.detail));
  const proof: Proof | null = checked ? "verified" : acted.length ? "executed" : produced || done.length ? "prepared" : null;
  return { done, now: busy ? activity.at(-1) ?? "Starting" : null, waiting, blockers, proof };
}

/** A voice follow-up that arrives mid-job only cancels it when it says so; anything else waits its turn. */
export const cancelsJob = (text: string) => /^\s*(?:(?:ok(?:ay)?|hey|orbit|core)[,\s]+)*(?:stop|cancel|abort|never ?mind|forget (?:it|that))\b/i.test(text);

/** Deliverable cards for a turn: the workspace files it wrote, one per file (the last write wins), in write order. */
export function deliverables(evidence: WriteEvidence[]): (WriteEvidence & { path: string })[] {
  const by = new Map<string, WriteEvidence & { path: string }>();
  for (const e of evidence) if (e.kind === "file" && e.path) { by.delete(`${e.id}/${e.path}`); by.set(`${e.id}/${e.path}`, { ...e, path: e.path }); }
  return [...by.values()];
}
