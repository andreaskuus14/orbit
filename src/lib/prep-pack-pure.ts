// Application prep pack (Atlas D05): a checklist of what an application needs, matched against VAULT files. Every requirement
// carries the page it came from and when that page was read; nothing is guessed. A requirement without a source or a confirmed
// date is "unresolved", never silently ready. Pure; tests in tests/prep-pack.test.ts.
import type { VaultFile } from "./vault-pure.ts";

export type Source = { title: string; url: string; read: string }; // read: ISO date the page was read
export type Requirement = { id: string; label: string; match: string[]; source?: Source; due?: string; dueConfirmed?: boolean; optional?: boolean };
export type Status = "ready" | "missing" | "unresolved" | "overdue";
export type Item = { id: string; label: string; status: Status; file?: string; due?: string; daysLeft?: number; why: string; cite?: Source; optional: boolean };

const DAY = 86_400_000;
const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const STALE_DAYS = 30; // a requirements page read longer ago than this may have changed

/** Status per requirement. `now` and dates are ISO/epoch in UTC; days are whole calendar days left until the due date. */
export function prepPack(reqs: readonly Requirement[], files: readonly Pick<VaultFile, "name">[], now: number): Item[] {
  return reqs.map((r) => {
    const file = files.find((f) => r.match.some((m) => norm(f.name).includes(norm(m))))?.name;
    const due = r.due && /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/.test(r.due) && !Number.isNaN(Date.parse(r.due)) ? r.due : undefined; // ISO only: V8 parses "spring 2027" as a date
    const daysLeft = due ? Math.ceil((Date.parse(due) - now) / DAY) : undefined;
    const base = { id: r.id, label: r.label, file, due, daysLeft, cite: r.source, optional: !!r.optional };
    if (!r.source) return { ...base, status: "unresolved" as const, why: "no source page: confirm this requirement on the official site" };
    if (Date.parse(r.source.read) < now - STALE_DAYS * DAY) return { ...base, status: "unresolved" as const, why: `source read more than ${STALE_DAYS} days ago: check it again` };
    if (r.due && !due) return { ...base, status: "unresolved" as const, why: `deadline "${r.due}" isn't a date: confirm it` };
    if (due && r.dueConfirmed === false) return { ...base, status: "unresolved" as const, why: "deadline not confirmed for this year" };
    if (file) return { ...base, status: "ready" as const, why: `found in VAULT: ${file}` };
    if (daysLeft !== undefined && daysLeft < 0) return { ...base, status: "overdue" as const, why: `deadline passed ${-daysLeft} day(s) ago` };
    return { ...base, status: "missing" as const, why: r.optional ? "optional, not in VAULT" : "not in VAULT yet" };
  });
}

const ORDER: Record<Status, number> = { overdue: 0, missing: 1, unresolved: 2, ready: 3 };

/** The pack as Markdown: most urgent first, each line citing its source; a summary line up top. */
export function prepMarkdown(title: string, items: readonly Item[]): string {
  const need = items.filter((i) => !i.optional && i.status !== "ready");
  const sorted = [...items].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  const box = (s: Status) => (s === "ready" ? "[x]" : "[ ]");
  const lines = sorted.map((i) => `- ${box(i.status)} **${i.label}**${i.optional ? " (optional)" : ""}: ${i.status}${i.due ? `, due ${i.due.slice(0, 10)}${i.daysLeft !== undefined && i.daysLeft >= 0 ? ` (${i.daysLeft} days)` : ""}` : ""}. ${i.why}.${i.cite ? ` Source: [${i.cite.title}](${i.cite.url}), read ${i.cite.read.slice(0, 10)}` : ""}`);
  return [`# ${title}`, "", need.length ? `${need.length} required item(s) still open.` : "Every required item is ready.", "", ...lines, ""].join("\n");
}
