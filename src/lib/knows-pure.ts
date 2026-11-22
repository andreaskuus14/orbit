// "What ORBIT knows about you": one readable list of what ORBIT has learned or stored about the owner, built from the stores
// that already exist (profile, playbook style rules, beliefs, memories, people, lessons, mistakes, skills). Pure (server, tests,
// browser). No model ever sees this page: the route only reads and the edits go to each store's own endpoint.
// Journal / LIFE rows (private-pure.ts) come out as "Journal entry · date" with no title, no text and no edit: only ids and dates.
import { isPrivate } from "./private-pure.ts";

export type Group = "you" | "prefs" | "people" | "projects" | "lessons" | "skills" | "journal";
export const GROUPS: readonly Group[] = ["you", "prefs", "people", "projects", "lessons", "skills", "journal"];
export type Store = "profile" | "playbook" | "fact" | "memory" | "person" | "lesson" | "mistake" | "skill" | "journal";
export type Src = "profile" | "playbook" | "said" | "inferred" | "document" | "memory" | "memoryCore" | "person" | "lessonFix" | "lesson" | "mistake" | "skill" | "journal";
/** label: a short name shown in bold (field, subject, person, memory title). text: what ORBIT holds (what Edit changes). */
export type KnowItem = { key: string; group: Group; store: Store; id: string; label?: string; text: string; src: Src; at?: string; edit: boolean; del: boolean };

export type ProfileIn = { display_name?: string | null; interests?: string[]; projects?: string[]; goals?: string[]; research_priorities?: string[]; communication?: string | null } | null;
export type FactIn = { id: string; subject: string; statement: string; status: string; source: string; updated_at?: string; created_at?: string; entity_id?: string | null };
export type MemoryIn = { id: string; kind: string; title?: string; content?: string; source?: string | null; tags?: string[] | null; created_at?: string; updated_at?: string };
export type PersonIn = { id: string; name: string; relation?: string; notes?: string; local?: boolean; updated_at?: string };
export type LessonIn = { id: string; text: string; area?: string; at?: string; status?: string };
export type MistakeIn = { id: string; area?: string; mistake: string; fix: string; status?: string; updatedAt?: string };
export type SkillIn = { id: string; name: string; instruction: string; at?: string };
export type KnowsIn = { profile?: ProfileIn; rules?: string[]; facts?: FactIn[]; memories?: MemoryIn[]; journal?: { id: string; created_at?: string }[];
  people?: PersonIn[]; lessons?: LessonIn[]; mistakes?: MistakeIn[]; skills?: SkillIn[] };

