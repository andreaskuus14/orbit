import { requireUser } from "@/lib/supabase/server";
import { listDevices, newPair, remoteProblem, S, updateDevices } from "@/lib/remote";

export const dynamic = "force-dynamic";

// PC side of the phone remote (owner signed in). GET: {problem, pair, devices}. POST {action:"pair"} shows a fresh 2-minute code;
// {action:"revoke", id} unpairs a device at once (its token stops working on the next request).
const view = async () => {
  const p = S.pair;
  const live = p && !p.used && p.fails < 5 && Date.now() < p.expiresAt;
  const devices = (await listDevices()).map(({ id, name, createdAt }) => ({ id, name, createdAt, lastSeen: S.seen.get(id) ?? null }));
  return { problem: remoteProblem(), pair: live ? { code: p.code, expiresAt: p.expiresAt } : null, devices };
};

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await view());
}

export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
  if (b?.action === "pair") {
    const problem = remoteProblem();
    if (problem) return Response.json({ error: problem }, { status: 503 });
    newPair(user.id);
  } else if (b?.action === "revoke" && typeof b.id === "string") {
    const id = b.id;
    await updateDevices((ds) => ds.filter((d) => d.id !== id));
    S.seen.delete(id); S.chat.delete(id);
  } else return Response.json({ error: "action must be pair or revoke" }, { status: 400 });
  return Response.json(await view());
}
