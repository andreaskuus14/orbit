import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { MEMORY_COLUMNS } from "./memory-search";
import { buildPack, outdatedSince, parsePacks, type Pack, type PackRec } from "./memory-pack-pure";

// MEM08 handover packs, I/O (rules: memory-pack-pure.ts). Saved revisions: <ORBIT data dir>/packs.json, per user and project.
const file = () => path.join(orbitDataDir(), "packs.json");
const g = globalThis as unknown as { __orbitPacks?: Promise<unknown> };
async function load() {
  const s = parsePacks(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("packs.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}

/** The project's records (scope tag or folder). The pure guard then drops everything that may not be in a pack. */
async function rows(sb: SupabaseClient, project: string): Promise<PackRec[]> {
  const [a, b] = await Promise.all([
    sb.from("memories").select(MEMORY_COLUMNS).contains("tags", [`scope:${project}`]).limit(1000),
    sb.from("memories").select(MEMORY_COLUMNS).ilike("folder", project.replace(/[%_\\]/g, "\\$&")).limit(1000),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  const by = new Map<string, PackRec>();
  for (const r of [...(a.data ?? []), ...(b.data ?? [])] as unknown as PackRec[]) by.set(r.id, { ...r, tags: r.tags ?? [], content: r.content ?? "", title: r.title ?? "" });
  return [...by.values()];
}

/** Current pack (not saved), the last saved revision, and since when that saved one is outdated. */
export async function packView(sb: SupabaseClient, userId: string, project: string, now = Date.now()) {
  const [rs, s] = await Promise.all([rows(sb, project), load()]);
  const saved: Pack | null = s[userId]?.[project.toLowerCase()] ?? null;
  return { saved, current: buildPack(rs, project, now, saved), outdatedSince: saved ? outdatedSince(saved, rs, now) : null };
}

/** Saves the current pack as the project's revision (same content keeps its revision number). One write at a time. */
export function savePack(sb: SupabaseClient, userId: string, project: string): Promise<Pack> {
  const p = (g.__orbitPacks ?? Promise.resolve()).catch(() => {}).then(async () => {
    const { current } = await packView(sb, userId, project);
    const s = await load();
    (s[userId] ??= {})[project.toLowerCase()] = current;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return current;
  });
  g.__orbitPacks = p;
  return p;
}
