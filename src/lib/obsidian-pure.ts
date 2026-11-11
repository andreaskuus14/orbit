// Obsidian bridge: ORBIT's memories, their links and projects as a folder of linked Markdown notes (an Obsidian vault). Each memory is
// one note with YAML properties (orbit_id, kind, tags, dates, source), confirmed links become [[wikilinks]] (suggested ones are listed
// as "Maybe related"), projects get their own notes, and ORBIT.md is the map of contents. "ORBIT memories.base" gives a sortable
// table view in Obsidian Bases. Journal entries stay out unless asked for (a vault is often synced). Route: /api/export/obsidian.
// Tests: tests/obsidian.test.ts.

export type Mem = { id: string; kind: string; title: string; content: string | null; url?: string | null; tags?: string[] | null; created_at: string; updated_at?: string | null };
export type Link = { from_id: string; to_id: string; status: string };
export type Project = { id: string; name: string; description: string; status: string; created_at: string };

/** A file name Obsidian, Windows and macOS all accept (no \ / : * ? " < > | # ^ [ ]), trimmed, never empty. */
export const safeName = (t: string) => t.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/, "") || "Untitled";
const yamlStr = (s: string) => JSON.stringify(s); // JSON strings are valid YAML scalars
const KIND_DIR: Record<string, string> = { note: "Notes", idea: "Ideas", link: "Links", document: "Documents", image: "Images", research: "Research", conversation: "Conversations",
  project: "Projects", preference: "Preferences", decision: "Decisions", goal: "Goals", journal: "Journal" };
const dir = (kind: string) => KIND_DIR[kind] ?? "Other";

/** Note names, unique per vault (Obsidian resolves [[links]] by name): a clash gets the date, then a counter. */
export function noteNames(ms: Mem[]): Map<string, string> {
  const used = new Set<string>(), out = new Map<string, string>();
  for (const m of [...ms].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    let n = safeName(m.title);
    if (used.has(n.toLowerCase())) n = `${n} (${m.created_at.slice(0, 10)})`;
    for (let k = 2; used.has(n.toLowerCase()); k++) n = `${safeName(m.title)} (${k})`;
    used.add(n.toLowerCase()); out.set(m.id, n);
  }
  return out;
}

export function vault(input: { memories: Mem[]; links: Link[]; projects: Project[]; includeJournal?: boolean; exportedAt: string }): Record<string, string> {
  const ms = input.memories.filter((m) => input.includeJournal || m.kind !== "journal");
  const names = noteNames(ms), files: Record<string, string> = {};
  const linked = (id: string, status: string) => input.links.filter((l) => l.status === status && (l.from_id === id || l.to_id === id))
    .map((l) => names.get(l.from_id === id ? l.to_id : l.from_id)).filter((n): n is string => !!n);
  for (const m of ms) {
    const tags = (m.tags ?? []).map((t) => t.replace(/[^\p{L}\p{N}_/-]/gu, "-")).filter(Boolean);
    const props = [`orbit_id: ${m.id}`, `kind: ${m.kind}`, ...(tags.length ? [`tags:`, ...tags.map((t) => `  - ${yamlStr(t)}`)] : []),
      `created: ${m.created_at.slice(0, 10)}`, ...(m.updated_at ? [`updated: ${m.updated_at.slice(0, 10)}`] : []), ...(m.url ? [`source: ${yamlStr(m.url)}`] : [])];
    const sure = [...new Set(linked(m.id, "confirmed"))], maybe = [...new Set(linked(m.id, "suggested"))].filter((n) => !sure.includes(n));
    files[`${dir(m.kind)}/${names.get(m.id)}.md`] = `---\n${props.join("\n")}\n---\n\n${(m.content ?? "").trim()}\n`
      + (sure.length ? `\n## Linked\n${sure.map((n) => `- [[${n}]]`).join("\n")}\n` : "")
      + (maybe.length ? `\n## Maybe related\n${maybe.map((n) => `- [[${n}]]`).join("\n")}\n` : "");
  }
  for (const p of input.projects) files[`Projects/${safeName(p.name)} (project).md`] = `---\norbit_id: ${p.id}\nkind: project\nstatus: ${p.status}\ncreated: ${p.created_at.slice(0, 10)}\n---\n\n${p.description.trim()}\n`;
  const byKind = new Map<string, string[]>();
  for (const m of ms) byKind.set(dir(m.kind), [...(byKind.get(dir(m.kind)) ?? []), names.get(m.id)!]);
  files["ORBIT.md"] = `---\nexported: ${input.exportedAt.slice(0, 16).replace("T", " ")}\n---\n\n# ORBIT\n\n${ms.length} memories, ${input.projects.length} projects. Exported from ORBIT; edits here don't flow back yet.\n\n`
    + [...byKind].sort().map(([d, ns]) => `## ${d} (${ns.length})\n${ns.slice(0, 30).map((n) => `- [[${n}]]`).join("\n")}${ns.length > 30 ? `\n- …and ${ns.length - 30} more in ${d}/` : ""}`).join("\n\n")
    + (input.projects.length ? `\n\n## Projects\n${input.projects.map((p) => `- [[${safeName(p.name)} (project)]] · ${p.status}`).join("\n")}` : "") + "\n";
  files["ORBIT memories.base"] = `filters: 'if(orbit_id, true, false)'\nformulas:\n  age_days: 'if(created, (today() - date(created)).days, "")'\nproperties:\n  formula.age_days:\n    displayName: "Days old"\nviews:\n  - type: table\n    name: "All memories"\n    groupBy:\n      property: kind\n      direction: ASC\n    order:\n      - file.name\n      - kind\n      - tags\n      - created\n      - formula.age_days\n  - type: cards\n    name: "Decisions"\n    filters: 'kind == "decision"'\n    order:\n      - file.name\n      - created\n`;
  return files;
}
