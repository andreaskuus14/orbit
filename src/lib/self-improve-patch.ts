import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, MODEL, recordUsage } from "./claude";
import { blocked } from "./agent-replay";
import { improveView } from "./self-improve";
import { PATCH_SYSTEM, checkDiff, handoffText, parsePatchReply, patchFile, patchPrompt, pickFiles, slug, type PatchResult } from "./self-improve-patch-pure";

// Draft a patch for one "Make ORBIT better" task (rules: self-improve-patch-pure.ts). Only on the owner's click; one model call with up to
// 4 source files as context; refused under Stop-all or the usage limit. Saves <data dir>/self-improve-patches/<week>-<task>.patch and
// returns the handoff text. It never applies, commits, pushes or deploys anything: no git, no writes outside that folder.

const MAX_FILE = 40_000; // chars per context file; bigger files are cut

const g = globalThis as unknown as { __orbitPatchBusy?: boolean };

async function repoFiles(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ["src", "tests", "evals"]) {
    const xs = await readdir(path.join(process.cwd(), dir), { recursive: true }).catch(() => [] as string[]);
    out.push(...xs.map((x) => `${dir}/${String(x).split(path.sep).join("/")}`));
  }
  return out;
}

export async function draftPatch(sb: SupabaseClient, userId: string, key: string): Promise<PatchResult> {
  const why = g.__orbitPatchBusy ? "A patch is already being drafted" : blocked(false);
  if (why) return { error: why };
  const { week, tasks } = await improveView(sb, userId);
  const t = tasks.find((x) => x.key === key);
  if (!t) return { error: "That task is no longer on this week's list" };
  g.__orbitPatchBusy = true;
  try {
    const picked = pickFiles(t, await repoFiles());
    const files = await Promise.all(picked.map(async (p) => ({ path: p, text: (await readFile(path.join(process.cwd(), p), "utf8")).slice(0, MAX_FILE) })));
    const a = await askClaude(patchPrompt(t, files), PATCH_SYSTEM, { lane: "foreground", model: MODEL, purpose: "self-improve-patch", timeoutMs: 240_000 });
    await recordUsage(sb, userId, "self-improve-patch", a, MODEL);
    const d = parsePatchReply(a.text);
    if (!d) return { error: "The model didn't return a diff. Try again or copy the brief instead." };
    const problems = checkDiff(d.diff);
    if (problems.length) return { error: "Refused: the draft breaks ORBIT's safety rules, so it was not saved.", problems };
    const dir = path.join(orbitDataDir(), "self-improve-patches"), file = path.join(dir, `${week}-${slug(t.key)}.patch`);
    await mkdir(dir, { recursive: true });
    await writeFile(file, patchFile(t, d, week));
    return { file, handoff: handoffText(t, d, file), rationale: d.rationale, test: d.test };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Drafting failed" };
  } finally { g.__orbitPatchBusy = false; }
}