/** Memory kinds that are about him (the rest, like notes, links and chat summaries, live on the MEMORY planet). */
export const ABOUT_KINDS = ["preference", "project", "goal", "decision"] as const;
const PROFILE_LISTS = ["interests", "projects", "goals", "research_priorities"] as const;
export type ProfileList = (typeof PROFILE_LISTS)[number];
const clip = (s: string | undefined | null, n: number) => { const x = (s ?? "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };

/** A long memory shows its start and is edited on the MEMORY planet (an edit here would cut it). */
export const EDIT_MAX = 4000;
const longText = (c: string | undefined) => { const t = (c ?? "").trim(); return t.length > EDIT_MAX ? { text: clip(t, 600), edit: false } : { text: t, edit: true }; };

export function buildKnows(x: KnowsIn): KnowItem[] {
  const out: KnowItem[] = [];
  const push = (i: Omit<KnowItem, "key">) => out.push({ ...i, key: `${i.store}:${i.id}` });
  const p = x.profile;
  if (p?.display_name) push({ group: "you", store: "profile", id: "display_name", label: "name", text: p.display_name, src: "profile", edit: true, del: true });
  for (const k of PROFILE_LISTS) (p?.[k] ?? []).forEach((v, n) => push({ group: k === "projects" || k === "goals" ? "projects" : "you", store: "profile", id: `${k}:${n}`, label: k.replace("_", " "), text: v, src: "profile", edit: true, del: true }));
  if (p?.communication?.trim()) push({ group: "prefs", store: "profile", id: "communication", label: "communication", text: p.communication.trim(), src: "profile", edit: true, del: true });
  (x.rules ?? []).forEach((r, n) => push({ group: "prefs", store: "playbook", id: String(n), text: r, src: "playbook", edit: true, del: true }));
  for (const f of x.facts ?? []) {
    if (f.status !== "current") continue;
    push({ group: f.entity_id ? "people" : "you", store: "fact", id: f.id, label: f.subject, text: f.statement, src: f.source === "user_said" ? "said" : f.source === "document" ? "document" : "inferred", at: f.updated_at ?? f.created_at, edit: true, del: true });
  }
  for (const m of x.memories ?? []) {
    if (isPrivate(m)) { push({ group: "journal", store: "journal", id: m.id, text: "", src: "journal", at: m.created_at, edit: false, del: false }); continue; } // never its title or text
    if (!(ABOUT_KINDS as readonly string[]).includes(m.kind)) continue;
    push({ group: m.kind === "preference" ? "prefs" : "projects", store: "memory", id: m.id, label: clip(m.title, 80), ...longText(m.content), src: /^core/.test(m.source ?? "") ? "memoryCore" : "memory", at: m.updated_at ?? m.created_at, del: true });
  }
  for (const j of x.journal ?? []) push({ group: "journal", store: "journal", id: j.id, text: "", src: "journal", at: j.created_at, edit: false, del: false });
  for (const pp of x.people ?? []) push({ group: "people", store: "person", id: pp.id, label: [pp.name, pp.relation].filter(Boolean).join(" · "), text: pp.notes ?? "", src: "person", at: pp.updated_at, edit: pp.local !== false, del: pp.local !== false });
  for (const l of x.lessons ?? []) if (!l.status || l.status === "kept") push({ group: "lessons", store: "lesson", id: l.id, text: l.text, src: l.area === "correction" ? "lessonFix" : "lesson", at: l.at, edit: true, del: true });
  for (const m of x.mistakes ?? []) if (m.status !== "archived") push({ group: "lessons", store: "mistake", id: m.id, label: clip(m.mistake, 120), text: m.fix, src: "mistake", at: m.updatedAt, edit: true, del: true });
  for (const s of x.skills ?? []) push({ group: "skills", store: "skill", id: s.id, label: s.name, text: s.instruction, src: "skill", at: s.at, edit: true, del: true });
  // dedupe (a journal row can come in both ways)
  return [...new Map(out.map((i) => [i.key, i])).values()];
}

/** Groups in a fixed, plain order; empty groups dropped; journal newest first, the rest as stored. */
export function groupKnows(items: readonly KnowItem[]): { group: Group; items: KnowItem[] }[] {
  return GROUPS.map((group) => {
    const g = items.filter((i) => i.group === group);
    return { group, items: group === "journal" ? [...g].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")) : g };
  }).filter((g) => g.items.length);
}

/** The one-line text shown for an item: a journal entry never shows more than its date. */
export const itemLine = (i: KnowItem, journalWord: string) => (i.store === "journal" ? `${journalWord}${i.at ? ` · ${i.at.slice(0, 10)}` : ""}` : i.text);

export type Req = { url: string; method: "POST" | "PUT" | "PATCH" | "DELETE"; body?: Record<string, unknown> };
/** Context some stores need for a write: the profile's current lists and the playbook's rules + version (optimistic lock). */
export type EditCtx = { profile?: ProfileIn; playbook?: { rules: string[]; version: number }; skills?: { id: string; name: string; tools: string[]; example?: string }[] };

/** The existing endpoint call for an edit (value = new text) or a delete (value = null). A string = why it can't be done. */
export function knowRequest(i: KnowItem, value: string | null, c: EditCtx = {}): Req | string {
  if (i.store === "journal") return "Journal entries are edited in LIFE → Journal";
  if (value !== null && !value.trim()) return "Type something, or use Delete";
  const v = value?.trim() ?? null;
  if (value !== null && !i.edit) return "This one can't be edited here";
  if (value === null && !i.del) return "This one can't be deleted here";
  switch (i.store) {
    case "profile": {
      if (i.id === "display_name") return { url: "/api/profile", method: "PUT", body: { display_name: v ?? "" } };
      if (i.id === "communication") return { url: "/api/profile", method: "PUT", body: { communication: v ?? "" } };
      const [k, n] = i.id.split(":") as [ProfileList, string];
      if (!(PROFILE_LISTS as readonly string[]).includes(k)) return "Unknown profile field";
      const list = [...(c.profile?.[k] ?? [])], at = Number(n);
      if (list[at] !== i.text) return "Your profile changed meanwhile: reload";
      if (v === null) list.splice(at, 1); else list[at] = v;
      return { url: "/api/profile", method: "PUT", body: { [k]: list } };
    }
    case "playbook": {
      if (!c.playbook) return "Reload first";
      const rules = [...c.playbook.rules], at = Number(i.id);
      if (rules[at] !== i.text) return "The rules changed meanwhile: reload";
      if (v === null) rules.splice(at, 1); else rules[at] = v;
      return { url: "/api/playbook", method: "POST", body: { action: "set", rules, version: c.playbook.version } };
    }
    case "fact": return v === null ? { url: "/api/facts", method: "POST", body: { action: "forget", id: i.id } } : { url: "/api/facts", method: "POST", body: { action: "edit", id: i.id, subject: i.label ?? "", statement: v } };
    case "memory": return v === null ? { url: `/api/memories/${encodeURIComponent(i.id)}`, method: "DELETE" } : { url: `/api/memories/${encodeURIComponent(i.id)}`, method: "PATCH", body: { content: v } };
    case "person": return { url: "/api/people", method: "POST", body: v === null ? { action: "delete", id: i.id } : { action: "update", id: i.id, notes: v } };
    case "lesson": return { url: "/api/lessons", method: "POST", body: v === null ? { id: i.id, decision: "reject" } : { action: "edit", id: i.id, text: v } };
    case "mistake": return v === null ? { url: `/api/mistakes?id=${encodeURIComponent(i.id)}`, method: "DELETE" } : { url: "/api/mistakes", method: "PATCH", body: { id: i.id, fix: v } };
    case "skill": {
      if (v === null) return { url: "/api/skills", method: "POST", body: { action: "delete", id: i.id } };
      const s = c.skills?.find((x) => x.id === i.id);
      if (!s) return "Reload first";
      return { url: "/api/skills", method: "POST", body: { action: "edit", id: i.id, name: s.name, tools: s.tools, example: s.example ?? "", instruction: v } };
    }
  }
  return "Unknown item";
}
