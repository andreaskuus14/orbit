import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { emit } from "@/lib/claude";
import { SAFE_ID, homes, parseControl } from "@/lib/selfdev-pure";
import { redact } from "@/lib/health-pure";

export const dynamic = "force-dynamic";

// Self-development view: reads the supervisor's published status and the builder's state (both written by their own
// processes, outside the app) and forwards the owner's pause / stop / restore requests to the supervisor's inbox.
// It can't release, resume or clear a halt: those exist only on the supervisor's own command line. Signed-in only.

const readJson = async (f: string) => { try { return JSON.parse(await readFile(f, "utf8")) as unknown; } catch { return null; } };

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const h = homes(process.env);
  const q = new URL(req.url).searchParams;
  const diff = q.get("diff");
  if (diff) {
    if (!h.supervisor || !SAFE_ID.test(diff)) return Response.json({ error: "Unknown release" }, { status: 400 });
    const text = await readFile(path.join(h.supervisor, "public", "diffs", `${diff}.patch`), "utf8").catch(() => null);
    return text == null ? Response.json({ error: "No diff for that release" }, { status: 404 }) : new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const shot = q.get("shot"), task = q.get("task");
  if (shot && task) {
    if (!h.builder || !SAFE_ID.test(task) || !/^[a-z0-9_-]{1,40}\.png$/i.test(shot)) return Response.json({ error: "Unknown evidence" }, { status: 400 });
    const png = await readFile(path.join(h.builder, "evidence", task, shot)).catch(() => null);
    return png ? new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } }) : Response.json({ error: "Not found" }, { status: 404 });
  }
  const sup = h.supervisor ? await readJson(path.join(h.supervisor, "public", "status.json")) : null;
  const st = (h.builder ? await readJson(path.join(h.builder, "state.json")) : null) as
    | { task?: unknown; history?: unknown[]; decisions?: unknown[]; attempts?: unknown; day?: unknown } | null;
  const builder = st ? JSON.parse(redact(JSON.stringify({ task: st.task ?? null, history: (st.history ?? []).slice(0, 20), decisions: (st.decisions ?? []).slice(0, 10), attempts: st.attempts ?? {}, day: st.day ?? null }))) : null;
  return Response.json({ installed: { supervisor: !!h.supervisor, builder: !!h.builder }, supervisor: sup, builder });
}

export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const c = parseControl(await req.json().catch(() => null));
  if (!c) return Response.json({ error: "Only pause, stop or restore" }, { status: 400 });
  const h = homes(process.env);
  if (!h.supervisor) return Response.json({ error: "The release supervisor isn't installed on this PC" }, { status: 409 });
  const inbox = path.join(h.supervisor, "inbox");
  const f = path.join(inbox, `control-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  try {
    await mkdir(inbox, { recursive: true });
    await writeFile(f, JSON.stringify(c), { flag: "wx" }); // one write, no rename: the inbox grants no delete rights
    // Stop also halts the builder directly, in case the supervisor itself is down.
    if (c.action === "stop" && h.builder) await appendFile(path.join(h.builder, "STOP"), `${new Date().toISOString()} requested from ORBIT\n`);
  } catch (e) {
    return Response.json({ error: `Couldn't reach the supervisor's inbox: ${e instanceof Error ? e.message : e}` }, { status: 503 });
  }
  await emit(sb, user.id, "selfdev.control", "core", { action: c.action }).catch(() => {});
  return Response.json({ ok: true, queued: c.action });
}
