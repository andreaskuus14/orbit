import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, MODEL, recordUsage } from "./claude";
import { blocked } from "./agent-replay";
import { improveView } from "./self-improve";
import { PATCH_SYSTEM, addSaved, checkDiff, handoffText, parsePatchReply, patchFile, patchName, patchPrompt, pickFiles, weekDrafts, type PatchResult, type SavedDraft } from "./self-improve-patch-pure";

// Draft a patch for one "Make ORBIT better" task (rules: self-improve-patch-pure.ts). Only on the owner's click; one model call with up to
// 4 source files as context; refused under Stop-all or the usage limit. Saves <data dir>/self-improve-patches/<week>-<task>.patch and
// returns the handoff text. index.json in that folder lists the drafts so the card shows them after a reload. It never applies, commits, pushes or deploys anything: no git, no writes outside that folder.

const MAX_FILE = 40_000; // chars per context file; bigger files are cut

const DIR = () => path.join(orbitDataDir(), "self-improve-patches");
const INDEX = () => path.join(DIR(), "index.json");

async function loadIndex(): Promise<SavedDraft[]> {
  let raw: string;
  try { raw = await readFile(INDEX(), "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const x = JSON.parse(raw) as SavedDraft[]; // a broken index throws instead of being overwritten
  if (!Array.isArray(x)) throw new Error("self-improve-patches/index.json is unreadable; fix or move it aside.");
  return x;
}

/** This week's saved drafts per task key, for the card after a reload. */
export async function savedDrafts(sb: SupabaseClient, userId: string): Promise<Record<string, PatchResult>> {
  return weekDrafts(await loadIndex(), (await improveView(sb, userId)).week);
}

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
    const dir = DIR(), index = await loadIndex();
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, patchName(week, t.key, await readdir(dir)));
    await writeFile(file, patchFile(t, d, week), { flag: "wx" }); // wx: never overwrite an older draft
    const saved = { week, key: t.key, file, handoff: handoffText(t, d, file), rationale: d.rationale, test: d.test };
    await writeFile(INDEX() + ".tmp", JSON.stringify(addSaved(index, saved), null, 1));
    await rename(INDEX() + ".tmp", INDEX());
    return { file, handoff: saved.handoff, rationale: d.rationale, test: d.test };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Drafting failed" };
  } finally { g.__orbitPatchBusy = false; }
}
