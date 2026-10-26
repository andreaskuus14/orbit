import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { orbitDataDir } from "@/lib/data-dir";
import { pushSnapshot, readSnapshots, type Snapshot } from "@/lib/arch-time-pure";

export const dynamic = "force-dynamic";

// ARCH time machine: the model's saved states, last KEEP per user, in <ORBIT data dir>/arch-versions.json = {users: {id: Snapshot[]}}.
// GET → {versions} oldest first; POST {scene} → {versions} (an unchanged scene isn't stored twice). Local only, no model calls.
type State = { users: Record<string, unknown> };
const file = () => path.join(orbitDataDir(), "arch-versions.json");
const load = async (): Promise<State> => {
  try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.users && typeof j.users === "object" ? j : { users: {} }; } catch { return { users: {} }; }
};
async function store(s: State) {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify(s));
  await rename(file() + ".tmp", file());
}
let chain: Promise<unknown> = Promise.resolve(); // one read-modify-write at a time, so two quick saves can't drop each other

export async function GET() {
  const { user, res } = await requireUser();
  if (res) return res;
  return Response.json({ versions: readSnapshots((await load()).users[user.id]) });
}

export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { scene?: unknown } | null;
  const run = chain.then(async (): Promise<Snapshot[] | null> => {
    const s = await load(), next = pushSnapshot(readSnapshots(s.users[user.id]), b?.scene, new Date());
    if (next) { s.users[user.id] = next; await store(s); }
    return next;
  });
  chain = run.catch(() => {});
  try {
    const versions = await run;
    return versions ? Response.json({ versions }) : Response.json({ error: "Scene missing or too big" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: `Couldn't save the version: ${e instanceof Error ? e.message : "unknown error"}` }, { status: 500 });
  }
}
