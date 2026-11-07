import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { archScopeKey, deskInput, emptyDesk, type Desk } from "./project-desk-pure.ts";

type Store = Record<string, Desk>;
const file = () => path.join(orbitDataDir(), "project-desks.json");
const state = globalThis as unknown as { __orbitProjectDesk?: Promise<unknown> };
function checked(raw: Desk | undefined): Desk {
  if (raw === undefined) return emptyDesk();
  if (typeof deskInput(raw) === "string" || !Number.isSafeInteger(raw.rev) || raw.rev < 0) throw new Error("Invalid project desk record");
  return raw;
}
async function read(): Promise<Store> {
  try {
    const data = JSON.parse(await readFile(file(), "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid project desk store");
    return data;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
}
export async function getDesk(user: string, project: string): Promise<Desk> {
  await state.__orbitProjectDesk?.catch(() => {});
  return checked((await read())[archScopeKey(user, project)]);
}
/** Export only this user's metadata; linked VAULT file bytes remain in the existing VAULT storage.
 *  An invalid record is left out (it stays in project-desks.json) and named in `warning`, so one bad desk can't empty the section. */
export async function exportDesks(user: string): Promise<{ desks: Record<string, Desk>; skipped: string[]; warning?: string }> {
  await state.__orbitProjectDesk?.catch(() => {});
  const prefix = `${user}:`, desks: Record<string, Desk> = {}, skipped: string[] = [];
  for (const [key, desk] of Object.entries(await read())) {
    if (!key.startsWith(prefix)) continue;
    try { desks[key.slice(prefix.length)] = checked(desk); } catch { skipped.push(key.slice(prefix.length)); }
  }
  if (!skipped.length) return { desks, skipped };
  const warning = `${skipped.length} project desk record(s) were invalid and left out of this export: ${skipped.join(", ")}. They are unchanged in project-desks.json.`;
  console.warn(`[project-desk] ${warning}`);
  return { desks, skipped, warning };
}
/** Exact revision check prevents a stale tab from replacing newer notes/references. */
export function saveDesk(user: string, project: string, rev: number, input: Omit<Desk, "rev">): Promise<Desk | null> {
  const run = (state.__orbitProjectDesk ?? Promise.resolve()).catch(() => {}).then(async () => {
    const store = await read(), key = archScopeKey(user, project), current = checked(store[key]);
    if (current.rev !== rev) return null;
    const next = { ...input, rev: rev + 1 }; store[key] = next;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(store));
    await rename(file() + ".tmp", file());
    return next;
  });
  state.__orbitProjectDesk = run;
  return run;
}
