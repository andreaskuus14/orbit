// Job fit, model side: the owner's profile + best-matching memories (journal excluded: LIFE data never goes to a model) →
// one scored, validated assessment with draft texts; one repair round. Nothing is saved, sent or applied. Rules: job-fit-pure.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "./claude";
import { searchMemories } from "./memory";
import { FIT_SYSTEM, fitPrompt, parseFit, type Fit } from "./job-fit-pure";

export async function jobFit(sb: SupabaseClient, userId: string, posting: string, signal?: AbortSignal): Promise<Fit | { error: string }> {
  const { data: p } = await sb.from("profiles").select("display_name, interests, projects, goals").eq("id", userId).maybeSingle();
  const profile = p ? [p.display_name && `Name: ${p.display_name}`, p.interests?.length && `Interests: ${p.interests.join(", ")}`, p.projects?.length && `Projects: ${p.projects.join(", ")}`, p.goals?.length && `Goals: ${p.goals.join(", ")}`].filter(Boolean).join("\n") : "";
  const mem = await searchMemories(sb, posting.slice(0, 400), 10, userId).catch(() => ({ results: [] as { title: string; content?: string; kind?: string }[] }));
  const memories = (mem.results as { title: string; content?: string; kind?: string }[]).filter((m) => m.kind !== "journal").map((m) => `- ${m.title}: ${(m.content ?? "").slice(0, 300)}`).join("\n");
  const ask = (extra = "") => askClaude(fitPrompt(posting, profile, memories) + extra, FIT_SYSTEM, { purpose: "job fit", signal });
  let r = parseFit((await ask()).text);
  if ("error" in r) r = parseFit((await ask(`\n\nYour last reply was invalid (${r.error}). Output the whole JSON again.`)).text);
  return r;
}
