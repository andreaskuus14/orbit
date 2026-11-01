import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { orbitDataDir } from "@/lib/data-dir";
import { acceptSave, type Saved } from "@/lib/arch-save-pure";
import { projectScope } from "@/lib/project-access";
import { archScopeKey } from "@/lib/project-desk-pure";

export const dynamic = "force-dynamic";

// ARCH active model (ARC01): the latest {rev, scene, prices, site} per user in <ORBIT data dir>/arch-scene.json, same store
// pattern as /api/arch/versions (no migration). GET → {saved|null}; POST {rev, scene, prices, site} → {rev} or 409 if a newer rev is stored.
type State = { users: Record<string, Saved> };
const file = () => path.join(orbitDataDir(), "arch-scene.json");
const MAX = 2_000_000;
const load = async (): Promise<State> => {
  try { const j = JSON.parse(await readFile(file(), "utf8")); if (!j?.users || typeof j.users !== "object" || Array.isArray(j.users)) throw new Error("Invalid ARCH store"); return j; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { users: {} }; throw e; }
};
async function store(s: State) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}
let chain: Promise<unknown> = Promise.resolve();

export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const project = await projectScope(req, sb, user.id);
  if (project instanceof Response) return project;
  const key = archScopeKey(user.id, project);
  return Response.json({ saved: (await load()).users[key] ?? null });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const project = await projectScope(req, sb, user.id);
  if (project instanceof Response) return project;
  const key = archScopeKey(user.id, project);
  const text = await req.text();
  if (text.length > MAX) return Response.json({ error: "Scene too big" }, { status: 413 });
  let b: Partial<Saved> | null = null;
  try { b = JSON.parse(text); } catch { /* handled below */ }
  if (!b || !Array.isArray(b.scene?.parts)) return Response.json({ error: "Scene missing" }, { status: 400 });
  const body = b;
  const run = chain.then(async () => {
    const s = await load(), cur = s.users[key];
    if (!acceptSave(cur, body.rev)) return { stale: cur?.rev ?? 0 };
    s.users[key] = { rev: body.rev as number, scene: body.scene!, prices: body.prices, site: body.site, variants: body.variants, at: new Date().toISOString() };
    await store(s);
    return { rev: body.rev as number };
  });
  chain = run.catch(() => {});
  try {
    const r = await run;
    return "stale" in r ? Response.json({ error: "A newer version is saved", rev: r.stale }, { status: 409 }) : Response.json(r);
  } catch (e) {
    return Response.json({ error: `Couldn't save: ${e instanceof Error ? e.message : "unknown error"}` }, { status: 500 });
  }
}
