// "What ORBIT knows about you" (knows-pure.ts): reads every store that holds something about the owner, in parallel. Reads only:
// no model call, no embedder, nothing leaves ORBIT. A store that is missing (no migration yet) is listed in `missing`, not an error.
// Journal rows are read as id + date only (never title or content); other private-tagged rows are redacted by buildKnows.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listFacts } from "./facts";
import { listPeople } from "./people";
import { lessonsView } from "./lessons";
import { listMistakes } from "./mistake-memory";
import { skillsView } from "./skills";
import { currentVersion } from "./skills-pure";
import { loadPlaybookRow } from "./playbook";
import { PRIVATE_KIND_LIST } from "./private-pure";
import { ABOUT_KINDS, buildKnows, groupKnows, type EditCtx, type KnowsIn } from "./knows-pure";

export async function knowsView(sb: SupabaseClient, userId: string) {
  const missing: string[] = [];
  const soft = <T>(name: string, p: PromiseLike<T>, empty: T): Promise<T> => Promise.resolve(p).catch((e) => { missing.push(`${name}: ${e instanceof Error ? e.message.slice(0, 120) : "unavailable"}`); return empty; });
  const rows = <T>(r: { data: T[] | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data ?? []; };
  const [profile, playbook, facts, memories, journal, people, lessons, mistakes, skills] = await Promise.all([
    soft("profile", sb.from("profiles").select("display_name, interests, projects, goals, research_priorities, communication").eq("id", userId).maybeSingle().then((r) => r.data as KnowsIn["profile"]), null),
    soft("playbook", loadPlaybookRow(sb, userId).then((r) => ({ rules: r.rules, version: r.version })), { rules: [] as string[], version: 0 }),
    soft("beliefs", listFacts(sb, userId), []),
    soft("memories", sb.from("memories").select("id, kind, title, content, source, tags, created_at, updated_at").eq("user_id", userId).in("kind", [...ABOUT_KINDS]).not("kind", "in", PRIVATE_KIND_LIST).order("updated_at", { ascending: false }).limit(300).then(rows), []),
    soft("journal", sb.from("memories").select("id, created_at").eq("user_id", userId).eq("kind", "journal").order("created_at", { ascending: false }).limit(200).then(rows), []),
    soft("people", listPeople(sb, userId), []),
    soft("lessons", lessonsView(userId).then((v) => v.kept), []),
    soft("mistakes", listMistakes(userId), []),
    soft("skills", skillsView().then((v) => v.skills.map((s) => ({ s, v: currentVersion(s) }))), []),
  ]);
  const input: KnowsIn = {
    profile, rules: playbook.rules, facts, memories: memories as KnowsIn["memories"], journal: journal as KnowsIn["journal"],
    people: people.map((p) => ({ id: p.id, name: p.name, relation: p.relation, notes: p.notes, local: p.local, updated_at: p.updated_at })),
    lessons: lessons.map((l) => ({ id: l.id, text: l.text, area: l.area, at: l.decidedAt ?? l.at, status: l.status })),
    mistakes: mistakes.map((m) => ({ id: m.id, area: m.area, mistake: m.mistake, fix: m.fix, status: m.status, updatedAt: m.updatedAt })),
    skills: skills.filter((x) => x.v).map(({ s, v }) => ({ id: s.id, name: v.name, instruction: v.instruction, at: v.at })),
  };
  const ctx: EditCtx = { profile, playbook, skills: skills.filter((x) => x.v).map(({ s, v }) => ({ id: s.id, name: v.name, tools: v.tools, example: v.example })) };
  return { groups: groupKnows(buildKnows(input)), ctx, missing };
}
